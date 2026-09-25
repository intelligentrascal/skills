// Wayfinder map snapshot: patch and validation (spec §4a). The same shape is used for
// maps/<key>/map.json (written only by the hub, decision D4) and for a session's state.map.
//
// Map patch rules (same spirit as the session patch in state.mjs):
//   null deletes a top-level key
//   tickets, closed, decisions: keyed by title. A known title merges one level (a null field
//     deletes it), a new title is appended, and {"title": T, "remove": true} drops that entry
//     (a no-op when T is unknown). A ticket resolved in this patch is typically removed from
//     tickets and added to closed in the same patch, so blockedBy edges stay valid.
//   listener: rejected (written by the hub from heartbeats)
//   tickets[].hubClaim: rejected (written by the hub: claim / claim --release). A ticket removed
//     and re-added under the same title in one patch keeps its hubClaim. The hub's own claim
//     code passes { hub: true } to write it.
//   handled: only increases; a lower value (or null) is ignored
//   any other key (fog, outOfScope, title, …): replaced whole
//   at: always stamped with `now`
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { die, isObj, oneLine, print, rand, readJson } from "./util.mjs";
import { projectKey } from "./home.mjs";
import { PatchError, bad, clean, fieldsOf, mergeOne } from "./state.mjs";

const TYPES = ["research", "prototype", "grilling", "task"];
const STATES = ["frontier", "blocked", "claimed"];
const KEYED = ["tickets", "closed", "decisions"];

function patchKeyed(current, list, key, hub) {
  if (!Array.isArray(list)) bad(`${key} in a map patch must be an array of entries, each with a title`);
  if (current !== undefined && !Array.isArray(current)) bad(`${key} in map.json is not an array`);
  let out = (current || []).slice();
  const removedClaims = new Map(); // title → hubClaim of a ticket removed earlier in this patch
  for (const p of list) {
    if (!isObj(p) || typeof p.title !== "string" || !p.title) bad(`every ${key} entry in a map patch needs a string title`);
    const where = `${key} ${p.title}`;
    fieldsOf(p, where);
    if (key === "tickets" && !hub && Object.hasOwn(p, "hubClaim")) bad(`${where}: hubClaim is written by the hub (claim/--release)`);
    const i = out.findIndex((x) => isObj(x) && x.title === p.title);
    if ("remove" in p) {
      if (p.remove !== true) bad(`${where}: remove must be true`);
      if (i >= 0) {
        if (key === "tickets" && isObj(out[i].hubClaim)) removedClaims.set(p.title, out[i].hubClaim);
        out = out.filter((_, j) => j !== i);
      }
      continue;
    }
    if (i >= 0) out[i] = mergeOne(out[i], p, where);
    else {
      const e = clean(p);
      if (removedClaims.has(p.title) && !Object.hasOwn(p, "hubClaim")) e.hubClaim = removedClaims.get(p.title);
      out.push(e);
    }
  }
  return out;
}

// Returns a new map; never mutates its inputs. Throws PatchError on a bad shape. Does not
// validate the result: callers run validateMap on it (and keep the old map on failure).
// opts.hub: the hub's own claim code (T33), which may write tickets[].hubClaim.
export function applyMapPatch(map, p, now, { hub = false } = {}) {
  if (!isObj(p)) bad("the map patch must be a JSON object shaped like map.json");
  if (Object.hasOwn(p, "listener")) bad("listener is written by the hub, not by map-patch");
  const out = isObj(map) ? { ...map } : {};
  for (const [k, v] of fieldsOf(p, "the map patch")) {
    // handled only moves forward (a late or replayed patch must not re-queue handled events).
    if (k === "handled" && Number.isInteger(out.handled) && (v === null || (typeof v === "number" && v < out.handled))) continue;
    if (v === null) delete out[k];
    else if (KEYED.includes(k)) out[k] = patchKeyed(out[k], v, k, hub);
    else out[k] = clean(v);
  }
  out.at = now;
  return out;
}

