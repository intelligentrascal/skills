// Session state patch/merge/stamp/validate (pure). Ported from jasonku09/grill-with-ui
// server.mjs:245-450 (daafa1e), extended with phase, finished.kind, map, and the owner/token
// rule (decision D3: those live in meta.json and are written by the hub/CLI, never by patch).
//
// The agent sends only what changed, so the whole state never passes through its context.
//   null deletes a key, at any level
//   agent, visual: merge one level (visual.thread and visual.queued append)
//   questions: keyed by id. A known id merges one level (its thread appends). An unknown id
//     with a title is a new question, appended with defaults; without a title it is an error.
//   terms: keyed by term; a known term is replaced whole, a new one appended
//   any other key: replaced whole
// Before the merge, applyPatch stamps the times the agent leaves out (see stampTimes).
import { isObj } from "./util.mjs";
import { validateMap } from "./maps.mjs";

export class PatchError extends Error {}
export const bad = (msg) => { throw new PatchError(msg); };
export const fieldsOf = (p, where) => {
  if (Object.hasOwn(p, "__proto__")) bad(`"__proto__" in ${where} is not a state.json field`);
  return Object.entries(p);
};
// A value written whole carries no null-valued keys: null means "delete" everywhere.
export const clean = (v) => (Array.isArray(v) ? v.map(clean)
  : isObj(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, clean(x)])) : v);
const newQuestionDefaults = () => ({ status: "open", deps: [], options: [], thread: [], durable: false, updated: false });
const THREAD = ["thread"];
const VISUAL_APPENDS = ["thread", "queued"];
const HUB_ONLY = ["owner", "token"];

// Agents do not reliably know the current time, so the hub stamps every time the patch
// leaves out (or gives as null); an explicit time in the patch always wins:
//   agent.since          when the patch gives agent.status
//   <q>.explore.at       when the patch gives a question's explore
//   visual.at            when the patch changes visual.version
//   visual.drawing.since when the patch gives visual.drawing
//   finished.at          when the patch gives finished
//   at on each appended message in a question's thread or visual.thread
function stampTimes(p, state, now) {
  const fill = (o, k) => (isObj(o) && o[k] == null ? { ...o, [k]: now } : o);
  const messages = (list) => (Array.isArray(list) ? list.map((m) => fill(m, "at")) : list);
  const out = { ...p };
  if (isObj(out.agent) && out.agent.status != null) out.agent = fill(out.agent, "since");
  if (isObj(out.finished)) out.finished = fill(out.finished, "at");
  if (Array.isArray(out.questions)) {
    out.questions = out.questions.map((q) => {
      if (!isObj(q)) return q;
      const s = { ...q };
      if (isObj(s.explore)) s.explore = fill(s.explore, "at");
      if ("thread" in s) s.thread = messages(s.thread);
      return s;
    });
  }
  if (isObj(out.visual)) {
    let v = { ...out.visual };
    const current = isObj(state) && isObj(state.visual) ? state.visual.version : undefined;
    if (v.version != null && v.version !== current) v = fill(v, "at");
    if (isObj(v.drawing)) v.drawing = fill(v.drawing, "since");
    if ("thread" in v) v.thread = messages(v.thread);
    out.visual = v;
  }
  return out;
}

