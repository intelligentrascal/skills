// OpenCode (~/.local/share/opencode/opencode.db, SQLite). Read-only.
import { createRequire } from "node:module";
import { newRecord, stamp, addTurn, addSkill, addTool, finish } from "./record.mjs";

// Loaded lazily so node:sqlite (and its ExperimentalWarning) is only touched when a DB exists.
const sqlite = () => createRequire(import.meta.url)("node:sqlite");

const iso = (ms) => (ms ? new Date(Number(ms)).toISOString() : "");
const json = (s) => { try { return JSON.parse(s); } catch { return {}; } };

export function parseOpencode(file, { deny = [] }) {
  const { DatabaseSync } = sqlite();
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const out = [];
    for (const s of db.prepare("select id, directory, time_created, time_updated from session where parent_id is null").all()) {
      const r = newRecord("opencode", s.id);
      r.cwd = s.directory || "";
      stamp(r, iso(s.time_created)); stamp(r, iso(s.time_updated));
      const roles = new Map(db.prepare("select id, data from message where session_id = ?").all(s.id).map((m) => [m.id, json(m.data).role]));
      r.assistantTurns = [...roles.values()].filter((x) => x === "assistant").length;
      for (const p of db.prepare("select message_id, time_created, data from part where session_id = ? order by time_created").all(s.id)) {
        const d = json(p.data), at = iso(p.time_created);
        if (d.type === "text" && roles.get(p.message_id) === "user") addTurn(r, at, d.text, deny);
        if (d.type === "tool") { addTool(r, d.tool); if (d.tool === "skill") addSkill(r, at, d.state?.input?.name, "tool"); }
      }
      out.push({ id: s.id, fingerprint: String(s.time_updated), record: finish(r, deny) });
    }
    return out;
  } finally { db.close(); }
}
