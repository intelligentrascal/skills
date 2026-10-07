import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readlinkSync, readdirSync, readFileSync, writeFileSync, statSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASH = process.platform === "darwin" ? "/bin/bash" : "bash";
const SCRIPT = join(ROOT, "scripts", "install-rascal.sh");
const SKILLS = readdirSync(join(ROOT, "plugins/rascal/skills"));
function env() {
  const t = mkdtempSync(join(tmpdir(), "irascal-"));
  const e = { ...process.env, HOME: t, AGENTS_SKILLS_DIR: join(t, "skills"), CLAUDE_SKILLS_DIR: join(t, "claude-skills"), RASCAL_HOME: join(t, "rascal") };
  // Agent config dirs default under the fake HOME; never let the real machine's overrides leak in.
  for (const k of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "XDG_CONFIG_HOME", "PI_CODING_AGENT_DIR"]) delete e[k];
  return { t, e };
}
const run = (e, ...args) => spawnSync(BASH, [SCRIPT, ...args], { env: e, encoding: "utf8" });

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
const runPack = (e, src) => spawnSync(BASH, [SCRIPT, "--pack", src], { env: e, encoding: "utf8" });

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
  const name = p.split("/").slice(-2).join("-");
  assert.equal(readlinkSync(join(t, "skills", "alpha")), join(t, "rascal", "packs", name, "alpha"));
});

function gitRepo(parent, repo) {
  const p = join(parent, repo); mkdirSync(p, { recursive: true });
  for (const s of ["alpha"]) { mkdirSync(join(p, s)); writeFileSync(join(p, s, "SKILL.md"), `---\nname: ${s}\n---\n`); }
  const g = (...a) => execFileSync("git", ["-C", p, ...a]);
  g("init", "-q"); g("add", "."); g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x");
  return p;
}

test("--pack <git url>: same owner-repo from two origins → second exits 1, first pack untouched", () => {
  const { t, e } = env();
  const a = gitRepo(join(mkdtempSync(join(tmpdir(), "own-")), "alice"), "skills");
  const b = gitRepo(join(mkdtempSync(join(tmpdir(), "own-")), "alice"), "skills");
  assert.equal(runPack(e, `file://${a}`).status, 0);
  const root = join(t, "rascal/packs/alice-skills");
  assert.equal(readlinkSync(join(t, "skills", "alpha")), join(root, "alpha"));
  const r = runPack(e, `file://${b}`);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes(`file://${a}`) && r.stderr.includes(`file://${b}`), r.stderr);
  assert.equal(readlinkSync(join(t, "skills", "alpha")), join(root, "alpha"));
});

test("--pack: URL forms map to owner-repo names", () => {
  const { t, e } = env();
  const mk = (url) => { // pre-seed a clone with a different origin; the mismatch message shows the derived path
    const dir = join(t, "rascal/packs"); mkdirSync(dir, { recursive: true });
    return spawnSync(BASH, [SCRIPT, "--pack", url], { env: e, encoding: "utf8" });
  };
  for (const [url, name] of [["https://github.com/alice/skills", "alice-skills"], ["https://github.com/alice/skills.git", "alice-skills"], ["git" + "@github.com:alice/skills.git", "alice-skills"], ["file:///x/alice/skills", "alice-skills"]]) {
    const root = join(t, "rascal/packs", name);
    rmSync(root, { recursive: true, force: true }); mkdirSync(root, { recursive: true });
    execFileSync("git", ["-C", root, "init", "-q"]);
    execFileSync("git", ["-C", root, "remote", "add", "origin", "https://other.invalid/z/z"]);
    const r = mk(url);
    assert.equal(r.status, 1, url);
    assert.ok(r.stderr.includes(root), `${url}: ${r.stderr}`);
  }
});

test("--pack: duplicate skill basenames in one pack → exit 1, nothing linked", () => {
  const { t, e } = env();
  const p = mkdtempSync(join(tmpdir(), "dup-"));
  for (const s of ["a/foo", "b/foo"]) { mkdirSync(join(p, s), { recursive: true }); writeFileSync(join(p, s, "SKILL.md"), "---\nname: foo\n---\n"); }
  const r = runPack(e, p);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /a\/foo/); assert.match(r.stderr, /b\/foo/);
  assert.equal(existsSync(join(t, "skills")), false);
  assert.equal(existsSync(join(t, "claude-skills")), false);
});

