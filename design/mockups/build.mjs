// design/mockups/build.mjs — inline data.js into every *.template.html
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const data = readFileSync(join(here, "data.js"), "utf8");
for (const f of readdirSync(here).filter((n) => n.endsWith(".template.html"))) {
  const out = f.replace(".template.html", ".html");
  writeFileSync(join(here, out), readFileSync(join(here, f), "utf8").replace("/*__DATA__*/", () => data));
  console.log("wrote", out);
}
