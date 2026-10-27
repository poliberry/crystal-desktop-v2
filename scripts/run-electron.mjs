#!/usr/bin/env bun
/**
 * Launcher that runs the Electron binary for this project.
 *
 * Some environments export `ELECTRON_RUN_AS_NODE=1` (e.g. for other tooling),
 * which silently makes the Electron binary behave as plain Node.js and breaks
 * `require('electron')` in the main process. We explicitly strip that variable
 * so `bun run dev` / `bun start` always boot a real Electron window.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

delete process.env.ELECTRON_RUN_AS_NODE;

// In a plain Node context the `electron` package's main export is the path to
// the packaged Electron binary.
const electronBinary = require("electron");

const result = spawnSync(electronBinary, process.argv.slice(2), {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