test("--pack: .ZIP (any case) is a zip, not a git url", () => {
  const { t, e } = env(); const p = pack();
  const zip = join(mkdtempSync(join(tmpdir(), "zip-")), "Big.ZIP");
  execFileSync("zip", ["-qr", zip, "."], { cwd: p });
  const r = runPack(e, zip);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readlinkSync(join(t, "skills", "alpha")), join(t, "rascal", "packs", "Big", "alpha"));
});

test("--pack <zip>: unzips into RASCAL_HOME/packs/<name>", () => {
  const { t, e } = env(); const p = pack();
  const zip = join(mkdtempSync(join(tmpdir(), "zip-")), "mypack.zip");
  execFileSync("zip", ["-qr", zip, "."], { cwd: p });
  const r = runPack(e, zip);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readlinkSync(join(t, "skills", "beta")), join(t, "rascal", "packs", "mypack", "group/beta"));
});

test("--pack <zip>: a different zip with the same name → exit 1, first pack kept; same zip again → ok", () => {
  const { t, e } = env();
  const mk = () => { const p = pack(); const z = join(mkdtempSync(join(tmpdir(), "zip-")), "main.zip"); execFileSync("zip", ["-qr", z, "."], { cwd: p }); return z; };
  const z1 = mk(), z2 = mk();
  assert.equal(runPack(e, z1).status, 0);
  assert.equal(runPack(e, z1).status, 0);
  const r = runPack(e, z2);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes(z1), r.stderr);
  assert.ok(existsSync(join(t, "rascal/packs/main/alpha/SKILL.md")));
});

test("--pack <git url>: the same repo spelled with .git re-runs cleanly", () => {
  const { e } = env();
  const a = gitRepo(join(mkdtempSync(join(tmpdir(), "own-")), "carol"), "skills");
  assert.equal(runPack(e, `file://${a}`).status, 0);
  const r = runPack(e, `file://${a}.git`);
  assert.equal(r.status, 0, r.stderr);
});

// ---- routing note (pack design Q10, Q20, Q23) ----
const { buildNote, BEGIN, END } = await import("../routing-note.mjs");
const AGENT_FILES = { claude: ".claude/CLAUDE.md", codex: ".codex/AGENTS.md", opencode: ".config/opencode/AGENTS.md", pi: ".pi/agent/AGENTS.md" };
const block = () => `${BEGIN}\n${buildNote()}${END}\n`;

test("routing note: written into every present agent's file, absent agents skipped and not created", () => {
  const { t, e } = env();
  for (const a of ["claude", "codex", "pi"]) mkdirSync(dirname(join(t, AGENT_FILES[a])), { recursive: true });
  writeFileSync(join(t, AGENT_FILES.claude), "# my rules\n");
  const p = run(e);
  assert.equal(p.status, 0, p.stderr);
  assert.equal(readFileSync(join(t, AGENT_FILES.claude), "utf8"), `# my rules\n\n${block()}`);
  assert.equal(readFileSync(join(t, AGENT_FILES.claude) + ".rascal-bak", "utf8"), "# my rules\n");
  for (const a of ["codex", "pi"]) {
    assert.equal(readFileSync(join(t, AGENT_FILES[a]), "utf8"), block());
    assert.equal(existsSync(join(t, AGENT_FILES[a]) + ".rascal-bak"), false, "a new file needs no backup");
  }
  assert.equal(existsSync(join(t, ".config")), false);
  assert.match(p.stdout, /opencode skipped/);
  assert.match(p.stdout, /CLAUDE\.md: updated \(backup: /);
});

test("routing note: re-running changes nothing; --remove-note restores the files", () => {
  const { t, e } = env();
  mkdirSync(join(t, ".claude"), { recursive: true });
  writeFileSync(join(t, AGENT_FILES.claude), "# my rules\n");
  run(e);
  writeFileSync(join(t, AGENT_FILES.claude) + ".rascal-bak", "sentinel");
  const p = run(e);
  assert.match(p.stdout, /CLAUDE\.md: unchanged/);
  assert.equal(readFileSync(join(t, AGENT_FILES.claude) + ".rascal-bak", "utf8"), "sentinel");
  const r = run(e, "--remove-note");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(t, AGENT_FILES.claude), "utf8"), "# my rules\n");
});

