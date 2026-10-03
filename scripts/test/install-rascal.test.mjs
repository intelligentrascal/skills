import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readlinkSync, readdirSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(ROOT, "scripts", "install-rascal.sh");
const SKILLS = readdirSync(join(ROOT, "plugins/rascal/skills"));
function env() {
  const t = mkdtempSync(join(tmpdir(), "irascal-"));
  return { t, e: { ...process.env, HOME: t, AGENTS_SKILLS_DIR: join(t, "skills"), CLAUDE_SKILLS_DIR: join(t, "claude-skills"), RASCAL_HOME: join(t, "rascal") } };
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

function pack() {
  const p = mkdtempSync(join(tmpdir(), "pack-"));
  for (const s of ["alpha", "group/beta"]) { mkdirSync(join(p, s), { recursive: true }); writeFileSync(join(p, s, "SKILL.md"), `---\nname: ${s.split("/").pop()}\n---\n`); }
  mkdirSync(join(p, "docs")); writeFileSync(join(p, "docs", "README.md"), "not a skill\n");
  return p;
}
const runPack = (e, src) => spawnSync("bash", [SCRIPT, "--pack", src], { env: e, encoding: "utf8" });

test("--pack <dir>: links each skill folder into both skill dirs; idempotent", () => {
  const { t, e } = env(); const p = pack();
  const r = runPack(e, p);
  assert.equal(r.status, 0, r.stderr);
  for (const d of ["skills", "claude-skills"]) {
    assert.equal(readlinkSync(join(t, d, "alpha")), join(p, "alpha"));
    assert.equal(readlinkSync(join(t, d, "beta")), join(p, "group/beta"));
    assert.equal(existsSync(join(t, d, "docs")), false);
  }
  assert.match(r.stdout, /linked 2 skills from .*: alpha, beta/);
  assert.equal(runPack(e, p).status, 0);
});

test("--pack: a real dir or another pack's link in the way → exit 1, nothing linked", () => {
  const { t, e } = env(); const p = pack();
  mkdirSync(join(t, "claude-skills", "beta"), { recursive: true });
  assert.equal(runPack(e, p).status, 1);
  assert.equal(existsSync(join(t, "skills", "alpha")), false);
  const { t: t2, e: e2 } = env(); const other = pack();
  assert.equal(runPack(e2, other).status, 0);
  assert.equal(runPack(e2, pack()).status, 1);
  assert.equal(readlinkSync(join(t2, "skills", "alpha")), join(other, "alpha"));
});

test("--pack <git url>: clones into RASCAL_HOME/packs/<name>", () => {
  const { t, e } = env(); const p = pack();
  const g = (...a) => execFileSync("git", ["-C", p, ...a]);
  g("init", "-q"); g("add", "."); g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x");
  const r = runPack(e, `file://${p}`);
  assert.equal(r.status, 0, r.stderr);
  const name = p.split("/").pop();
  assert.equal(readlinkSync(join(t, "skills", "alpha")), join(t, "rascal", "packs", name, "alpha"));
});

test("--pack <zip>: unzips into RASCAL_HOME/packs/<name>", () => {
  const { t, e } = env(); const p = pack();
  const zip = join(mkdtempSync(join(tmpdir(), "zip-")), "mypack.zip");
  execFileSync("zip", ["-qr", zip, "."], { cwd: p });
  const r = runPack(e, zip);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readlinkSync(join(t, "skills", "beta")), join(t, "rascal", "packs", "mypack", "group/beta"));
});
