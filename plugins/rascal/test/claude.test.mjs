import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseClaude } from "../skills/rascal-retro/lib/claude.mjs";
import { MAX_TURN, newRecord, addTurn } from "../skills/rascal-retro/lib/record.mjs";

const FX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

test("CLI transcript → record", () => {
  const r = parseClaude(join(FX, "claude-cli.jsonl"), { source: "claude-cli" });
  assert.equal(r.v, 1);
  assert.equal(r.id, "s1");
  assert.equal(r.cwd, "/Users/[user]/code/app");
  assert.equal(r.start, "2026-09-10T10:00:00Z");
  assert.equal(r.end, "2026-09-10T10:02:30Z");
  assert.deepEqual(r.turns.map((t) => t.text), ["design the export flow", "no, don't add a modal; email me at [email]"]);
  assert.deepEqual(r.skills.map((s) => [s.name, s.via]), [["mattpocock-skills:grilling", "command"], ["mattpocock-skills:domain-modeling", "tool"]]);
  assert.deepEqual(r.tools, { Skill: 1, Bash: 1 });
  assert.equal(r.assistantTurns, 2);
});

test("desktop audit transcript → record via session_id", () => {
  const r = parseClaude(join(FX, "claude-desktop.jsonl"), { source: "claude-desktop" });
  assert.equal(r.id, "d1");
  assert.deepEqual(r.turns.map((t) => t.text), ["summarise my inbox"]);
  assert.deepEqual(r.skills.map((s) => s.name), ["anthropic-skills:morning"]);
});

test("deny-list redacts and long turns clip", () => {
  const r = parseClaude(join(FX, "claude-cli.jsonl"), { source: "claude-cli", deny: ["export"] });
  assert.equal(r.turns[0].text, "design the [redacted] flow");
  const long = newRecord("claude-cli", "x");
  addTurn(long, "", "y".repeat(MAX_TURN + 1000), []);
  assert.equal(long.turns[0].text.length, MAX_TURN);
  assert.equal(MAX_TURN, 4000);
});
