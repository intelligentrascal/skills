// Unit tests for lib/state.mjs: applyPatch + validateState (pure). Ported from
// jasonku09/grill-with-ui test/server.test.mjs:291-572 (daafa1e) as direct calls; the CLI-level
// patch tests (stdin, --file, exit codes, one stderr line) are ported with the patch CLI (T10).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PatchError, applyPatch, validateState } from "../lib/state.mjs";

const T0 = "2026-09-01T10:00:00.000Z";
const NOW = "2026-01-01T00:00:00.000Z";
const qn = (id, round, extra = {}) => ({
  id, round, deps: [], title: `Title ${id}`, body: `Body ${id}`,
  options: [{ k: "A", text: "Alpha" }, { k: "B", text: "Beta" }], rec: { option: "A", why: "Alpha is simpler." },
  status: "open", durable: false, updated: false, thread: [], ...extra,
});
const base = (fields = {}) => ({
  topic: "Patch topic", doc: "", project: "/tmp/proj", created: T0,
  agent: { status: "waiting", since: T0, handled: 0 }, terms: [], questions: [], ...fields,
});
// The CLI contract: merge, then validate; a rejection leaves the input untouched.
const applied = (state, p, now = NOW) => { const next = applyPatch(state, p, now); validateState(next); return next; };
function rejected(state, p, pattern) {
  const before = JSON.stringify(state);
  assert.throws(() => applied(state, typeof p === "string" ? JSON.parse(p) : p), (e) => {
    assert.ok(e instanceof PatchError, `expected a PatchError, got ${e && e.name}: ${e && e.message}`);
    if (pattern) assert.match(e.message, pattern);
    return true;
  }, `expected a rejection for ${typeof p === "string" ? p : JSON.stringify(p)}`);
  assert.equal(JSON.stringify(state), before, "input state untouched");
}

test("patch: agent and visual merge one level; other top-level keys are replaced whole", () => {
  let st = base({
    note: "old note", doc: "docs/a-design.md",
    agent: { status: "working", since: T0, handled: 3 },
    questions: [qn("q1", 1), qn("q2", 1, { status: "answered", answer: { kind: "accept" } })],
    visual: { kind: "prototype", version: 2, at: T0, note: "v2: first", stale: true, drawing: { since: T0, seq: 3 }, thread: [{ who: "user", text: "bigger", at: T0 }] },
  });
  st = applied(st, {
    agent: { handled: 4 },
    visual: { stale: false, note: "v3: bigger", drawing: { since: "2026-09-01T11:00:00.000Z", seq: 4 } },
    note: "new note", doc: "docs/b-design.md", finished: { doc: "docs/b-design.md", visual: "docs/b-visual.html", at: T0 },
  });
  assert.deepEqual(st.agent, { status: "working", since: T0, handled: 4 });
  assert.deepEqual(st.visual, { kind: "prototype", version: 2, at: T0, note: "v3: bigger", stale: false, drawing: { since: "2026-09-01T11:00:00.000Z", seq: 4 }, thread: [{ who: "user", text: "bigger", at: T0 }] });
  assert.equal(st.note, "new note");
  assert.equal(st.doc, "docs/b-design.md");
  assert.equal(st.topic, "Patch topic", "untouched keys stay");
  assert.equal(st.questions.length, 2);
  st = applied(st, { finished: { doc: "docs/c-design.md", at: T0 } });
  assert.deepEqual(st.finished, { doc: "docs/c-design.md", at: T0 }, "finished is replaced whole, not merged");
});

