import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { run } from "../sync-rules.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
function fixture(skillText) {
  const root = mkdtempSync(join(tmpdir(), "rules-"));
  mkdirSync(join(root, "plugins/rascal/rules"), { recursive: true });
  mkdirSync(join(root, "plugins/rascal/skills/rascal-a"), { recursive: true });
  writeFileSync(join(root, "plugins/rascal/rules/x.md"), "## X\n\nBe brief.\n");
  writeFileSync(join(root, "plugins/rascal/skills/rascal-a/SKILL.md"), skillText);
  return root;
}
const SKILL = (root) => readFileSync(join(root, "plugins/rascal/skills/rascal-a/SKILL.md"), "utf8");

test("check reports a stale copy and changes nothing; run expands it; then in sync", () => {
  const before = "# A\n\n<!-- rule:x -->\nold\n<!-- /rule:x -->\n";
  const root = fixture(before);
  assert.deepEqual(run({ check: true, root }), ["rascal-a"]);
  assert.equal(SKILL(root), before);
  assert.deepEqual(run({ root }), ["rascal-a"]);
  assert.equal(SKILL(root), "# A\n\n<!-- rule:x -->\n## X\n\nBe brief.\n<!-- /rule:x -->\n");
  assert.deepEqual(run({ check: true, root }), []);
});

test("unknown rule throws", () => {
  const root = fixture("<!-- rule:nope -->\n<!-- /rule:nope -->\n");
  assert.throws(() => run({ root }), /unknown rule "nope"/);
});

test("the repo's skills are in sync", () => {
  assert.deepEqual(run({ check: true, root: REPO }), []);
});
