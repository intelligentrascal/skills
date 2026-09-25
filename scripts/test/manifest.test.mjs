// Plugin and marketplace manifests (plan T25; spec §2, §5b Installation).
// Dependency format per https://code.claude.com/docs/en/plugins/dependencies: an entry is a string or
// { name, marketplace?, version? }; a cross-marketplace dependency needs the root marketplace's
// allowCrossMarketplaceDependenciesOn to list that marketplace.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const json = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

test("plugin.json: name, version, dependency on mattpocock-skills@mattpocock", () => {
  const p = json(".claude-plugin/plugin.json");
  assert.equal(p.name, "intelligentrascal");
  assert.match(p.version, /^\d+\.\d+\.\d+$/);
  assert.equal(p.license, "MIT");
  assert.equal(typeof p.description, "string");
  assert.deepEqual(p.dependencies, [{ name: "mattpocock-skills", marketplace: "mattpocock" }]);
  assert.equal(p.skills, undefined, "skills come from the default skills/ scan");
});

test("marketplace.json: one plugin at ./, cross-marketplace allowlist for mattpocock", () => {
  const m = json(".claude-plugin/marketplace.json");
  assert.equal(m.name, "intelligentrascal");
  assert.equal(typeof m.owner?.name, "string");
  assert.deepEqual(m.allowCrossMarketplaceDependenciesOn, ["mattpocock"]);
  assert.equal(m.plugins.length, 1);
  assert.equal(m.plugins[0].name, "intelligentrascal");
  assert.equal(m.plugins[0].source, "./");
});

test("skills/: the four skill folders, each SKILL.md name matching its folder", () => {
  const dirs = readdirSync(join(ROOT, "skills"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  assert.deepEqual(dirs, ["grill-docs-ui", "grill-me-ui", "grilling-ui", "wayfinder-ui"]);
  for (const d of dirs) {
    const f = join(ROOT, "skills", d, "SKILL.md");
    assert.ok(existsSync(f), `${d}/SKILL.md`);
    const name = /^---\n[\s\S]*?^name:\s*(.+)$/m.exec(readFileSync(f, "utf8"))?.[1].trim();
    assert.equal(name, d);
  }
});
