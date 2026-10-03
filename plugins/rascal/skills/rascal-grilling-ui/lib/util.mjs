// Small shared helpers. Ported from jasonku09/grill-with-ui server.mjs:31-49 (daafa1e).
import fs from "node:fs";
import crypto from "node:crypto";

export function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { o._.push(a); continue; }
    const k = a.slice(2), v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) o[k] = true; else { o[k] = v; i++; }
  }
  return o;
}
export const print = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
export const die = (msg, code = 2) => { process.stderr.write(`grill: ${msg}\n`); process.exit(code); };
// Atomic: a temp file in the same folder, then rename, so a reader never sees half a file.
// Returns the byte length written. `mode` (e.g. 0o600) applies to the new file.
export function writeJson(file, obj, mode) {
  const text = JSON.stringify(obj, null, 2) + "\n";
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tmp, text, mode === undefined ? undefined : { mode });
    fs.renameSync(tmp, file);
  } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
  return Buffer.byteLength(text);
}
// null when missing or unparseable.
export function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}
export const rand = (hexChars) => crypto.randomBytes(Math.ceil(hexChars / 2)).toString("hex").slice(0, hexChars);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export const oneLine = (s) => String(s).replace(/\s+/g, " ").trim();
// A numeric env override, or the default.
export const envMs = (name, dflt, env = process.env) => {
  const n = Number(env[name]);
  return env[name] !== undefined && env[name] !== "" && Number.isFinite(n) && n >= 0 ? n : dflt;
};
