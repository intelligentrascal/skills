// agent-profile: agent detection from env fixtures, the exact listen parameters per agent, the
// GRILL_MONITOR_MS override and the CLI with --session (spec §5b, §10; plan D13, T16, T26).
// Every per-agent value is cited in docs/superpowers/verification/agent-profile-sources.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
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

test("detectAgent: exact values only, order codex → opencode → pi → claude", () => {
  assert.equal(detectAgent({ CLAUDECODE: "0" }), "unknown");
  assert.equal(detectAgent({ OPENCODE: "true" }), "unknown");
  assert.equal(detectAgent({ PI_CODING_AGENT: "1" }), "unknown");
  assert.equal(detectAgent({ CODEX_THREAD_ID: "" }), "unknown");
  // Every child inherits CLAUDECODE=1, so Codex/OpenCode/Pi launched from a Claude Code terminal
  // carry it too (T29 smoke run): their own markers win. The skills pass --agent, which is exact.
  assert.equal(detectAgent({ ...ENV.codex, ...ENV.claude }), "codex");
  assert.equal(detectAgent({ ...ENV.claude, ...ENV.pi }), "pi");
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
      command: "node '/opt/skills/grilling-ui/hub.mjs' watch --session '/h/grill-sessions/p-1/20260925-120000-ab12' --after 7 --agent-id a1b2c3d4e5f6",
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
  assert.equal(p.listen.params.command, "node '/opt/skills/grilling-ui/hub.mjs' watch --session '<session>' --after <handled> --agent-id <agentId>");
  assert.equal(p.listen.params.description, "grill: <project> · <topic>");
  const q = profile("pi", { skill: SKILL });
  assert.match(q.listen.params.command, /--session '<session>' --after <handled> --timeout 900 --agent-id <agentId>$/);
});

test("codex: exec_command + write_stdin polling in 30 s steps, wait --timeout 280", () => {
  const p = profile("codex", CTX);
  assert.equal(p.mode, "wait");
  assert.deepEqual(p.listen, {
    tool: "exec_command",
    params: {
      cmd: "node '/opt/skills/grilling-ui/hub.mjs' wait --session '/h/grill-sessions/p-1/20260925-120000-ab12' --after 7 --timeout 280 --agent-id a1b2c3d4e5f6",
      yield_time_ms: 30000,
    },
    poll: { tool: "write_stdin", params: { session_id: "<session_id returned by exec_command>", chars: "", yield_time_ms: 30000 } },
  });
  assert.match(p.repeat, /exit 3/i);
  assert.deepEqual(p.draw, { tool: "spawn_agent", background: true });
  assert.equal(p.research, "subagent");
});

test("opencode: bash with timeout 120000, wait --timeout 110; task tool draws", () => {
  const p = profile("opencode", { ...CTX, env: {} });
  assert.deepEqual(p.listen, {
    tool: "bash",
    params: {
      command: "node '/opt/skills/grilling-ui/hub.mjs' wait --session '/h/grill-sessions/p-1/20260925-120000-ab12' --after 7 --timeout 110 --agent-id a1b2c3d4e5f6",
      timeout: 120000,
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
    params: { command: "node '/opt/skills/grilling-ui/hub.mjs' wait --session '/h/grill-sessions/p-1/20260925-120000-ab12' --after 7 --timeout 900 --agent-id a1b2c3d4e5f6" },
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
  assert.equal(out.listen.params.timeout, 120000);
  // the skill path is the absolute folder of hub.mjs
  assert.ok(out.listen.params.command.startsWith(`node '${dirname(HUB)}/hub.mjs' wait`), out.listen.params.command);
  assert.equal(JSON.parse(run(clean(ENV.opencode), ["agent-profile", "--agent", "claude"])).mode, "monitor");
  assert.equal(JSON.parse(run(clean({}), ["agent-profile"])).agent, "unknown");
  assert.equal(JSON.parse(run(clean({ ...ENV.claude, GRILL_MONITOR_MS: "60000" }), ["agent-profile"])).listen.params.timeout_ms, 60000);
  assert.throws(() => run(clean({}), ["agent-profile", "--agent", "cursor"], { stdio: "pipe" }), /--agent must be one of/);
});

test("CLI: --session fills session, handled, project and topic; agentId only from --agent-id, never meta.json", () => {
  const dir = join(tmp("grill-prof-"), "20260925-120000-ab12"); mkdirSync(dir);
  writeFileSync(join(dir, "state.json"), JSON.stringify({ id: "20260925-120000-ab12", topic: "Board layout", project: "/code/my-app", agent: { status: "waiting", handled: 4 }, questions: [] }));
  // meta.json names another owner (a take happened): its agentId must never be printed
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ token: "t", owner: { agentId: "ffee00112233", agent: "codex", heartbeat: "x" } }));
  const p = JSON.parse(run(clean(ENV.claude), ["agent-profile", "--session", dir]));
  assert.equal(p.listen.params.command, `node '${dirname(HUB)}/hub.mjs' watch --session '${dir}' --after 4 --agent-id <agentId>`);
  assert.equal(p.listen.params.description, "grill: my-app · Board layout");
  const q = JSON.parse(run(clean(ENV.claude), ["agent-profile", "--session", dir, "--agent-id", "a1b2c3d4e5f6"]));
  assert.equal(q.listen.params.command, `node '${dirname(HUB)}/hub.mjs' watch --session '${dir}' --after 4 --agent-id a1b2c3d4e5f6`);
  assert.throws(() => run(clean({}), ["agent-profile", "--agent-id"], { stdio: "pipe" }), /--agent-id needs a value/);
  // handled defaults to 0 when the agent has not acknowledged anything yet
  writeFileSync(join(dir, "state.json"), JSON.stringify({ topic: "T", project: "/x/y", questions: [] }));
  assert.match(JSON.parse(run(clean(ENV.pi), ["agent-profile", "--session", dir, "--agent-id", "abc"])).listen.params.command, /--after 0 --timeout 900 --agent-id abc$/);
  // a folder that is not a session fails loudly
  assert.throws(() => run(clean({}), ["agent-profile", "--session", join(dir, "nope")], { stdio: "pipe" }), /not a grill session/);
});

