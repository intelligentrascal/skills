import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { derive, REF_MAP } from "../derive.mjs";

function upstream(files) {
  const dir = mkdtempSync(join(tmpdir(), "derive-up-"));
  for (const [p, body] of Object.entries(files)) { mkdirSync(join(dir, p, ".."), { recursive: true }); writeFileSync(join(dir, p), body); }
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
  git("init", "-q"); git("add", "."); git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x");
  return { dir, commit: git("rev-parse", "HEAD") };
}
const out = () => mkdtempSync(join(tmpdir(), "derive-out-"));

test("markdown: name set, refs rewritten, provenance after frontmatter", () => {
  const up = upstream({ "skills/x/SKILL.md": "---\nname: x\ndescription: d\n---\n\nUse superpowers:test-driven-development here.\n" });
  const dest = join(out(), "rascal-x", "SKILL.md");
  derive({ source: "superpowers", path: "skills/x/SKILL.md", dest, name: "rascal-x", pins: { superpowers: { commit: up.commit } }, checkouts: { superpowers: up.dir } });
  assert.equal(readFileSync(dest, "utf8"),
    `---\nname: rascal-x\ndescription: d\n---\n<!-- provenance: superpowers skills/x/SKILL.md @ ${up.commit} -->\n\nUse rascal-tdd here.\n`);
});

test("strip-frontmatter puts provenance on line 1", () => {
  const up = upstream({ "a.md": "---\nname: a\n---\n# A\n" });
  const dest = join(out(), "a.md");
  derive({ source: "pocock", path: "a.md", dest, stripFrontmatter: true, pins: { pocock: { commit: up.commit } }, checkouts: { pocock: up.dir } });
  assert.equal(readFileSync(dest, "utf8"), `<!-- provenance: pocock a.md @ ${up.commit} -->\n# A\n`);
});

test("script: provenance after shebang, exec bit kept, sdd path rewritten", () => {
  const up = upstream({ "s/run": '#!/usr/bin/env bash\nsdd="$(cd "$(dirname "$0")/../../subagent-driven-development/scripts" && pwd)"\nbase="$root/.superpowers/sdd"\n' });
  chmodSync(join(up.dir, "s/run"), 0o755);
  const dest = join(out(), "run");
  derive({ source: "superpowers", path: "s/run", dest, pins: { superpowers: { commit: up.commit } }, checkouts: { superpowers: up.dir } });
  assert.equal(readFileSync(dest, "utf8"),
    `#!/usr/bin/env bash\n# provenance: superpowers s/run @ ${up.commit}\nsdd="$(cd "$(dirname "$0")" && pwd)"\nbase="$root/.rascal/sdd"\n`);
  assert.ok(statSync(dest).mode & 0o100);
});

test("ts: // provenance on line 1", () => {
  const up = upstream({ "e.ts": "export {};\n" });
  const dest = join(out(), "e.ts");
  derive({ source: "superpowers", path: "e.ts", dest, pins: { superpowers: { commit: up.commit } }, checkouts: { superpowers: up.dir } });
  assert.equal(readFileSync(dest, "utf8"), `// provenance: superpowers e.ts @ ${up.commit}\nexport {};\n`);
});

test("checkout not at the pin: throws, writes nothing", () => {
  const up = upstream({ "a.md": "x\n" });
  const dest = join(out(), "a.md");
  assert.throws(() => derive({ source: "pocock", path: "a.md", dest, pins: { pocock: { commit: "0".repeat(40) } }, checkouts: { pocock: up.dir } }), /sources.json pins/);
  assert.equal(existsSync(dest), false);
});

test("REF_MAP covers every superpowers: skill name rascal replaces", () => {
  const from = REF_MAP.map(([a]) => a);
  for (const s of ["test-driven-development", "systematic-debugging", "verification-before-completion", "requesting-code-review",
    "writing-plans", "executing-plans", "subagent-driven-development", "dispatching-parallel-agents", "brainstorming",
    "using-git-worktrees", "finishing-a-development-branch"]) assert.ok(from.includes(`superpowers:${s}`), s);
});
