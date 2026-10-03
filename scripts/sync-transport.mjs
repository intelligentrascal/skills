#!/usr/bin/env node
// Mirror intelligentrascal's grill transport (skills/grilling-ui) into the rascal plugin
// (design doc Q34; plan decision 2). Code, page and visual brief are copied byte-identically so
// both plugins compute the same hub version and share one hub. SKILL.md and agents/openai.yaml
// are rewritten to rascal's skill names. Tests are not copied.
//   node scripts/sync-transport.mjs           write the mirror
//   node scripts/sync-transport.mjs --check   exit 1 listing drift; write nothing
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.REPO_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "skills", "grilling-ui");
const DEST = path.join(ROOT, "plugins", "rascal", "skills", "rascal-grilling-ui");
const COPY = ["hub.mjs", "lib", "page", "visual-brief.md"];

const DESCRIPTION = "Browser transport for rascal's -ui grill skills: publishes rounds to a local page and listens for Sends. Loaded by rascal-grill-me-ui and rascal-grill-docs-ui.";

export function transformSkill(t) {
  return t
    .replace(/^name: grilling-ui$/m, "name: rascal-grilling-ui")
    .replace(/^description: .*$/m, `description: ${JSON.stringify(DESCRIPTION)}`)
    .replace(/Pocock's `grilling` \(and `domain-modeling`\)/g, "`rascal-grilling` (and `rascal-domain-modeling`)")
    .replace(/Pocock's `grilling`/g, "`rascal-grilling`")
    .replace(/`(grilling|domain-modeling|grilling-ui|grill-me-ui|grill-docs-ui)`/g, "`rascal-$1`")
    .replace(/mattpocock-skills:(grilling|domain-modeling)/g, "rascal:rascal-$1")
    .replace(/intelligentrascal:(grilling-ui|grill-me-ui|grill-docs-ui)/g, "rascal:rascal-$1")
    .replace(/Under grilling-ui/g, "Under rascal-grilling-ui")
    .replace(/\bPocock's\b/g, "rascal's")
    .replace(/\bintelligentrascal\b/g, "rascal");
}
export function transformYaml(t) {
  return t.replace(/display_name: ".*"/, 'display_name: "Grilling UI (rascal engine)"')
    .replace(/short_description: ".*"/, 'short_description: "Browser transport for rascal\'s -ui grill skills"');
}

function walk(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    e.isDirectory() ? walk(p, base, out) : out.push(path.relative(base, p));
  }
  return out;
}

// Map of relative dest path → expected contents (Buffer or string).
export function expected() {
  const want = new Map();
  for (const c of COPY) {
    const p = path.join(SRC, c);
    if (fs.statSync(p).isDirectory()) for (const f of walk(p)) want.set(path.join(c, f), fs.readFileSync(path.join(p, f)));
    else want.set(c, fs.readFileSync(p));
  }
  want.set("SKILL.md", transformSkill(fs.readFileSync(path.join(SRC, "SKILL.md"), "utf8")));
  want.set(path.join("agents", "openai.yaml"), transformYaml(fs.readFileSync(path.join(SRC, "agents", "openai.yaml"), "utf8")));
  return want;
}

function diff(want) {
  const drift = [];
  for (const [f, c] of want) {
    const p = path.join(DEST, f);
    if (!fs.existsSync(p) || !fs.readFileSync(p).equals(Buffer.from(c))) drift.push(f);
  }
  const extra = walk(DEST).filter((f) => !want.has(f));
  return { drift, extra };
}

function main() {
  const check = process.argv.includes("--check");
  const want = expected();
  const { drift, extra } = diff(want);
  if (check) {
    if (!drift.length && !extra.length) { console.log("sync-transport: in sync"); return 0; }
    console.error(`sync-transport: rascal-grilling-ui is out of sync with skills/grilling-ui; run node scripts/sync-transport.mjs\n${[...drift, ...extra.map((f) => `${f} (extra)`)].map((f) => "  " + f).join("\n")}`);
    return 1;
  }
  for (const f of drift) { fs.mkdirSync(path.dirname(path.join(DEST, f)), { recursive: true }); fs.writeFileSync(path.join(DEST, f), want.get(f)); }
  for (const f of extra) fs.rmSync(path.join(DEST, f));
  console.log(`sync-transport: ${drift.length + extra.length} files written`);
  return 0;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
