// Privacy patterns shared by the repo scrub (scripts/scrub.mjs) and the miner's digest redaction
// (design doc Q15). Generic patterns only; personal names live in the local deny-list.
import { readFileSync } from "node:fs";

const SAFE_USERS = new Set(["Shared", "runner", "user", "you", "me", "name", "[user]"]);
const SAFE_EMAILS = /^(noreply@anthropic\.com|.+@users\.noreply\.github\.com)$/i;

// Each home-path alternative captures (prefix)(name); the substitution keeps the prefix, so a name
// that is a substring of "Users" or "home" can't leak.
//   /Users/<name>/… and /home/<name>/…
//   a bare macOS home dir, /Users/<name> (e.g. a cwd); a bare /home/<name> is not matched, because
//     prose like "hub/home/write" would be a false positive
//   the dashed project slug Claude Code and Cursor use, -Users-<name>-… (not -home-: kebab-case prose)
//   C:\Users\<name>\…
const HOME = /(\/(?:Users|home)\/)([A-Za-z0-9._-]+)(?=\/)|(\/Users\/)([A-Za-z0-9._-]+)(?![A-Za-z0-9._\/-])|(?<![A-Za-z0-9])(-?Users-)([A-Za-z0-9._]+)(?=-)|([A-Za-z]:\\Users\\)([A-Za-z0-9._-]+)(?=\\)/g;
const homeName = (m) => m[2] ?? m[4] ?? m[6] ?? m[8];
const homePrefix = (m) => m[1] ?? m[3] ?? m[5] ?? m[7];

export const GENERIC = [
  { kind: "home-path", re: HOME, keep: (m) => SAFE_USERS.has(homeName(m)), sub: (m) => homePrefix(m) + "[user]" },
  { kind: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, keep: (m) => SAFE_EMAILS.test(m[0]), sub: () => "[email]" },
  { kind: "token", re: /\b(?:sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{32,}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|xox[a-z]-[A-Za-z0-9-]{20,})/g, sub: () => "[token]" },
  // The scrub works line by line, so it flags the BEGIN line; redaction removes the whole block.
  { kind: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
    redactRe: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, sub: () => "[private-key]" },
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
  for (const p of GENERIC) out = out.replace(p.redactRe || p.re, (...args) => {
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
