import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readlinkSync, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(ROOT, "scripts", "install-rascal.sh");
const SKILLS = readdirSync(join(ROOT, "plugins/rascal/skills"));
function env() {
  const t = mkdtempSync(join(tmpdir(), "irascal-"));
  return { t, e: { ...process.env, HOME: t, AGENTS_SKILLS_DIR: join(t, "skills"), RASCAL_HOME: join(t, "rascal") } };
}
const run = (e) => spawnSync("bash", [SCRIPT], { env: e, encoding: "utf8" });

test("links every rascal skill and scaffolds RASCAL_HOME", () => {
  const { t, e } = env();
  const p = run(e);
  assert.equal(p.status, 0, p.stderr);
  for (const s of SKILLS) assert.equal(readlinkSync(join(t, "skills", s)), join(ROOT, "plugins/rascal/skills", s));
  assert.equal(statSync(join(t, "rascal")).mode & 0o777, 0o700);
  assert.match(readFileSync(join(t, "rascal", "denylist.txt"), "utf8"), /^# /);
  assert.equal(readFileSync(join(t, "rascal", "preferences.md"), "utf8"), "");
  assert.ok(statSync(join(t, "rascal", "mining")).isDirectory());
  assert.match(p.stdout, /claude plugin install rascal@intelligentrascal/);
});

test("idempotent; never overwrites the deny-list", () => {
  const { t, e } = env();
  run(e);
  writeFileSync(join(t, "rascal", "denylist.txt"), "acme\n");
  assert.equal(run(e).status, 0);
  assert.equal(readFileSync(join(t, "rascal", "denylist.txt"), "utf8"), "acme\n");
});

test("a real directory in the way: exit 1, nothing linked", () => {
  const { t, e } = env();
  mkdirSync(join(t, "skills", SKILLS[0]), { recursive: true });
  assert.equal(run(e).status, 1);
  assert.deepEqual(readdirSync(join(t, "skills")), [SKILLS[0]]);
});
