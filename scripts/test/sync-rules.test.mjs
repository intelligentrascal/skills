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

test("unclosed opener before a well-formed block throws and leaves the file unchanged (both modes)", () => {
  const before = "<!-- rule:x -->\nstray\n\n<!-- rule:x -->\nold\n<!-- /rule:x -->\n";
  const root = fixture(before);
  assert.throws(() => run({ root }), /sync-rules: rascal-a: unbalanced rule:x/);
  assert.throws(() => run({ check: true, root }), /unbalanced rule:x/);
  assert.equal(SKILL(root), before);
});

test("stray closer throws", () => {
  assert.throws(() => run({ root: fixture("text\n<!-- /rule:x -->\n") }), /unbalanced rule:x/);
});

test("CRLF files sync and check, keeping CRLF", () => {
  const root = fixture("# A\r\n\r\n<!-- rule:x -->\r\nold\r\n<!-- /rule:x -->\r\n");
  assert.deepEqual(run({ check: true, root }), ["rascal-a"]);
  assert.deepEqual(run({ root }), ["rascal-a"]);
  assert.equal(SKILL(root), "# A\r\n\r\n<!-- rule:x -->\r\n## X\r\n\r\nBe brief.\r\n<!-- /rule:x -->\r\n");
  assert.deepEqual(run({ check: true, root }), []);
});

test("the repo's skills are in sync", () => {
  assert.deepEqual(run({ check: true, root: REPO }), []);
});
