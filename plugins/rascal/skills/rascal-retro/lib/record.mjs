// The digest record (one per session) and the helpers every extractor shares (design doc Q16).
import { redact } from "./redact.mjs";

export const MAX_TURN = 4000;
export const INJECTED = /^\s*(<system-reminder>|<task-notification>|<local-command-|<user-prompt-submit-hook>|\[SYSTEM NOTIFICATION|<environment_context>|<recommended_plugins>|<permissions instructions>|# AGENTS\.md instructions|Caveat: The messages below)/;

export function newRecord(source, id) {
  return { v: 1, source, id, cwd: "", start: "", end: "", turns: [], skills: [], tools: {}, assistantTurns: 0 };
}
export function stamp(r, at) {
  if (!at) return;
  if (!r.start || at < r.start) r.start = at;
  if (!r.end || at > r.end) r.end = at;
}
export function addTurn(r, at, text, deny) {
  const t = String(text || "").trim();
  if (!t || INJECTED.test(t)) return;
  r.turns.push({ at, text: redact(t, deny).slice(0, MAX_TURN) });
}
export const addSkill = (r, at, name, via) => name && r.skills.push({ at, name: String(name).replace(/^\//, ""), via });
export const addTool = (r, name) => { if (name) r.tools[name] = (r.tools[name] || 0) + 1; };
export const finish = (r, deny) => { r.cwd = redact(r.cwd || "", deny); return r; };

// "<command-name>/x</command-name> … <command-args>y</command-args>" → { name, args } or null.
export function slashCommand(text) {
  const n = /<command-name>\/?([^<]+)<\/command-name>/.exec(text);
  if (!n) return null;
  return { name: n[1].trim(), args: (/<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1] || "").trim() };
}
