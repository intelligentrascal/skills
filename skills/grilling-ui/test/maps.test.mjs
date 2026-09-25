// Unit tests for lib/maps.mjs: applyMapPatch + validateMap (spec §4a map shape).
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMapPatch, validateMap } from "../lib/maps.mjs";
import { PatchError, validateState } from "../lib/state.mjs";

const NOW = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-02T00:00:00.000Z";
const tk = (title, extra = {}) => ({ title, type: "task", state: "frontier", ...extra });
const full = () => ({
  title: "Map", link: "https://github.com/o/r/issues/42", at: NOW, destination: "Ship it", notes: "n",
  decisions: [{ title: "D1", link: "docs/adr/1.md", gist: "g" }],
  tickets: [
    tk("A", { type: "research", link: "https://github.com/o/r/issues/43", assignee: "rahil" }),
    tk("B", { state: "blocked", blockedBy: ["A", "Old"] }),
    tk("C", { type: "prototype", state: "claimed", session: "http://127.0.0.1:4000/s/20260925-101010-abcd/", hubClaim: { agentId: "a1b2", at: NOW, seq: 3 } }),
    tk("D", { type: "grilling" }),
  ],
  closed: [{ title: "Old", gist: "done" }],
  fog: ["how fast?"], outOfScope: [{ gist: "mobile", link: "x" }],
  listener: { agentId: "a1b2", heartbeat: NOW }, handled: 3,
});
const rejects = (m, re) => assert.throws(() => validateMap(m), (e) => e instanceof PatchError && re.test(e.message));

test("a full map in the §4a shape validates", () => {
  assert.doesNotThrow(() => validateMap(full()));
  assert.doesNotThrow(() => validateMap({ title: "Only a title" }));
});

test("map: top-level fields have the right types", () => {
  rejects("x", /map must be an object/);
  rejects([], /map must be an object/);
  rejects({}, /map\.title must be a string/);
  for (const k of ["link", "at", "destination", "notes"]) rejects({ ...full(), [k]: 5 }, new RegExp(`map\\.${k} must be a string`));
  rejects({ ...full(), fog: "x" }, /map\.fog must be an array of strings/);
  rejects({ ...full(), fog: [1] }, /map\.fog must be an array of strings/);
  rejects({ ...full(), handled: -1 }, /map\.handled must be a whole number/);
  rejects({ ...full(), handled: 1.5 }, /map\.handled must be a whole number/);
  rejects({ ...full(), listener: { agentId: "x" } }, /map\.listener must be \{"agentId","heartbeat"\}/);
  rejects({ ...full(), listener: "x" }, /map\.listener/);
  rejects({ ...full(), outOfScope: [{ link: "x" }] }, /map\.outOfScope\[0\]\.gist must be a string/);
  rejects({ ...full(), outOfScope: [{ gist: "g", link: 1 }] }, /map\.outOfScope\[0\]\.link must be a string/);
  rejects({ ...full(), outOfScope: {} }, /map\.outOfScope must be an array/);
});

test("map: decisions and closed are arrays of {title, link?, gist?} strings", () => {
  for (const k of ["decisions", "closed"]) {
    rejects({ title: "M", [k]: {} }, new RegExp(`map\\.${k} must be an array`));
    rejects({ title: "M", [k]: [{ gist: "g" }] }, new RegExp(`map\\.${k}\\[0\\] needs a string title`));
    rejects({ title: "M", [k]: [{ title: "T", gist: 5 }] }, new RegExp(`${k} T\\.gist must be a string`));
    rejects({ title: "M", [k]: [{ title: "T", link: {} }] }, new RegExp(`${k} T\\.link must be a string`));
    rejects({ title: "M", [k]: [{ title: "T" }, { title: "T" }] }, new RegExp(`${k} "T" appears twice`));
  }
});

test("map: tickets need a unique title, a known type and state; errors name the ticket and field", () => {
  rejects({ title: "M", tickets: {} }, /map\.tickets must be an array/);
  rejects({ title: "M", tickets: [{ type: "task", state: "frontier" }] }, /map\.tickets\[0\] needs a string title/);
  rejects({ title: "M", tickets: [tk("A"), tk("A")] }, /ticket "A" appears twice/);
  rejects({ title: "M", tickets: [tk("A", { type: "bug" })] }, /ticket A\.type must be one of research\|prototype\|grilling\|task/);
  rejects({ title: "M", tickets: [tk("A", { type: undefined })] }, /ticket A\.type/);
  rejects({ title: "M", tickets: [tk("A", { state: "done" })] }, /ticket A\.state must be one of frontier\|blocked\|claimed/);
  rejects({ title: "M", tickets: [tk("A", { link: 1 })] }, /ticket A\.link must be a string/);
  rejects({ title: "M", tickets: [tk("A", { assignee: ["x"] })] }, /ticket A\.assignee must be a string/);
  rejects({ title: "M", tickets: [tk("A", { blockedBy: "B" })] }, /ticket A\.blockedBy must be an array of ticket titles/);
  rejects({ title: "M", tickets: [tk("A", { session: "javascript:alert(1)" })] }, /ticket A\.session must be an http\(s\) URL/);
  rejects({ title: "M", tickets: [tk("A", { hubClaim: { agentId: "x" } })] }, /ticket A\.hubClaim must be \{"agentId","at","seq"\?\}/);
  rejects({ title: "M", tickets: [tk("A", { hubClaim: { agentId: "x", at: NOW, seq: -2 } })] }, /ticket A\.hubClaim/);
});

