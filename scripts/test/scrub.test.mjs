import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scanText, redact } from "../../plugins/rascal/skills/rascal-retro/lib/redact.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "scrub.mjs");

test("scanText: generic kinds", () => {
  const kinds = (t) => scanText(t).map((h) => h.kind);
  assert.deepEqual(kinds("see /Users/alice/code/x"), ["home-path"]);
  assert.deepEqual(kinds('"cwd": "/Users/alice",'), ["home-path"], "a bare home dir, no trailing slash");
  assert.deepEqual(kinds("see ~/code/x and /Users/Shared/x"), []);
  assert.deepEqual(kinds("mail bob@example.org"), ["email"]);
  assert.deepEqual(kinds("key sk-ant-api03-" + "a".repeat(40)), ["token"]);
  assert.deepEqual(kinds("ghp_" + "A".repeat(36)), ["token"]);
  assert.deepEqual(kinds("-----BEGIN OPENSSH PRIVATE KEY-----"), ["private-key"]);
  assert.deepEqual(kinds("noreply@anthropic.com"), [], "the commit trailer address is allowed");
});

test("redact: project slugs, Windows paths, short names, whole key blocks, newer tokens", () => {
  assert.equal(redact("~/.claude/projects/-Users-alice-code-app/memory"), "~/.claude/projects/-Users-[user]-code-app/memory");
  assert.equal(redact("C:\\Users\\alice\\x"), "C:\\Users\\[user]\\x");
  assert.equal(redact("/home/e/x and /Users/U"), "/home/[user]/x and /Users/[user]", "a name inside 'home'/'Users' still redacts the name");
  assert.equal(redact("a\n-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----\nb"), "a\n[private-key]\nb");
  assert.equal(redact("sk-proj-" + "a_b-".repeat(10)), "[token]");
  for (const t of ["my-home-page-thing", "task-" + "a".repeat(40), "hub/home/write", "/Users/Shared/x"]) assert.equal(redact(t), t, t);
});

test("scanText: deny-list literals, case-insensitive", () => {
  assert.deepEqual(scanText("Meeting with ACME corp", ["acme"]).map((h) => h.kind), ["deny-list"]);
});

test("redact replaces hits with a marker", () => {
  assert.equal(redact("at /Users/alice/x mail a@b.co"), "at /Users/[user]/x mail [email]");
  assert.equal(redact("cwd /Users/alice"), "cwd /Users/[user]");
  assert.equal(redact("exit 1 on hub/home/write failure"), "exit 1 on hub/home/write failure");
});

function repo() {
  const r = mkdtempSync(join(tmpdir(), "scrub-"));
  spawnSync("git", ["init", "-q"], { cwd: r });
  return r;
}
const run = (cwd, args, env = {}) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, env: { ...process.env, RASCAL_HOME: join(cwd, ".rh"), ...env }, encoding: "utf8" });

test("--staged: reports file:line:kind without the secret, exit 1", () => {
  const r = repo();
  writeFileSync(join(r, "a.md"), "ok\npath /Users/alice/x\n");
  spawnSync("git", ["add", "a.md"], { cwd: r });
  const p = run(r, ["--staged"]);
  assert.equal(p.status, 1);
  assert.match(p.stdout, /a\.md:2: home-path/);
  assert.doesNotMatch(p.stdout, /alice/);
});

test("deny-list from RASCAL_HOME applies unless --generic", () => {
  const r = repo();
  mkdirSync(join(r, ".rh"));
  writeFileSync(join(r, ".rh", "denylist.txt"), "# clients\nacme\n");
  writeFileSync(join(r, "b.md"), "for Acme\n");
  assert.equal(run(r, ["b.md"]).status, 1);
  assert.equal(run(r, ["--generic", "b.md"]).status, 0);
});

test(".scrub-allow: whole file and file:literal", () => {
  const r = repo();
  writeFileSync(join(r, "c.md"), "x@y.co\n");
  writeFileSync(join(r, "d.md"), "keep z@w.co\nbut not q@r.co\n");
  writeFileSync(join(r, ".scrub-allow"), "c.md\nd.md:z@w.co\n");
  const p = run(r, ["c.md", "d.md"]);
  assert.equal(p.status, 1);
  assert.match(p.stdout, /d\.md:2: email/);
  assert.doesNotMatch(p.stdout, /c\.md|d\.md:1/);
});

test(".scrub-allow: a literal never allows a shorter hit inside it; empty literal is an error", () => {
  const r = repo();
  mkdirSync(join(r, ".rh"));
  writeFileSync(join(r, ".rh", "denylist.txt"), "acme\n");
  writeFileSync(join(r, "e.md"), "acme\n");
  writeFileSync(join(r, ".scrub-allow"), "e.md:ops@acme.example\n");
  assert.equal(run(r, ["e.md"]).status, 1);
  writeFileSync(join(r, ".scrub-allow"), "e.md:\n");
  assert.equal(run(r, ["e.md"]).status, 2);
});

test("explicit paths match .scrub-allow globs from a subdirectory", () => {
  const r = repo();
  mkdirSync(join(r, "sub"));
  writeFileSync(join(r, "sub", "f.md"), "x@y.co\n");
  writeFileSync(join(r, ".scrub-allow"), "sub/f.md\n");
  assert.equal(run(join(r, "sub"), ["f.md"], { RASCAL_HOME: join(r, ".rh") }).status, 0);
});

test("no paths and no mode is a usage error (exit 2)", () => {
  assert.equal(run(repo(), []).status, 2);
});
