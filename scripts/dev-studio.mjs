#!/usr/bin/env bun
/**
 * Runs Crystal Studio, the standalone application, in development.
 *
 *   bun run dev:studio       on its own: starts the Next dev server if none is running, then Studio
 *   bun dev                  runs this with --wait beside Crystal, so both apps start together
 *
 * Studio is a page of the same Next app, so it needs the dev server on :3000. Without `--wait` this reuses one that is
 * already running or starts one. With `--wait` the server is somebody else's (`bun dev` started it), so this only waits
 * for it, and for the Electron build `bun dev`'s Crystal makes, rather than racing either.
 *
 * Either way it says what it is waiting for, and gives up after two minutes with the reason, instead of sitting silent.
 *
 * Closing Studio's window quits Studio. Under `bun dev` that must not end the whole dev session, which stops when its
 * first process exits, so in `--wait` mode this stays alive afterwards; Crystal's Creator tab starts Studio again.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const URL = "http://localhost:3000";
const MAIN = "dist-electron/main.js";
const waitOnly = process.argv.includes("--wait");
const say = (m) => console.log(`[dev:studio] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const up = async () => {
  try {
    const r = await fetch(URL, { signal: AbortSignal.timeout(1500) });
    return r.status < 500;
  } catch {
    return false;
  }
};

let next = null;
if (waitOnly) {
  say(`waiting for the dev server on ${URL} (started by \`bun dev\`)…`);
} else {
  say("compiling the Electron main process…");
  const built = spawnSync("bunx", ["tsc", "-p", "electron/tsconfig.json"], { stdio: "inherit" });
  if (built.status !== 0) {
    say("the Electron build failed (above); not starting.");
    process.exit(built.status ?? 1);
  }
  if (await up()) {
    say(`using the dev server already running on ${URL}`);
  } else {
    say(`nothing on ${URL}; starting the Next dev server…`);
    next = spawn("bun", ["run", "dev:next"], { stdio: "inherit" });
    next.on("exit", (code) => {
      say(`the Next dev server stopped (${code}).`);
      process.exit(code ?? 1);
    });
  }
}

const started = Date.now();
let announced = 0;
while (!(await up())) {
  const waited = Math.round((Date.now() - started) / 1000);
  if (waited >= 120) {
    say(`${URL} never came up in 2 minutes. Run \`bun run dev:next\` on its own to see why.`);
    next?.kill();
    process.exit(1);
  }
  if (waited - announced >= 10) {
    announced = waited;
    say(`still waiting for ${URL} (${waited}s). The first page compiles on first request, which can take a while.`);
  }
  await sleep(1000);
}

if (waitOnly) {
  // Crystal's launcher compiles the main process before it waits for the server, so by now it is done or nearly: wait
  // for the file to exist and to stop changing, so Studio never loads half a build.
  let lastChange = Date.now();
  let lastSeen = 0;
  while (true) {
    const m = existsSync(MAIN) ? statSync(MAIN).mtimeMs : 0;
    if (m !== lastSeen) {
      lastSeen = m;
      lastChange = Date.now();
    }
    if (m && Date.now() - lastChange > 1500) break;
    if (Date.now() - started > 120_000) {
      say(`${MAIN} never appeared. Is Crystal's launcher (\`bun run dev:electron\`) running?`);
      process.exit(1);
    }
    await sleep(500);
  }
}

// The first request compiles the page; ask for Studio's now so the window doesn't open onto a blank wait.
say("warming up /studio…");
await fetch(`${URL}/studio`, { signal: AbortSignal.timeout(110_000) }).catch(() => {});

say("launching Crystal Studio.");
delete process.env.ELECTRON_RUN_AS_NODE;
const electron = spawn(require("electron"), ["."], {
  stdio: "inherit",
  env: { ...process.env, CRYSTAL_APP: "studio", ELECTRON_START_URL: URL },
});
const stop = () => {
  next?.kill();
  electron.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
electron.on("exit", (code) => {
  next?.kill();
  if (!waitOnly) process.exit(code ?? 0);
  say("Crystal Studio closed. Open it again from Crystal's Creator tab; this stays running so `bun dev` does too.");
});
// Keeps the process alive in --wait mode after Studio quits; killed with the rest of `bun dev`.
setInterval(() => {}, 1 << 30);