export function appendTo(current, added, where) {
  if (!Array.isArray(added)) bad(`${where} in a patch must be an array of the new entries to append`);
  if (current !== undefined && !Array.isArray(current)) bad(`${where} in state.json is not an array`);
  return [...(current || []), ...added.map(clean)];
}
// One level: each key given replaces that key (null deletes it); keys in `appends` append.
export function mergeOne(current, p, where, appends = []) {
  if (!isObj(p)) bad(`${where} in a patch must be an object`);
  const out = isObj(current) ? { ...current } : {};
  for (const [k, v] of fieldsOf(p, where)) {
    if (v === null) delete out[k];
    else if (appends.includes(k)) out[k] = appendTo(out[k], v, `${where}.${k}`);
    else out[k] = clean(v);
  }
  return out;
}
function patchQuestions(current, list) {
  if (!Array.isArray(list)) bad("questions in a patch must be an array of entries, each with an id");
  if (!Array.isArray(current)) bad("questions in state.json is not an array");
  const qs = current.slice();
  for (const p of list) {
    if (!isObj(p) || typeof p.id !== "string" || !p.id) bad("every question entry in a patch needs a string id");
    const i = qs.findIndex((q) => isObj(q) && q.id === p.id);
    if (i >= 0) { qs[i] = mergeOne(qs[i], p, p.id, THREAD); continue; }
    if (p.title == null) {
      const ids = qs.map((q) => q && q.id).join(", ") || "none yet";
      bad(`no question ${JSON.stringify(p.id)} in state.json (ids: ${ids}); a new question needs round, title, and rec`);
    }
    const missing = ["round", "rec"].filter((k) => p[k] == null);
    if (missing.length) bad(`new question ${p.id} needs ${missing.join(" and ")}`);
    const q = mergeOne({}, p, p.id, THREAD);
    for (const [k, d] of Object.entries(newQuestionDefaults())) if (!(k in q)) q[k] = d;
    qs.push(q);
  }
  return qs;
}
function patchTerms(current, list) {
  if (!Array.isArray(list)) bad("terms in a patch must be an array of entries, each with a term");
  if (current != null && !Array.isArray(current)) bad("terms in state.json is not an array");
  const ts = (current || []).slice();
  for (const t of list) {
    if (!isObj(t) || typeof t.term !== "string" || !t.term) bad("every term entry in a patch needs a string term");
    const i = ts.findIndex((x) => isObj(x) && x.term === t.term);
    if (i >= 0) ts[i] = clean(t); else ts.push(clean(t));
  }
  return ts;
}
// Returns a new state; never mutates `state` or `p`. Throws PatchError on a bad shape.
export function applyPatch(state, p, now) {
  if (!isObj(p)) bad("the patch must be a JSON object shaped like state.json");
  for (const k of HUB_ONLY) if (Object.hasOwn(p, k)) bad("owner and token are written by the hub, not by patch");
  const out = { ...state };
  for (const [k, v] of fieldsOf(stampTimes(p, state, now), "the patch")) {
    if (v === null) delete out[k];
    else if (k === "agent") out.agent = mergeOne(out.agent, v, "agent");
    else if (k === "visual") out.visual = mergeOne(out.visual, v, "visual", VISUAL_APPENDS);
    else if (k === "questions") out.questions = patchQuestions(out.questions, v);
    else if (k === "terms") out.terms = patchTerms(out.terms, v);
    else out[k] = clean(v);
  }
  return out;
}

