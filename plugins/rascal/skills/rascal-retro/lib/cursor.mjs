// Cursor agent transcripts (~/.cursor/projects/<project>/agent-transcripts/<id>/<id>.jsonl).
import fs from "node:fs";
import path from "node:path";
import { newRecord, stamp, addTurn, addSkill, addTool, finish } from "./record.mjs";

const SKILL_READ = /\/([A-Za-z0-9._-]+)\/SKILL\.md/g;
const projectCwd = (p) => (/^\d+$/.test(p) ? "" : "/" + p.replace(/-/g, "/"));

export function parseCursor(file, { deny = [] }) {
  const r = newRecord("cursor", path.basename(path.dirname(file)));
  r.cwd = projectCwd(path.basename(path.resolve(file, "../../..")));
  const at = new Date(fs.statSync(file).mtimeMs).toISOString();
  stamp(r, at);
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const blocks = o.message?.content || [];
    if (o.role === "user") {
      const t = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const q = /<user_query>([\s\S]*?)<\/user_query>/.exec(t);
      addTurn(r, at, q ? q[1] : t.replace(/<timestamp>[\s\S]*?<\/timestamp>/g, ""), deny);
    } else if (o.role === "assistant") {
      r.assistantTurns++;
      for (const b of blocks) if (b.type === "tool_use") {
        addTool(r, b.name);
        for (const m of JSON.stringify(b.input || {}).matchAll(SKILL_READ)) addSkill(r, at, m[1], "read");
      }
    }
  }
  return finish(r, deny);
}
