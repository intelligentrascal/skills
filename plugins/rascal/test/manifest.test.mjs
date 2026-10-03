import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = (p) => JSON.parse(readFileSync(join(PLUGIN, p), "utf8"));

test("plugin.json: rascal, semver, MIT, standalone (no dependencies)", () => {
  const p = json(".claude-plugin/plugin.json");
  assert.equal(p.name, "rascal");
  assert.match(p.version, /^\d+\.\d+\.\d+$/);
  assert.equal(p.license, "MIT");
  assert.equal(p.dependencies, undefined);
});

test("sources.json: four sources, Pocock pinned", () => {
  const s = json("sources.json");
  assert.deepEqual(Object.keys(s.sources).sort(), ["pocock", "pstack", "superpowers", "superpowers-extended-cc"]);
  assert.equal(s.sources.pocock.repo, "mattpocock/skills");
  assert.match(s.sources.pocock.commit, /^[0-9a-f]{40}$/);
  for (const v of Object.values(s.sources)) assert.equal(typeof v.license, "string");
});

test("THIRD_PARTY_NOTICES names Matt Pocock's MIT licence", () => {
  const t = readFileSync(join(PLUGIN, "THIRD_PARTY_NOTICES.md"), "utf8");
  assert.match(t, /Copyright \(c\) 2026 Matt Pocock/);
  assert.match(t, /Permission is hereby granted/);
});