test("blockedBy must name a ticket or a closed title", () => {
  assert.throws(() => validateMap({ title: "M", tickets: [{ title: "B", type: "task", state: "blocked", blockedBy: ["Nope"] }] }), /B\.blockedBy names unknown "Nope"/);
  assert.throws(() => validateMap({ title: "M", tickets: [tk("B", { blockedBy: ["B"] })] }), /B\.blockedBy names the ticket itself/);
  assert.doesNotThrow(() => validateMap({ title: "M", tickets: [tk("A"), tk("B", { blockedBy: ["A", "Z"] })], closed: [{ title: "Z" }] }));
});

test("tickets merge by title; remove drops one; listener is hub-only", () => {
  let m = applyMapPatch({}, { title: "Map", tickets: [{ title: "A", type: "research", state: "frontier" }, { title: "B", type: "task", state: "blocked", blockedBy: ["A"] }] }, NOW);
  m = applyMapPatch(m, { tickets: [{ title: "A", remove: true }, { title: "B", state: "frontier", blockedBy: null }], closed: [{ title: "A", gist: "done" }] }, NOW);
  assert.deepEqual(m.tickets.map((t) => [t.title, t.state, t.blockedBy]), [["B", "frontier", undefined]]);
  assert.equal(m.at, NOW); validateMap(m);
  assert.throws(() => applyMapPatch(m, { listener: { agentId: "x" } }, NOW), /written by the hub/);
});

test("map patch: known titles merge one level, new titles append, order kept, other keys replaced whole", () => {
  let m = full(); // as the hub holds it (listener is hub-written)
  m = applyMapPatch(m, {
    tickets: [tk("E", { type: "research" }), { title: "A", assignee: null, state: "claimed" }],
    decisions: [{ title: "D1", gist: "changed" }, { title: "D2", gist: "new" }],
    closed: [{ title: "Old", link: "https://x/1" }],
    fog: ["only this"], outOfScope: [], destination: "Ship it well", notes: null, handled: 4,
  }, LATER);
  assert.deepEqual(m.tickets.map((t) => t.title), ["A", "B", "C", "D", "E"]);
  assert.deepEqual(m.tickets[0], { title: "A", type: "research", state: "claimed", link: "https://github.com/o/r/issues/43" });
  assert.deepEqual(m.decisions, [{ title: "D1", link: "docs/adr/1.md", gist: "changed" }, { title: "D2", gist: "new" }]);
  assert.deepEqual(m.closed, [{ title: "Old", gist: "done", link: "https://x/1" }]);
  assert.deepEqual(m.fog, ["only this"]);
  assert.deepEqual(m.outOfScope, []);
  assert.equal(m.destination, "Ship it well");
  assert.ok(!("notes" in m), "null deletes a top-level key");
  assert.equal(m.handled, 4);
  assert.equal(m.at, LATER, "at is stamped on every patch");
  assert.deepEqual(m.listener, full().listener, "listener kept (hub-written)");
  validateMap(m);
  // remove works on decisions and closed too; removing an unknown title is a no-op
  m = applyMapPatch(m, { decisions: [{ title: "D2", remove: true }], closed: [{ title: "Nope", remove: true }], tickets: [{ title: "Gone", remove: true }] }, LATER);
  assert.deepEqual(m.decisions.map((d) => d.title), ["D1"]);
  assert.equal(m.tickets.length, 5);
});

test("map patch: an explicit at is overwritten by the stamp; the input is not mutated", () => {
  const m0 = full(); const before = JSON.stringify(m0);
  const m = applyMapPatch(m0, { at: "1999-01-01T00:00:00.000Z", tickets: [{ title: "A", state: "claimed" }] }, LATER);
  assert.equal(m.at, LATER);
  assert.equal(JSON.stringify(m0), before);
});

