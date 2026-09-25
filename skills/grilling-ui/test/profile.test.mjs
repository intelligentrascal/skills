// agent-profile: agent detection from env fixtures, the exact listen parameters per agent, the
// GRILL_MONITOR_MS override and the CLI with --session (spec §5b, §10; plan D13, T16, T26).
// Every per-agent value is cited in docs/superpowers/verification/agent-profile-sources.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { run, tmp, HUB } from "./helpers.mjs";
import { detectAgent, profile, AGENTS } from "../lib/profile.mjs";

// Env fixtures: exactly what each agent puts in the environment of a model-run shell command.
const ENV = {
  claude: { CLAUDECODE: "1" },
  codex: { CODEX_THREAD_ID: "019a-thread", CODEX_SESSION_ID: "019a-session" },
  codexSandbox: { CODEX_SANDBOX: "seatbelt" },
  opencode: { OPENCODE: "1", AGENT: "1" },
  pi: { PI_CODING_AGENT: "true", AI_AGENT: "pi" },
  unknown: { PATH: "/usr/bin" },
};
const SKILL = "/opt/skills/grilling-ui";
const CTX = { skill: SKILL, session: "/h/grill-sessions/p-1/20260925-120000-ab12", agentId: "a1b2c3d4e5f6", handled: 7, project: "/code/skills", topic: "Board layout" };
// A clean env: none of the real agent variables of the machine running the tests leak in.
const clean = (extra) => {
  const e = { ...process.env };
  for (const k of ["CLAUDECODE", "CODEX_THREAD_ID", "CODEX_SANDBOX", "OPENCODE", "PI_CODING_AGENT", "GRILL_MONITOR_MS"]) delete e[k];
  return { ...e, ...extra };
};

test("detectAgent: env fixtures for all five", () => {
  assert.equal(detectAgent(ENV.claude), "claude");
  assert.equal(detectAgent(ENV.codex), "codex");
  assert.equal(detectAgent(ENV.codexSandbox), "codex");
  assert.equal(detectAgent(ENV.opencode), "opencode");
  assert.equal(detectAgent(ENV.pi), "pi");
  assert.equal(detectAgent(ENV.unknown), "unknown");
  assert.equal(detectAgent({}), "unknown");
});

test("detectAgent: exact values only, order claude → codex → opencode → pi", () => {
  assert.equal(detectAgent({ CLAUDECODE: "0" }), "unknown");
  assert.equal(detectAgent({ OPENCODE: "true" }), "unknown");
  assert.equal(detectAgent({ PI_CODING_AGENT: "1" }), "unknown");
  assert.equal(detectAgent({ CODEX_THREAD_ID: "" }), "unknown");
  // Claude Code started from inside a Codex shell inherits both; the innermost one set CLAUDECODE.
  assert.equal(detectAgent({ ...ENV.codex, ...ENV.claude }), "claude");
  assert.equal(detectAgent({ ...ENV.opencode, ...ENV.codex }), "codex");
  assert.equal(detectAgent({ ...ENV.pi, ...ENV.opencode }), "opencode");
});

test("detectAgent: --agent flag wins; a bad flag throws", () => {
  assert.equal(detectAgent(ENV.claude, "pi"), "pi");
  assert.equal(detectAgent(ENV.unknown, "codex"), "codex");
  assert.equal(detectAgent(ENV.pi, "unknown"), "unknown");
  assert.throws(() => detectAgent(ENV.claude, "cursor"), /--agent must be one of claude\|codex\|opencode\|pi\|unknown/);
  assert.throws(() => detectAgent(ENV.claude, true), /--agent must be one of/);
  assert.deepEqual(AGENTS, ["claude", "codex", "opencode", "pi", "unknown"]);
});

