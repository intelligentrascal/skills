// `url` and best-effort `open` (spec §6; plan T15, D1; §10 "open: skip rules, URL validation
// (session and map URLs), GRILL_OPENER").
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupHub, hubInfo, mkHome, run, runAsync, sleep, tmp, waitUntil } from "./helpers.mjs";
import { URL_RE, openerArgs, skipReason } from "../lib/open.mjs";
import { projectKey } from "../lib/home.mjs";

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
// An env that would really open: no GRILL_NO_OPEN, no SSH, a recording GRILL_OPENER, no grace wait.
function homeFor(t, extra = {}) {
  const dir = tmp("grill-opener-"), argv = join(dir, "argv.txt"), opener = join(dir, "opener.sh");
  writeFileSync(opener, `#!/bin/sh\nprintf '%s\\n' "$@" >> "${argv}"\n`); chmodSync(opener, 0o755);
  const h = mkHome({ GRILL_NO_OPEN: "", GRILL_OPENER: opener, GRILL_OPEN_GRACE_MS: "0", ...extra });
  delete h.env.SSH_CONNECTION;
  for (const [k, v] of Object.entries(extra)) if (v === undefined) delete h.env[k];
  t.after(() => cleanupHub(h.home));
  return { ...h, dir, opened: () => (existsSync(argv) ? readFileSync(argv, "utf8").split("\n").filter(Boolean) : []) };
}
const newIn = (env, cwd = tmp("grill-p-")) => JSON.parse(run(env, ["new", "--topic", "T"], { cwd }));
const openCli = async (env, args, opts) => { const r = await runAsync(env, ["open", ...args], opts); assert.equal(r.code, 0, r.err); return JSON.parse(r.out); };

test("skipReason: GRILL_NO_OPEN, ssh, linux without a display", () => {
  assert.equal(skipReason({ GRILL_NO_OPEN: "1" }, "darwin"), "GRILL_NO_OPEN");
  assert.equal(skipReason({ GRILL_NO_OPEN: "1", SSH_CONNECTION: "x" }, "linux"), "GRILL_NO_OPEN");
  assert.equal(skipReason({ SSH_CONNECTION: "1.2.3.4 5 6.7.8.9 22" }, "darwin"), "ssh");
  assert.equal(skipReason({}, "linux"), "no-display");
  assert.equal(skipReason({ DISPLAY: ":0" }, "linux"), null);
  assert.equal(skipReason({ WAYLAND_DISPLAY: "wayland-0" }, "linux"), null);
  assert.equal(skipReason({}, "darwin"), null);
  assert.equal(skipReason({}, "win32"), null);
  assert.equal(skipReason({ GRILL_NO_OPEN: "0" }, "darwin"), null);
});

test("URL_RE (D1): session and map URLs only", () => {
  for (const ok of ["http://127.0.0.1:4567/s/abc-1/", "http://127.0.0.1:4567/s/abc-1/studio", "http://127.0.0.1:1/s/20260925-101010-ab12/inbox",
    "http://127.0.0.1:4567/s/abc-1/brief", "http://127.0.0.1:4567/m/proj-1a2b3c4d/42/"]) assert.match(ok, URL_RE, ok);
  for (const no of ["http://127.0.0.1:4567/s/../", "http://127.0.0.1:4567/s/a/b/", "javascript:alert(1)", "http://127.0.0.1:1/s/a/brief?x",
    "http://127.0.0.1:1/s/a/brief#x", "http://127.0.0.1:1/s/a", "http://localhost:1/s/a/", "https://127.0.0.1:1/s/a/", "http://127.0.0.1/s/a/",
    "http://127.0.0.1:1/s/a/other", "http://127.0.0.1:1/m/p/42", "http://127.0.0.1:1/m/p/", "http://127.0.0.1:1/m/p/4/2/", "http://evil.example/s/a/",
    "http://127.0.0.1:1/s/a/\n", " http://127.0.0.1:1/s/a/", "http://127.0.0.1:1/s/a b/"]) assert.doesNotMatch(no, URL_RE, JSON.stringify(no));
});

