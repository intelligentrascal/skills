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