export function validateMap(m) {
  const need = (ok, msg) => { if (!ok) bad(msg); };
  const str = (v) => typeof v === "string";
  const strs = (v) => Array.isArray(v) && v.every(str);
  const check = (o, k, ok, msg) => { if (k in o) need(ok(o[k]), msg); };
  const texts = (o, keys, where) => { for (const k of keys) check(o, k, str, `${where}.${k} must be a string`); };
  need(isObj(m), "map must be an object");
  need(str(m.title), "map.title must be a string");
  texts(m, ["link", "at", "destination", "notes"], "map");
  check(m, "fog", strs, "map.fog must be an array of strings");
  check(m, "handled", (v) => Number.isInteger(v) && v >= 0, "map.handled must be a whole number (the seq of the last handled board event)");
  check(m, "listener", (v) => isObj(v) && str(v.agentId) && str(v.heartbeat), 'map.listener must be {"agentId","heartbeat"}');
  if ("outOfScope" in m) {
    need(Array.isArray(m.outOfScope), 'map.outOfScope must be an array of {"gist","link"}');
    m.outOfScope.forEach((o, i) => {
      need(isObj(o), `map.outOfScope[${i}] must be {"gist","link"}`);
      need(str(o.gist), `map.outOfScope[${i}].gist must be a string`);
      texts(o, ["link"], `map.outOfScope[${i}]`);
    });
  }
  const titled = (key, kind, each) => {
    if (!(key in m)) return new Set();
    need(Array.isArray(m[key]), `map.${key} must be an array`);
    const seen = new Set();
    m[key].forEach((e, i) => {
      need(isObj(e) && str(e.title) && e.title !== "", `map.${key}[${i}] needs a string title`);
      need(!seen.has(e.title), `${kind} ${JSON.stringify(e.title)} appears twice`); seen.add(e.title);
      each(e, `${kind} ${e.title}`);
    });
    return seen;
  };
  const note = (e, w) => texts(e, ["link", "gist"], w);
  titled("decisions", "decisions", note);
  const closed = titled("closed", "closed", note);
  const tickets = titled("tickets", "ticket", (t, w) => {
    need(TYPES.includes(t.type), `${w}.type must be one of ${TYPES.join("|")}`);
    need(STATES.includes(t.state), `${w}.state must be one of ${STATES.join("|")}`);
    texts(t, ["link", "assignee"], w);
    check(t, "blockedBy", strs, `${w}.blockedBy must be an array of ticket titles`);
    check(t, "session", (v) => str(v) && /^https?:\/\/[^\s]+$/.test(v), `${w}.session must be an http(s) URL`);
    check(t, "hubClaim", (v) => isObj(v) && str(v.agentId) && str(v.at) && (!("seq" in v) || (Number.isInteger(v.seq) && v.seq >= 0)),
      `${w}.hubClaim must be {"agentId","at","seq"?}`);
  });
  for (const t of tickets) need(!closed.has(t), `${JSON.stringify(t)} is in both tickets and closed`);
  for (const t of m.tickets || []) {
    for (const b of t.blockedBy || []) {
      need(b !== t.title, `ticket ${t.title}.blockedBy names the ticket itself`);
      need(tickets.has(b) || closed.has(b), `ticket ${t.title}.blockedBy names unknown ${JSON.stringify(b)} (not a ticket or closed title)`);
    }
  }
}

export { PatchError };