test("openerArgs: macOS open, Linux xdg-open, Windows cmd start, GRILL_OPENER wins", () => {
  const u = "http://127.0.0.1:1/s/a/";
  assert.deepEqual(openerArgs(u, {}, "darwin"), ["open", [u]]);
  assert.deepEqual(openerArgs(u, {}, "linux"), ["xdg-open", [u]]);
  assert.deepEqual(openerArgs(u, {}, "win32"), ["cmd", ["/c", "start", "", u]]);
  assert.deepEqual(openerArgs(u, { GRILL_OPENER: "/x/y" }, "win32"), ["/x/y", [u]]);
});

test("url: session (bare and --ui), map (slug or full key); bad input exits 2", async (t) => {
  const { home, env } = homeFor(t);
  const cwd = tmp("grill-p-");
  const s = newIn(env, cwd);
  const port = hubInfo(home).port;
  assert.equal(run(env, ["url", "--session", s.session]), `http://127.0.0.1:${port}/s/${s.id}/`);
  assert.equal(run(env, ["url", "--session", s.session, "--ui", "studio"]), `http://127.0.0.1:${port}/s/${s.id}/studio`);
  const mp = await runAsync(env, ["map-patch", "--map", "42"], { cwd, input: JSON.stringify({ title: "M" }) });
  assert.equal(mp.code, 0, mp.err);
  const mapUrl = `http://127.0.0.1:${port}/m/${projectKey(cwd)}/42/`;
  assert.equal(run(env, ["url", "--map", "42"], { cwd }), mapUrl);
  assert.equal(run(env, ["url", "--map", `${projectKey(cwd)}/42`]), mapUrl);
  for (const [args, re] of [
    [["url"], /--session .* or --map/],
    [["url", "--session", s.session, "--map", "42"], /--session .* or --map/],
    [["url", "--session", s.session, "--ui", "fancy"], /--ui must be one of inbox\|brief\|studio/],
    [["url", "--map", "42", "--ui", "brief"], /--ui is for sessions/],
    [["url", "--map", "nope"], /no such map/],
    [["url", "--session", tmp("grill-empty-")], /not a grill session/],
  ]) {
    const r = await runAsync(env, args, { cwd });
    assert.equal(r.code, 2, `${args.join(" ")}: ${r.err}`); assert.match(r.err, re);
  }
});

test("open: GRILL_NO_OPEN and ssh skip with the url; nothing spawned", async (t) => {
  const { env, opened } = homeFor(t);
  const s = newIn(env);
  assert.deepEqual(await openCli({ ...env, GRILL_NO_OPEN: "1" }, ["--session", s.session]), { opened: false, reason: "GRILL_NO_OPEN", url: s.url });
  assert.deepEqual(await openCli({ ...env, SSH_CONNECTION: "a b c d" }, ["--session", s.session]), { opened: false, reason: "ssh", url: s.url });
  assert.deepEqual(opened(), []);
});

test("open: spawns GRILL_OPENER with exactly the url (session, --ui, map)", async (t) => {
  const { home, env, opened } = homeFor(t);
  const cwd = tmp("grill-p-");
  const s = newIn(env, cwd);
  assert.deepEqual(await openCli(env, ["--session", s.session]), { opened: true, url: s.url });
  assert.deepEqual(await openCli(env, ["--session", s.session, "--ui", "brief"]), { opened: true, url: `${s.url}brief` });
  assert.equal((await runAsync(env, ["map-patch", "--map", "7"], { cwd, input: JSON.stringify({ title: "M" }) })).code, 0);
  const mapUrl = `http://127.0.0.1:${hubInfo(home).port}/m/${projectKey(cwd)}/7/`;
  assert.deepEqual(await openCli(env, ["--map", "7"], { cwd }), { opened: true, url: mapUrl });
  assert.deepEqual(opened(), [s.url, `${s.url}brief`, mapUrl]);
});

