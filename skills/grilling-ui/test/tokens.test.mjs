// skills/grilling-ui/test/tokens.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../page/tokens.css", import.meta.url), "utf8");
const root = css.match(/:root\s*\{([^}]*)\}/)[1];
const tok = Object.fromEntries([...root.matchAll(/--([a-z0-9-]+):\s*([^;]+);/gi)].map((m) => [m[1], m[2].trim()]));
const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hex = (k) => (k.startsWith("#") ? k : tok[k]);

// Jason Ku's page.html:8-13, exactly (plan execution note E1: the Inbox is Jason's look).
const JASON = {
  bg: "#f7f4ee", panel: "#ffffff", ink: "#1f1c18", "ink-2": "#625b51", "ink-3": "#9a9285",
  rule: "#e6e0d4", accent: "#9a3a26", ok: "#3d6b4a", "ok-soft": "#e3eee5", stage: "#b8791f", "stage-soft": "#f8ecd2", "warn-soft": "#fbe9e4",
  serif: '"Iowan Old Style", Charter, Georgia, serif',
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
};
test("colour and font tokens equal Jason's page.html values", () => {
  for (const [k, v] of Object.entries(JASON)) assert.equal(tok[k], v, `--${k}`);
  for (const k of ["focus", "mono", "r1", "r2", "s1", "s2", "s3", "s4", "s5", "s6"]) assert.ok(tok[k], `--${k} kept`);
});

// Real pairings that meet WCAG: [fg, bg, min].
const pairs = [["ink", "bg", 4.5], ["ink", "panel", 4.5], ["ink-2", "bg", 4.5], ["ink-2", "panel", 4.5], ["accent", "panel", 4.5], ["#ffffff", "accent", 4.5], ["ok", "ok-soft", 4.5], ["ink-3", "panel", 3.0]];
// Documented exceptions (tokens.css header): pairings Jason's exact look keeps below the bar.
// Each one is asserted to still be below it, with its ratio pinned, so any change is deliberate.
const exceptions = [["stage", "stage-soft", 4.5, 3.09], ["stage", "panel", 4.5, 3.63], ["ink-3", "bg", 3.0, 2.80], ["#ffffff", "ink-3", 4.5, 3.08]];
test("token pairings meet contrast", () => {
  for (const [fg, bg, min] of pairs) {
    assert.ok(hex(fg) && hex(bg), `missing --${fg} or --${bg}`);
    assert.ok(ratio(hex(fg), hex(bg)) >= min, `${fg} on ${bg} = ${ratio(hex(fg), hex(bg)).toFixed(2)} < ${min}`);
  }
});
test("sub-AA pairings are exactly the documented exceptions", () => {
  for (const [fg, bg, min, is] of exceptions) {
    const r = ratio(hex(fg), hex(bg));
    assert.ok(r < min, `${fg} on ${bg} now passes (${r.toFixed(2)}); drop it from the exceptions`);
    assert.equal(Number(r.toFixed(2)), is, `${fg} on ${bg}`);
    assert.match(css, new RegExp(`${fg.replace("#", "#?")}\\s+on\\s+-*${bg}\\s+${is.toFixed(1)}`), `exception ${fg} on ${bg} documented in tokens.css`);
  }
});
test("no network, no italic headings, focus-visible and reduced motion present", () => {
  assert.doesNotMatch(css, /@import|url\(\s*["']?https?:/);
  assert.match(css, /:focus-visible/); assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /h1[^{]*\{[^}]*font-style:\s*normal/);
});
test("base control rules are scoped away from Jason's look", () => {
  const scoped = css.match(/@scope \(html:not\(\[data-look="jason"\]\)\) \{([\s\S]*?)\n\}\n\n\/\* shared/);
  assert.ok(scoped, "@scope block present");
  for (const sel of [".opt.staged::after", "button.pending::after", "button:hover, .opt:hover", "h1, h2, h3, h4"]) {
    assert.ok(scoped[1].includes(sel), `${sel} inside the scope`);
    assert.ok(!css.slice(0, css.indexOf("@scope")).includes(sel), `${sel} not unscoped`);
  }
});