test("claude: exact Monitor params (snapshot)", () => {
  const p = profile("claude", { ...CTX, env: {} });
  assert.equal(p.agent, "claude");
  assert.equal(p.mode, "monitor");
  assert.deepEqual(p.listen, {
    tool: "Monitor",
    params: {
      command: 'node "/opt/skills/grilling-ui/hub.mjs" watch --session "/h/grill-sessions/p-1/20260925-120000-ab12" --after 7 --agent-id a1b2c3d4e5f6',
      description: "grill: skills · Board layout",
      timeout_ms: 1800000,
    },
  });
  assert.match(p.repeat, /expir/); assert.match(p.repeat, /current `handled`/);
  assert.deepEqual(p.draw, { tool: "Agent", background: true });
  assert.equal(p.research, "subagent");
  assert.match(p.loadSkill, /Skill tool/);
});

test("claude: GRILL_MONITOR_MS overrides timeout_ms, clamped to Monitor's 1000..1800000", () => {
  const t = (v) => profile("claude", { ...CTX, env: { GRILL_MONITOR_MS: v } }).listen.params.timeout_ms;
  assert.equal(t("60000"), 60000);
  assert.equal(t("5000000"), 1800000);
  assert.equal(t("10"), 1000);
  assert.equal(t("nonsense"), 1800000);
  assert.equal(t(""), 1800000);
});

test("placeholders stay when the context is not given", () => {
  const p = profile("claude", { skill: SKILL, env: {} });
  assert.equal(p.listen.params.command, 'node "/opt/skills/grilling-ui/hub.mjs" watch --session "<session>" --after <handled> --agent-id <agentId>');
  assert.equal(p.listen.params.description, "grill: <project> · <topic>");
  const q = profile("pi", { skill: SKILL });
  assert.match(q.listen.params.command, /--session "<session>" --after <handled> --timeout 900 --agent-id <agentId>$/);
});

test("codex: exec_command + write_stdin polling in 30 s steps, wait --timeout 280", () => {
  const p = profile("codex", CTX);
  assert.equal(p.mode, "wait");
  assert.deepEqual(p.listen, {
    tool: "exec_command",
    params: {
      cmd: 'node "/opt/skills/grilling-ui/hub.mjs" wait --session "/h/grill-sessions/p-1/20260925-120000-ab12" --after 7 --timeout 280 --agent-id a1b2c3d4e5f6',
      yield_time_ms: 30000,
    },
    poll: { tool: "write_stdin", params: { session_id: "<session_id returned by exec_command>", chars: "", yield_time_ms: 30000 } },
  });
  assert.match(p.repeat, /exit 3/i);
  assert.deepEqual(p.draw, { tool: "spawn_agent", background: true });
  assert.equal(p.research, "subagent");
});

test("opencode: bash with timeout 600000, wait --timeout 540; task tool draws", () => {
  const p = profile("opencode", { ...CTX, env: {} });
  assert.deepEqual(p.listen, {
    tool: "bash",
    params: {
      command: 'node "/opt/skills/grilling-ui/hub.mjs" wait --session "/h/grill-sessions/p-1/20260925-120000-ab12" --after 7 --timeout 540 --agent-id a1b2c3d4e5f6',
      timeout: 600000,
    },
  });
  assert.deepEqual(p.draw, { tool: "task", background: false });
  assert.equal(p.research, "subagent");
  assert.match(p.loadSkill, /skill/);
  // background subagents exist only behind OpenCode's experimental flag
  assert.equal(profile("opencode", { ...CTX, env: { OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS: "true" } }).draw.background, true);
  assert.equal(profile("opencode", { ...CTX, env: { OPENCODE_EXPERIMENTAL: "1" } }).draw.background, true);
  assert.equal(profile("opencode", { ...CTX, env: { OPENCODE_EXPERIMENTAL: "1", OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS: "false" } }).draw.background, false);
});

