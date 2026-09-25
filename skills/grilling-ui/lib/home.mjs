// GRILL_HOME, project identity, and the writable-root check (spec §5 Root, Session identity;
// §5b Codex sandbox; decision D2). projectRoot is ported from jasonku09/grill-with-ui
// server.mjs:58-64 (daafa1e).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

export function grillHome(env = process.env) {
  return env.GRILL_HOME ? path.resolve(env.GRILL_HOME) : path.join(os.homedir(), ".intelligentrascal");
}

// The git common root (all worktrees share it); the working directory outside git.
export function projectRoot(cwd = process.cwd()) {
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return fs.realpathSync(path.dirname(common));
  } catch { return fs.realpathSync(cwd); }
}

// D2: basename lower-cased, every run of non-[a-z0-9] → "-", then "-", then 8 hex of
// sha256(absolute root). Leading/trailing dashes of the basename part are trimmed so the key
// never starts with "-" (e.g. a folder named ".dotfiles"); an empty basename becomes "root".
export function projectKeyOf(root) {
  const base = path.basename(root).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "root";
  return `${base}-${crypto.createHash("sha256").update(root).digest("hex").slice(0, 8)}`;
}
export const projectKey = (cwd = process.cwd()) => projectKeyOf(projectRoot(cwd));

export function branchOf(cwd = process.cwd()) {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch { return ""; }
}

// The exact fix text (plan T9; reused by install-agents.sh). `what` is "write GRILL_HOME" or
// "bind 127.0.0.1". Returned without the "grill: " prefix, which die() adds.
export function codexFix(what, code, home) {
  return `cannot ${what} (${code}). If you are in Codex, add to ~/.codex/config.toml:
  [sandbox_workspace_write]
  network_access = true
  writable_roots = ["${home}"]
then restart Codex. Other agents: make ${home} writable or set GRILL_HOME.`;
}
export const DENIED = ["EPERM", "EACCES", "EROFS"];

export class HomeError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

// Creates home, logs/, grill-sessions/, maps/ and probes a write. Throws HomeError whose message
// is the Codex fix on EPERM/EACCES/EROFS (no fallback location), or a one-line error otherwise.
export function assertWritable(home) {
  try {
    for (const d of ["", "logs", "grill-sessions", "maps"]) fs.mkdirSync(path.join(home, d), { recursive: true });
    const probe = path.join(home, `.probe-${process.pid}`);
    fs.writeFileSync(probe, "");
    fs.rmSync(probe, { force: true });
  } catch (e) {
    if (DENIED.includes(e.code)) throw new HomeError(codexFix("write GRILL_HOME", e.code, home), e.code);
    throw new HomeError(`cannot use GRILL_HOME ${home}: ${e.code || e.message}`, e.code);
  }
}
