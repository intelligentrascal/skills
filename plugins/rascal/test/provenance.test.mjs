import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { PLUGIN } from "./manifest.test.mjs";

const SKILLS = join(PLUGIN, "skills");
const pins = JSON.parse(readFileSync(join(PLUGIN, "sources.json"), "utf8")).sources;
// rascal-grilling-ui is a byte-identical mirror of intelligentrascal's transport (sync-transport); it carries no provenance.
const MIRRORED = new Set(["rascal-grilling-ui"]);

function* files(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!(dir === SKILLS && MIRRORED.has(e.name))) yield* files(p); }
    else yield p;
  }
}
const LINE = /^(?:<!--|#|\/\/) (provenance|graft): (\S+) (\S+) @ ([0-9a-f]{40})(?: -> (.+?))?(?: -->)?$/;
export const provenanceOf = (text) => text.split("\n").map((l) => LINE.exec(l.trim())).filter(Boolean)
  .map(([, kind, source, path, commit, target]) => ({ kind, source, path, commit, target }));

test("every provenance/graft line names a pinned source at its pinned commit", () => {
  for (const f of files(SKILLS)) {
    const text = readFileSync(f, "utf8");
    for (const p of provenanceOf(text)) {
      const where = `${relative(SKILLS, f)}: ${p.kind} ${p.source} ${p.path}`;
      assert.ok(pins[p.source], `${where}: source not in sources.json`);
      assert.equal(p.commit, pins[p.source].commit, `${where}: commit is not the pin`);
      if (p.kind === "graft") {
        assert.ok(p.target, `${where}: graft without "-> <heading>"`);
        assert.ok(text.split("\n").some((l) => l.trim() === p.target), `${where}: target heading "${p.target}" not in file`);
      }
    }
  }
});

test("no rascal skill file references an upstream plugin namespace", () => {
  for (const f of files(SKILLS)) {
    const text = readFileSync(f, "utf8");
    assert.doesNotMatch(text, /superpowers:|mattpocock-skills:|\/setup-matt-pocock-skills/, relative(SKILLS, f));
  }
});

// Expected provenance per file: "<kind> <source> <path>". Each later task adds its files here.
export const EXPECT = {
  "rascal-grilling/SKILL.md": ["provenance pocock skills/productivity/grilling/SKILL.md"],
  "rascal-domain-modeling/SKILL.md": ["provenance pocock skills/engineering/domain-modeling/SKILL.md"],
  "rascal-tdd/SKILL.md": ["provenance pocock skills/engineering/tdd/SKILL.md"],
  "rascal-tdd/mocking.md": ["provenance pocock skills/engineering/tdd/mocking.md"],
  "rascal-tdd/tests.md": ["provenance pocock skills/engineering/tdd/tests.md"],
  "rascal-debugging/SKILL.md": ["provenance superpowers skills/systematic-debugging/SKILL.md"],
  "rascal-debugging/root-cause-tracing.md": ["provenance superpowers skills/systematic-debugging/root-cause-tracing.md"],
  "rascal-debugging/defense-in-depth.md": ["provenance superpowers skills/systematic-debugging/defense-in-depth.md"],
  "rascal-debugging/condition-based-waiting.md": ["provenance superpowers skills/systematic-debugging/condition-based-waiting.md"],
  "rascal-debugging/condition-based-waiting-example.ts": ["provenance superpowers skills/systematic-debugging/condition-based-waiting-example.ts"],
  "rascal-debugging/find-polluter.sh": ["provenance superpowers skills/systematic-debugging/find-polluter.sh"],
};

test("each derived file carries exactly its expected provenance", () => {
  for (const [file, want] of Object.entries(EXPECT)) {
    const got = provenanceOf(readFileSync(join(SKILLS, file), "utf8")).map((p) => `${p.kind} ${p.source} ${p.path}`);
    assert.deepEqual(got.sort(), [...want].sort(), file);
  }
});
