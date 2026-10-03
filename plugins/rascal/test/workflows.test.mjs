import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN } from "./manifest.test.mjs";

const SKILLS = join(PLUGIN, "skills");
const read = (d, f = "SKILL.md") => readFileSync(join(SKILLS, d, f), "utf8");
const has = (d) => existsSync(join(SKILLS, d, "SKILL.md"));

// workflow → rule blocks it must carry
export const WORKFLOWS = {
  "rascal-plan": ["questions", "recommend", "handoff"],
  "rascal-feature": ["autonomy", "recommend", "handoff"],
  "rascal-ui": ["three-variants", "autonomy", "recommend", "handoff"],
  "rascal-scheduled-runbook": ["sources", "recommend", "handoff"],
  "rascal-orchestrate": ["questions", "three-variants", "autonomy", "recommend", "handoff"],
};
const present = () => Object.keys(WORKFLOWS).filter(has);

test("at least one workflow exists", () => assert.ok(present().length > 0));

test("each workflow carries its rule blocks, expanded", () => {
  for (const w of present()) {
    const t = read(w);
    for (const r of WORKFLOWS[w]) {
      const rule = readFileSync(join(PLUGIN, "rules", `${r}.md`), "utf8").trim();
      assert.ok(t.includes(`<!-- rule:${r} -->\n${rule}\n<!-- /rule:${r} -->`), `${w}: rule ${r}`);
    }
  }
});

test("every rascal skill a workflow names exists", () => {
  const all = new Set(readdirSync(SKILLS));
  for (const w of present()) {
    for (const [, s] of read(w).matchAll(/"(rascal-[a-z-]+)"|`rascal:(rascal-[a-z-]+)`/g).map((m) => [null, m[1] || m[2]])) {
      assert.ok(all.has(s), `${w} names ${s}`);
    }
  }
});

test("workflows are model-invocable and ship openai.yaml", () => {
  for (const w of present()) {
    assert.doesNotMatch(read(w), /disable-model-invocation/, w);
    assert.ok(existsSync(join(SKILLS, w, "agents", "openai.yaml")), w);
  }
});

test("rascal-plan: fog → wayfinder, grill with docs, write it down", () => {
  if (!has("rascal-plan")) return;
  const t = read("rascal-plan");
  for (const s of ['"rascal-wayfinder"', '"rascal-grilling"', '"rascal-domain-modeling"', '"rascal-grill-docs-ui"', "docs/<slug>-design.md"]) assert.ok(t.includes(s), s);
});

test("rascal-feature: plan → planning → review, resumable at execute, ships", () => {
  if (!has("rascal-feature")) return;
  const t = read("rascal-feature");
  const i = (s) => t.indexOf(s);
  assert.ok(i('"rascal-plan"') > 0 && i('"rascal-plan"') < i('"rascal-planning"') && i('"rascal-planning"') < i('"rascal-review"'));
  for (const s of ["execute <plan path>", "gh pr create", "git worktree remove", "README"]) assert.ok(t.includes(s), s);
});

test("rascal-ui: steps in order, parity gate, walkthrough with Playwright fallback", () => {
  if (!has("rascal-ui")) return;
  const t = read("rascal-ui");
  const order = ['"rascal-prototype"', "## 2. Review in parallel", "## 3. Design language", "## 4. Feedback loop", "## 5. Parity gate", "## 6. Persona walkthrough", "## 7. Ship"];
  for (let k = 1; k < order.length; k++) assert.ok(t.indexOf(order[k - 1]) < t.indexOf(order[k]) && t.indexOf(order[k - 1]) >= 0, order[k]);
  const w = read("rascal-ui", "persona-walkthrough.md");
  for (const s of ["npm install --prefix .rascal/walkthrough playwright", "never", "screenshot"]) assert.ok(w.includes(s), s);
});

test("rascal-scheduled-runbook: ten guardrail sections in order, siblings, test run", () => {
  if (!has("rascal-scheduled-runbook")) return;
  const t = read("rascal-scheduled-runbook");
  const order = ["**Purpose and output.**", "**Preconditions.**", "**Trust boundary.**", "**Watermark.**", "**Cheap exit.**", "**Work.**",
    "**Dry run, then commit.**", "**Record before render.**", "**Render and verify.**", "**Report-only fallback.**", "## 3. Siblings", "## 4. Test"];
  for (let k = 1; k < order.length; k++) assert.ok(t.indexOf(order[k - 1]) >= 0 && t.indexOf(order[k - 1]) < t.indexOf(order[k]), order[k]);
});
