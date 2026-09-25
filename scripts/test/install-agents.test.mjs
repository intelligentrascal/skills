// scripts/install-agents.sh (plan T28; spec §5b Installation, Codex sandbox; §8 upstream.json.agents).
// Every run uses a temp HOME, AGENTS_SKILLS_DIR and REPO_ROOT: never the real ~/.agents or ~/.codex.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, symlinkSync, lstatSync, realpathSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { codexFix } from "../../skills/grilling-ui/lib/home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(ROOT, "scripts", "install-agents.sh");
const SKILLS = ["grilling-ui", "grill-me-ui", "grill-docs-ui", "wayfinder-ui"];
const tmp = (p) => realpathSync(mkdtempSync(join(tmpdir(), p)));

// A temp HOME and a temp repo root whose skills/ points at the real skills and whose upstream.json is a copy.
function setup({ pocock = "agents", lock = true, codex = null } = {}) {
  const home = tmp("ia-home-"), repo = tmp("ia-repo-");
  symlinkSync(join(ROOT, "skills"), join(repo, "skills"));
  copyFileSync(join(ROOT, "upstream.json"), join(repo, "upstream.json"));
  const dest = join(home, ".agents", "skills");
  mkdirSync(dest, { recursive: true });
  const pocockDir = pocock === "agents" ? dest : pocock === "pi" ? join(home, ".pi", "agent", "skills") : null;
  if (pocockDir) for (const s of ["grilling", "domain-modeling"]) {
    mkdirSync(join(pocockDir, s), { recursive: true });
    writeFileSync(join(pocockDir, s, "SKILL.md"), `---\nname: ${s}\ndescription: fake ${s}\n---\nbody of ${s}\n`);
  }
  if (lock) writeFileSync(join(home, ".agents", ".skill-lock.json"), JSON.stringify({ version: 3, skills: {
    grilling: { source: "mattpocock/skills", sourceType: "github", sourceUrl: "https://github.com/mattpocock/skills", skillFolderHash: "tree-grilling", installedAt: "", updatedAt: "" },
    "domain-modeling": { source: "mattpocock/skills", sourceType: "github", sourceUrl: "https://github.com/mattpocock/skills", skillFolderHash: "tree-dm", installedAt: "", updatedAt: "" },
  } }));
  if (codex !== null) { mkdirSync(join(home, ".codex")); writeFileSync(join(home, ".codex", "config.toml"), codex); }
  const env = { PATH: process.env.PATH, HOME: home, REPO_ROOT: repo };
  return { home, repo, dest, pocockDir, env };
}
const run = (env) => spawnSync("bash", [SCRIPT], { env, encoding: "utf8" });
const upstream = (repo) => JSON.parse(readFileSync(join(repo, "upstream.json"), "utf8"));
const sha = (...files) => { const h = createHash("sha256"); for (const f of files) h.update(readFileSync(f)); return h.digest("hex"); };

