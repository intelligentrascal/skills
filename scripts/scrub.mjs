#!/usr/bin/env node
// Privacy scrub (design doc Q15). Reports file:line: kind for personal data; never prints the match.
//   node scripts/scrub.mjs --staged | --all | <paths…>   [--generic]
// Deny-list: $RASCAL_HOME/denylist.txt (default ~/.rascal), skipped with --generic (CI).
// Allowlist: .scrub-allow at the repo root: "glob" or "glob:literal" per line, # comments.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { scanText, readDeny } from "../plugins/rascal/skills/rascal-retro/lib/redact.mjs";

const args = process.argv.slice(2);
const generic = args.includes("--generic");
const git = (...a) => execFileSync("git", a, { encoding: "utf8" });
let files;
if (args.includes("--staged")) files = git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z").split("\0").filter(Boolean);
else if (args.includes("--all")) files = git("ls-files", "-z").split("\0").filter(Boolean);
else files = args.filter((a) => !a.startsWith("--"));
if (!files.length && !args.includes("--staged") && !args.includes("--all")) { console.error("usage: scrub.mjs --staged | --all | <paths…> [--generic]"); process.exit(2); }

const home = process.env.RASCAL_HOME || path.join(os.homedir(), ".rascal");
const deny = generic ? [] : readDeny(path.join(home, "denylist.txt"));
const root = git("rev-parse", "--show-toplevel").trim();
const allow = (() => { try { return fs.readFileSync(path.join(root, ".scrub-allow"), "utf8").split("\n").map((l) => l.replace(/\s+#.*$/, "").trim()).filter((l) => l && !l.startsWith("#")); } catch { return []; } })()
  .map((l) => { const i = l.indexOf(":"); return i === -1 ? { glob: l } : { glob: l.slice(0, i), lit: l.slice(i + 1) }; });
const globRe = (g) => new RegExp("^" + g.split("**").map((s) => s.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")).join(".*") + "$");
const allowed = (file, text) => allow.some((a) => globRe(a.glob).test(file) && (a.lit === undefined || text.includes(a.lit) || a.lit.includes(text)));

const isText = (buf) => !buf.subarray(0, 8000).includes(0);
const out = [];
for (const f of files) {
  let buf;
  try { buf = args.includes("--staged") ? execFileSync("git", ["show", `:${f}`]) : fs.readFileSync(path.resolve(f)); } catch { continue; }
  if (!isText(buf)) continue;
  buf.toString("utf8").split("\n").forEach((line, i) => {
    for (const h of scanText(line, deny)) if (!allowed(f, h.text)) out.push(`${f}:${i + 1}: ${h.kind}`);
  });
}
if (out.length) { console.log([...new Set(out)].join("\n")); console.error(`scrub: ${out.length} finding(s); fix them or add a line to .scrub-allow`); process.exit(1); }
console.log("scrub: clean");
