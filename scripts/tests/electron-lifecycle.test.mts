import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..", "..");

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, d === undefined ? "" : JSON.stringify(d))); };

// Electron throws "cannot be called before the app is ready" if these run at
// module load. Switches are the opposite: they must run before ready. This
// guards the placement in electron/main.ts after the startup crash that took
// down both apps (configureHostResolver at module top level).
for (const file of ["electron/main.ts", "dist-electron/main.js"]) {
  const src = readFileSync(join(root, file), "utf8");
  const readyAt = src.indexOf("app.whenReady");
  ok(`${file} has a whenReady handler`, readyAt !== -1);
  if (readyAt === -1) continue;

  const calls = [...src.matchAll(/app\.configureHostResolver\(/g)].map((m) => m.index ?? -1);
  ok(`${file}: configureHostResolver is only called at/after ready (${calls.length} call(s))`, calls.every((i) => i > readyAt), calls);
}

console.log(f ? `\n${f} FAILED, ${p} passed` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
