// agent-profile: detect the coding agent and print the exact listening/draw parameters the
// grilling-ui skill follows verbatim (spec §5b; plan D13, T16, T26). Every tool name, parameter
// and limit below is checked against the agent's source; see
// docs/superpowers/verification/agent-profile-sources.md for file:line citations.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { print, die, readJson, envMs, rand } from "./util.mjs";

export const AGENTS = ["claude", "codex", "opencode", "pi", "unknown"];

// The flag wins; else the env each agent sets on a model-run shell, in this order.
export function detectAgent(env = process.env, flag) {
  if (flag !== undefined) {
    if (typeof flag !== "string" || !AGENTS.includes(flag)) throw new Error(`--agent must be one of ${AGENTS.join("|")}`);
    return flag;
  }
  // Innermost agent first: every child process inherits CLAUDECODE=1, so a Codex/OpenCode/Pi run
  // launched from a Claude Code terminal still carries it (T29 smoke run). Their own markers win.
  if (env.CODEX_THREAD_ID || env.CODEX_SANDBOX) return "codex";
  if (env.OPENCODE === "1") return "opencode";
  if (env.PI_CODING_AGENT === "true") return "pi";
  if (env.CLAUDECODE === "1") return "claude";
  return "unknown";
}

// Monitor: default 300000, capped at 1800000, minimum 1000 (Claude Code Monitor tool schema).
const MONITOR_MAX_MS = 1_800_000, MONITOR_MIN_MS = 1000;
// POSIX shell quoting for the printed commands: single quotes, each ' written as '\''. An agentId
// of plain id characters (or the placeholder) stays bare.
export const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
const shArg = (s) => (/^[A-Za-z0-9_-]+$/.test(String(s)) ? String(s) : shq(s));
// How a listener ends (every agent): taken (exit 4 / a {"type":"taken"} line) or an error (exit 1/2).
export const STOP_RULES = 'Exit 4 or a {"type":"taken"} line: another agent took the session; stop listening, tell the user, and do not restart the listener. Exit 1 or 2: report the error line to the user; do not loop.';
// Effect's Config.boolean truthy spellings (OpenCode runtime flags).
const effectBool = (v) => v === undefined ? undefined : ["true", "yes", "on", "1", "y"].includes(String(v).toLowerCase());

// A map listener (the board watcher, spec §4a) is never taken: the latest watcher wins.
const MAP_STOP_RULES = "Exit 1 or 2: report the error line to the user; do not loop.";
// A map key is [a-z0-9-]+/[a-z0-9-]+: safe bare in a shell word.
const MAP_KEY_RE = /^[a-z0-9-]+\/[a-z0-9-]+$/;