test("every repeat says how to stop: exit 4 / taken → stop, tell the user, no restart; exit 1/2 → report, no loop", () => {
  for (const a of AGENTS) {
    const r = profile(a, CTX).repeat;
    assert.match(r, /Exit 4 or a \{"type":"taken"\} line: another agent took the session; stop listening, tell the user, and do not restart/, a);
    assert.match(r, /Exit 1 or 2: report the error line to the user; do not loop/, a);
  }
});

test("printed commands quote paths for POSIX shells ($, backtick, double and single quotes, spaces)", () => {
  const skill = join(tmp("grill-q-"), `sk $HOME \`id\` "q" it's`);
  const session = join(tmp("grill-q-"), `s $(id) \`x\` "y" o'k`);
  for (const a of AGENTS) {
    const p = profile(a, { skill, session, handled: 3, agentId: "a b'c" });
    const cmd = p.listen.params.command ?? p.listen.params.cmd;
    // the shell must see exactly these words: print each argument on its own line instead of running node
    const words = execFileSync("sh", ["-c", cmd.replace(/^node /, "printf '%s\\n' ")], { encoding: "utf8" }).split("\n").slice(0, -1);
    assert.equal(words[0], `${skill}/hub.mjs`, a);
    assert.equal(words[words.indexOf("--session") + 1], session, a);
    assert.equal(words[words.indexOf("--agent-id") + 1], "a b'c", a);
  }
});

// ---- board watcher: agent-profile --map (plan T35; spec §4a Board watcher, §5b Listening) ----
const MAPCTX = { skill: SKILL, map: "skills-1a2b3c4d/42", mapTitle: "Board redesign", project: "skills", agentId: "b0a4d1e2f3a4", handled: 3 };

test("map: claude Monitor on watch --map, description board: <project> · <map title> (snapshot)", () => {
  const p = profile("claude", { ...MAPCTX, env: {} });
  assert.equal(p.mode, "monitor");
  assert.deepEqual(p.listen, {
    tool: "Monitor",
    params: {
      command: "node '/opt/skills/grilling-ui/hub.mjs' watch --map skills-1a2b3c4d/42 --after 3 --agent-id b0a4d1e2f3a4",
      description: "board: skills · Board redesign",
      timeout_ms: 1800000,
    },
  });
  assert.match(p.repeat, /map event rule/); assert.match(p.repeat, /agent-profile --map/);
  assert.doesNotMatch(p.repeat, /taken/, "a map listener is never taken: the latest watcher wins");
  assert.equal(profile("claude", { ...MAPCTX, env: { GRILL_MONITOR_MS: "60000" } }).listen.params.timeout_ms, 60000);
});