test("bash -n: the script parses", () => {
  const r = spawnSync("bash", ["-n", SCRIPT], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("links all four skills, records the agents pin, idempotent", () => {
  const { home, repo, dest, env } = setup();
  const r = run(env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const s of SKILLS) {
    assert.ok(lstatSync(join(dest, s)).isSymbolicLink(), `${s} is a symlink`);
    assert.equal(realpathSync(join(dest, s)), realpathSync(join(ROOT, "skills", s)));
  }
  const u = upstream(repo);
  assert.deepEqual(u.pocock.agents, {
    dir: "~/.agents/skills",
    skillFolderHash: { grilling: "tree-grilling", "domain-modeling": "tree-dm" },
    contentSha: sha(join(dest, "grilling", "SKILL.md"), join(dest, "domain-modeling", "SKILL.md")),
  });
  // the rest of upstream.json is untouched
  const orig = JSON.parse(readFileSync(join(ROOT, "upstream.json"), "utf8"));
  assert.deepEqual({ ...u.pocock, agents: orig.pocock.agents }, orig.pocock);
  assert.ok(existsSync(home));
  // second run: same links, same pin, no errors
  const r2 = run(env);
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  assert.deepEqual(readdirSync(dest).sort(), [...SKILLS, "domain-modeling", "grilling"].sort());
  assert.deepEqual(upstream(repo), u);
});

test("AGENTS_SKILLS_DIR overrides the destination", () => {
  const { home, env } = setup({ pocock: "pi" });
  const alt = join(home, "alt-skills");
  const r = run({ ...env, AGENTS_SKILLS_DIR: alt });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const s of SKILLS) assert.ok(lstatSync(join(alt, s)).isSymbolicLink());
});

test("Pocock's skills found under ~/.pi/agent/skills; XDG_STATE_HOME lock; missing lock → null hash", () => {
  const a = setup({ pocock: "pi", lock: false });
  let r = run(a.env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(upstream(a.repo).pocock.agents.dir, "~/.pi/agent/skills");
  assert.equal(upstream(a.repo).pocock.agents.skillFolderHash, null);

  const b = setup({ pocock: "agents", lock: false });
  const xdg = join(b.home, "state");
  mkdirSync(join(xdg, "skills"), { recursive: true });
  writeFileSync(join(xdg, "skills", ".skill-lock.json"), JSON.stringify({ version: 3, skills: { grilling: { skillFolderHash: "x1" }, "domain-modeling": { skillFolderHash: "x2" } } }));
  r = run({ ...b.env, XDG_STATE_HOME: xdg });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(upstream(b.repo).pocock.agents.skillFolderHash, { grilling: "x1", "domain-modeling": "x2" });
});

test("without Pocock's skills: links anyway, prints the npx hint, exits 2, pin untouched", () => {
  const { repo, dest, env } = setup({ pocock: "none" });
  const r = run(env);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /npx skills add -g mattpocock\/skills/);
  for (const s of SKILLS) assert.ok(lstatSync(join(dest, s)).isSymbolicLink());
  assert.equal(upstream(repo).pocock.agents, null);
});

test("refuses (exit 1, nothing linked) when a real directory holds one of the names", () => {
  const { dest, env } = setup();
  mkdirSync(join(dest, "grill-me-ui"));
  const r = run(env);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /grill-me-ui/);
  for (const s of SKILLS.filter((s) => s !== "grill-me-ui")) assert.ok(!existsSync(join(dest, s)), `${s} not linked`);
});

// The block must be exactly the one the hub prints (lib/home.mjs codexFix, plan T9).
const block = (home) => codexFix("x", "y", home).split("\n").slice(1, 4).join("\n");

test("Codex sandbox: prints the exact block and reports missing without a config", () => {
  const { home, env } = setup();
  const r = run(env);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes(block(join(home, ".intelligentrascal"))), r.stdout);
  assert.match(r.stdout, /Codex sandbox: missing — add the block above/);
});

test("Codex sandbox: OK when network_access and the writable root are set (GRILL_HOME honoured)", () => {
  const cfg = (root) => `model = "o3"\n\n[sandbox_workspace_write]\nnetwork_access = true\nwritable_roots = [\n  "/tmp/other",\n  "${root}",\n]\n\n[tui]\nx = 1\n`;
  const a = setup();
  const good = setup({ codex: cfg(join(a.home, ".intelligentrascal")) });
  // the config names the other HOME's root → missing
  let r = run(good.env);
  assert.match(r.stdout, /Codex sandbox: missing/);
  const ok = setup({ codex: "" });
  writeFileSync(join(ok.home, ".codex", "config.toml"), cfg(join(ok.home, ".intelligentrascal")));
  r = run(ok.env);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Codex sandbox: OK/);
  // GRILL_HOME changes the root that must be writable
  r = run({ ...ok.env, GRILL_HOME: join(ok.home, "gh") });
  assert.match(r.stdout, /Codex sandbox: missing/);
  assert.ok(r.stdout.includes(block(join(ok.home, "gh"))));
  // network_access outside the section does not count
  const off = setup({ codex: `network_access = true\n[sandbox_workspace_write]\nwritable_roots = ["X"]\n` });
  writeFileSync(join(off.home, ".codex", "config.toml"), `network_access = true\n[sandbox_workspace_write]\nwritable_roots = ["${join(off.home, ".intelligentrascal")}"]\n`);
  r = run(off.env);
  assert.match(r.stdout, /Codex sandbox: missing/);
});