test("patch: questions merge one level by id; each given field replaces that field whole", () => {
  const explore = { at: T0, rows: [{ option: "A", pros: ["p"], cons: ["c"] }] };
  const before = base({
    questions: [
      qn("q1", 1, { updated: true, explore, thread: [{ who: "user", text: "hm", at: T0 }, { who: "agent", text: "ok", at: T0 }] }),
      qn("q2", 1),
    ],
  });
  const st = applied(before, { questions: [{ id: "q1", status: "answered", answer: { kind: "option", option: "B" }, rec: { option: "B" }, updated: false, options: [{ k: "A", text: "Alpha" }, { k: "B", text: "Beta" }, { k: "C", text: "Gamma" }] }] });
  assert.deepEqual(st.questions.map((q) => q.id), ["q1", "q2"], "order kept, nothing appended");
  const q1 = st.questions[0];
  assert.deepEqual(q1.rec, { option: "B" }, "rec replaced whole, not deep-merged");
  assert.deepEqual(q1.answer, { kind: "option", option: "B" });
  assert.equal(q1.status, "answered");
  assert.equal(q1.updated, false);
  assert.equal(q1.options.length, 3);
  assert.equal(q1.title, "Title q1");
  assert.equal(q1.body, "Body q1");
  assert.deepEqual(q1.explore, explore);
  assert.deepEqual(q1.thread, before.questions[0].thread, "thread untouched when the patch has none");
  assert.deepEqual(st.questions[1], before.questions[1], "other questions untouched");
});

test("patch: a new id with a title is appended with defaults; an unknown id without a title is rejected", () => {
  const st = applied(base({ questions: [qn("q1", 1)] }), { questions: [
    { id: "q2", round: 2, deps: ["q1"], title: "Second", body: "B2", options: [{ k: "A", text: "Yes" }], rec: { option: "A", why: "w" }, durable: true },
    { id: "q3", round: 2, title: "Free text", body: "B3", rec: { text: "Something", why: "w" } },
  ] });
  assert.deepEqual(st.questions.map((q) => q.id), ["q1", "q2", "q3"]);
  assert.deepEqual(st.questions[1], { id: "q2", round: 2, deps: ["q1"], title: "Second", body: "B2", options: [{ k: "A", text: "Yes" }], rec: { option: "A", why: "w" }, durable: true, status: "open", thread: [], updated: false });
  assert.deepEqual(st.questions[2], { id: "q3", round: 2, title: "Free text", body: "B3", rec: { text: "Something", why: "w" }, status: "open", deps: [], options: [], thread: [], durable: false, updated: false });

  rejected(st, { agent: { handled: 1 }, questions: [{ id: "Q1", status: "answered", answer: { kind: "accept" } }] }, /Q1/);
  rejected(st, { questions: [{ id: "q9", round: 3, title: "No rec" }] }, /q9.*rec/);
  rejected(st, { questions: [{ id: "q9", title: "No round", rec: { option: "A" } }] }, /q9.*round/);
  rejected(st, { questions: [{ status: "open" }] }, /id/);
});

test("patch: thread and visual.queued append; appended messages without at get the current time", () => {
  const m = (who, text, at = T0) => ({ who, text, at });
  const st0 = base({
    questions: [qn("q1", 1, { thread: [m("user", "first")] })],
    visual: { kind: "diagram", version: 1, at: T0, thread: [m("agent", "v1 drawn")], drawing: { since: T0, seq: 1 }, queued: ["feedback: bigger"] },
  });
  const st = applied(st0, {
    questions: [{ id: "q1", thread: [m("user", "why?", "2026-09-01T10:05:00.000Z"), { who: "agent", text: "because" }] },
      { id: "q2", round: 2, title: "New", rec: { text: "t", why: "w" }, thread: [{ who: "agent", text: "context" }] }],
    visual: { thread: [{ who: "user", text: "smaller" }], queued: ["feedback: smaller"] },
  });
  const th = st.questions[0].thread;
  assert.deepEqual(th, [m("user", "first"), m("user", "why?", "2026-09-01T10:05:00.000Z"), m("agent", "because", NOW)], "existing kept, given at kept, missing at stamped");
  assert.equal(st.questions[1].thread[0].at, NOW);
  assert.deepEqual(st.visual.thread, [m("agent", "v1 drawn"), m("user", "smaller", NOW)]);
  assert.deepEqual(st.visual.queued, ["feedback: bigger", "feedback: smaller"]);
  assert.deepEqual(st.visual.drawing, { since: T0, seq: 1 }, "the rest of visual is kept");
  rejected(st, { questions: [{ id: "q1", thread: { who: "user", text: "not a list" } }] }, /thread/);
  rejected(st, { visual: { queued: "not a list" } }, /queued/);
});

