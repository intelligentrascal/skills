// design/directions/build.mjs: inline mockups/data.js into each direction-N.template.html, then
// embed all three documents and directions.json into shell.html → index.html (one self-contained file).
// Each direction stays a whole document (mounted as an iframe srcdoc) so the three design systems
// and keyboard layers can't bleed into each other. Pass --parts to also write direction-N.html.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(here, ...p), "utf8");
const data = read("..", "mockups", "data.js");
// JSON is valid JS; escaping "<" keeps "</script>" and "<!--" inside the strings inert.
const js = (v) => JSON.stringify(v).replace(/</g, "\\u003c");

const templates = readdirSync(here).filter((n) => /^direction-\d+\.template\.html$/.test(n)).sort();
const docs = templates.map((f) => {
  const src = read(f);
  if (!src.includes("/*__DATA__*/")) throw new Error(`${f}: no /*__DATA__*/ placeholder`);
  const doc = src.replace("/*__DATA__*/", () => data);
  if (process.argv.includes("--parts")) writeFileSync(join(here, f.replace(".template", "")), doc);
  return doc;
});
const directions = JSON.parse(read("directions.json"));
if (directions.length !== docs.length) throw new Error(`directions.json has ${directions.length} entries, found ${docs.length} templates`);

const out = read("shell.html").replace("/*__DIRECTIONS__*/", () => `const DIRECTIONS = ${js(directions)};\nconst DOCS = ${js(docs)};`);
writeFileSync(join(here, "index.html"), out);
console.log(`wrote index.html (${(out.length / 1024).toFixed(0)} KB, ${docs.length} directions)`);