test("map: wait agents get wait --map with the same tools and timeouts as sessions", () => {
  const cmd = (a, secs) => `node '/opt/skills/grilling-ui/hub.mjs' wait --map skills-1a2b3c4d/42 --after 3 --timeout ${secs} --agent-id b0a4d1e2f3a4`;
  const codex = profile("codex", MAPCTX);
  assert.deepEqual(codex.listen.params, { cmd: cmd("codex", 280), yield_time_ms: 30000 });
  assert.equal(codex.listen.poll.tool, "write_stdin");
  assert.deepEqual(profile("opencode", { ...MAPCTX, env: {} }).listen, { tool: "bash", params: { command: cmd("opencode", 110), timeout: 120000 } });
  assert.deepEqual(profile("pi", MAPCTX).listen, { tool: "bash", params: { command: cmd("pi", 900) } });
  assert.deepEqual(profile("unknown", MAPCTX).listen, { tool: "shell", params: { command: cmd("unknown", 480) } });
  for (const a of ["codex", "opencode", "pi", "unknown"]) {
    const r = profile(a, { ...MAPCTX, env: {} }).repeat;
    assert.match(r, /map event rule/, a); assert.match(r, /Exit 3/, a); assert.match(r, /Exit 1 or 2: report the error line to the user; do not loop/, a);
    assert.doesNotMatch(r, /patch agent\.handled/, a);
  }
});

test("map: full shape, placeholders when title or project are unknown", () => {
  for (const a of AGENTS) {
    const p = profile(a, MAPCTX);
    assert.deepEqual(Object.keys(p).sort(), ["agent", "draw", "listen", "loadSkill", "mode", "notes", "repeat", "research"]);
  }
  const p = profile("claude", { skill: SKILL, map: "skills-1a2b3c4d/42", env: {} });
  assert.equal(p.listen.params.command, "node '/opt/skills/grilling-ui/hub.mjs' watch --map skills-1a2b3c4d/42 --after <handled> --agent-id <agentId>");
  assert.equal(p.listen.params.description, "board: <project> · <map title>");
});

test("CLI: agent-profile --map reads handled and title from map.json; --agent-id or a fresh agentId", () => {
  const home = tmp("grill-prof-home-");
  const dir = join(home, "maps", "my-app-0a1b2c3d", "42"); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ token: "t" }));
  writeFileSync(join(dir, "map.json"), JSON.stringify({ title: "Checkout rewrite", handled: 5, tickets: [] }));
  const env = (extra) => clean({ GRILL_HOME: home, ...extra });
  const p = JSON.parse(run(env(ENV.claude), ["agent-profile", "--map", "my-app-0a1b2c3d/42", "--agent-id", "b0a4d1e2f3a4"]));
  assert.equal(p.listen.params.command, `node '${dirname(HUB)}/hub.mjs' watch --map my-app-0a1b2c3d/42 --after 5 --agent-id b0a4d1e2f3a4`);
  assert.equal(p.listen.params.description, "board: my-app · Checkout rewrite");
  assert.equal(p.agentId, "b0a4d1e2f3a4");
  // no --agent-id: a fresh board agentId is minted, printed, and used in the command
  const q = JSON.parse(run(env(ENV.pi), ["agent-profile", "--map", "my-app-0a1b2c3d/42"]));
  assert.match(q.agentId, /^[0-9a-f]{12}$/);
  assert.match(q.listen.params.command, new RegExp(`wait --map my-app-0a1b2c3d/42 --after 5 --timeout 900 --agent-id ${q.agentId}$`));
  // handled defaults to 0
  writeFileSync(join(dir, "map.json"), JSON.stringify({ title: "Checkout rewrite" }));
  assert.match(JSON.parse(run(env(ENV.pi), ["agent-profile", "--map", "my-app-0a1b2c3d/42", "--agent-id", "x1"])).listen.params.command, /--after 0 --timeout 900/);
  // errors: no such map, both --map and --session, a bad key
  assert.throws(() => run(env({}), ["agent-profile", "--map", "my-app-0a1b2c3d/nope"], { stdio: "pipe" }), /no such map/);
  assert.throws(() => run(env({}), ["agent-profile", "--map", "my-app-0a1b2c3d/42", "--session", dir], { stdio: "pipe" }), /either --session or --map/);
  assert.throws(() => run(env({}), ["agent-profile", "--map", "a/b/c"], { stdio: "pipe" }), /bad map key/);
});
