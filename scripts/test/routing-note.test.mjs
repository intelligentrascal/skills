import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { trigger, buildNote, run, install, remove, hasOwnContent, BEGIN, END, MAX_LINES } from "../routing-note.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(ROOT, "scripts", "routing-note.mjs");
const list = JSON.parse(readFileSync(join(ROOT, "plugins/rascal/workflows.json"), "utf8"));

// A scratch copy of the parts of the repo the generator reads and writes.
function sandbox() {
  const r = mkdtempSync(join(tmpdir(), "rnote-"));
  for (const p of ["plugins/rascal/workflows.json", "plugins/rascal/rules", "plugins/rascal/skills", "plugins/rascal/routing-note.md"]) {
    cpSync(join(ROOT, p), join(r, p), { recursive: true });
  }
  return r;
}

test("trigger: the description's 'Use when/for' sentence, lower-cased lead", () => {
  assert.equal(trigger("Plan work. Use when the user wants to plan."), "when the user wants to plan.");
  assert.equal(trigger('"Experimental. Build it. Use when the user says orchestrate."'), "when the user says orchestrate.");
  assert.equal(trigger("Design a UI. Use for a new page; not for small UI tweaks."), "for a new page; not for small UI tweaks.");
  assert.throws(() => trigger("No trigger here."), /no "Use when/);
});

test("the note: at most 30 lines, every workflow with its trigger, the canonical table, rules, overrides", () => {
  const note = buildNote();
  assert.ok(note.trimEnd().split("\n").length <= 30, `${note.split("\n").length} lines`);
  for (const w of list.workflows) {
    const d = /^description:\s*(.*)$/m.exec(readFileSync(join(ROOT, "plugins/rascal/skills", w, "SKILL.md"), "utf8"))[1];
    assert.ok(note.includes(`\`${w}\`: ${trigger(d)}`), w);
  }
  for (const [concept, skill] of Object.entries(list.canonical)) assert.ok(note.includes(`${concept} \`${skill}\``), concept);
  assert.ok(note.includes("if the task is a chore with no design decision in it (setup, housekeeping, a quick fix, or a run that follows its own spec), just do it."));
  for (const s of ["~/.rascal/preferences.md", "1% chance", "/rascal:go <task>", "rascal-go", "rascal:<name>", "worktree", "source"]) assert.ok(note.includes(s), s);
});

test("the router copy omits the pointer to itself", () => {
  const r = buildNote({ forRouter: true });
  assert.ok(r.includes("`rascal-plan`"));
  assert.ok(!r.includes("/rascal:go"));
});

test("generate writes the note and the router block; --check reports drift", () => {
  const r = sandbox();
  writeFileSync(join(r, "plugins/rascal/routing-note.md"), "stale\n");
  const sk = join(r, "plugins/rascal/skills/rascal-go/SKILL.md");
  writeFileSync(sk, readFileSync(sk, "utf8").replace(/<!-- routing-note -->[\s\S]*<!-- \/routing-note -->/, "<!-- routing-note -->\nold\n<!-- /routing-note -->"));
  assert.deepEqual(run({ check: true, root: r }).sort(), ["plugins/rascal/routing-note.md", "plugins/rascal/skills/rascal-go/SKILL.md"]);
  assert.equal(readFileSync(join(r, "plugins/rascal/routing-note.md"), "utf8"), "stale\n", "--check writes nothing");
  run({ root: r });
  assert.deepEqual(run({ check: true, root: r }), []);
  assert.equal(readFileSync(join(r, "plugins/rascal/routing-note.md"), "utf8"), buildNote({ root: r }));
  assert.ok(readFileSync(sk, "utf8").includes(buildNote({ root: r, forRouter: true })));
});

test("the committed note and router block are current", () => {
  assert.deepEqual(run({ check: true }), []);
  const p = spawnSync(process.execPath, [SCRIPT, "--check"], { encoding: "utf8" });
  assert.equal(p.status, 0, p.stderr);
});

test("the note follows a description edit", () => {
  const r = sandbox();
  const f = join(r, "plugins/rascal/skills/rascal-plan/SKILL.md");
  writeFileSync(f, readFileSync(f, "utf8").replace(/Use when the user wants to plan[^\n]*/, "Use when a test asks."));
  assert.ok(buildNote({ root: r }).includes("`rascal-plan`: when a test asks."));
});

const tmpFile = (content) => {
  const d = mkdtempSync(join(tmpdir(), "rnote-f-"));
  const f = join(d, "sub", "AGENTS.md");
  if (content !== undefined) { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, content); }
  return f;
};

test("install into a missing file: creates it with only the block, no backup", () => {
  const f = tmpFile();
  assert.equal(install(f, "NOTE\n"), "created");
  assert.equal(readFileSync(f, "utf8"), `${BEGIN}\nNOTE\n${END}\n`);
  assert.equal(existsSync(`${f}.rascal-bak`), false);
});

