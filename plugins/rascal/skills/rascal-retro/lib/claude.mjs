// Claude Code CLI (~/.claude/projects/*/*.jsonl) and Claude desktop (local-agent-mode-sessions) transcripts.
import fs from "node:fs";
import { newRecord, stamp, addTurn, addSkill, addTool, finish, slashCommand } from "./record.mjs";

export function parseClaude(file, { source, deny = [] }) {
  let r = null;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type !== "user" && o.type !== "assistant") continue;
    r ??= newRecord(source, o.sessionId || o.session_id || "");
    if (!r.cwd && o.cwd) r.cwd = o.cwd;
    const at = o.timestamp || "";
    stamp(r, at);
    const c = o.message?.content;
    if (o.type === "assistant") {
      r.assistantTurns++;
      for (const b of Array.isArray(c) ? c : []) if (b.type === "tool_use") {
        addTool(r, b.name);
        if (b.name === "Skill") addSkill(r, at, b.input?.skill, "tool");
      }
      continue;
    }
    if (o.isMeta || o.isSidechain) continue;
    const text = typeof c === "string" ? c : (Array.isArray(c) ? c.filter((b) => b.type === "text").map((b) => b.text).join("\n") : "");
    const cmd = slashCommand(text);
    if (cmd) { addSkill(r, at, cmd.name, "command"); addTurn(r, at, cmd.args, deny); }
    else addTurn(r, at, text, deny);
  }
  return r && finish(r, deny);
}