test("open: a present tab (presence ping) or one seen in the last 120 s prevents opening", async (t) => {
  const { env, opened } = homeFor(t, { GRILL_PRESENCE_MS: "150" });
  const s = newIn(env);
  assert.equal((await fetch(`${s.url}presence?tab=t1`)).status, 204);
  assert.deepEqual(await openCli(env, ["--session", s.session]), { opened: false, reason: "tab-open", url: s.url });
  await sleep(250); // no longer counted, but seen within 120 s
  assert.equal((await (await fetch(`${s.url}clients`)).json()).count, 0);
  assert.deepEqual(await openCli(env, ["--session", s.session]), { opened: false, reason: "tab-open", url: s.url });
  assert.deepEqual(opened(), []);
});

test("open: right after a hub start, waits (≤ grace) for an existing tab to reconnect", async (t) => {
  const { home, env, opened } = homeFor(t, { GRILL_OPEN_GRACE_MS: "4000" });
  const s = newIn(env);
  // The hub just started (by `new`): open polls /clients; a tab pinging 400 ms later is seen.
  const started = Date.parse(hubInfo(home).started);
  const t0 = Date.now();
  const p = openCli(env, ["--session", s.session]);
  await sleep(400);
  await fetch(`${s.url}presence?tab=back`);
  assert.deepEqual(await p, { opened: false, reason: "tab-open", url: s.url });
  assert.ok(Date.now() - t0 < 3500, "stopped polling once the tab was seen (before the grace ran out)");
  assert.deepEqual(opened(), []);
  // No tab: it waits until hubStarted + grace, then opens.
  const s2 = newIn(env);
  const r = await openCli(env, ["--session", s2.session]);
  assert.equal(r.opened, true);
  assert.ok(Date.now() >= started + 4000 - 50, "waited out the grace period");
});

test("open: invalid url, failing opener, missing opener, hung opener killed", async (t) => {
  const { home, env, dir, opened } = homeFor(t, { GRILL_OPENER_TIMEOUT_MS: "1500" });
  const s = newIn(env);
  // A session folder whose name cannot be in a URL.
  const weird = join(tmp("grill-weird-"), "bad.name");
  cpSync(s.session, weird, { recursive: true });
  const bad = await openCli(env, ["--session", weird]);
  assert.equal(bad.opened, false); assert.equal(bad.reason, "invalid-url");
  assert.equal((await runAsync(env, ["url", "--session", weird])).code, 2);
  const fail = join(dir, "fail.sh"); writeFileSync(fail, "#!/bin/sh\nexit 3\n"); chmodSync(fail, 0o755);
  assert.deepEqual(await openCli({ ...env, GRILL_OPENER: fail }, ["--session", s.session]), { opened: false, reason: "opener-failed", url: s.url });
  assert.deepEqual(await openCli({ ...env, GRILL_OPENER: join(dir, "missing") }, ["--session", s.session]), { opened: false, reason: "opener-error", url: s.url });
  const pidFile = join(dir, "pid");
  const hang = join(dir, "hang.sh"); writeFileSync(hang, `#!/bin/sh\necho $$ > "${pidFile}"\nexec sleep 30\n`); chmodSync(hang, 0o755);
  const t0 = Date.now();
  assert.deepEqual(await openCli({ ...env, GRILL_OPENER: hang }, ["--session", s.session]), { opened: true, url: s.url });
  assert.ok(Date.now() - t0 < 5000, "returned at the time limit, not when the opener ended");
  // Under heavy load the shell may be killed before it wrote its pid; either way it is gone.
  if (existsSync(pidFile)) {
    const pid = Number(readFileSync(pidFile, "utf8"));
    await waitUntil(() => !alive(pid), 2000).catch(() => {});
    assert.equal(alive(pid), false, "the hung opener was killed");
  }
  assert.deepEqual(opened(), []);
  void home;
});
