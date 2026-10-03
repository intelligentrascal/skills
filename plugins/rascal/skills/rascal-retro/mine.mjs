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

// A turn-less record that still has assistant turns looks like a format change the parser no longer
// recognizes (e.g. a renamed user line type), not a genuinely empty session, unless the user's lines
// were understood as a bare slash command (a skill via "command" with no args).
const suspect = (r) => !r.turns.length && r.assistantTurns > 0 && !r.skills.some((k) => k.via === "command");
const same = (a, b) => { const { extractedAt: _a, ...x } = a, { extractedAt: _b, ...y } = b; return JSON.stringify(x) === JSON.stringify(y); };

function extract() {
  const all = flag("--all"), cursor = readJson(CURSOR, {}), now = new Date().toISOString();
  let broken = [];
  for (const [source, list] of Object.entries(sources(process.env, readDeny(path.join(HOME, "denylist.txt"))))) {
    const rep = { source, found: 0, written: 0, unchanged: 0, empty: 0, failed: 0 };
    const seen = new Set(), emptyKeys = [];
    let sessions = [], attempted = 0, suspects = 0;
    try { sessions = list(); } catch { rep.failed++; attempted++; }
    for (const s of sessions) {
      rep.found++;
      if (!all && cursor[s.key] === s.fingerprint) { rep.unchanged++; continue; }
      attempted++;
      let r = null; try { r = s.load(); } catch { /* counted as failed below */ }
      if (!r || !r.id) { rep.failed++; continue; }
      if (!r.turns.length) { rep.empty++; if (suspect(r)) suspects++; emptyKeys.push(s); continue; }
      // Two files with one id (a resumed session's copy): the digest keeps the one with more turns, across
      // runs too. The other copy counts as unchanged, so found = written + unchanged + empty + failed.
      const file = path.join(DIGEST, source, `${safe(r.id)}.json`), old = readJson(file, null);
      cursor[s.key] = s.fingerprint;
      if (old && old.turns.length > r.turns.length) { rep.unchanged++; continue; }
      seen.has(r.id) ? rep.unchanged++ : rep.written++;
      seen.add(r.id);
      // Unchanged content keeps its extractedAt, so "extract --all" doesn't make every record look new to "list --since".
      writeJson(file, { ...r, extractedAt: old && same(old, r) ? old.extractedAt : now });
    }
    console.log(JSON.stringify(rep));
    // Ratios are over the sessions attempted this run, not all found, so an incremental run can still trip it.
    if (attempted && rep.failed + suspects > attempted * 0.1) broken.push(source);
    // Empty sessions are only marked done when the source looks healthy; otherwise they are retried after a parser fix.
    else for (const s of emptyKeys) cursor[s.key] = s.fingerprint;
  }
  writeJson(CURSOR, cursor);
  if (broken.length) { console.error(`mine: suspected parser break in ${broken.join(", ")}: sessions failed to parse or had no recognizable user turns; check the transcript format`); return 3; }
  return 0;
}

// Digest records: one directory per source, *.json inside (anything else, e.g. .DS_Store, is ignored).
function records(since = "") {
  const out = [];
  const dirs = fs.existsSync(DIGEST) ? fs.readdirSync(DIGEST, { withFileTypes: true }).filter((d) => d.isDirectory()) : [];
  for (const src of dirs)
    for (const f of fs.readdirSync(path.join(DIGEST, src.name)).filter((f) => f.endsWith(".json"))) {
      const p = path.join(DIGEST, src.name, f), r = readJson(p, null);
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
    // skillUse and topSkills count distinct skills per session, not invocations.
    const names = r.skills.map((s) => s.name), distinct = new Set(names);
    distinct.size === 0 ? none++ : distinct.size === 1 ? one++ : many++;
    for (const n of distinct) skills[n] = (skills[n] || 0) + 1;
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
