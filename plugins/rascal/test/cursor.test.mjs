import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCursor } from "../skills/rascal-retro/lib/cursor.mjs";

const F = join(dirname(fileURLToPath(import.meta.url)), "fixtures/cursor/Users-alice-code-app/agent-transcripts/u1/u1.jsonl");

test("Cursor transcript → record", () => {
  const r = parseCursor(F, {});
  assert.equal(r.source, "cursor");
  assert.equal(r.id, "u1");
  assert.equal(r.cwd, "/Users/[user]/code/app");
  assert.deepEqual(r.turns.map((t) => t.text), ["fix syntax error"]);
  assert.deepEqual(r.skills.map((s) => [s.name, s.via]), [["unslop", "read"]]);
  assert.deepEqual(r.tools, { Read: 1 });
  assert.equal(r.assistantTurns, 1);
  assert.equal(r.start, new Date(statSync(F).mtimeMs).toISOString());
});
