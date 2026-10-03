import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCodex } from "../skills/rascal-retro/lib/codex.mjs";

const FX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

test("Codex rollout → record", () => {
  const r = parseCodex(join(FX, "codex.jsonl"), {});
  assert.equal(r.source, "codex");
  assert.equal(r.id, "c1");
  assert.equal(r.cwd, "/Users/[user]/Documents/Codex/x");
  assert.deepEqual(r.turns.map((t) => t.text), ["grill me on the billing redesign"]);
  assert.deepEqual(r.skills.map((s) => [s.name, s.via]), [["grilling", "read"]]);
  assert.deepEqual(r.tools, { shell: 1, apply_patch: 1 });
  assert.equal(r.assistantTurns, 1);
  assert.equal(r.start, "2026-10-02T13:49:59Z");
});

test("a subagent rollout (shares the parent's session_id) has no turns", () => {
  const r = parseCodex(join(FX, "codex-subagent.jsonl"), {});
  assert.equal(r.id, "c1-guardian");
  assert.deepEqual(r.turns, []);
});
