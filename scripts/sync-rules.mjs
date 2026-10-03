#!/usr/bin/env node
// Expand shared rules into rascal skills (docs/rascal-v1-design.md, Q14). A SKILL.md marks a rule as
// <!-- rule:NAME --> … <!-- /rule:NAME -->; the text between is replaced by plugins/rascal/rules/NAME.md.
//   node scripts/sync-rules.mjs            rewrite stale skills
//   node scripts/sync-rules.mjs --check    exit 1 if any skill is stale (pre-commit)
// Exit: 0 ok, 1 stale (--check), 2 unknown rule or unbalanced markers.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BLOCK = /<!-- rule:([a-z0-9-]+) -->(\r?\n)[\s\S]*?<!-- \/rule:\1 -->/g;
const OPEN = /<!-- rule:([a-z0-9-]+) -->/g;
const CLOSE = /<!-- \/rule:([a-z0-9-]+) -->/g;
function checkBalanced(skill, text) {
  const n = {};
  for (const m of text.matchAll(OPEN)) (n[m[1]] ??= [0, 0])[0]++;
  for (const m of text.matchAll(CLOSE)) (n[m[1]] ??= [0, 0])[1]++;
  for (const [name, [o, c]] of Object.entries(n)) if (o !== c) throw new Error(`sync-rules: ${skill}: unbalanced rule:${name}`);
}

export function run({ check = false, root = ROOT } = {}) {
  const rules = path.join(root, "plugins/rascal/rules");
  const skills = path.join(root, "plugins/rascal/skills");
  const rule = (n) => {
    const f = path.join(rules, `${n}.md`);
    if (!fs.existsSync(f)) throw new Error(`sync-rules: unknown rule "${n}"`);
    return fs.readFileSync(f, "utf8").trim();
  };
  const stale = [];
  const dirs = fs.readdirSync(skills).sort().filter((d) => fs.existsSync(path.join(skills, d, "SKILL.md")));
  for (const d of dirs) checkBalanced(d, fs.readFileSync(path.join(skills, d, "SKILL.md"), "utf8"));
  for (const d of dirs) {
    const f = path.join(skills, d, "SKILL.md");
    const before = fs.readFileSync(f, "utf8");
    const after = before.replace(BLOCK, (_, n, eol) => `<!-- rule:${n} -->${eol}${rule(n).replace(/\r?\n/g, eol)}${eol}<!-- /rule:${n} -->`);
    if (before === after) continue;
    stale.push(d);
    if (!check) fs.writeFileSync(f, after);
  }
  return stale;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  try {
    const stale = run({ check });
    if (check && stale.length) { console.error(`sync-rules: out of date: ${stale.join(", ")}; run node scripts/sync-rules.mjs`); process.exit(1); }
    console.log(check ? "sync-rules: in sync" : `sync-rules: updated ${stale.length} skill(s)`);
  } catch (e) { console.error(e.message); process.exit(2); }
}
