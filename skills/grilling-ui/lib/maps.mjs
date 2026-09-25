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
//   any other key (fog, outOfScope, title, handled, …): replaced whole
//   at: always stamped with `now`
import { isObj } from "./util.mjs";
import { PatchError, bad, clean, fieldsOf, mergeOne } from "./state.mjs";

const TYPES = ["research", "prototype", "grilling", "task"];
const STATES = ["frontier", "blocked", "claimed"];
const KEYED = ["tickets", "closed", "decisions"];

function patchKeyed(current, list, key) {
  if (!Array.isArray(list)) bad(`${key} in a map patch must be an array of entries, each with a title`);
  if (current !== undefined && !Array.isArray(current)) bad(`${key} in map.json is not an array`);
  let out = (current || []).slice();
  for (const p of list) {
    if (!isObj(p) || typeof p.title !== "string" || !p.title) bad(`every ${key} entry in a map patch needs a string title`);
    const where = `${key} ${p.title}`;
    fieldsOf(p, where);
    const i = out.findIndex((x) => isObj(x) && x.title === p.title);
    if ("remove" in p) {
      if (p.remove !== true) bad(`${where}: remove must be true`);
      if (i >= 0) out = out.filter((_, j) => j !== i);
      continue;
    }
    if (i >= 0) out[i] = mergeOne(out[i], p, where);
    else out.push(clean(p));
  }
  return out;
}

// Returns a new map; never mutates its inputs. Throws PatchError on a bad shape. Does not
// validate the result: callers run validateMap on it (and keep the old map on failure).
export function applyMapPatch(map, p, now) {
  if (!isObj(p)) bad("the map patch must be a JSON object shaped like map.json");
  if (Object.hasOwn(p, "listener")) bad("listener is written by the hub, not by map-patch");
  const out = isObj(map) ? { ...map } : {};
  for (const [k, v] of fieldsOf(p, "the map patch")) {
    if (v === null) delete out[k];
    else if (KEYED.includes(k)) out[k] = patchKeyed(out[k], v, k);
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
  for (const t of m.tickets || []) {
    for (const b of t.blockedBy || []) {
      need(b !== t.title, `ticket ${t.title}.blockedBy names the ticket itself`);
      need(tickets.has(b) || closed.has(b), `ticket ${t.title}.blockedBy names unknown ${JSON.stringify(b)} (not a ticket or closed title)`);
    }
  }
}

export { PatchError };
