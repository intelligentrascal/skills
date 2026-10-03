import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync, spawnSync as sp } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "smoke-agents.sh");
function fakeBin(agents) {
  const bin = mkdtempSync(join(tmpdir(), "smoke-bin-"));
  for (const [name, body] of Object.entries(agents)) { writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`); chmodSync(join(bin, name), 0o755); }
  return bin;
}
const run = (bin, args) => spawnSync(process.platform === "darwin" ? "/bin/bash" : "bash", [SCRIPT, ...args], { env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` }, encoding: "utf8" });

test("replied / no reply / skipped; exit 1 when any agent gave no reply", () => {
  const bin = fakeBin({ claude: "echo PONG", codex: "exit 3" });
  const p = run(bin, ["--agents", "claude codex nosuchagent", "--timeout", "10"]);
  assert.equal(p.status, 1, p.stderr);
  assert.match(p.stdout, /^claude\s+replied$/m);
  assert.match(p.stdout, /^codex\s+NO REPLY \(exit 3\)$/m);
  assert.match(p.stdout, /^nosuchagent\s+skipped \(not installed\)$/m);
  assert.match(p.stdout, /^logs: \//m);
});

test("all replied: exit 0; the prompt reaches the agent", () => {
  const bin = fakeBin({ pi: 'echo "got: $2"' });
  const p = run(bin, ["--agents", "pi", "--prompt", "hello there", "--expect", "got: hello there"]);
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /^pi\s+replied$/m);
});

test("timeout counts as no reply", () => {
  const bin = fakeBin({ opencode: "sleep 5; echo late" });
  const p = run(bin, ["--agents", "opencode", "--timeout", "1"]);
  assert.equal(p.status, 1);
  assert.match(p.stdout, /^opencode\s+NO REPLY/m);
});

test("bad option: exit 2", () => assert.equal(run(fakeBin({}), ["--nope"]).status, 2));

test("option without a value: exit 2", () => assert.equal(run(fakeBin({}), ["--prompt"]).status, 2));

test("non-zero exit with stdout is NO REPLY, even when the text matches", () => {
  const bin = fakeBin({ claude: "echo PONG; exit 4" });
  const p = run(bin, ["--agents", "claude"]);
  assert.equal(p.status, 1);
  assert.match(p.stdout, /^claude\s+NO REPLY \(exit 4\)$/m);
});

test("exit 0 without the expected text under the default prompt: WRONG REPLY, exit 1", () => {
  const bin = fakeBin({ claude: "echo hello" });
  const p = run(bin, ["--agents", "claude"]);
  assert.equal(p.status, 1);
  assert.match(p.stdout, /^claude\s+WRONG REPLY \(exit 0\)$/m);
});

test("--prompt without --expect: any non-empty stdout counts; empty does not", () => {
  const bin = fakeBin({ claude: "echo anything", codex: "true" });
  const p = run(bin, ["--agents", "claude codex", "--prompt", "hi"]);
  assert.match(p.stdout, /^claude\s+replied$/m);
  assert.match(p.stdout, /^codex\s+NO REPLY \(exit 0\)$/m);
});

test("--skill <name>: fixed skill prompt, expects the skill name back", () => {
  const bin = fakeBin({
    claude: `echo "$2" | sed -n 's/^Use the \\(.*\\) skill\\. Reply with exactly the value of its frontmatter name field and nothing else\\.$/\\1/p'`,
    pi: "echo wrong",
  });
  const p = run(bin, ["--agents", "claude pi", "--skill", "rascal-tdd"]);
  assert.match(p.stdout, /^claude\s+replied$/m);
  assert.match(p.stdout, /^pi\s+WRONG REPLY \(exit 0\)$/m);
  assert.equal(p.status, 1);
});

test("agent stdin is /dev/null", () => {
  const bin = fakeBin({ claude: "cat >/dev/null; echo PONG" });
  const p = spawnSync("bash", ["-c", `sleep 20 | "$0" "$1" --agents claude --timeout 5`, "/bin/bash", SCRIPT], { env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` }, encoding: "utf8", timeout: 15000 });
  assert.match(p.stdout, /^claude\s+replied$/m);
});

test("timeout kills the whole process group (no orphan)", () => {
  const marker = `smokemarker${process.pid}${Date.now()}`;
  const bin2 = fakeBin({ opencode: `/bin/bash -c 'sleep 31 & wait' ${marker} & wait` });
  const p = run(bin2, ["--agents", "opencode", "--timeout", "1"]);
  assert.equal(p.status, 1);
  assert.match(p.stdout, /^opencode\s+NO REPLY \(exit 142\)$/m);
  const q = sp("pgrep", ["-f", marker], { encoding: "utf8" });
  assert.equal(q.stdout.trim(), "", `orphans: ${q.stdout}`);
});
