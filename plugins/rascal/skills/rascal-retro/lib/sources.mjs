// Where each transcript source lives and how to enumerate its sessions (design doc Q9, Q16).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseClaude } from "./claude.mjs";
import { parseCodex } from "./codex.mjs";
import { parseCursor } from "./cursor.mjs";
import { parseOpencode } from "./opencode.mjs";

const H = os.homedir();
export const rascalHome = (env = process.env) => env.RASCAL_HOME || path.join(H, ".rascal");

function walk(dir, keep, out = []) {
  let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of es) { const p = path.join(dir, e.name); e.isDirectory() ? walk(p, keep, out) : keep(p) && out.push(p); }
  return out;
}
const fp = (f) => { const s = fs.statSync(f); return `${s.mtimeMs}:${s.size}`; };
const fileSessions = (files, parse) => files.map((f) => ({ key: f, fingerprint: fp(f), load: () => parse(f) }));
const SUBAGENTS = `${path.sep}subagents${path.sep}`;

// Each source: () → [{ key, fingerprint, load: () => record | null }]
export function sources(env = process.env, deny = []) {
  const claude = env.RASCAL_SRC_CLAUDE || path.join(H, ".claude", "projects");
  const desktop = env.RASCAL_SRC_DESKTOP || path.join(H, "Library", "Application Support", "Claude", "local-agent-mode-sessions");
  const codex = env.RASCAL_SRC_CODEX || path.join(H, ".codex", "sessions");
  const opencode = env.RASCAL_SRC_OPENCODE || path.join(H, ".local", "share", "opencode", "opencode.db");
  const cursor = env.RASCAL_SRC_CURSOR || path.join(H, ".cursor", "projects");
  const topLevel = (root) => { try { return fs.readdirSync(root).flatMap((d) => { try { return fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(root, d, f)); } catch { return []; } }); } catch { return []; } };
  return {
    "claude-cli": () => fileSessions(topLevel(claude), (f) => parseClaude(f, { source: "claude-cli", deny })),
    // Each desktop session also keeps an inner CLI-format copy under .claude/projects with a different
    // session id; audit.jsonl alone is the session.
    "claude-desktop": () => fileSessions(walk(desktop, (p) => path.basename(p) === "audit.jsonl"), (f) => parseClaude(f, { source: "claude-desktop", deny })),
    codex: () => fileSessions(walk(codex, (p) => /rollout-.*\.jsonl$/.test(path.basename(p))), (f) => parseCodex(f, { deny })),
    opencode: () => (fs.existsSync(opencode) ? parseOpencode(opencode, { deny }).map((s) => ({ key: `opencode:${s.id}`, fingerprint: s.fingerprint, load: () => s.record })) : []),
    cursor: () => fileSessions(walk(cursor, (p) => p.includes(`${path.sep}agent-transcripts${path.sep}`) && !p.includes(SUBAGENTS) && p.endsWith(".jsonl")), (f) => parseCursor(f, { deny })),
  };
}
