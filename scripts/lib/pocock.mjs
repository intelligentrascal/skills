#!/usr/bin/env node
// JSON/TOML helpers for scripts/install-agents.sh and scripts/sync-pocock.sh (so neither needs jq).
// Zero dependencies. Every command prints to stdout and exits 0 unless noted.
//
//   get <file.json> <dotted.path>          value (strings raw, others as JSON; missing → empty)
//   set <file.json> <dotted.path> <json>   set a value, rewrite the file (2-space JSON)
//   installed <installed_plugins.json> <plugin@marketplace>
//                                          "<version>\t<gitCommitSha>\t<installPath>" of entry [0]; exit 1 if absent
//   content-sha <dir>                      sha256 over grilling/SKILL.md then domain-modeling/SKILL.md in <dir>
//   agents-pin <dir>                       JSON { dir, skillFolderHash, contentSha } for upstream.json.pocock.agents
//   codex-check <config.toml> <root>       exit 0 when [sandbox_workspace_write] has network_access = true
//                                          and writable_roots contains <root>; exit 1 otherwise
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const POCOCK_AGENT_SKILLS = ["grilling", "domain-modeling"];

const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const home = () => process.env.HOME || os.homedir();

export function getPath(obj, dotted) {
  return dotted.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
export function setPath(obj, dotted, value) {
  const keys = dotted.split("."); let o = obj;
  for (const k of keys.slice(0, -1)) { if (o[k] == null || typeof o[k] !== "object") o[k] = {}; o = o[k]; }
  o[keys.at(-1)] = value;
  return obj;
}
// Atomic rewrite, so an interrupted run never leaves half a file.
function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

export function contentSha(dir) {
  const h = crypto.createHash("sha256");
  for (const s of POCOCK_AGENT_SKILLS) h.update(fs.readFileSync(path.join(dir, s, "SKILL.md")));
  return h.digest("hex");
}

// vercel-labs/skills src/skill-lock.ts:64-70: $XDG_STATE_HOME/skills/.skill-lock.json, else ~/.agents/.skill-lock.json.
export function lockPath(env = process.env) {
  return env.XDG_STATE_HOME ? path.join(env.XDG_STATE_HOME, "skills", ".skill-lock.json") : path.join(home(), ".agents", ".skill-lock.json");
}
// Per-skill GitHub tree SHAs from the lock file; null when there is no usable lock.
export function skillFolderHash(env = process.env) {
  let lock; try { lock = readJson(lockPath(env)); } catch { return null; }
  if (!lock || typeof lock.skills !== "object") return null;
  const out = {};
  for (const s of POCOCK_AGENT_SKILLS) out[s] = lock.skills[s]?.skillFolderHash ?? null;
  return Object.values(out).every((v) => v === null) ? null : out;
}
const tilde = (p) => { const h = home(); return p === h ? "~" : p.startsWith(h + path.sep) ? "~" + p.slice(h.length) : p; };
export const untilde = (p) => (p === "~" ? home() : p.startsWith("~/") ? path.join(home(), p.slice(2)) : p);

export function agentsPin(dir) {
  return { dir: tilde(path.resolve(dir)), skillFolderHash: skillFolderHash(), contentSha: contentSha(dir) };
}

// Minimal TOML reading: tables, `key = value`, dotted keys at the root, and multi-line arrays of strings.
export function codexSandboxOk(text, root) {
  const norm = (p) => p.replace(/\/+$/, "");
  let table = "", network = false, roots = [], collecting = null;
  const strings = (s) => [...s.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map((m) => (m[1] !== undefined ? JSON.parse(`"${m[1]}"`) : m[2]));
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (collecting !== null) { collecting += " " + line; if (line.includes("]")) { roots.push(...strings(collecting)); collecting = null; } continue; }
    if (!line || line.startsWith("#")) continue;
    const t = /^\[\s*([^\]]+?)\s*\]$/.exec(line);
    if (t) { table = t[1]; continue; }
    const kv = /^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = table ? `${table}.${kv[1]}` : kv[1];
    if (key === "sandbox_workspace_write.network_access") network = kv[2] === "true";
    if (key === "sandbox_workspace_write.writable_roots") {
      if (kv[2].includes("]")) roots.push(...strings(kv[2])); else collecting = kv[2];
    }
  }
  return network && roots.map(norm).includes(norm(root));
}

function main([cmd, ...a]) {
  switch (cmd) {
    case "get": {
      const v = getPath(readJson(a[0]), a[1]);
      if (v !== undefined && v !== null) process.stdout.write((typeof v === "string" ? v : JSON.stringify(v)) + "\n");
      return 0;
    }
    case "set": writeJson(a[0], setPath(readJson(a[0]), a[1], JSON.parse(a[2]))); return 0;
    case "installed": {
      let d; try { d = readJson(a[0]); } catch { return 1; }
      const e = (d.plugins || d)[a[1]]?.[0];
      if (!e) return 1;
      process.stdout.write(`${e.version}\t${e.gitCommitSha}\t${e.installPath}\n`);
      return 0;
    }
    case "content-sha": process.stdout.write(contentSha(a[0]) + "\n"); return 0;
    case "agents-pin": process.stdout.write(JSON.stringify(agentsPin(a[0])) + "\n"); return 0;
    case "codex-check": {
      let text; try { text = fs.readFileSync(a[0], "utf8"); } catch { return 1; }
      return codexSandboxOk(text, a[1]) ? 0 : 1;
    }
    default: process.stderr.write(`pocock.mjs: unknown command ${cmd}\n`); return 2;
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