test("patch: the hub stamps the times the agent leaves out; an explicit time in the patch always wins", () => {
  const rows = [{ option: "A", pros: ["p"], cons: ["c"] }];
  let st = base({
    agent: { status: "working", since: T0, handled: 2 },
    questions: [qn("q1", 1), qn("q2", 1)],
    visual: { kind: "prototype", version: 1, at: T0, note: "v1", stale: false, thread: [], drawing: { since: T0, seq: 2 } },
  });
  st = applied(st, {
    agent: { status: "waiting", handled: 3 },
    questions: [
      { id: "q1", explore: { rows } },
      { id: "q3", round: 2, title: "New", rec: { text: "t", why: "w" }, explore: { rows } },
    ],
    visual: { version: 2, note: "v2: bigger", drawing: { seq: 3 } },
    finished: { doc: "docs/x-design.md" },
  });
  assert.equal(st.agent.since, NOW, "agent.since");
  assert.equal(st.agent.status, "waiting");
  assert.equal(st.agent.handled, 3);
  assert.equal(st.questions[0].explore.at, NOW, "q1.explore.at");
  assert.deepEqual(st.questions[0].explore.rows, rows);
  assert.equal(st.questions[2].explore.at, NOW, "q3.explore.at (new question)");
  assert.equal(st.visual.at, NOW, "visual.at on a version bump");
  assert.equal(st.visual.version, 2);
  assert.equal(st.visual.drawing.since, NOW, "visual.drawing.since");
  assert.equal(st.visual.drawing.seq, 3);
  assert.equal(st.finished.at, NOW, "finished.at");
  assert.equal(st.finished.doc, "docs/x-design.md");

  const at = (m) => `2026-09-01T12:0${m}:00.000Z`;
  st = applied(st, {
    agent: { status: "working", since: at(1) },
    questions: [{ id: "q2", explore: { at: at(2), rows } }],
    visual: { version: 3, at: at(3), drawing: { since: at(4), seq: 4 } },
    finished: { doc: "docs/x-design.md", visual: "docs/x-visual.html", at: at(5) },
  });
  assert.equal(st.agent.since, at(1));
  assert.equal(st.questions[1].explore.at, at(2));
  assert.equal(st.visual.at, at(3));
  assert.equal(st.visual.drawing.since, at(4));
  assert.equal(st.finished.at, at(5));

  const before = st;
  st = applied(st, { agent: { handled: 5 }, visual: { version: 3, stale: true }, questions: [{ id: "q2", status: "deferred" }] }, "2030-01-01T00:00:00.000Z");
  assert.equal(st.agent.since, before.agent.since, "agent.since kept when the patch gives no status");
  assert.equal(st.visual.at, before.visual.at, "visual.at kept when the version does not change");
  assert.deepEqual(st.visual.drawing, before.visual.drawing, "drawing untouched");
  assert.deepEqual(st.questions[1].explore, before.questions[1].explore, "explore untouched");
  assert.deepEqual(st.finished, before.finished, "finished untouched");

  st = applied(st, { finished: { doc: "docs/x-design.md", visual: "docs/x-visual.html" } }, "2031-01-01T00:00:00.000Z");
  assert.equal(st.finished.at, "2031-01-01T00:00:00.000Z", "finished.at when finished is re-given");
});

test("patch: null deletes a key at any level", () => {
  let st = base({
    note: "every branch settled",
    questions: [qn("q1", 1, { status: "answered", answer: { kind: "accept" } }), qn("q2", 1)],
    visual: { kind: "prototype", version: 3, at: T0, note: "v3", stale: false, drawing: { since: T0, seq: 5 }, queued: ["a"], thread: [] },
  });
  st = applied(st, { note: null, questions: [{ id: "q1", status: "reopened", answer: null }], visual: { drawing: null, queued: null } });
  assert.ok(!("note" in st));
  assert.ok(!("answer" in st.questions[0]));
  assert.equal(st.questions[0].status, "reopened");
  assert.deepEqual(st.visual, { kind: "prototype", version: 3, at: T0, note: "v3", stale: false, thread: [] });
  st = applied(st, { visual: null, note: "The draw failed; click Visualize to try again." });
  assert.ok(!("visual" in st));
  assert.equal(st.note, "The draw failed; click Visualize to try again.");
});

