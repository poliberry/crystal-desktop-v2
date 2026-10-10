#!/usr/bin/env bun
/**
 * Runs every `*.test.mts` in this folder, one after another, and fails if any does. Each test is a
 * plain script that prints `ALL PASSED (n)` or the failures and sets its exit code, so there is no
 * framework to install.
 *
 *   bun scripts/tests/run-all.mjs            everything
 *   bun scripts/tests/run-all.mjs bot        only tests whose name contains "bot"
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const only = process.argv[2];
const tests = readdirSync(here)
  .filter((f) => f.endsWith(".test.mts") && (!only || f.includes(only)))
  .sort();

let failed = 0;
for (const t of tests) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [join(here, t)], { encoding: "utf8", env: { ...process.env, FORCE_COLOR: "0" } });
  const lines = `${r.stdout}${r.stderr}`.trim().split("\n");
  const summary = lines[lines.length - 1] ?? "";
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"}  ${t.replace(".test.mts", "").padEnd(16)} ${summary}  (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  if (!ok) console.log(lines.slice(0, 30).map((l) => "      " + l).join("\n"));
}
console.log(failed ? `\n${failed} of ${tests.length} test files failed` : `\nAll ${tests.length} test files passed`);
process.exit(failed ? 1 : 0);
