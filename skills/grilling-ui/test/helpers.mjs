// test/helpers.mjs
import { mkdtempSync, readFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join, dirname } from "node:path";
import { execFileSync, spawn } from "node:child_process"; import { fileURLToPath } from "node:url";
export const HUB = join(dirname(fileURLToPath(import.meta.url)), "..", "hub.mjs");
export const tmp = (p) => mkdtempSync(join(tmpdir(), p));
export function mkHome(extra = {}) { const home = tmp("grill-home-"); return { home, env: { ...process.env, GRILL_HOME: home, GRILL_NO_OPEN: "1", ...extra } }; }
export const run = (env, args, opts = {}) => execFileSync(process.execPath, [HUB, ...args], { encoding: "utf8", env, ...opts }).trim();
// opts.input (like execFileSync's) is written to stdin; stdin is always closed so a reader never hangs.
// Resolves on "close" (not "exit") so all of stdout/stderr has been read.
export const runAsync = (env, args, { input, ...opts } = {}) => new Promise((res) => { const c = spawn(process.execPath, [HUB, ...args], { env, ...opts }); c.stdin?.on("error", () => {}); c.stdin?.end(input ?? ""); let out = "", err = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (err += d)); c.on("close", (code) => res({ code, out: out.trim(), err: err.trim() })); });
export const hubInfo = (home) => JSON.parse(readFileSync(join(home, "hub.json"), "utf8"));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function waitUntil(fn, ms = 5000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await sleep(25); } throw new Error("waitUntil timed out"); }
export async function stopHub(home) { try { const h = hubInfo(home); await fetch(`http://127.0.0.1:${h.port}/admin/shutdown`, { method: "POST", headers: { "x-grill-admin": h.adminToken } }); } catch {} }
// Stop the hub and make sure its process is gone, then remove the home (T12+ tests).
export async function cleanupHub(home, { rm = true } = {}) {
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
  let pid; try { pid = hubInfo(home).pid; } catch { /* never started */ }
  await stopHub(home);
  if (pid) { try { await waitUntil(() => !alive(pid), 3000); } catch { try { process.kill(pid, "SIGKILL"); } catch {} } }
  if (rm) (await import("node:fs")).rmSync(home, { recursive: true, force: true });
}
// A minimal EventSource over fetch: sseReader(url) → { next(event, ms) → Promise<data object>,
// clear(event?), events (all parsed {event, data}), comments (count of ":" lines), retry, status,
// headers (Promise), close() }.
export function sseReader(url) {
  const ac = new AbortController();
  const r = { events: [], comments: 0, retry: null, queue: [], waiters: [] };
  const deliver = (e) => {
    r.events.push(e);
    const w = r.waiters.findIndex((x) => x.event === e.event);
    if (w >= 0) { const [x] = r.waiters.splice(w, 1); clearTimeout(x.timer); x.resolve(e.data); } else r.queue.push(e);
  };
  r.headers = fetch(url, { signal: ac.signal, headers: { accept: "text/event-stream" } }).then((res) => {
    r.status = res.status;
    (async () => {
      const dec = new TextDecoder(); let buf = "";
      try {
        for await (const chunk of res.body) {
          buf += dec.decode(chunk, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const block = buf.slice(0, i); buf = buf.slice(i + 2);
            let event = "message", data = "", has = false;
            for (const l of block.split("\n")) {
              if (l.startsWith(":")) r.comments++;
              else if (l.startsWith("event:")) event = l.slice(6).trim();
              else if (l.startsWith("data:")) { data += l.slice(5).trim(); has = true; }
              else if (l.startsWith("retry:")) r.retry = Number(l.slice(6).trim());
            }
            if (has) { let d; try { d = JSON.parse(data); } catch { d = data; } deliver({ event, data: d }); }
          }
        }
      } catch { /* aborted */ }
    })();
    return res.headers;
  }).catch(() => null);
  r.next = (event, ms = 3000) => {
    const i = r.queue.findIndex((e) => e.event === event);
    if (i >= 0) return Promise.resolve(r.queue.splice(i, 1)[0].data);
    return new Promise((resolve, reject) => {
      const x = { event, resolve };
      x.timer = setTimeout(() => { r.waiters.splice(r.waiters.indexOf(x), 1); reject(new Error(`no "${event}" event within ${ms} ms`)); }, ms);
      r.waiters.push(x);
    });
  };
  r.clear = (event) => { r.queue = event ? r.queue.filter((e) => e.event !== event) : []; };
  r.close = () => ac.abort();
  return r;
}
// Wait until `event` has been quiet on reader r for ms, then clear it (late or replayed file
// events drain first: macOS FSEvents may replay a folder's recent creation to a watch attached
// right after it, and under load events arrive late).
export async function settle(r, event, ms = 300, max = 5000) {
  const end = Date.now() + max;
  while (Date.now() < end) { try { await r.next(event, ms); } catch { r.clear(event); return; } }
  throw new Error(`${event} pings never settled`);
}
