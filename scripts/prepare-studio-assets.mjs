#!/usr/bin/env bun
/**
 * Things Crystal Studio's code workbench needs that an install doesn't leave in a usable state.
 *
 *  - Monaco is served from the app's own origin (public/monaco/vs), not a CDN, so the editor works
 *    offline and nothing about what a creator is writing is fetched from or sent to a third party.
 *    Only the parts used are copied: the editor, TypeScript/JSON language services, and the few
 *    syntax grammars the workbench opens.
 *  - The Crystal SDKs (`sdk/bot`, `sdk/extension`) are copied to public/studio-sdk/<name>/ with a
 *    manifest of their files, so Studio can install them into a new project without a network:
 *    a project gets its own copy of the SDK source, which it can read, step into and build with.
 *  - The written guides (src/studio/docs/content/*.md) are compiled into src/studio/docs/built-in.generated.ts
 *    (see scripts/build-guides.mjs), so a guide edited in Markdown is in the app on the next start.
 *  - The SDK reference (src/studio/docs/reference.generated.ts) is regenerated from the SDKs' source and doc
 *    comments (see scripts/build-reference.mjs), so it is never behind the SDK a project is given.
 *  - node-pty's `spawn-helper` has to be executable. Package managers that unpack from a cache drop
 *    the bit, and the symptom is a terminal that fails with "posix_spawnp failed".
 *
 * Idempotent; run by `postinstall` and before dev/build.
 */
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const src = join(root, "node_modules/monaco-editor/min/vs");
const dest = join(root, "public/monaco/vs");
if (existsSync(src)) {
  const stamp = join(dest, ".copied-from");
  const version = JSON.parse((await import("node:fs")).readFileSync(join(root, "node_modules/monaco-editor/package.json"), "utf8")).version;
  const done = existsSync(stamp) && (await import("node:fs")).readFileSync(stamp, "utf8") === version;
  if (!done) {
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    for (const part of ["loader.js", "editor", "base", "language/typescript", "language/json", "basic-languages/typescript", "basic-languages/javascript", "basic-languages/shell", "basic-languages/markdown"]) {
      if (existsSync(join(src, part))) {
        mkdirSync(dirname(join(dest, part)), { recursive: true });
        cpSync(join(src, part), join(dest, part), { recursive: true });
      }
    }
    (await import("node:fs")).writeFileSync(stamp, version);
    console.log(`[studio] copied Monaco ${version} to public/monaco/vs`);
  }
}

const prebuilds = join(root, "node_modules/node-pty/prebuilds");
if (existsSync(prebuilds)) {
  for (const platform of readdirSync(prebuilds)) {
    const helper = join(prebuilds, platform, "spawn-helper");
    if (existsSync(helper) && statSync(helper).isFile()) chmodSync(helper, 0o755);
  }
}

// --- The SDKs ---------------------------------------------------------------------------------
import { readFileSync, writeFileSync } from "node:fs";

for (const name of ["bot", "extension"]) {
  const from = join(root, "sdk", name);
  if (!existsSync(from)) continue;
  const to = join(root, "public/studio-sdk", name);
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  // Source and package.json only: the tsconfig beside them is for checking the SDK itself.
  const files = readdirSync(from).filter((f) => /\.(ts|json)$/.test(f) && !f.startsWith("tsconfig"));
  for (const f of files) cpSync(join(from, f), join(to, f));
  const version = JSON.parse(readFileSync(join(from, "package.json"), "utf8")).version;
  writeFileSync(join(to, "manifest.json"), JSON.stringify({ name, version, files }, null, 2));
}

// --- The guides ---------------------------------------------------------------------------------
import { writeGuides } from "./build-guides.mjs";

if (writeGuides()) console.log("[studio] compiled the guides");

// --- The SDK reference ----------------------------------------------------------------------------
// Read from the SDKs with the TypeScript compiler API, which is a dev dependency: a machine that installed only
// production dependencies keeps the committed copy rather than failing.
try {
  const { writeReference } = await import("./build-reference.mjs");
  if (writeReference()) console.log("[studio] compiled the SDK reference");
} catch (e) {
  if (e && e.code === "MODULE_NOT_FOUND") console.log("[studio] kept the committed SDK reference (typescript5 isn't installed)");
  else throw e;
}
