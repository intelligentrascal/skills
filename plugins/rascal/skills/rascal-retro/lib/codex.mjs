// Codex rollouts (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl).
import fs from "node:fs";
import { newRecord, stamp, addTurn, addSkill, addTool, finish } from "./record.mjs";

const SKILL_READ = /\/([A-Za-z0-9._-]+)\/SKILL\.md/g;

export function parseCodex(file, { deny = [] }) {
  const r = newRecord("codex", "");
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const p = o.payload || {}, at = o.timestamp || "";
    stamp(r, at);
    if (o.type === "session_meta") { r.id = p.session_id || p.id || r.id; r.cwd = p.cwd || r.cwd; continue; }
    if (o.type !== "response_item") continue;
    if (p.type === "message" && p.role === "user") for (const c of p.content || []) { if (c.type === "input_text") addTurn(r, at, c.text, deny); }
    else if (p.type === "message" && p.role === "assistant") r.assistantTurns++;
    else if (p.type === "function_call" || p.type === "custom_tool_call") {
      addTool(r, p.name);
      for (const m of String(p.arguments ?? p.input ?? "").matchAll(SKILL_READ)) addSkill(r, at, m[1], "read");
    }
  }
  return r.id ? finish(r, deny) : null;
}
