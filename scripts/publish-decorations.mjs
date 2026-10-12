#!/usr/bin/env bun
/**
 * Publishes the Archive collection's avatar decorations to the CDN and points their SKUs at the files.
 *
 *   bun scripts/publish-decorations.mjs --dry     check everything, write nothing
 *   bun scripts/publish-decorations.mjs           the dev deployment
 *   bun scripts/publish-decorations.mjs --prod    production
 *
 * The artwork is code (src/lib/avatar-decoration-collection.ts), so it is built here and handed to the server action
 * `cosmeticCollection:publishDecorations`, which checks it, uploads it and updates the SKUs.
 */
import { spawnSync } from "node:child_process";

import { COLLECTION_PRESETS } from "../src/lib/avatar-decoration-collection.ts";

const dry = process.argv.includes("--dry");
const prod = process.argv.includes("--prod");
const args = JSON.stringify({ files: COLLECTION_PRESETS.map((p) => ({ key: p.key, svg: p.animatedSvg })), dryRun: dry });
const r = spawnSync("npx", ["convex", "run", "cosmeticCollection:publishDecorations", ...(prod ? ["--prod"] : []), args], { stdio: "inherit" });
process.exit(r.status ?? 1);
