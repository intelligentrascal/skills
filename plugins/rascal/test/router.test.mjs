import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN } from "./manifest.test.mjs";

const read = (...p) => readFileSync(join(PLUGIN, ...p), "utf8");
const list = JSON.parse(read("workflows.json"));

test("workflows.json lists the five workflows and the canonical skills, all present", () => {
  assert.deepEqual(list.workflows, ["rascal-plan", "rascal-feature", "rascal-ui", "rascal-scheduled-runbook", "rascal-orchestrate"]);
  for (const s of list.workflows) assert.ok(existsSync(join(PLUGIN, "skills", s, "SKILL.md")), s);
  assert.deepEqual(Object.keys(list.canonical), ["TDD", "debugging", "review", "planning", "grilling"]);
  for (const s of Object.values(list.canonical)) assert.ok(existsSync(join(PLUGIN, "skills", s, "SKILL.md")), s);
});

test("rascal-go: model-invocable router that announces a route, then runs it", () => {
  const t = read("skills/rascal-go/SKILL.md");
  assert.match(t, /^---\nname: rascal-go\n/);
  assert.doesNotMatch(t, /disable-model-invocation/);
  for (const s of ["Route: <just do it", "~/.rascal/preferences.md", "~/.rascal/state.json", "lastRetro", "14 or more days",
    "rascal-debugging` → `rascal-tdd", "Never substitute another pack's skill", "<!-- routing-note -->"]) assert.ok(t.includes(s), s);
  assert.ok(existsSync(join(PLUGIN, "skills/rascal-go/agents/openai.yaml")));
});

test("/rascal:go is a plugin command that loads rascal-go with the task", () => {
  const t = read("commands/go.md");
  assert.match(t, /^---\ndescription: .+\nargument-hint: <task>\n---/);
  assert.ok(t.includes("`rascal:rascal-go`"));
  assert.ok(t.includes("$ARGUMENTS"));
});

test("the committed routing note is at most 30 lines", () => {
  assert.ok(read("routing-note.md").trimEnd().split("\n").length <= 30);
});