// ---- storage (plan T14; spec §4a Data, <mapKey>; D2, D4) ----
//   maps/<projectKey>/<slug>/
//     map.json      written only by the hub (POST /m/<key>/patch, heartbeat, claims)
//     meta.json     { token } (0600), created once by the first map-patch
//     events.jsonl  board actions (refresh, work), appended by the hub (T33)
// mapKey = "<projectKey>/<slug>", both parts [a-z0-9-]+.
export const MAPS_DIR = "maps";
export const MAP_PART = /^[a-z0-9-]+$/;
export const mapFile = (dir) => path.join(dir, "map.json");
export const mapMetaFile = (dir) => path.join(dir, "meta.json");
export const mapEventsFile = (dir) => path.join(dir, "events.jsonl");
export const mapUrl = (port, key) => `http://127.0.0.1:${port}/m/${key}/`;
// The folder of a (valid) map key. Never touches the disk.
export const mapDirOf = (home, key) => path.join(home, MAPS_DIR, ...key.split("/"));
export class MapKeyError extends Error {}
// D2: a tracker map id or effort slug, lower-cased, every run of non-[a-z0-9] → "-".
const slugPart = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
// "<projectKey>/<slug>" from a --map argument: a bare slug is prefixed with the projectKey of
// `cwd`; a full key's projectKey part must already be a key ([a-z0-9-]+). Throws MapKeyError.
export function mapKeyOf(arg, cwd = process.cwd()) {
  const parts = typeof arg === "string" ? arg.split("/") : [];
  if (!arg || parts.length > 2) throw new MapKeyError(`bad map key ${JSON.stringify(arg)}: use <slug> or <projectKey>/<slug>`);
  const [pk, raw] = parts.length === 2 ? parts : [projectKey(cwd), parts[0]];
  const slug = slugPart(raw);
  if (!MAP_PART.test(pk) || !slug) throw new MapKeyError(`bad map key ${JSON.stringify(arg)}: use <slug> or <projectKey>/<slug> ([a-z0-9-])`);
  return `${pk}/${slug}`;
}
export const readMapMeta = (dir) => { const m = readJson(mapMetaFile(dir)); return isObj(m) ? m : null; };
// Creates the map folder, meta.json {token} and an empty events.jsonl if absent; returns the dir.
// meta.json is written to a temp file and hard-linked into place, so two first map-patches race
// safely: exactly one token wins and nobody ever reads a half-written file.
export function ensureMapDir(home, key) {
  const dir = mapDirOf(home, key);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const meta = mapMetaFile(dir);
  if (!fs.existsSync(meta)) {
    const tmp = `${meta}.${process.pid}.${crypto.randomBytes(3).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ token: rand(32) }, null, 2) + "\n", { mode: 0o600 });
    try { fs.linkSync(tmp, meta); } catch (e) { if (e.code !== "EEXIST") throw e; } finally { fs.rmSync(tmp, { force: true }); }
  }
  fs.closeSync(fs.openSync(mapEventsFile(dir), "a"));
  return dir;
}

// ---- CLI: map-patch --map KEY|SLUG [--agent-id ID] [--file P] ----
// Exit codes: 0 ok; 1 hub/home/write failure; 2 bad input or a rejected patch.
export async function cmdMapPatch(o, env = process.env) {
  if (!o.map || o.map === true) die("--map <slug|projectKey/slug> is required");
  if (o["agent-id"] === true) die("--agent-id needs a value");
  let key;
  try { key = mapKeyOf(String(o.map)); } catch (e) { die(e instanceof MapKeyError ? e.message : `cannot read the project: ${e.code || oneLine(e.message)}`, e instanceof MapKeyError ? 2 : 1); }
  const { readPatchText } = await import("./sessions.mjs");
  const text = readPatchText(o, "map.json");
  let patch;
  try { patch = JSON.parse(text); } catch (e) { die(`the map patch is not valid JSON (map.json unchanged): ${oneLine(e.message)}`); }
  if (!isObj(patch)) die("the map patch must be a JSON object shaped like map.json (map.json unchanged)");
  const hub = await mapHubOrDie(env);
  let dir;
  try { dir = ensureMapDir(hub.home, key); } catch (e) { die(`could not create the map folder: ${e.code || oneLine(e.message)}`, 1); }
  const body = { patch, ...(typeof o["agent-id"] === "string" ? { agentId: o["agent-id"] } : {}) };
  let r, reply;
  try {
    r = await fetch(`http://127.0.0.1:${hub.port}/m/${key}/patch`, {
      method: "POST", headers: { "content-type": "application/json", "x-grill-token": readMapMeta(dir)?.token ?? "" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    });
    reply = await r.json().catch(() => ({}));
  } catch (e) { die(`map-patch failed: the hub did not answer (${oneLine(e.message)}); map.json unchanged`, 1); }
  if (r.status === 400) die(`map-patch rejected (map.json unchanged): ${oneLine(reply.error ?? "bad patch")}`);
  if (!r.ok) die(`map-patch failed (HTTP ${r.status}): ${oneLine(reply.error ?? "")}`, 1);
  print({ ok: true, tickets: reply.tickets, url: mapUrl(hub.port, key) });
  process.stdout.write("", () => process.exit(0));
}
export async function mapHubOrDie(env) {
  const { ensureHub, EnsureError } = await import("./lifecycle.mjs");
  const { HomeError } = await import("./home.mjs");
  try { return await ensureHub(env); } catch (e) { die(e instanceof HomeError || e instanceof EnsureError ? e.message : `ensure failed: ${oneLine(e.message)}`, 1); }
}
