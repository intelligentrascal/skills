#!/usr/bin/env node
// Copy one upstream file into a rascal skill (docs/rascal-v1-design.md, Q29): verify the local checkout
// is at the sources.json pin, rewrite cross-skill references to rascal names, stamp a provenance line.
//
//   node scripts/derive.mjs <source> <upstream-path> <dest> [--name <skill>] [--strip-frontmatter]
//
// Checkouts: pocock → ~/.claude/plugins/marketplaces/mattpocock, superpowers → ~/.rascal/upstream/superpowers.
// Override with RASCAL_UPSTREAM_<SOURCE> (uppercase, "-" → "_"). Exit: 0 ok, 1 refused, 2 usage.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = () => process.env.HOME || os.homedir();
const DEFAULT_CHECKOUTS = { pocock: "~/.claude/plugins/marketplaces/mattpocock", superpowers: "~/.rascal/upstream/superpowers" };

// Ordered: longer, more specific strings first.
export const REF_MAP = [
  ["superpowers:test-driven-development", "rascal-tdd"],
  ["superpowers:systematic-debugging", "rascal-debugging"],
  ["superpowers:verification-before-completion", "rascal-review"],
  ["superpowers:requesting-code-review", "rascal-review"],
  ["superpowers:writing-plans", "rascal-planning"],
  ["superpowers:executing-plans", "rascal-planning"],
  ["superpowers:subagent-driven-development", "rascal-orchestrate"],
  ["superpowers:dispatching-parallel-agents", "rascal-orchestrate"],
  ["superpowers:brainstorming", "rascal-grilling"],
  ["superpowers:using-git-worktrees", "a git worktree"],
  ["superpowers:finishing-a-development-branch", "the Ship step of rascal-feature"],
  ["the `code-review` skill", "the `rascal-review` skill"],
  ["../requesting-code-review/code-reviewer.md", "../rascal-review/code-reviewer.md"],
  ["/../../subagent-driven-development/scripts", ""],
  ["../subagent-driven-development/scripts/", "scripts/"],
  [".superpowers/sdd", ".rascal/sdd"],
];

const FRONT = /^---\n[\s\S]*?\n---\n/;

export function derive({ source, path: upPath, dest, name, stripFrontmatter = false, pins, checkouts }) {
  const pin = pins[source]?.commit;
  if (!pin) throw new Error(`derive: "${source}" has no pinned commit in sources.json`);
  const dir = checkouts[source];
  const head = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (head !== pin) throw new Error(`derive: checkout ${dir} is at ${head}, sources.json pins ${pin}; run git -C ${dir} checkout ${pin}`);
  const src = path.join(dir, upPath);
  let text = fs.readFileSync(src, "utf8");
  for (const [from, to] of REF_MAP) text = text.split(from).join(to);
  if (stripFrontmatter) text = text.replace(FRONT, "");
  if (name) text = text.replace(FRONT, (fm) => fm.replace(/^name:.*$/m, `name: ${name}`));
  const tag = `${source} ${upPath} @ ${pin}`;
  const ext = path.extname(dest);
  if ([".ts", ".js", ".mjs"].includes(ext)) text = `// provenance: ${tag}\n${text}`;
  else if (text.startsWith("#!")) text = text.replace(/^(#!.*\n)/, `$1# provenance: ${tag}\n`);
  else if (FRONT.test(text)) text = text.replace(FRONT, (fm) => `${fm}<!-- provenance: ${tag} -->\n`);
  else text = `<!-- provenance: ${tag} -->\n${text}`;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, text);
  if (fs.statSync(src).mode & 0o111) fs.chmodSync(dest, 0o755);
  return `derive: ${dest} ← ${tag.replace(pin, pin.slice(0, 7))}`;
}

function checkoutsFromEnv() {
  const out = {};
  for (const [s, d] of Object.entries(DEFAULT_CHECKOUTS)) {
    const v = process.env[`RASCAL_UPSTREAM_${s.toUpperCase().replace(/-/g, "_")}`] || d;
    out[s] = v.replace(/^~(?=\/)/, home());
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const USAGE = "usage: derive.mjs <source> <upstream-path> <dest> [--name <skill>] [--strip-frontmatter]";
  const flag = (f) => {
    const i = a.indexOf(f); if (i < 0) return undefined;
    const v = a[i + 1];
    if (v === undefined || v.startsWith("--")) { console.error(`derive: ${f} needs a value\n${USAGE}`); process.exit(2); }
    a.splice(i, 2); return v;
  };
  const name = flag("--name");
  const strip = a.includes("--strip-frontmatter"); if (strip) a.splice(a.indexOf("--strip-frontmatter"), 1);
  if (a.length !== 3) { console.error(USAGE); process.exit(2); }
  const pins = JSON.parse(fs.readFileSync(path.join(ROOT, "plugins/rascal/sources.json"), "utf8")).sources;
  try { console.log(derive({ source: a[0], path: a[1], dest: a[2], name, stripFrontmatter: strip, pins, checkouts: checkoutsFromEnv() })); }
  catch (e) { console.error(e.message); process.exit(1); }
}
