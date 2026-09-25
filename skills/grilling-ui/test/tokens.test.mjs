// skills/grilling-ui/test/tokens.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../page/tokens.css", import.meta.url), "utf8");
const tok = Object.fromEntries([...css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const pairs = [["ink", "bg", 4.5], ["ink", "panel", 4.5], ["ink-2", "bg", 4.5], ["ink-2", "panel", 4.5], ["accent", "panel", 4.5], ["ok", "ok-soft", 4.5], ["stage", "stage-soft", 4.5], ["ink-3", "panel", 3.0]];
test("token pairings meet contrast", () => {
  for (const [fg, bg, min] of pairs) { assert.ok(tok[fg] && tok[bg], `missing --${fg} or --${bg}`); assert.ok(ratio(tok[fg], tok[bg]) >= min, `--${fg} on --${bg} = ${ratio(tok[fg], tok[bg]).toFixed(2)} < ${min}`); }
  assert.ok(ratio("#ffffff", tok.accent) >= 4.5, "white on --accent");
});
test("no network, no italic headings, focus-visible and reduced motion present", () => {
  assert.doesNotMatch(css, /@import|url\(\s*["']?https?:/);
  assert.match(css, /:focus-visible/); assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /h1[^{]*\{[^}]*font-style:\s*normal/);
});
