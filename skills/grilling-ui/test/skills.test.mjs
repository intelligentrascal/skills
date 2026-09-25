// The SKILL.md files: frontmatter, the grilling-ui override table, every hub command they name is
// a real subcommand, load order and portable conventions (spec §3, §5b; plan T21–T23).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { HUB } from "./helpers.mjs";

const SKILLS = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (skill) => readFileSync(join(SKILLS, skill, "SKILL.md"), "utf8");

// Frontmatter as { key: raw value } (single-line values only, which is all these files use).
function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(m, "SKILL.md starts with a --- frontmatter block");
  // A double-quoted value is unquoted (grilling-ui's description holds ": ", which a plain YAML scalar cannot).
  const unq = (v) => (/^".*"$/.test(v) ? JSON.parse(v) : v);
  return Object.fromEntries(m[1].split("\n").map((l) => { const i = l.indexOf(":"); return [l.slice(0, i).trim(), unq(l.slice(i + 1).trim())]; }));
}

// Subcommand names from the hub's usage text (printed on stderr, exit 2).
function subcommands() {
  const r = spawnSync(process.execPath, [HUB], { encoding: "utf8" });
  const names = [...r.stderr.matchAll(/^ {2}([a-z][a-z-]*)/gm)].map((m) => m[1]);
  assert.ok(names.includes("patch") && names.includes("agent-profile"), "usage lists the subcommands");
  return new Set(names);
}

test("grilling-ui: frontmatter", () => {
  const fm = frontmatter(read("grilling-ui"));
  assert.equal(fm.name, "grilling-ui");
  assert.equal(fm["user-invocable"], "false");
  assert.match(fm.description, /^Browser transport for the -ui grill skills/);
  assert.doesNotMatch(fm.description, /\bUse when\b|"[^"]*"/, "no trigger phrases");
});

test("grilling-ui: override table comes first and has all six rows", () => {
  const text = read("grilling-ui");
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, "");
  const firstH2 = /^## (.+)$/m.exec(body);
  assert.equal(firstH2[1].trim(), "Overrides");
  assert.match(text, /This skill loads last\. Where Pocock's `grilling` or `domain-modeling` disagree with this table, this table wins\./);
  const section = body.slice(firstH2.index, body.indexOf("\n## ", firstH2.index + 1));
  const rows = section.split("\n").filter((l) => l.startsWith("|") && !/^\|\s*-/.test(l)).slice(1);
  assert.equal(rows.length, 6, "six override rows");
  for (const phrase of [
    "Ask the whole frontier per round",
    "Format a round like so",
    "Wait for the user's answers",
    "Dispatch sub-agents for facts",
    "Done when the frontier is empty",
    "call out conflicts immediately",
  ]) assert.ok(rows.some((r) => r.split("|")[1].includes(phrase)), `override row for: ${phrase}`);
});

