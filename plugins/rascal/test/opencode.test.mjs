import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { parseOpencode } from "../skills/rascal-retro/lib/opencode.mjs";

function db() {
  const f = join(mkdtempSync(join(tmpdir(), "oc-")), "opencode.db");
  const d = new DatabaseSync(f);
  d.exec(`create table session (id text, parent_id text, directory text, time_created int, time_updated int);
          create table message (id text, session_id text, time_created int, data text);
          create table part (id text, message_id text, session_id text, time_created int, data text);`);
  d.prepare("insert into session values (?,?,?,?,?)").run("o1", null, "/Users/alice/x", 1790350998000, 1790351001000);
  d.prepare("insert into session values (?,?,?,?,?)").run("o2", "o1", "/x", 1, 2);
  d.prepare("insert into message values (?,?,?,?)").run("m1", "o1", 1790350998759, JSON.stringify({ role: "user" }));
  d.prepare("insert into message values (?,?,?,?)").run("m2", "o1", 1790350999000, JSON.stringify({ role: "assistant" }));
  d.prepare("insert into part values (?,?,?,?,?)").run("p1", "m1", "o1", 1790350998760, JSON.stringify({ type: "text", text: "grill me on search" }));
  d.prepare("insert into part values (?,?,?,?,?)").run("p2", "m2", "o1", 1790350999100, JSON.stringify({ type: "tool", tool: "skill", state: { input: { name: "grill-me-ui" } } }));
  d.prepare("insert into part values (?,?,?,?,?)").run("p3", "m2", "o1", 1790350999200, JSON.stringify({ type: "text", text: "Q1" }));
  d.close();
  return f;
}

test("OpenCode DB → one record per top-level session", () => {
  const out = parseOpencode(db(), {});
  assert.equal(out.length, 1);
  const { id, fingerprint, record: r } = out[0];
  assert.equal(id, "o1");
  assert.equal(fingerprint, "1790351001000");
  assert.equal(r.cwd, "/Users/[user]/x");
  assert.deepEqual(r.turns.map((t) => t.text), ["grill me on search"]);
  assert.deepEqual(r.skills.map((s) => [s.name, s.via]), [["grill-me-ui", "tool"]]);
  assert.deepEqual(r.tools, { skill: 1 });
  assert.equal(r.assistantTurns, 1);
  assert.equal(r.start, new Date(1790350998000).toISOString());
});
