import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "smoke-agents.sh");
function fakeBin(agents) {
  const bin = mkdtempSync(join(tmpdir(), "smoke-bin-"));
  for (const [name, body] of Object.entries(agents)) { writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`); chmodSync(join(bin, name), 0o755); }
  return bin;
}
const run = (bin, args) => spawnSync("bash", [SCRIPT, ...args], { env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` }, encoding: "utf8" });

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
  const p = run(bin, ["--agents", "pi", "--prompt", "hello there"]);
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
