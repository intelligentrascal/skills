// `url` and best-effort `open` (spec §6; decision D1).
//
//   url  (--session DIR [--ui L] | --map KEY)   → the URL line
//   open (--session DIR [--ui L] | --map KEY)   → {"opened":bool,"reason"?,"url"}
//
// open, in order: skip rules (GRILL_NO_OPEN=1, SSH_CONNECTION, Linux without a display) → URL
// validation (URL_RE) → tab detection via /clients (a counted tab, or one seen in the last 120 s;
// within GRILL_OPEN_GRACE_MS (3 s) of a hub start, poll /clients until then so an existing tab
// can reconnect) → spawn the opener without a shell, killed after GRILL_OPENER_TIMEOUT_MS (5 s).
// reason ∈ GRILL_NO_OPEN | ssh | no-display | invalid-url | tab-open | opener-error | opener-failed.
// Both commands run `ensure` first (they need the port). Exit codes: 0 (whatever open decided);
// 1 hub/home failure; 2 bad input.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { die, envMs, oneLine, sleep } from "./util.mjs";
import { sessionUrl, stateFile } from "./sessions.mjs";
import { MapKeyError, mapDirOf, mapHubOrDie, mapKeyOf, mapMetaFile, mapUrl } from "./maps.mjs";

// D1 (spec §6 regex widened with `inbox`; map keys are exactly <projectKey>/<slug>).
export const URL_RE = /^http:\/\/127\.0\.0\.1:\d+\/(s\/[A-Za-z0-9-]+\/(inbox|brief|studio)?|m\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+\/)$/;
export const UIS = ["inbox", "brief", "studio"];
export const TAB_RECENT_MS = 120_000;

export function skipReason(env, platform) {
  if (env.GRILL_NO_OPEN === "1") return "GRILL_NO_OPEN";
  if (env.SSH_CONNECTION) return "ssh";
  if (platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) return "no-display";
  return null;
}
// [command, args]; always spawned with shell: false.
export function openerArgs(url, env, platform) {
  if (env.GRILL_OPENER) return [env.GRILL_OPENER, [url]];
  if (platform === "darwin") return ["open", [url]];
  if (platform === "win32") return ["cmd", ["/c", "start", "", url]];
  return ["xdg-open", [url]];
}
// A /clients reply that means a tab is (or very recently was) showing this grill/board.
export const tabOpen = (c, now = Date.now()) => !!c && (c.count > 0 || (typeof c.lastSeen === "string" && now - Date.parse(c.lastSeen) < TAB_RECENT_MS));

// Spawn the opener; resolves {opened:true} on exit 0 or when still running at the time limit
// (it is killed then: some openers linger while the browser starts), {opened:false, reason}
// on a spawn error or a non-zero exit.
export function runOpener(url, env = process.env, platform = process.platform, timeoutMs = envMs("GRILL_OPENER_TIMEOUT_MS", 5000, env)) {
  const [cmd, args] = openerArgs(url, env, platform);
  return new Promise((resolve) => {
    let child;
    try { child = spawn(cmd, args, { shell: false, stdio: "ignore", windowsHide: true }); }
    catch { return resolve({ opened: false, reason: "opener-error" }); }
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} resolve({ opened: true }); }, timeoutMs);
    child.on("error", () => { clearTimeout(timer); resolve({ opened: false, reason: "opener-error" }); });
    child.on("exit", (code) => { clearTimeout(timer); resolve(code === 0 ? { opened: true } : { opened: false, reason: "opener-failed" }); });
  });
}

// { hub, url, clients } for --session/--map; dies (exit 2) on bad input.
async function target(o, env) {
  const hasS = o.session !== undefined, hasM = o.map !== undefined;
  if (hasS === hasM || o.session === true || o.map === true) die("give exactly one of --session <dir> or --map <slug|projectKey/slug>");
  if (o.ui !== undefined && hasM) die("--ui is for sessions (boards have one layout)");
  if (o.ui !== undefined && !UIS.includes(o.ui)) die(`--ui must be one of ${UIS.join("|")}`);
  if (hasS) {
    const dir = path.resolve(String(o.session));
    if (!fs.existsSync(stateFile(dir))) die(`no state.json in ${dir}; not a grill session`);
    const hub = await mapHubOrDie(env);
    const id = path.basename(dir);
    return { hub, url: sessionUrl(hub.port, id) + (o.ui ?? ""), clients: `http://127.0.0.1:${hub.port}/s/${id}/clients` };
  }
  let key;
  try { key = mapKeyOf(String(o.map)); } catch (e) { die(e instanceof MapKeyError ? e.message : `cannot read the project: ${e.code || oneLine(e.message)}`, e instanceof MapKeyError ? 2 : 1); }
  const hub = await mapHubOrDie(env);
  if (!fs.existsSync(mapMetaFile(mapDirOf(hub.home, key)))) die(`no such map ${key}; map-patch creates it`);
  return { hub, url: mapUrl(hub.port, key), clients: `http://127.0.0.1:${hub.port}/m/${key}/clients` };
}
const exit = (code = 0) => process.stdout.write("", () => process.exit(code));

export async function cmdUrl(o, env = process.env) {
  const { url } = await target(o, env);
  if (!URL_RE.test(url)) die(`not a valid grill URL: ${url}`);
  process.stdout.write(url + "\n");
  exit();
}

async function clientsOf(url) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(1000) }); return r.ok ? await r.json() : null; } catch { return null; }
}

export async function cmdOpen(o, env = process.env, platform = process.platform) {
  const { url, clients } = await target(o, env);
  const out = (r) => { process.stdout.write(JSON.stringify({ opened: r.opened, ...(r.reason ? { reason: r.reason } : {}), url }) + "\n"); exit(); };
  const skip = skipReason(env, platform);
  if (skip) return out({ opened: false, reason: skip });
  if (!URL_RE.test(url)) return out({ opened: false, reason: "invalid-url" });
  // Tab detection. A /clients failure is not a tab: open anyway (best effort).
  const graceMs = envMs("GRILL_OPEN_GRACE_MS", 3000, env);
  let c = await clientsOf(clients);
  if (tabOpen(c)) return out({ opened: false, reason: "tab-open" });
  const until = c && typeof c.hubStarted === "string" ? Date.parse(c.hubStarted) + graceMs : 0;
  while (Date.now() < until) {
    await sleep(Math.min(150, until - Date.now()));
    c = await clientsOf(clients);
    if (tabOpen(c)) return out({ opened: false, reason: "tab-open" });
  }
  out(await runOpener(url, env, platform));
}
