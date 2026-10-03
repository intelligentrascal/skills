import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { transformSkill } from "../sync-transport.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(ROOT, "scripts", "sync-transport.mjs");
const run = (root, ...args) => spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, REPO_ROOT: root }, encoding: "utf8" });

function fixture() {
  const r = mkdtempSync(join(tmpdir(), "transport-"));
  cpSync(join(ROOT, "skills", "grilling-ui"), join(r, "skills", "grilling-ui"), { recursive: true });
  return r;
}
const DEST = (r) => join(r, "plugins", "rascal", "skills", "rascal-grilling-ui");

test("transformSkill: renames and strips upstream names", () => {
  const out = transformSkill(readFileSync(join(ROOT, "skills/grilling-ui/SKILL.md"), "utf8"));
  assert.match(out, /^---\nname: rascal-grilling-ui\n/);
  assert.match(out, /^description: "[^"\n]+"$/m, "the description stays a quoted YAML scalar");
  assert.doesNotMatch(out, /Pocock|mattpocock|intelligentrascal/);
  assert.doesNotMatch(out, /`(grilling|domain-modeling|grilling-ui)`/);
  assert.doesNotMatch(out, /Under grilling-ui/);
});

test("sync copies code byte-identically, skips tests, is idempotent", () => {
  const r = fixture();
  assert.equal(run(r).status, 0);
  for (const f of ["hub.mjs", "lib/state.mjs", "page/core.js", "visual-brief.md"])
    assert.equal(readFileSync(join(DEST(r), f), "utf8"), readFileSync(join(r, "skills/grilling-ui", f), "utf8"), f);
  assert.equal(existsSync(join(DEST(r), "test")), false);
  const second = run(r);
  assert.equal(second.status, 0);
  assert.match(second.stdout, /0 files written/);
});

test("--check: 0 in sync, 1 with the drifted path, writes nothing", () => {
  const r = fixture();
  run(r);
  assert.equal(run(r, "--check").status, 0);
  writeFileSync(join(r, "skills/grilling-ui/lib/util.mjs"), "// changed\n");
  const c = run(r, "--check");
  assert.equal(c.status, 1);
  assert.match(c.stderr, /lib\/util\.mjs/);
  assert.notEqual(readFileSync(join(DEST(r), "lib/util.mjs"), "utf8"), "// changed\n");
});

test("a stale extra file in the mirror is drift and is removed on sync", () => {
  const r = fixture();
  run(r);
  writeFileSync(join(DEST(r), "lib", "old.mjs"), "x");
  assert.equal(run(r, "--check").status, 1);
  run(r);
  assert.equal(existsSync(join(DEST(r), "lib", "old.mjs")), false);
});

test("a new file upstream is drift and gets mirrored", () => {
  const r = fixture();
  run(r);
  writeFileSync(join(r, "skills/grilling-ui/NEW.md"), "new\n");
  assert.equal(run(r, "--check").status, 1);
  run(r);
  assert.equal(readFileSync(join(DEST(r), "NEW.md"), "utf8"), "new\n");
});
