import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN } from "./manifest.test.mjs";

const SKILLS = join(PLUGIN, "skills");
const read = (...p) => readFileSync(join(SKILLS, ...p), "utf8");
const front = (t) => Object.fromEntries([.../^---\n([\s\S]*?)\n---/.exec(t)[1].matchAll(/^(\w[\w-]*):\s*(.*)$/gm)].map((m) => [m[1], m[2].trim()]));
const pins = JSON.parse(readFileSync(join(PLUGIN, "sources.json"), "utf8")).sources;
const skillDirs = () => readdirSync(SKILLS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

test("every skill: rascal- prefix, name matches folder", () => {
  for (const d of skillDirs()) {
    assert.match(d, /^rascal-/);
    assert.equal(front(read(d, "SKILL.md")).name, d);
  }
});

const DERIVED = { "rascal-grilling": "skills/productivity/grilling/SKILL.md", "rascal-domain-modeling": "skills/engineering/domain-modeling/SKILL.md",
  "rascal-grill-me": "skills/productivity/grill-me/SKILL.md", "rascal-grill-with-docs": "skills/engineering/grill-with-docs/SKILL.md" };

test("derived skills carry a provenance header matching sources.json", () => {
  for (const [d, path] of Object.entries(DERIVED)) {
    const t = read(d, "SKILL.md");
    assert.ok(t.includes(`<!-- provenance: pocock ${path} @ ${pins.pocock.commit} -->`), d);
  }
});

test("no rascal skill points at Pocock's plugin", () => {
  for (const d of skillDirs()) {
    const t = read(d, "SKILL.md");
    assert.doesNotMatch(t, /mattpocock-skills:|npx skills add -g mattpocock|claude plugin install mattpocock/, d);
  }
});

test("rascal-domain-modeling ships its format references", () => {
  for (const f of ["CONTEXT-FORMAT.md", "ADR-FORMAT.md"]) assert.ok(existsSync(join(SKILLS, "rascal-domain-modeling", f)));
});

test("ui entry points load rascal's grilling then rascal-grilling-ui", () => {
  for (const [d, profile, loads] of [
    ["rascal-grill-me-ui", "design-doc", ["rascal:rascal-grilling"]],
    ["rascal-grill-docs-ui", "docs", ["rascal:rascal-grilling", "rascal:rascal-domain-modeling"]],
  ]) {
    const t = read(d, "SKILL.md");
    for (const l of loads) assert.ok(t.includes(`\`${l}\``), `${d} loads ${l}`);
    // Match the closing backtick: "rascal:rascal-grilling" is a prefix of "rascal:rascal-grilling-ui".
    assert.ok(t.indexOf("`rascal:rascal-grilling-ui`") > t.lastIndexOf(`\`${loads.at(-1)}\``), `${d} loads the transport last`);
    assert.ok(t.includes(`finish profile **${profile}**`), d);
    assert.ok(existsSync(join(SKILLS, d, "agents", "openai.yaml")));
  }
});

test("rascal-retro drives mine.mjs, keeps findings local, ends in the seed grill", () => {
  const t = read("rascal-retro", "SKILL.md");
  for (const s of ['node "$SKILL/mine.mjs" extract', "mine.mjs\" stats", "mine.mjs\" list", "mine.mjs\" mark-retro", "rascal-grill-me-ui",
    "docs/rascal-v1-design.md", "~/.rascal/mining/", "analyst-brief.md", "generic", "personal"]) assert.ok(t.includes(s), s);
  assert.doesNotMatch(t, /~\/\.claude\/projects|\.codex\/sessions/, "the skill never reads raw transcripts");
  assert.ok(existsSync(join(SKILLS, "rascal-retro", "analyst-brief.md")));
});
