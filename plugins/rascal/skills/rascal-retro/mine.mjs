#!/usr/bin/env node
// rascal miner (design doc Q16): transcripts → ~/.rascal/mining/digest/<source>/<id>.json.
//   extract [--all]        incremental unless --all; one JSON report line per source; exit 3 on a suspected parser break
//   list [--since ISO]     digest files extracted since ISO
//   stats [--since ISO]    JSON summary for the retro
//   mark-retro | last-retro
import fs from "node:fs";
import path from "node:path";
import { sources, rascalHome } from "./lib/sources.mjs";
import { readDeny } from "./lib/redact.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (n) => rest.includes(n);
const opt = (n) => { const i = rest.indexOf(n); return i === -1 ? "" : rest[i + 1] || ""; };
const HOME = rascalHome();
const DIGEST = path.join(HOME, "mining", "digest");
const CURSOR = path.join(HOME, "mining", "cursor.json");
const STATE = path.join(HOME, "state.json");
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
// Mining output is private: directories the miner creates are owner-only.
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + "\n"); };
const safe = (id) => String(id).replace(/[^A-Za-z0-9._-]/g, "_");

function extract() {
  const all = flag("--all"), cursor = readJson(CURSOR, {}), seen = new Map(), now = new Date().toISOString();
  let broken = [];
  for (const [source, list] of Object.entries(sources(process.env, readDeny(path.join(HOME, "denylist.txt"))))) {
    const rep = { source, found: 0, written: 0, unchanged: 0, empty: 0, failed: 0 };
    let sessions = [];
    try { sessions = list(); } catch { rep.failed++; }
    for (const s of sessions) {
      rep.found++;
      if (!all && cursor[s.key] === s.fingerprint) { rep.unchanged++; continue; }
      let r = null; try { r = s.load(); } catch { /* counted as failed below */ }
      if (!r || !r.id) { rep.failed++; continue; }
      if (!r.turns.length) { rep.empty++; cursor[s.key] = s.fingerprint; continue; }
      // Two files with one id (a resumed session's copy): keep the one with more turns. The other copy
      // counts as unchanged, so found = written + unchanged + empty + failed.
      const id = `${source}:${r.id}`;
      if (seen.has(id) && seen.get(id) >= r.turns.length) { rep.unchanged++; cursor[s.key] = s.fingerprint; continue; }
      seen.has(id) ? rep.unchanged++ : rep.written++;
      seen.set(id, r.turns.length);
      writeJson(path.join(DIGEST, source, `${safe(r.id)}.json`), { ...r, extractedAt: now });
      cursor[s.key] = s.fingerprint;
    }
    console.log(JSON.stringify(rep));
    if ((rep.found && !(rep.written + rep.unchanged + rep.empty)) || rep.failed > rep.found * 0.1) broken.push(source);
  }
  writeJson(CURSOR, cursor);
  if (broken.length) { console.error(`mine: suspected parser break in ${broken.join(", ")}: found sessions but extracted few; check the transcript format`); return 3; }
  return 0;
}

function records(since = "") {
  const out = [];
  for (const src of (fs.existsSync(DIGEST) ? fs.readdirSync(DIGEST) : []))
    for (const f of fs.readdirSync(path.join(DIGEST, src))) {
      const p = path.join(DIGEST, src, f), r = readJson(p, null);
      if (r && (!since || r.extractedAt >= since)) out.push({ path: p, r });
    }
  return out.sort((a, b) => (a.r.start < b.r.start ? -1 : 1));
}

function stats(since) {
  const rs = records(since).map((x) => x.r), bySource = {}, skills = {}, pairs = {};
  let none = 0, one = 0, many = 0, turns = 0;
  for (const r of rs) {
    bySource[r.source] = (bySource[r.source] || 0) + 1;
    turns += r.turns.length;
    const names = r.skills.map((s) => s.name);
    names.length === 0 ? none++ : names.length === 1 ? one++ : many++;
    for (const n of names) skills[n] = (skills[n] || 0) + 1;
    const seq = names.filter((n, i) => n !== names[i - 1]);
    for (let i = 1; i < seq.length; i++) { const k = `${seq[i - 1]} → ${seq[i]}`; pairs[k] = (pairs[k] || 0) + 1; }
  }
  const top = (o, n, key) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, count]) => ({ [key]: k, count }));
  const pct = (x) => (rs.length ? Math.round((100 * x) / rs.length) : 0);
  return { sessions: { total: rs.length, bySource }, skillUse: { nonePct: pct(none), onePct: pct(one), manyPct: pct(many) },
    topSkills: top(skills, 30, "skill"), topPairs: top(pairs, 20, "pair"), userTurns: turns };
}

const code = (() => {
  switch (cmd) {
    case "extract": return extract();
    case "list": for (const x of records(opt("--since"))) console.log(x.path); return 0;
    case "stats": console.log(JSON.stringify(stats(opt("--since")), null, 2)); return 0;
    case "mark-retro": writeJson(STATE, { ...readJson(STATE, {}), lastRetro: new Date().toISOString() }); return 0;
    case "last-retro": console.log(readJson(STATE, {}).lastRetro || ""); return 0;
    default: console.error("usage: mine.mjs extract [--all] | list [--since ISO] | stats [--since ISO] | mark-retro | last-retro"); return 2;
  }
})();
process.exit(code);