test("patch: terms are keyed by term; a known term is replaced whole, a new one appended", () => {
  const st = applied(base({ terms: [{ term: "round", def: "One turn of questions.", avoid: ["batch"] }, { term: "send", def: "One press.", avoid: [] }] }),
    { terms: [{ term: "round", def: "The frontier of one turn." }, { term: "frontier", def: "Askable now.", avoid: ["queue"] }] });
  assert.deepEqual(st.terms, [
    { term: "round", def: "The frontier of one turn." },
    { term: "send", def: "One press.", avoid: [] },
    { term: "frontier", def: "Askable now.", avoid: ["queue"] },
  ]);
  rejected(st, { terms: [{ def: "no term" }] }, /term/);
});

test("patch: a failed validation or a bad shape is rejected with a PatchError and leaves the input untouched", () => {
  const st = base({ questions: [qn("q1", 1)] });
  rejected(st, [1, 2], /object/);
  rejected(st, '"just a string"', /object/);
  rejected(st, null, /object/);
  rejected(st, { agent: { status: "sleeping" } }, /agent\.status/);
  rejected(st, { agent: { handled: -1 } }, /agent\.handled/);
  rejected(st, { agent: "waiting" }, /agent/);
  rejected(st, { questions: null }, /questions/);
  rejected(st, { questions: { id: "q1" } }, /questions/);
  rejected(st, { questions: [{ id: "q1", status: "done" }] }, /q1.*status/);
  rejected(st, { questions: [{ id: "q1", answer: { kind: "maybe" } }] }, /q1.*answer/);
  rejected(st, { questions: [{ id: "q1", thread: [{ who: "bot", text: "hi" }] }] }, /q1.*thread/);
  rejected(st, { visual: { kind: "painting" } }, /visual\.kind/);
  rejected(st, { visual: { stale: true } }, /visual needs kind and version/);
  rejected(st, { terms: "round" }, /terms/);
  rejected(st, '{"questions":null,"__proto__":{"questions":[]}}', /__proto__.*the patch/);
  rejected(st, '{"agent":{"status":null,"__proto__":{"status":"waiting"}}}', /__proto__.*agent/);
  rejected(st, '{"questions":[{"id":"q1","status":null,"__proto__":{"status":"open"}}]}', /__proto__.*q1/);
  rejected(st, '{"questions":[{"id":"q9","round":2,"title":"t","rec":{"why":"w"},"__proto__":{"status":"answered"}}]}', /__proto__.*q9/);
});

test("patch: an error the merge never expected is not a PatchError (the CLI reports it as one line)", () => {
  const deep = JSON.parse(`{"extra":${"[".repeat(20000)}${"]".repeat(20000)}}`);
  assert.throws(() => applyPatch(base({ questions: [qn("q1", 1)] }), deep, NOW), (e) => !(e instanceof PatchError));
});

