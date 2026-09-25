// Hub log with size rotation (decision D8). The hub is spawned with stdio "ignore" and writes its
// own log, so rotation never fights an inherited file descriptor.
//   logs/hub.log → hub.log.1 → hub.log.2 → hub.log.3 (oldest dropped), rotated at 1 MB.
import fs from "node:fs";
import path from "node:path";

export const LOG_MAX = 1024 * 1024;
export const LOG_KEEP = 3;

export function rotate(file, keep = LOG_KEEP) {
  fs.rmSync(`${file}.${keep}`, { force: true });
  for (let i = keep - 1; i >= 1; i--) {
    try { fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`); } catch { /* gap: fine */ }
  }
  try { fs.renameSync(file, `${file}.1`); } catch { /* nothing to rotate */ }
}

// Returns log(...parts): appends "<ISO> <text>\n". Never throws (logging must not kill the hub).
export function createLog(file, { max = LOG_MAX, keep = LOG_KEEP } = {}) {
  let size = 0;
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch { /* reported by the first append */ }
  try { size = fs.statSync(file).size; } catch { size = 0; }
  return function log(...parts) {
    const line = `${new Date().toISOString()} ${parts.map((p) => (typeof p === "string" ? p : p instanceof Error ? p.stack || p.message : JSON.stringify(p))).join(" ")}\n`;
    try {
      if (size > 0 && size + Buffer.byteLength(line) > max) { rotate(file, keep); size = 0; }
      fs.appendFileSync(file, line);
      size += Buffer.byteLength(line);
    } catch { /* disk full or unwritable: drop the line */ }
  };
}
