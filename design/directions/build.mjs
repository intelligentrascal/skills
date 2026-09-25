// design/directions/build.mjs: inline mockups/data.js into each dN/direction.template.html, then
// embed every document and its direction.json into shell.html → index.html (one self-contained file).
// Each direction stays a whole document (mounted as an iframe srcdoc) so the three design systems
// and keyboard layers can't bleed into each other. Pass --parts to also write dN/direction.html.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(here, ...p), "utf8");
const data = read("..", "mockups", "data.js");
// JSON is valid JS; escaping "<" keeps "</script>" and "<!--" inside the strings inert.
const js = (v) => JSON.stringify(v).replace(/</g, "\\u003c");

const dirs = readdirSync(here, { withFileTypes: true }).filter((e) => e.isDirectory() && /^d\d+$/.test(e.name)).map((e) => e.name).sort();
const docs = [], directions = [];
for (const d of dirs) {
  const src = read(d, "direction.template.html");
  if (!src.includes("/*__DATA__*/")) throw new Error(`${d}: no /*__DATA__*/ placeholder`);
  const doc = src.replace("/*__DATA__*/", () => data);
  if (process.argv.includes("--parts")) writeFileSync(join(here, d, "direction.html"), doc);
  docs.push(doc);
  directions.push(JSON.parse(read(d, "direction.json")));
}

const out = read("shell.html").replace("/*__DIRECTIONS__*/", () => `const DIRECTIONS = ${js(directions)};\nconst DOCS = ${js(docs)};`);
writeFileSync(join(here, "index.html"), out);
console.log(`wrote index.html (${(out.length / 1024).toFixed(0)} KB, ${docs.length} directions)`);