test("grilling-ui: sections in order", () => {
  const heads = [...read("grilling-ui").matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
  const want = ["Overrides", "`$SKILL`", "Files and ownership", "Patching", "Start", "Listening", "The event rule",
    "Handling a send", "Visualize", "Terminal input", "Finish", "Resume", "state.json"];
  assert.deepEqual(heads, want);
});

test("grilling-ui: every hub command is a real subcommand, always run as node \"$SKILL/hub.mjs\"", () => {
  const text = read("grilling-ui");
  const cmds = subcommands();
  const used = [...text.matchAll(/node "\$SKILL\/hub\.mjs" ([a-z][a-z-]*)/g)].map((m) => m[1]);
  assert.ok(used.length >= 8, "the skill names its commands");
  for (const c of used) assert.ok(cmds.has(c), `${c} is a hub.mjs subcommand`);
  for (const c of ["new", "patch", "agent-profile", "open", "pending", "resume"]) assert.ok(used.includes(c), `mentions ${c}`);
  // hub.mjs never appears in any other form (a bare or relative path)
  const bare = [...text.matchAll(/(.{0,16})hub\.mjs/g)].filter((m) => !m[1].endsWith('"$SKILL/'));
  assert.deepEqual(bare.map((m) => m[0]), []);
  assert.match(text, /--agent-id <agentId>/);
});

test("grilling-ui: loads nothing, no relative paths", () => {
  const text = read("grilling-ui");
  assert.doesNotMatch(text, /Call the Skill tool with/);
  assert.doesNotMatch(text, /\.\.\//);
});

// ---- wrappers (T22, T23) ----
const SKILL_LINE = "`$SKILL` = the folder containing this SKILL.md: `${CLAUDE_SKILL_DIR}` in Claude Code, otherwise the directory of the path you were shown for this file.";
// Quoted trigger phrases in a description.
const triggers = (desc) => [...desc.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
// Index of the line that loads `name` (flat name and Claude Code form on the same line).
function loadLine(text, flat, qualified) {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => /Call the Skill tool with/.test(l) && l.includes(`\`${flat}\``) && l.includes(`\`${qualified}\``));
  assert.ok(i >= 0, `a "Call the Skill tool with" line names \`${flat}\` and \`${qualified}\``);
  return i;
}

for (const [skill, extra] of [["grill-me-ui", []], ["grill-docs-ui", [["domain-modeling", "mattpocock-skills:domain-modeling"]]]]) {
  test(`${skill}: frontmatter and ui-only triggers`, () => {
    const fm = frontmatter(read(skill));
    assert.equal(fm.name, skill);
    assert.equal(Object.keys(fm).length, 2, "only name and description");
    assert.doesNotMatch(fm.description, /: /, "a plain YAML scalar holds no \": \"");
    const t = triggers(fm.description);
    assert.ok(t.length >= 3, "has quoted trigger phrases");
    for (const p of t) assert.match(p, /\bui\b|browser/i, `trigger ${JSON.stringify(p)} names ui or browser`);
    assert.doesNotMatch(fm.description, /"grill me"|"grill with docs"/i);
  });

  test(`${skill}: preflight, load order, $SKILL, no relative paths`, () => {
    const text = read(skill);
    assert.ok(text.includes(SKILL_LINE));
    assert.match(text, /claude plugin install mattpocock-skills@mattpocock/);
    assert.match(text, /npx skills add -g mattpocock\/skills/);
    assert.match(text, /Never grill from memory/);
    const order = [["grilling", "mattpocock-skills:grilling"], ...extra, ["grilling-ui", "intelligentrascal:grilling-ui"]].map(([f, q]) => loadLine(text, f, q));
    for (let i = 1; i < order.length; i++) assert.ok(order[i - 1] < order[i], "loads in order: grilling, (domain-modeling), grilling-ui");
    assert.doesNotMatch(text, /\.\.\//);
    assert.doesNotMatch(text, /hub\.mjs/, "wrappers run no commands");
  });
}

test("grill-me-ui: design-doc profile, default doc path, resume", () => {
  const text = read("grill-me-ui");
  assert.match(text, /finish profile \*\*design-doc\*\*/);
  assert.match(text, /docs\/<slug>-design\.md/);
  assert.match(text, /grilling-ui \*\*Start\*\*/);
  assert.match(text, /grilling-ui \*\*Resume\*\*/);
});

test("grill-docs-ui: docs profile, two separate loads, terms patched after CONTEXT.md edits", () => {
  const text = read("grill-docs-ui");
  assert.match(text, /finish profile \*\*docs\*\*/);
  const g = loadLine(text, "grilling", "mattpocock-skills:grilling"), d = loadLine(text, "domain-modeling", "mattpocock-skills:domain-modeling");
  assert.notEqual(g, d, "grilling and domain-modeling are two calls");
  assert.match(text, /After every `CONTEXT\.md` edit, patch the page `terms` with the terms touched in this grill only\./);
});

// ---- wayfinder-ui (T23) ----
const ROOT = join(SKILLS, "..");
const PIN = "3cca18b368ae95cdbdebbff572ccafa662551015";
const POCOCK_PIN = process.env.POCOCK_PIN || join(homedir(), ".claude/plugins/cache/mattpocock/mattpocock-skills/1.2.3");
const PINNED_WAYFINDER = join(POCOCK_PIN, "skills/engineering/wayfinder/SKILL.md");

test("wayfinder-ui: vendored upstream/wayfinder.md is byte-identical to the pinned file", { skip: !existsSync(PINNED_WAYFINDER) && `no pinned copy at ${PINNED_WAYFINDER}` }, () => {
  assert.ok(readFileSync(join(SKILLS, "wayfinder-ui/upstream/wayfinder.md")).equals(readFileSync(PINNED_WAYFINDER)));
});

test("upstream.json: pins", () => {
  // Shape, not values: install-agents.sh records `agents` and sync-pocock.sh bumps the pins.
  const u = JSON.parse(readFileSync(join(ROOT, "upstream.json"), "utf8")).pocock;
  const sha = /^[0-9a-f]{40}$/;
  assert.equal(u.plugin, "mattpocock-skills");
  assert.match(u.claude.version, /^\d+\.\d+\.\d+$/);
  assert.match(u.claude.commit, sha);
  assert.match(u.wayfinder.vendoredFrom, sha);
  if (u.agents !== null) {
    assert.equal(typeof u.agents.dir, "string");
    assert.match(u.agents.contentSha, /^[0-9a-f]{64}$/);
    assert.ok(u.agents.skillFolderHash === null || typeof u.agents.skillFolderHash === "object");
  }
});

test("wayfinder-ui: frontmatter, triggers, $SKILL, preflight and load order", () => {
  const text = read("wayfinder-ui");
  const fm = frontmatter(text);
  assert.equal(fm.name, "wayfinder-ui");
  assert.equal(Object.keys(fm).length, 2, "only name and description");
  assert.doesNotMatch(fm.description, /: /, "a plain YAML scalar holds no \": \"");
  const t = triggers(fm.description);
  for (const p of ["wayfinder ui", "wayfind with ui", "/wayfinder-ui", "/wayfinder-ui board <map>"]) assert.ok(t.includes(p), `trigger ${p}`);
  for (const p of t) assert.match(p, /\bui\b|-ui\b|browser/i, `trigger ${JSON.stringify(p)} names ui`);
  assert.ok(text.includes(SKILL_LINE));
  assert.match(text, /claude plugin install mattpocock-skills@mattpocock/);
  assert.match(text, /npx skills add -g mattpocock\/skills/);
  const order = [["grilling", "mattpocock-skills:grilling"], ["domain-modeling", "mattpocock-skills:domain-modeling"], ["grilling-ui", "intelligentrascal:grilling-ui"]].map(([f, q]) => loadLine(text, f, q));
  assert.ok(order[0] < order[1] && order[1] < order[2], "loads grilling, domain-modeling, then grilling-ui");
  assert.match(text, /Read `\$SKILL\/upstream\/wayfinder\.md` \(same folder\) and follow it, with these changes:/);
  assert.doesNotMatch(text, /\.\.\//);
});

test("wayfinder-ui: chart mode, finish, work mode and hub commands", () => {
  const text = read("wayfinder-ui");
  for (const s of ["--phase destination", "--phase ticket", "--map-key", "finished", '"kind": "map"', '"kind": "no-map"', "map-patch", "one ticket", "claim --release", "research"]) assert.ok(text.includes(s), `mentions ${s}`);
  assert.match(text, /finish profile \*\*wayfinder\*\*/);
  // hub commands run through grilling-ui's folder, and each is a real subcommand
  const cmds = subcommands();
  const used = [...text.matchAll(/node "\$ENGINE\/hub\.mjs" ([a-z][a-z-]*)/g)].map((m) => m[1]);
  for (const c of ["map-patch", "claim"]) assert.ok(used.includes(c), `runs ${c}`);
  for (const c of used) assert.ok(cmds.has(c), `${c} is a hub.mjs subcommand`);
  const bare = [...text.matchAll(/(.{0,16})hub\.mjs/g)].filter((m) => !m[1].endsWith('"$ENGINE/'));
  assert.deepEqual(bare.map((m) => m[0]), []);
  assert.match(text, /No design doc in either mode/);
});

// ---- Codex agents/openai.yaml sidecars (T27; spec §2, §5b) ----
// Field names verified against openai/codex (research clone at b35a7af):
//   codex-rs/ext/skills/src/loader/mod.rs:20-21   SKILLS_METADATA_DIR = "agents", SKILLS_METADATA_FILENAME = "openai.yaml"
//   codex-rs/ext/skills/src/loader/metadata.rs:28-34  SkillMetadataFile { interface, dependencies, policy }
//   codex-rs/ext/skills/src/loader/metadata.rs:51-53  Policy { allow_implicit_invocation: Option<bool> }
//   codex-rs/skills/src/interface.rs:10-22        SkillInterfaceFile { display_name (≤ 64 chars), short_description (≤ 1024), … }
// Convention: Pocock's .agents/invocation.md (policy block only on skills hidden from the model).

// Tiny YAML reader for the two-level maps these files use: { section: { key: value } }.
function readYaml(text) {
  const out = {}; let section = null;
  for (const raw of text.split("\n")) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const m = /^( *)([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(raw);
    assert.ok(m, `parsable YAML line: ${JSON.stringify(raw)}`);
    const [, indent, key, val] = m;
    const v = val === "" ? undefined : /^".*"$/.test(val) ? JSON.parse(val) : val === "true" ? true : val === "false" ? false : val;
    if (indent.length === 0) { assert.equal(v, undefined, `top-level ${key} is a map`); section = out[key] = {}; }
    else { assert.equal(indent.length, 2, "two-space indent"); assert.ok(section, "nested key under a section"); section[key] = v; }
  }
  return out;
}
const sidecar = (skill) => readYaml(readFileSync(join(SKILLS, skill, "agents", "openai.yaml"), "utf8"));

test("openai.yaml: grilling-ui is hidden from implicit invocation", () => {
  assert.deepEqual(sidecar("grilling-ui"), {
    interface: { display_name: "Grilling UI (engine)", short_description: "Browser transport for the -ui grill skills" },
    policy: { allow_implicit_invocation: false },
  });
});

for (const [skill, name] of [["grill-me-ui", "Grill Me (UI)"], ["grill-docs-ui", "Grill With Docs (UI)"], ["wayfinder-ui", "Wayfinder (UI)"]]) {
  test(`openai.yaml: ${skill} has a display name and no policy block`, () => {
    const y = sidecar(skill);
    assert.deepEqual(Object.keys(y), ["interface"], "only an interface block (model-invocable by its ui triggers)");
    assert.equal(y.interface.display_name, name);
    assert.equal(typeof y.interface.short_description, "string");
    assert.ok(y.interface.short_description.length > 10 && y.interface.short_description.length <= 1024);
    assert.deepEqual(Object.keys(y.interface).sort(), ["display_name", "short_description"]);
  });
}