test("pi: bash with no timeout, wait --timeout 900; draws inline, research left open", () => {
  const p = profile("pi", CTX);
  assert.deepEqual(p.listen, {
    tool: "bash",
    params: { command: 'node "/opt/skills/grilling-ui/hub.mjs" wait --session "/h/grill-sessions/p-1/20260925-120000-ab12" --after 7 --timeout 900 --agent-id a1b2c3d4e5f6' },
  });
  assert.deepEqual(p.draw, { tool: "inline", background: false });
  assert.equal(p.research, "leave-open");
});

test("unknown: shell wait --timeout 480, poll in ≤ 60 s steps", () => {
  const p = profile("unknown", CTX);
  assert.equal(p.mode, "wait");
  assert.equal(p.listen.tool, "shell");
  assert.match(p.listen.params.command, /wait --session .* --after 7 --timeout 480 --agent-id a1b2c3d4e5f6$/);
  assert.match(p.repeat, /60 s/);
  assert.deepEqual(p.draw, { tool: "inline", background: false });
});

test("every profile has the full shape and at most 3 notes", () => {
  for (const a of AGENTS) {
    const p = profile(a, CTX);
    assert.deepEqual(Object.keys(p).sort(), ["agent", "draw", "listen", "loadSkill", "mode", "notes", "repeat", "research"]);
    assert.ok(["monitor", "wait"].includes(p.mode));
    assert.ok(Array.isArray(p.notes) && p.notes.length <= 3, a);
    assert.ok(["subagent", "leave-open"].includes(p.research));
  }
});

test("CLI: agent-profile detects from env and honours --agent", () => {
  const out = JSON.parse(run(clean(ENV.opencode), ["agent-profile"]));
  assert.equal(out.agent, "opencode");
  assert.equal(out.listen.params.timeout, 600000);
  // the skill path is the absolute folder of hub.mjs
  assert.ok(out.listen.params.command.startsWith(`node "${dirname(HUB)}/hub.mjs" wait`), out.listen.params.command);
  assert.equal(JSON.parse(run(clean(ENV.opencode), ["agent-profile", "--agent", "claude"])).mode, "monitor");
  assert.equal(JSON.parse(run(clean({}), ["agent-profile"])).agent, "unknown");
  assert.equal(JSON.parse(run(clean({ ...ENV.claude, GRILL_MONITOR_MS: "60000" }), ["agent-profile"])).listen.params.timeout_ms, 60000);
  assert.throws(() => run(clean({}), ["agent-profile", "--agent", "cursor"], { stdio: "pipe" }), /--agent must be one of/);
});

test("CLI: --session fills session, handled, agentId, project and topic", () => {
  const dir = join(tmp("grill-prof-"), "20260925-120000-ab12"); mkdirSync(dir);
  writeFileSync(join(dir, "state.json"), JSON.stringify({ id: "20260925-120000-ab12", topic: "Board layout", project: "/code/my-app", agent: { status: "waiting", handled: 4 }, questions: [] }));
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ token: "t", owner: { agentId: "ffee00112233", agent: "claude", heartbeat: "x" } }));
  const p = JSON.parse(run(clean(ENV.claude), ["agent-profile", "--session", dir]));
  assert.equal(p.listen.params.command, `node "${dirname(HUB)}/hub.mjs" watch --session "${dir}" --after 4 --agent-id ffee00112233`);
  assert.equal(p.listen.params.description, "grill: my-app · Board layout");
  // handled defaults to 0 when the agent has not acknowledged anything yet
  writeFileSync(join(dir, "state.json"), JSON.stringify({ topic: "T", project: "/x/y", questions: [] }));
  assert.match(JSON.parse(run(clean(ENV.pi), ["agent-profile", "--session", dir])).listen.params.command, /--after 0 --timeout 900 --agent-id ffee00112233$/);
  // a folder that is not a session fails loudly
  assert.throws(() => run(clean({}), ["agent-profile", "--session", join(dir, "nope")], { stdio: "pipe" }), /not a grill session/);
});
