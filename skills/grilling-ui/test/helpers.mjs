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