// The shape the page and SKILL.md rely on. Every field the page reads is checked for the type
// the render uses it as: a list it maps is an array, and text it shows is a string. Text goes
// through String() on the page, which throws on an object whose own toString is not a function,
// so "any value" is not safe there. Optional fields stay optional.
const STATUSES = ["open", "answered", "deferred", "reopened"];
const ANSWER_KINDS = ["accept", "option", "text"];
const PHASES = ["destination", "frontier", "ticket"];
const KINDS = ["doc", "map", "no-map"];
export function validateState(s) {
  const need = (ok, msg) => { if (!ok) bad(msg); };
  const str = (v) => typeof v === "string";
  const strs = (v) => Array.isArray(v) && v.every(str);
  const bool = (v) => typeof v === "boolean";
  const count = (v) => Number.isInteger(v) && v >= 0;
  const check = (o, k, ok, msg) => { if (k in o) need(ok(o[k]), msg); };
  const texts = (o, keys, where) => { for (const k of keys) check(o, k, str, `${where}.${k} must be a string`); };
  const messages = (list, where) => {
    need(Array.isArray(list), `${where} must be an array`);
    list.forEach((m, i) => need(isObj(m) && (m.who === "user" || m.who === "agent") && str(m.text) && (m.at === undefined || str(m.at)),
      `${where}[${i}] must be {"who":"user"|"agent","text":"…","at":"ISO"}`));
  };
  need(isObj(s), "state must be an object");
  for (const k of ["topic", "doc", "project", "created", "note"]) check(s, k, str, `${k} must be a string`);
  check(s, "phase", (v) => PHASES.includes(v), `phase must be one of ${PHASES.join("|")}`);
  for (const k of ["mapKey", "id", "projectKey", "cwd", "branch"]) check(s, k, str, `${k} must be a string`);
  if ("finished" in s) {
    need(isObj(s.finished), 'finished must be an object ({"kind","doc","visual","at"})');
    texts(s.finished, ["doc", "visual", "at"], "finished");
    check(s.finished, "kind", (v) => KINDS.includes(v), `finished.kind must be one of ${KINDS.join("|")}`);
  }
  if ("agent" in s) {
    need(isObj(s.agent), "agent must be an object");
    check(s.agent, "status", (v) => v === "waiting" || v === "working", 'agent.status must be "waiting" or "working"');
    check(s.agent, "since", str, "agent.since must be an ISO time string");
    check(s.agent, "handled", count, "agent.handled must be a whole number (the seq of the last handled send)");
  }
  if ("terms" in s) {
    need(Array.isArray(s.terms), "terms must be an array");
    s.terms.forEach((t, i) => {
      need(isObj(t) && str(t.term), `terms[${i}] needs a string term`);
      const w = `term ${JSON.stringify(t.term)}`;
      check(t, "def", str, `${w}: def must be a string`);
      check(t, "avoid", strs, `${w}: avoid must be an array of strings`);
    });
  }
  need(Array.isArray(s.questions), "questions must be an array");
  const ids = new Set();
  s.questions.forEach((q, i) => {
    need(isObj(q) && str(q.id) && q.id !== "", `questions[${i}] needs a string id`);
    const w = q.id;
    need(!ids.has(w), `question id ${w} appears twice`); ids.add(w);
    need(Number.isFinite(q.round), `${w}.round must be a number`);
    need(str(q.title), `${w}.title must be a string`);
    need(STATUSES.includes(q.status), `${w}.status must be one of ${STATUSES.join("|")}`);
    need(isObj(q.rec), `${w}.rec must be an object ({"option","why"} or {"text","why"})`);
    texts(q.rec, ["option", "text", "why"], `${w}.rec`);
    check(q, "body", str, `${w}.body must be a string`);
    check(q, "deps", strs, `${w}.deps must be an array of question ids`);
    check(q, "options", (v) => Array.isArray(v) && v.every((x) => isObj(x) && str(x.k) && (!("text" in x) || str(x.text))),
      `${w}.options must be an array of {"k","text"} with string k and text`);
    if ("answer" in q) {
      need(isObj(q.answer) && ANSWER_KINDS.includes(q.answer.kind), `${w}.answer.kind must be one of ${ANSWER_KINDS.join("|")}`);
      texts(q.answer, ["option", "text"], `${w}.answer`);
    }
    if ("explore" in q) {
      const e = q.explore;
      need(isObj(e) && Array.isArray(e.rows), `${w}.explore must be {"at","rows":[…]}`);
      check(e, "at", str, `${w}.explore.at must be an ISO time string`);
      e.rows.forEach((r, j) => {
        const where = `${w}.explore.rows[${j}]`;
        need(isObj(r), `${where} must be {"option","pros":[…],"cons":[…]}`);
        check(r, "option", str, `${where}.option must be a string`);
        for (const k of ["pros", "cons"]) check(r, k, strs, `${where}.${k} must be an array of strings`);
      });
    }
    for (const k of ["durable", "updated"]) check(q, k, bool, `${w}.${k} must be true or false`);
    if ("thread" in q) messages(q.thread, `${w}.thread`);
  });
  if ("visual" in s) {
    const v = s.visual;
    need(isObj(v), "visual must be an object");
    check(v, "kind", (x) => x === "prototype" || x === "diagram", 'visual.kind must be "prototype" or "diagram"');
    check(v, "version", count, "visual.version must be a whole number");
    need("kind" in v && "version" in v, "visual needs kind and version; the first Visualize draw creates it (version 0)");
    check(v, "stale", bool, "visual.stale must be true or false");
    texts(v, ["note", "at"], "visual");
    check(v, "drawing", (x) => isObj(x) && (!("since" in x) || str(x.since)), 'visual.drawing must be {"since":"ISO","seq":N}');
    check(v, "queued", strs, "visual.queued must be an array of strings");
    if ("thread" in v) messages(v.thread, "visual.thread");
  }
  if ("map" in s) validateMap(s.map);
}

export const isOpen = (q) => q.status === "open" || q.status === "reopened";
