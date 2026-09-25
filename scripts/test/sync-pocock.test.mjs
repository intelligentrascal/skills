// scripts/sync-pocock.sh (plan T37; spec §8, §11 "Pocock restructures his skills").
// Offline: the "upstream" is a local git repo and the marketplace is a clone of it. Every run uses a
// temp HOME, CLAUDE_PLUGINS, POCOCK_MARKETPLACE and REPO_ROOT, and SYNC_TEST_CMD instead of the suite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(ROOT, "scripts", "sync-pocock.sh");
const tmp = (p) => realpathSync(mkdtempSync(join(tmpdir(), p)));

const WAYFINDER_V1 = Array.from({ length: 12 }, (_, i) => `wayfinder line ${i + 1}`).join("\n") + "\n";
const PATHS = {
  grilling: "skills/productivity/grilling",
  "domain-modeling": "skills/engineering/domain-modeling",
  "grill-me": "skills/productivity/grill-me",
  "grill-with-docs": "skills/engineering/grill-with-docs",
  wayfinder: "skills/engineering/wayfinder",
};
const skillMd = (name, extraFm = "", body = `body of ${name}\n`) => `---\nname: ${name}\ndescription: ${name} skill${extraFm}\n---\n${body}`;

function world() {
  const base = tmp("sp-");
  const home = join(base, "home"); mkdirSync(home);
  const gitEnv = { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const git = (cwd, ...a) => execFileSync("git", a, { cwd, env: gitEnv, encoding: "utf8" }).trim();
  const up = join(base, "upstream"); mkdirSync(up);
  git(up, "init", "-q", "-b", "main");
  const put = (rel, text) => { mkdirSync(dirname(join(up, rel)), { recursive: true }); writeFileSync(join(up, rel), text); };
  const commit = (msg) => { git(up, "add", "-A"); git(up, "commit", "-q", "-m", msg); return git(up, "rev-parse", "HEAD"); };
  for (const [n, p] of Object.entries(PATHS)) put(`${p}/SKILL.md`, n === "wayfinder" ? WAYFINDER_V1 : skillMd(n));
  put(`${PATHS.grilling}/agents/openai.yaml`, `interface:\n  display_name: "Grilling"\n`);
  const v1 = commit("v1");
  put(`${PATHS.grilling}/SKILL.md`, skillMd("grilling", "", "body of grilling\nv2 grilling line\n"));
  put(`${PATHS.wayfinder}/SKILL.md`, WAYFINDER_V1.replace("wayfinder line 2\n", "wayfinder line 2 (v2 upstream)\n"));
  const v2 = commit("v2");
  const mkt = join(base, "plugins", "marketplaces", "mattpocock");
  mkdirSync(dirname(mkt), { recursive: true });
  execFileSync("git", ["clone", "-q", up, mkt], { env: gitEnv });

  const repo = join(base, "repo");
  mkdirSync(join(repo, "skills", "wayfinder-ui", "upstream"), { recursive: true });
  // ours = v1 plus a local edit far from upstream's change
  writeFileSync(join(repo, "skills/wayfinder-ui/upstream/wayfinder.md"), WAYFINDER_V1.replace("wayfinder line 10\n", "wayfinder line 10 (ours)\n"));
  const pin = { pocock: { plugin: "mattpocock-skills", claude: { version: "1.0.0", commit: v1 }, agents: null, wayfinder: { vendoredFrom: v1 } } };
  writeFileSync(join(repo, "upstream.json"), JSON.stringify(pin, null, 2) + "\n");

  const installPath = join(base, "plugins", "cache", "mattpocock", "mattpocock-skills");
  const installed = (version, sha) => writeFileSync(join(base, "plugins", "installed_plugins.json"), JSON.stringify({ version: 2, plugins: {
    "mattpocock-skills@mattpocock": [{ scope: "user", installPath: `${installPath}/${version}`, version, gitCommitSha: sha }],
  } }));
  installed("2.0.0", v2);
  const marker = join(base, "tests-ran");
  const env = { ...gitEnv, CLAUDE_PLUGINS: join(base, "plugins"), REPO_ROOT: repo,
    SYNC_TEST_CMD: `echo "POCOCK_PIN=$POCOCK_PIN" > '${marker}'` };
  const run = (extra = {}) => spawnSync("bash", [SCRIPT], { env: { ...env, ...extra }, encoding: "utf8" });
  const upstream = () => JSON.parse(readFileSync(join(repo, "upstream.json"), "utf8"));
  const ours = () => readFileSync(join(repo, "skills/wayfinder-ui/upstream/wayfinder.md"), "utf8");
  return { base, home, up, mkt, repo, v1, v2, put, commit, git, installed, installPath, marker, run, upstream, ours, env };
}

test("bash -n: the script parses", () => {
  const r = spawnSync("bash", ["-n", SCRIPT], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("v1 pin → v2 installed: diff printed, wayfinder merged, tests run, pins bumped", () => {
  const w = world();
  const r = w.run();
  const out = r.stdout + r.stderr;
  assert.equal(r.status, 0, out);
  assert.match(out, /\+v2 grilling line/);
  assert.match(out, /--- grilling/);
  assert.doesNotMatch(out, /ahead/);
  assert.match(w.ours(), /wayfinder line 2 \(v2 upstream\)/);
  assert.match(w.ours(), /wayfinder line 10 \(ours\)/);
  assert.equal(readFileSync(w.marker, "utf8").trim(), `POCOCK_PIN=${w.installPath}/2.0.0`);
  const u = w.upstream().pocock;
  assert.deepEqual(u.claude, { version: "2.0.0", commit: w.v2 });
  assert.equal(u.wayfinder.vendoredFrom, w.v2);
  assert.equal(u.agents, null);
  // second run: nothing to sync
  rmSync(w.marker);
  const r2 = w.run();
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  assert.match(r2.stdout, /Nothing to sync/);
  assert.ok(!existsSync(w.marker), "no tests when nothing changed");
});

test("upstream main ahead of the installed release → warning", () => {
  const w = world();
  w.put("README.md", "later\n"); w.commit("v3");
  const r = w.run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /upstream main is 1 commit\(s\) ahead of the installed release 2\.0\.0/);
});

test("offline: the upstream check is skipped with a note", () => {
  const w = world();
  w.git(w.mkt, "remote", "set-url", "origin", join(w.base, "nowhere"));
  const r = w.run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /offline/i);
  assert.deepEqual(w.upstream().pocock.claude, { version: "2.0.0", commit: w.v2 });
});

for (const [label, mutate, re] of [
  ["grilling gains disable-model-invocation: true", (w) => w.put(`${PATHS.grilling}/SKILL.md`, skillMd("grilling", "\ndisable-model-invocation: true")), /grilling.*disable-model-invocation/],
  ["domain-modeling gains allow_implicit_invocation: false", (w) => w.put(`${PATHS["domain-modeling"]}/agents/openai.yaml`, "policy:\n  allow_implicit_invocation: false\n"), /domain-modeling.*allow_implicit_invocation/],
  ["grill-me is renamed", (w) => { rmSync(join(w.up, PATHS["grill-me"]), { recursive: true }); w.put("skills/productivity/grill-me-please/SKILL.md", skillMd("grill-me-please")); }, /grill-me\b.*(missing|renamed)/],
]) {
  test(`v3 where ${label} → exit 3, nothing applied`, () => {
    const w = world();
    mutate(w);
    const v3 = w.commit("v3");
    w.git(w.mkt, "fetch", "-q", "origin", "main");
    w.installed("3.0.0", v3);
    const before = w.ours();
    const r = w.run();
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.match(r.stderr, re);
    assert.equal(w.ours(), before, "wayfinder not merged");
    assert.deepEqual(w.upstream().pocock.claude, { version: "1.0.0", commit: w.v1 });
    assert.ok(!existsSync(w.marker));
  });
}

test("wayfinder conflict → markers left, exit 4, pins unchanged", () => {
  const w = world();
  writeFileSync(join(w.repo, "skills/wayfinder-ui/upstream/wayfinder.md"), WAYFINDER_V1.replace("wayfinder line 2\n", "wayfinder line 2 (ours)\n"));
  const r = w.run();
  assert.equal(r.status, 4, r.stdout + r.stderr);
  assert.match(w.ours(), /^<<<<<<< ours$/m);
  assert.match(w.ours(), /^>>>>>>> theirs$/m);
  assert.match(r.stdout + r.stderr, /1 conflict/);
  assert.equal(w.upstream().pocock.claude.commit, w.v1);
  // after resolving by hand, SYNC_WAYFINDER_DONE=1 skips the merge and finishes
  writeFileSync(join(w.repo, "skills/wayfinder-ui/upstream/wayfinder.md"), "resolved\n");
  const r2 = w.run({ SYNC_WAYFINDER_DONE: "1" });
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  assert.equal(w.ours(), "resolved\n");
  assert.equal(w.upstream().pocock.wayfinder.vendoredFrom, w.v2);
});

test("tests fail → exit 5, pins not bumped, merge left in the tree", () => {
  const w = world();
  const r = w.run({ SYNC_TEST_CMD: "exit 1" });
  assert.equal(r.status, 5, r.stdout + r.stderr);
  assert.equal(w.upstream().pocock.claude.commit, w.v1);
  assert.match(w.ours(), /v2 upstream/);
});

test("agents copy differs from its pin → diff against the Claude pin, unsupported note, pin bumped", () => {
  const w = world();
  const dir = join(w.home, ".agents", "skills");
  for (const s of ["grilling", "domain-modeling"]) {
    mkdirSync(join(dir, s), { recursive: true });
    writeFileSync(join(dir, s, "SKILL.md"), skillMd(s, "", s === "grilling" ? "body of grilling\nagents-only line\n" : `body of ${s}\n`));
  }
  const u = w.upstream();
  u.pocock.agents = { dir: "~/.agents/skills", skillFolderHash: null, contentSha: "old" };
  // Claude side already up to date: only the agents copy moved
  u.pocock.claude = { version: "2.0.0", commit: w.v2 }; u.pocock.wayfinder.vendoredFrom = w.v2;
  writeFileSync(join(w.repo, "upstream.json"), JSON.stringify(u, null, 2) + "\n");
  const r = w.run();
  const out = r.stdout + r.stderr;
  assert.equal(r.status, 0, out);
  assert.match(out, /\+agents-only line/);
  assert.match(out, /unsupported/);
  assert.match(out, /1\.0\.0|2\.0\.0/);
  const h = createHash("sha256");
  for (const s of ["grilling", "domain-modeling"]) h.update(readFileSync(join(dir, s, "SKILL.md")));
  assert.equal(w.upstream().pocock.agents.contentSha, h.digest("hex"));
  assert.equal(w.upstream().pocock.agents.dir, "~/.agents/skills");
});

test("agents copy gains disable-model-invocation → exit 3", () => {
  const w = world();
  const dir = join(w.home, ".agents", "skills");
  for (const s of ["grilling", "domain-modeling"]) { mkdirSync(join(dir, s), { recursive: true }); writeFileSync(join(dir, s, "SKILL.md"), skillMd(s, s === "grilling" ? "\ndisable-model-invocation: true" : "")); }
  const u = w.upstream(); u.pocock.agents = { dir: "~/.agents/skills", skillFolderHash: null, contentSha: "old" };
  writeFileSync(join(w.repo, "upstream.json"), JSON.stringify(u, null, 2) + "\n");
  const r = w.run();
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stderr, /agents copy.*grilling.*disable-model-invocation/);
});
