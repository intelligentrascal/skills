// design/mockups/shoot.mjs — screenshot each mockup at 1440 and 390 px, fail on horizontal overflow.
// PLAYWRIGHT_PKG points at @playwright/test's index.mjs; PLAYWRIGHT_CHANNEL (e.g. "chrome") picks a
// system browser when Playwright's own build isn't installed.
const { chromium } = await import(process.env.PLAYWRIGHT_PKG || "@playwright/test");
import { mkdirSync } from "node:fs"; import { join, dirname } from "node:path"; import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url)); mkdirSync(join(here, "shots"), { recursive: true });
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}); let bad = 0;
for (const v of ["inbox", "brief", "studio"]) for (const w of [1440, 390]) {
  const page = await browser.newPage({ viewport: { width: w, height: w === 390 ? 844 : 900 } });
  await page.goto(pathToFileURL(join(here, `${v}.html`)).href);
  const over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (over) { console.log("OVERFLOW", v, w); bad++; }
  const out = join(here, "shots", `${v}-${w}.png`); await page.screenshot({ path: out, fullPage: true }); console.log(out); await page.close();
}
await browser.close(); process.exit(bad ? 1 : 0);
