import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const T = dirname(fileURLToPath(import.meta.url));
const MINE = join(T, "..", "skills", "rascal-retro", "mine.mjs");
const FX = join(T, "fixtures");

function world() {
  const w = mkdtempSync(join(tmpdir(), "mine-"));
  mkdirSync(join(w, "claude", "proj"), { recursive: true });
  copyFileSync(join(FX, "claude-cli.jsonl"), join(w, "claude", "proj", "s1.jsonl"));
  mkdirSync(join(w, "claude", "proj", "s1", "subagents"), { recursive: true });
  copyFileSync(join(FX, "claude-cli.jsonl"), join(w, "claude", "proj", "s1", "subagents", "a.jsonl")); // must be ignored
  mkdirSync(join(w, "desktop", "x", ".claude", "projects", "p"), { recursive: true });
  copyFileSync(join(FX, "claude-desktop.jsonl"), join(w, "desktop", "x", "audit.jsonl"));
  // Desktop keeps an inner CLI-format copy of each session under a different id: must be ignored.
  writeFileSync(join(w, "desktop", "x", ".claude", "projects", "p", "inner.jsonl"),
    readFileSync(join(FX, "claude-desktop.jsonl"), "utf8").replaceAll('"session_id":"d1"', '"sessionId":"d1-inner"'));
  mkdirSync(join(w, "codex", "2026", "10", "02"), { recursive: true });
  copyFileSync(join(FX, "codex.jsonl"), join(w, "codex", "2026", "10", "02", "rollout-1.jsonl"));
  cpSync(join(FX, "cursor"), join(w, "cursor"), { recursive: true });
  const u1 = join(w, "cursor", "Users-alice-code-app", "agent-transcripts", "u1");
  mkdirSync(join(u1, "subagents"));
  copyFileSync(join(u1, "u1.jsonl"), join(u1, "subagents", "sa.jsonl")); // must be ignored
  const env = { ...process.env, RASCAL_HOME: join(w, "home"), RASCAL_SRC_CLAUDE: join(w, "claude"), RASCAL_SRC_DESKTOP: join(w, "desktop"),
    RASCAL_SRC_CODEX: join(w, "codex"), RASCAL_SRC_OPENCODE: join(w, "none.db"), RASCAL_SRC_CURSOR: join(w, "cursor") };
  return { w, env };
}
const run = (env, ...a) => spawnSync(process.execPath, [MINE, ...a], { env, encoding: "utf8" });
const reports = (out) => Object.fromEntries(out.trim().split("\n").map((l) => JSON.parse(l)).map((o) => [o.source, o]));

test("extract: one record per session, subagents and desktop inner copies ignored, then incremental", () => {
  const { w, env } = world();
  const a = run(env, "extract");
  assert.equal(a.status, 0, a.stderr);
  const r = reports(a.stdout);
  assert.deepEqual([r["claude-cli"].found, r["claude-cli"].written], [1, 1]);
  assert.deepEqual([r["claude-desktop"].found, r["claude-desktop"].written], [1, 1]);
  assert.equal(r.codex.written, 1);
  assert.deepEqual([r.cursor.found, r.cursor.written], [1, 1]);
  assert.equal(r.opencode.found, 0);
  const rec = JSON.parse(readFileSync(join(w, "home", "mining", "digest", "claude-cli", "s1.json"), "utf8"));
  assert.ok(rec.extractedAt);
  const b = reports(run(env, "extract").stdout);
  assert.deepEqual([b["claude-cli"].written, b["claude-cli"].unchanged], [0, 1]);
  assert.equal(reports(run(env, "extract", "--all").stdout)["claude-cli"].written, 1);
});

test("a source whose files all fail to parse exits 3", () => {
  const { w, env } = world();
  writeFileSync(join(w, "codex", "2026", "10", "02", "rollout-1.jsonl"), "not json\n");
  const p = run(env, "extract");
  assert.equal(p.status, 3);
  assert.match(p.stderr, /codex/);
});

test("stats and list", () => {
  const { env } = world();
  run(env, "extract");
  const s = JSON.parse(run(env, "stats").stdout);
  assert.equal(s.sessions.total, 4);
  assert.deepEqual(s.topPairs[0], { pair: "mattpocock-skills:grilling → mattpocock-skills:domain-modeling", count: 1 });
  assert.equal(run(env, "list").stdout.trim().split("\n").length, 4);
  assert.equal(run(env, "list", "--since", "2999-01-01T00:00:00Z").stdout.trim(), "");
});

test("mark-retro / last-retro", () => {
  const { env } = world();
  assert.equal(run(env, "last-retro").stdout.trim(), "");
  run(env, "mark-retro");
  assert.match(run(env, "last-retro").stdout.trim(), /^\d{4}-\d\d-\d\dT/);
});

test("unknown command: usage, exit 2", () => {
  assert.equal(run(world().env, "nope").status, 2);
});

test("two files with one session id: the one with more turns wins", () => {
  const { w, env } = world();
  // "aaa" sorts before "proj", so the one-turn copy is seen first and must be replaced.
  mkdirSync(join(w, "claude", "aaa"));
  writeFileSync(join(w, "claude", "aaa", "copy.jsonl"), readFileSync(join(FX, "claude-cli.jsonl"), "utf8").split("\n")[0] + "\n");
  const r = reports(run(env, "extract").stdout)["claude-cli"];
  assert.deepEqual([r.found, r.written, r.unchanged], [2, 1, 1]);
  assert.equal(JSON.parse(readFileSync(join(w, "home", "mining", "digest", "claude-cli", "s1.json"), "utf8")).turns.length, 2);
});