test("patch: every field the page renders must have the shape the render reads, or the patch is rejected", () => {
  const T = base({
    terms: [{ term: "round", def: "One turn of questions.", avoid: ["batch"] }],
    questions: [qn("q1", 1, { explore: { at: T0, rows: [{ option: "A", pros: ["p"], cons: ["c"] }] } })],
    visual: { kind: "prototype", version: 1, at: T0, note: "v1", stale: false, thread: [] },
  });
  rejected(T, { terms: [{ term: "round", def: "d", avoid: "batch" }] }, /round.*avoid/);
  rejected(T, { terms: [{ term: "round", def: "d", avoid: [["batch"]] }] }, /round.*avoid/);
  rejected(T, { terms: [{ term: "round", def: ["d"] }] }, /round.*def/);
  const ex = (rows, at) => ({ questions: [{ id: "q1", explore: { ...(at === undefined ? {} : { at }), rows } }] });
  rejected(T, ex([null]), /q1\.explore\.rows\[0\]/);
  rejected(T, ex(["A"]), /q1\.explore\.rows\[0\]/);
  rejected(T, ex([{ option: "A", pros: "fast", cons: ["c"] }]), /q1\.explore\.rows\[0\]\.pros/);
  rejected(T, ex([{ option: "A", pros: ["p"], cons: [{ text: "c" }] }]), /q1\.explore\.rows\[0\]\.cons/);
  rejected(T, ex([{ option: 1, pros: ["p"], cons: ["c"] }]), /q1\.explore\.rows\[0\]\.option/);
  rejected(T, ex([], 12), /q1\.explore\.at/);
  const boom = { toString: "x" };
  rejected(T, { questions: [{ id: "q1", options: [{ k: "A", text: boom }] }] }, /q1\.options/);
  rejected(T, { questions: [{ id: "q1", rec: { option: "A", why: boom } }] }, /q1\.rec\.why/);
  rejected(T, { questions: [{ id: "q1", rec: { option: ["A"], why: "w" } }] }, /q1\.rec\.option/);
  rejected(T, { questions: [{ id: "q1", rec: { text: 5, why: "w" } }] }, /q1\.rec\.text/);
  rejected(T, { questions: [{ id: "q1", status: "answered", answer: { kind: "option", option: 2 } }] }, /q1\.answer\.option/);
  rejected(T, { questions: [{ id: "q1", status: "answered", answer: { kind: "text", text: boom } }] }, /q1\.answer\.text/);
  rejected(T, { visual: { note: boom } }, /visual\.note/);
  rejected(T, { visual: { version: 2, at: 5 } }, /visual\.at/);
  rejected(T, { visual: { drawing: { since: boom, seq: 2 } } }, /visual\.drawing/);
  rejected(T, { finished: { doc: boom } }, /finished\.doc/);
  rejected(T, { finished: { doc: "docs/x.md", visual: 1 } }, /finished\.visual/);
  rejected(T, { finished: { doc: "docs/x.md", at: boom } }, /finished\.at/);

  assert.doesNotThrow(() => applied(T, {
    terms: [{ term: "round", def: "d", avoid: [] }, { term: "send", def: "One press." }],
    questions: [
      { id: "q1", status: "answered", answer: { kind: "text", text: "Neither, a third way" }, rec: { text: "t", why: "w" },
        explore: { rows: [{ option: "A", pros: ["p"], cons: [] }, { option: "B", pros: [], cons: ["c"] }] } },
      { id: "q2", round: 2, title: "No options", body: "b", rec: { why: "only a why" } },
    ],
    visual: { version: 2, note: "v2: bigger", drawing: { seq: 3 } },
    finished: { doc: "docs/x-design.md", visual: "docs/x-visual.html" },
  }));
});

// ---- new fields (spec §4, D3) ----
test("phase, finished.kind and map validate", () => {
  const s = base();
  assert.doesNotThrow(() => validateState({ ...s, phase: "frontier", finished: { kind: "map", at: "x" } }));
  assert.doesNotThrow(() => validateState({ ...s, phase: "ticket", mapKey: "proj-1a2b3c4d/42", id: "20260925-101010-abcd", projectKey: "proj-1a2b3c4d", cwd: "/x", branch: "main", finished: { kind: "no-map" } }));
  assert.throws(() => validateState({ ...s, phase: "later" }), /phase must be one of destination\|frontier\|ticket/);
  assert.throws(() => validateState({ ...s, finished: { kind: "pdf" } }), /finished.kind must be one of doc\|map\|no-map/);
  for (const k of ["mapKey", "id", "projectKey", "cwd", "branch"]) assert.throws(() => validateState({ ...s, [k]: 5 }), new RegExp(`${k} must be a string`));
});
test("patch may not write owner or token", () => {
  assert.throws(() => applyPatch(base(), { owner: { agentId: "x" } }, NOW), /written by the hub/);
  assert.throws(() => applyPatch(base(), { token: "t" }, NOW), /written by the hub/);
  assert.throws(() => applyPatch(base(), { owner: null }, NOW), /written by the hub/);
});
test("applyPatch does not mutate its input", () => {
  const s = base({ questions: [qn("q1", 1)] });
  const before = JSON.stringify(s);
  applyPatch(s, { questions: [{ id: "q1", thread: [{ who: "user", text: "x" }] }], agent: { handled: 1 } }, NOW);
  assert.equal(JSON.stringify(s), before);
});