test("install appends to an existing file, backs it up, then is idempotent", () => {
  const f = tmpFile("# Mine\n\nkeep me\n");
  assert.equal(install(f, "NOTE\n"), "updated");
  assert.equal(readFileSync(f, "utf8"), `# Mine\n\nkeep me\n\n${BEGIN}\nNOTE\n${END}\n`);
  assert.equal(readFileSync(`${f}.rascal-bak`, "utf8"), "# Mine\n\nkeep me\n");
  writeFileSync(`${f}.rascal-bak`, "sentinel");
  assert.equal(install(f, "NOTE\n"), "unchanged");
  assert.equal(readFileSync(`${f}.rascal-bak`, "utf8"), "sentinel", "no write, no new backup");
});

test("install replaces only the block; content around it is untouched", () => {
  const f = tmpFile(`before\n${BEGIN}\nOLD\n${END}\nafter\n`);
  assert.equal(install(f, "NEW\n"), "updated");
  assert.equal(readFileSync(f, "utf8"), `before\n${BEGIN}\nNEW\n${END}\nafter\n`);
  assert.equal(readFileSync(`${f}.rascal-bak`, "utf8"), `before\n${BEGIN}\nOLD\n${END}\nafter\n`);
});

test("unbalanced or repeated markers: refused, file untouched", () => {
  for (const bad of [`x\n${BEGIN}\nOLD\n`, `x\n${END}\n`, `${BEGIN}\na\n${END}\n${BEGIN}\nb\n${END}\n`]) {
    const f = tmpFile(bad);
    assert.throws(() => install(f, "NEW\n"), /markers/);
    assert.throws(() => remove(f), /markers/);
    assert.equal(readFileSync(f, "utf8"), bad);
    assert.equal(existsSync(`${f}.rascal-bak`), false);
  }
});

test("remove takes the block out (with its separating blank line), backs up; absent → unchanged", () => {
  const f = tmpFile("# Mine\n");
  install(f, "NOTE\n");
  assert.equal(remove(f), "removed");
  assert.equal(readFileSync(f, "utf8"), "# Mine\n");
  assert.equal(remove(f), "unchanged");
  assert.equal(remove(tmpFile()), "unchanged");
});

test("CLI: install / remove print the outcome; bad markers exit 1", () => {
  const f = tmpFile("x\n");
  const cli = (...a) => spawnSync(process.execPath, [SCRIPT, ...a], { encoding: "utf8" });
  let p = cli("install", f);
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /updated/);
  assert.ok(readFileSync(f, "utf8").includes(buildNote()));
  p = cli("remove", f);
  assert.equal(p.status, 0);
  assert.equal(readFileSync(f, "utf8"), "x\n");
  writeFileSync(f, `${BEGIN}\n`);
  assert.equal(cli("install", f).status, 1);
  assert.equal(cli("bogus").status, 2);
});

test("a note over the line cap fails to build (so --check fails too)", () => {
  const r = sandbox();
  const f = join(r, "plugins/rascal/rules/routing.md");
  writeFileSync(f, readFileSync(f, "utf8") + Array.from({ length: MAX_LINES }, (_, i) => `- **Extra ${i}:** filler.`).join("\n") + "\n");
  assert.throws(() => buildNote({ root: r }), /caps it at 30/);
  assert.throws(() => run({ check: true, root: r }), /caps it at 30/);
});

test("CRLF files stay CRLF through install and remove", () => {
  const f = tmpFile("a\r\nb\r\n");
  install(f, "N1\nN2\n");
  assert.equal(readFileSync(f, "utf8"), `a\r\nb\r\n\r\n${BEGIN}\r\nN1\r\nN2\r\n${END}\r\n`);
  assert.equal(install(f, "N1\nN2\n"), "unchanged");
  remove(f);
  assert.equal(readFileSync(f, "utf8"), "a\r\nb\r\n");
});

test("a file without a trailing newline gets a blank line before the block", () => {
  const f = tmpFile("rules");
  install(f, "N\n");
  assert.equal(readFileSync(f, "utf8"), `rules\n\n${BEGIN}\nN\n${END}\n`);
});

test("hasOwnContent: anything besides the note counts", () => {
  assert.equal(hasOwnContent(tmpFile()), false);
  const f = tmpFile("");
  install(f, "N\n");
  assert.equal(hasOwnContent(f), false);
  assert.equal(hasOwnContent(tmpFile("mine\n")), true);
  const g = tmpFile("mine\n"); install(g, "N\n");
  assert.equal(hasOwnContent(g), true);
  const p = spawnSync(process.execPath, [SCRIPT, "has-own-content", g]);
  assert.equal(p.status, 0);
  assert.equal(spawnSync(process.execPath, [SCRIPT, "has-own-content", f]).status, 1);
});
