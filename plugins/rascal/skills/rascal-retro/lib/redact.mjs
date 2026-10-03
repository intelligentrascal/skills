// Privacy patterns shared by the repo scrub (scripts/scrub.mjs) and the miner's digest redaction
// (design doc Q15). Generic patterns only; personal names live in the local deny-list.
import { readFileSync } from "node:fs";

const SAFE_USERS = new Set(["Shared", "runner", "user", "you", "me", "name", "[user]"]);
const SAFE_EMAILS = /^(noreply@anthropic\.com|.+@users\.noreply\.github\.com)$/i;

export const GENERIC = [
  { kind: "home-path", re: /\/(?:Users|home)\/([A-Za-z0-9._-]+)\//g, keep: (m) => SAFE_USERS.has(m[1]), sub: (m) => m[0].replace(m[1], "[user]") },
  { kind: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, keep: (m) => SAFE_EMAILS.test(m[0]), sub: () => "[email]" },
  { kind: "token", re: /\b(?:sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[0-9A-Z]{16}|xox[bp]-[A-Za-z0-9-]{20,})/g, sub: () => "[token]" },
  { kind: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, sub: () => "[private-key]" },
];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// [{ kind, index, text }] for one string. deny: lower-cased literals.
export function scanText(text, deny = []) {
  const hits = [];
  for (const p of GENERIC) for (const m of text.matchAll(p.re)) if (!p.keep?.(m)) hits.push({ kind: p.kind, index: m.index, text: m[0] });
  for (const d of deny) for (const m of text.matchAll(new RegExp(escape(d), "gi"))) hits.push({ kind: "deny-list", index: m.index, text: m[0] });
  return hits.sort((a, b) => a.index - b.index);
}

// The text with every hit replaced by its marker ([user] inside paths, [email], [token], [private-key], [redacted]).
export function redact(text, deny = []) {
  let out = text;
  for (const p of GENERIC) out = out.replace(p.re, (...args) => {
    const m = args.slice(0, -2);            // [match, ...groups]; the last two args are offset and input
    return p.keep?.(m) ? m[0] : p.sub(m);
  });
  for (const d of deny) out = out.replace(new RegExp(escape(d), "gi"), "[redacted]");
  return out;
}

// Lower-cased literals from a deny-list file (# comments, blank lines ignored); [] when missing.
export function readDeny(file) {
  try { return readFileSync(file, "utf8").split("\n").map((l) => l.replace(/#.*/, "").trim().toLowerCase()).filter(Boolean); }
  catch { return []; }
}