test("routing note: honours CLAUDE_CONFIG_DIR, CODEX_HOME, XDG_CONFIG_HOME, PI_CODING_AGENT_DIR", () => {
  const { t, e } = env();
  const dirs = { CLAUDE_CONFIG_DIR: "cc", CODEX_HOME: "cx", XDG_CONFIG_HOME: "xdg", PI_CODING_AGENT_DIR: "pa" };
  for (const [k, d] of Object.entries(dirs)) { e[k] = join(t, d); mkdirSync(join(t, d), { recursive: true }); }
  mkdirSync(join(t, "xdg", "opencode"));
  assert.equal(run(e).status, 0);
  for (const f of ["cc/CLAUDE.md", "cx/AGENTS.md", "xdg/opencode/AGENTS.md", "pa/AGENTS.md"]) assert.equal(readFileSync(join(t, f), "utf8"), block(), f);
});

test("routing note: --no-note links and scaffolds only; broken markers exit 1, file untouched", () => {
  const { t, e } = env();
  mkdirSync(join(t, ".codex"), { recursive: true });
  assert.equal(run(e, "--no-note").status, 0);
  assert.equal(existsSync(join(t, AGENT_FILES.codex)), false);
  assert.ok(existsSync(join(t, "rascal", "preferences.md")));
  writeFileSync(join(t, AGENT_FILES.codex), `${BEGIN}\nhalf\n`);
  const p = run(e);
  assert.equal(p.status, 1);
  assert.match(p.stderr, /markers/);
  assert.equal(readFileSync(join(t, AGENT_FILES.codex), "utf8"), `${BEGIN}\nhalf\n`);
});

test("routing note: warns when an AGENTS.override.md would shadow the note", () => {
  const { t, e } = env();
  mkdirSync(join(t, ".codex"), { recursive: true });
  writeFileSync(join(t, ".codex", "AGENTS.override.md"), "x\n");
  const p = run(e);
  assert.equal(p.status, 0);
  assert.match(p.stderr, /AGENTS\.override\.md exists/);
});

test("unknown or extra arguments: exit 2, nothing linked or written", () => {
  for (const args of [["--no-notes"], ["--no-note", "--pack", "x"], ["--remove-note", "x"], ["--pack"]]) {
    const { t, e } = env();
    mkdirSync(join(t, ".codex"), { recursive: true });
    const p = run(e, ...args);
    assert.equal(p.status, 2, args.join(" "));
    assert.equal(existsSync(join(t, AGENT_FILES.codex)), false, args.join(" "));
    assert.equal(existsSync(join(t, "skills")), false, args.join(" "));
  }
});

test("routing note: OpenCode is skipped while its CLAUDE.md fallback carries the user's own rules", () => {
  const { t, e } = env();
  mkdirSync(join(t, ".claude"), { recursive: true });
  mkdirSync(join(t, ".config", "opencode"), { recursive: true });
  writeFileSync(join(t, AGENT_FILES.claude), "# my rules\n");
  const p = run(e);
  assert.equal(p.status, 0, p.stderr);
  assert.equal(existsSync(join(t, AGENT_FILES.opencode)), false);
  assert.match(p.stdout, /opencode skipped \(creating .* would stop OpenCode reading your ~\/\.claude\/CLAUDE\.md/);
  // With an AGENTS.md of its own, OpenCode no longer reads CLAUDE.md, so it gets the note there.
  writeFileSync(join(t, AGENT_FILES.opencode), "# oc\n");
  run(e);
  assert.equal(readFileSync(join(t, AGENT_FILES.opencode), "utf8"), `# oc\n\n${block()}`);
});

test("routing note: the AGENTS.override.md warning is Codex-only", () => {
  const { t, e } = env();
  mkdirSync(join(t, ".pi", "agent"), { recursive: true });
  writeFileSync(join(t, ".pi", "agent", "AGENTS.override.md"), "x\n");
  assert.doesNotMatch(run(e).stderr, /override/);
});