test("map patch: bad shapes are PatchErrors", () => {
  const bad = (p, re) => assert.throws(() => applyMapPatch(full(), p, NOW), (e) => e instanceof PatchError && re.test(e.message));
  bad([], /map patch must be a JSON object/);
  bad(null, /map patch must be a JSON object/);
  bad({ tickets: { title: "A" } }, /tickets in a map patch must be an array/);
  bad({ tickets: [{ state: "frontier" }] }, /every tickets entry in a map patch needs a string title/);
  bad({ closed: ["A"] }, /every closed entry in a map patch needs a string title/);
  bad({ tickets: [{ title: "A", remove: "yes" }] }, /remove must be true/);
  bad(JSON.parse('{"__proto__":{"title":"x"}}'), /__proto__/);
  bad(JSON.parse('{"tickets":[{"title":"A","__proto__":{"state":"x"}}]}'), /__proto__/);
  bad({ listener: null }, /listener is written by the hub/);
  // A patch whose merge leaves a dangling blockedBy fails validation (the hub then keeps the old map).
  assert.throws(() => validateMap(applyMapPatch(full(), { tickets: [{ title: "A", remove: true }] }, NOW)), /B\.blockedBy names unknown "A"/);
});

test("session state.map is validated by validateMap", () => {
  const s = { topic: "t", questions: [] };
  assert.doesNotThrow(() => validateState({ ...s, map: full() }));
  assert.throws(() => validateState({ ...s, map: "not a map" }), (e) => e instanceof PatchError && /map must be an object/.test(e.message));
  assert.throws(() => validateState({ ...s, map: { title: "M", tickets: [tk("B", { blockedBy: ["X"] })] } }), /B\.blockedBy names unknown "X"/);
});

test("map patch: hubClaim is hub-written; a ticket removed and re-added in one patch keeps it", () => {
  const bad = (p) => assert.throws(() => applyMapPatch(full(), p, NOW), (e) => e instanceof PatchError && /tickets C: hubClaim is written by the hub \(claim\/--release\)/.test(e.message));
  bad({ tickets: [{ title: "C", hubClaim: { agentId: "me", at: NOW } }] });
  bad({ tickets: [{ title: "C", hubClaim: null }] });
  assert.throws(() => applyMapPatch(full(), { tickets: [tk("Z", { hubClaim: { agentId: "me", at: NOW } })] }, NOW), /tickets Z: hubClaim is written by the hub/);
  // A full-snapshot rewrite: remove C, then add it back without hubClaim.
  const m = applyMapPatch(full(), { tickets: [{ title: "C", remove: true }, tk("C", { type: "prototype", state: "claimed" })] }, LATER);
  assert.deepEqual(m.tickets.find((t) => t.title === "C").hubClaim, full().tickets[2].hubClaim);
  validateMap(m);
  // A plain merge keeps it too; removal alone drops it.
  assert.deepEqual(applyMapPatch(full(), { tickets: [{ title: "C", assignee: "x" }] }, LATER).tickets[2].hubClaim, full().tickets[2].hubClaim);
  assert.ok(!applyMapPatch(full(), { tickets: [{ title: "C", remove: true }] }, LATER).tickets.some((t) => t.title === "C"));
  // The hub's own claim code may write it.
  const h = applyMapPatch(full(), { tickets: [{ title: "D", state: "claimed", hubClaim: { agentId: "a1b2", at: LATER, seq: 4 } }] }, LATER, { hub: true });
  assert.deepEqual(h.tickets[3].hubClaim, { agentId: "a1b2", at: LATER, seq: 4 });
  assert.ok(!("hubClaim" in applyMapPatch(h, { tickets: [{ title: "D", hubClaim: null }] }, LATER, { hub: true }).tickets[3]));
});

test("map patch: handled only increases", () => {
  assert.equal(applyMapPatch(full(), { handled: 5 }, NOW).handled, 5);
  assert.equal(applyMapPatch(full(), { handled: 3 }, NOW).handled, 3);
  assert.equal(applyMapPatch(full(), { handled: 1 }, NOW).handled, 3, "a lower value is ignored");
  assert.equal(applyMapPatch(full(), { handled: null }, NOW).handled, 3, "null does not reset it");
  assert.equal(applyMapPatch({ title: "M" }, { handled: 2 }, NOW).handled, 2);
  assert.throws(() => validateMap(applyMapPatch(full(), { handled: "7" }, NOW)), /map\.handled must be a whole number/);
});

test("validateMap: a title cannot be both a ticket and closed", () => {
  rejects({ title: "M", tickets: [tk("A")], closed: [{ title: "A" }] }, /"A" is in both tickets and closed/);
  assert.throws(() => validateMap(applyMapPatch(full(), { closed: [{ title: "D", gist: "done" }] }, NOW)), /"D" is in both tickets and closed/);
});