// With `map` (a map key) the listener is the board watcher: watch/wait --map, same tools and
// timeouts as a session listener, `handled` = map.json handled, description "board: …".
export function profile(agent, { skill = "<skill>", session, map, mapTitle, agentId, handled, project, topic, env = process.env } = {}) {
  const H = handled ?? "<handled>", A = agentId === undefined ? "<agentId>" : shArg(agentId);
  const onMap = map !== undefined;
  const T = onMap ? `--map ${MAP_KEY_RE.test(map) ? map : shq(map)}` : `--session ${shq(session ?? "<session>")}`;
  const hub = `node ${shq(`${skill}/hub.mjs`)}`;
  const wait = (secs) => `${hub} wait ${T} --after ${H} --timeout ${secs} --agent-id ${A}`;
  const proj = project ? path.basename(project) : "<project>";
  const waitRepeat = onMap
    ? `Exit 0: handle the printed board events per the map event rule (its map-patch sets handled), then start a new wait with the new handled. Exit 3 (idle timeout): start a new wait with the same handled. ${MAP_STOP_RULES} Never end the turn while watching the board; if you must stop, say the board watcher is inactive (board requests queue).`
    : `Exit 0: handle every printed send as one batch, patch agent.handled, then start a new wait with the new handled. Exit 3 (idle timeout): start a new wait with the same handled. ${STOP_RULES} Never end the turn while listening; if you must stop, say the listener is inactive (Sends queue and replay on resume).`;
  const base = { agent, mode: "wait" };

  if (agent === "claude") {
    const ms = Math.min(MONITOR_MAX_MS, Math.max(MONITOR_MIN_MS, envMs("GRILL_MONITOR_MS", MONITOR_MAX_MS, env)));
    return {
      ...base, mode: "monitor",
      listen: { tool: "Monitor", params: {
        command: `${hub} watch ${T} --after ${H} --agent-id ${A}`,
        description: onMap ? `board: ${proj} · ${mapTitle || "<map title>"}` : `grill: ${proj} · ${topic ?? "<topic>"}`,
        timeout_ms: ms,
      } },
      repeat: onMap
        ? `Each Monitor event is a board event (work or refresh): handle it per the map event rule; its map-patch sets handled. On the expiry notice, re-run agent-profile --map with your --agent-id and re-arm the Monitor exactly as printed. ${MAP_STOP_RULES} Stop it with TaskStop when you hand off to work mode or the user ends board mode.`
        : `Each Monitor event is a send: handle it and patch agent.handled. On the expiry notice, re-arm the same Monitor with the current \`handled\`. ${STOP_RULES} Stop it with TaskStop only at Finish.`,
      draw: { tool: "Agent", background: true },
      research: "subagent",
      loadSkill: "Call the Skill tool with the plugin-qualified name, e.g. mattpocock-skills:grilling.",
      notes: ["Never stop the hub; only the Monitor."],
    };
  }
  if (agent === "codex") {
    return {
      ...base,
      listen: {
        tool: "exec_command", params: { cmd: wait(280), yield_time_ms: 30000 },
        poll: { tool: "write_stdin", params: { session_id: "<session_id returned by exec_command>", chars: "", yield_time_ms: 30000 } },
      },
      repeat: `While a call returns a session_id the wait is still running: poll that same session with write_stdin (chars "") in 30 s steps; never start a second wait. ${waitRepeat}`,
      draw: { tool: "spawn_agent", background: true },
      research: "subagent",
      loadSkill: "Open and read the SKILL.md at the path listed for that skill name in your skills list.",
      notes: [
        "exec_command yields after at most 30000 ms; the wait's own --timeout 280 bounds each process under the 300000 ms write_stdin poll ceiling.",
        "Needs the sandbox config (network_access, writable_roots) printed by install-agents.sh.",
      ],
    };
  }
  if (agent === "opencode") {
    const bg = effectBool(env.OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS) ?? effectBool(env.OPENCODE_EXPERIMENTAL) ?? false;
    return {
      ...base,
      listen: { tool: "bash", params: { command: wait(110), timeout: 120000 } }, // 110 s fits OpenCode's 2-min default even when the model drops `timeout` (T29)
      repeat: waitRepeat,
      draw: { tool: "task", background: bg },
      research: "subagent",
      loadSkill: 'Call the skill tool with {name: "<skill name>"}.',
      notes: bg ? [] : ["task runs in the foreground (background subagents need OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true); Sends made meanwhile queue and the next wait returns them."],
    };
  }
  if (agent === "pi") {
    return {
      ...base,
      listen: { tool: "bash", params: { command: wait(900) } },
      repeat: waitRepeat,
      draw: { tool: "inline", background: false },
      research: "leave-open",
      loadSkill: "Use the read tool on the <location> listed for that skill name (the user can also type /skill:<name>).",
      notes: ["No timeout parameter: Esc kills only the wait; the hub survives. Research tickets stay open for a later session; say so."],
    };
  }
  return {
    ...base, agent: "unknown",
    listen: { tool: "shell", params: { command: wait(480) } },
    repeat: `If your shell yields a still-running process, keep that one wait and poll it in steps of 60 s or less; never start a second wait. ${waitRepeat}`,
    draw: { tool: "inline", background: false },
    research: "leave-open",
    loadSkill: "Read the SKILL.md of the named skill from your skills list.",
    notes: ["Agent not detected; pass --agent claude|codex|opencode|pi if you are one of them."],
  };
}

// The skill folder is the absolute folder of hub.mjs (this file lives in <skill>/lib/).
export const skillDir = () => path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export async function cmdAgentProfile(o) {
  let agent;
  try { agent = detectAgent(process.env, o.agent); } catch (e) { die(e.message); }
  const ctx = { skill: skillDir(), env: process.env };
  // The agentId is the caller's own (printed by new/resume), never read from meta.json: after a
  // take, meta.json names the new owner, and printing that to the old one would hand it the session.
  if (o["agent-id"] !== undefined) {
    if (typeof o["agent-id"] !== "string" || !o["agent-id"]) die("--agent-id needs a value");
    ctx.agentId = o["agent-id"];
  }
  if (o.session !== undefined && o.map !== undefined) die("give either --session or --map, not both");
  if (o.map !== undefined) {
    // The board watcher (plan T35): handled and title from map.json; a board has no `new` to mint
    // an agentId, so one is minted here when --agent-id is absent and printed as `agentId`.
    if (typeof o.map !== "string") die("--map needs a key");
    const { mapKeyOf, mapDirOf, mapFile, MapKeyError } = await import("./maps.mjs");
    const { grillHome } = await import("./home.mjs");
    let key;
    try { key = mapKeyOf(o.map); } catch (e) { die(e instanceof MapKeyError ? e.message : `cannot read the project: ${e.code || e.message}`); }
    const map = readJson(mapFile(mapDirOf(grillHome(process.env), key)));
    if (!map || typeof map !== "object") die(`no such map ${key} (map-patch it first)`);
    ctx.agentId ??= rand(12);
    Object.assign(ctx, {
      map: key,
      mapTitle: typeof map.title === "string" ? map.title : "",
      handled: Number.isInteger(map.handled) && map.handled > 0 ? map.handled : 0,
      project: key.split("/")[0].replace(/-[0-9a-f]{8}$/, ""),
    });
    return print({ ...profile(agent, ctx), agentId: ctx.agentId });
  }
  if (o.session !== undefined) {
    if (typeof o.session !== "string") die("--session needs a folder");
    const dir = path.resolve(o.session);
    const state = fs.existsSync(path.join(dir, "state.json")) ? readJson(path.join(dir, "state.json")) : null;
    if (!state) die(`not a grill session (no readable state.json): ${dir}`);
    Object.assign(ctx, {
      session: dir,
      handled: Number.isInteger(state.agent?.handled) ? state.agent.handled : 0,
      project: state.project,
      topic: state.topic,
    });
  }
  print(profile(agent, ctx));
}
