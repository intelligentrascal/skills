#!/usr/bin/env node
// intelligentrascal grill hub CLI. Plain Node (20+), no dependencies, no build step.
// One per-user hub process (`serve`) serves every grill and board; every other subcommand is a
// short-lived CLI call. See docs/superpowers/specs/2026-09-25-intelligentrascal-grill-ui-design.md.
import { parseArgs, die } from "./lib/util.mjs";

const USAGE = `usage: hub.mjs <command> [options]
  ensure                                             start or reuse the hub → {"port","pid","version","started","reused"}
  serve [--port N]                                   run the hub (internal; spawned by ensure)
  new --topic T [--doc P] [--agent A] [--phase P] [--map-key K]
  sessions [--all]
  resume [--session DIR] [--take] [--agent A]
  patch --session DIR --agent-id ID [--file P]
  pending --session DIR
  url  (--session DIR [--ui L] | --map KEY)
  open (--session DIR [--ui L] | --map KEY)
  watch (--session DIR | --map KEY) --after N --agent-id ID
  wait  (--session DIR | --map KEY) --after N --timeout S --agent-id ID
  map-patch --map KEY [--agent-id ID] [--file P]
  claim --map KEY --ticket TITLE --agent-id ID [--release]
  agent-profile [--agent A] [--session DIR]`;

// Each command is loaded lazily so a short CLI call imports only what it needs.
const cmds = {
  ensure: async (o) => (await import("./lib/lifecycle.mjs")).cmdEnsure(o),
  serve: async (o) => (await import("./lib/lifecycle.mjs")).cmdServe(o),
  new: async (o) => (await import("./lib/sessions.mjs")).cmdNew(o),
  sessions: async (o) => (await import("./lib/sessions.mjs")).cmdSessions(o),
  resume: async (o) => (await import("./lib/sessions.mjs")).cmdResume(o),
  patch: async (o) => (await import("./lib/sessions.mjs")).cmdPatch(o),
  pending: async (o) => (await import("./lib/sessions.mjs")).cmdPending(o),
  watch: async (o) => (await import("./lib/events.mjs")).cmdWatch(o),
  wait: async (o) => (await import("./lib/events.mjs")).cmdWait(o),
  "map-patch": async (o) => (await import("./lib/maps.mjs")).cmdMapPatch(o),
  url: async (o) => (await import("./lib/open.mjs")).cmdUrl(o),
  open: async (o) => (await import("./lib/open.mjs")).cmdOpen(o),
  "agent-profile": async (o) => (await import("./lib/profile.mjs")).cmdAgentProfile(o),
};

const o = parseArgs(process.argv.slice(2));
const name = o._[0] ?? "";
// own keys only: `toString` and friends are inherited, not subcommands
if (!Object.hasOwn(cmds, name)) die(name && name !== "help" && !o.help ? `unknown command ${JSON.stringify(name)}\n${USAGE}` : USAGE);
await cmds[name](o);
