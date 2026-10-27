#!/usr/bin/env bun
/**
 * Publishes the Archive collection's avatar decorations to the CDN and points their SKUs at the files.
 *
 *   bun scripts/publish-decorations.mjs --dry     check everything, write nothing
 *   bun scripts/publish-decorations.mjs           the dev deployment
 *   bun scripts/publish-decorations.mjs --prod    production
 *
 * Add `--only ice-cube,sakura` to publish just those. Without it, every decoration is published, which repoints the SKUs
 * of ones that are already on sale: say which you mean.
 *
 * The artwork is code (src/lib/avatar-decoration-collection.ts), so it is built here and handed to the server action
 * `cosmeticCollection:publishDecorations`, which checks it, uploads it and updates the SKUs.
 */
import { spawnSync } from "node:child_process";

import { COLLECTION_PRESETS } from "../src/lib/avatar-decoration-collection.ts";

const dry = process.argv.includes("--dry");
const prod = process.argv.includes("--prod");
const onlyArg = process.argv.indexOf("--only");
const only = onlyArg >= 0 ? process.argv[onlyArg + 1].split(",") : null;
if (!only && !process.argv.includes("--all")) {
  console.error("Say which decorations: --only key,key (or --all to publish and repoint every one).");
  process.exit(2);
}
const chosen = COLLECTION_PRESETS.filter((p) => !only || only.includes(p.key));
if (only && chosen.length !== only.length) {
  console.error(`Unknown decoration: ${only.filter((k) => !COLLECTION_PRESETS.some((p) => p.key === k)).join(", ")}`);
  process.exit(2);
}
const args = JSON.stringify({ files: chosen.map((p) => ({ key: p.key, svg: p.animatedSvg, ...(p.refract ? { refract: p.refract } : {}) })), dryRun: dry });
const r = spawnSync("npx", ["convex", "run", "cosmeticCollection:publishDecorations", ...(prod ? ["--prod"] : []), args], { stdio: "inherit" });
process.exit(r.status ?? 1);
