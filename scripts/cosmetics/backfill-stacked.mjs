#!/usr/bin/env bun
/**
 * Gives the remakes already published an Android copy: a new remake version holding, for every effect and decoration,
 * the latest reviewed render of it (byte for byte: its WebM, HEVC MP4 and poster) plus a stacked-alpha MP4 made from
 * its WebM (see ./stacked.mjs). Publishing that version then repoints everything to addresses that carry the new file.
 *
 *   bun scripts/cosmetics/backfill-stacked.mjs --into v5
 *   bun scripts/publish-cosmetic-remakes.mjs --version v5 --dry
 *   bun scripts/publish-cosmetic-remakes.mjs --version v5
 *
 * The review carries over only where the copied files are still exactly what was reviewed.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { checkStacked, makeStacked } from "./stacked.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const remakes = join(root, "public/cosmetic-remakes");
const args = process.argv.slice(2);
const into = args[args.indexOf("--into") + 1];
if (!args.includes("--into") || !/^v\d+$/.test(into ?? "")) throw new Error("Say which version to write: --into v<n>.");
const number = (v) => Number(v.slice(1));
const out = join(remakes, into);
if (existsSync(join(out, "manifest.json"))) throw new Error(`${into} already exists.`);

const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const versions = readdirSync(remakes).filter((v) => /^v\d+$/.test(v) && number(v) < number(into) && existsSync(join(remakes, v, "published.json"))).sort((a, b) => number(a) - number(b));

// The latest published render of each design.
const latest = new Map();
for (const v of versions) {
  const manifest = read(join(remakes, v, "manifest.json"));
  const review = read(join(remakes, v, "review.json"));
  const published = new Set(read(join(remakes, v, "published.json")).items.map((i) => i.slug));
  for (const item of manifest.items) if (published.has(item.slug)) latest.set(item.slug, { v, item, review: review[item.slug] });
}

mkdirSync(out, { recursive: true });
const items = [];
const review = {};
for (const { v, item, review: reviewed } of latest.values()) {
  if (item.kind === "nameplate") continue; // opaque: Android plays its WebM as it is
  const from = join(remakes, v);
  for (const file of [item.video, item.hevc, item.poster, item.sheet].filter(Boolean)) copyFileSync(join(from, file), join(out, file));
  const stacked = `${item.slug}.stacked.mp4`;
  makeStacked("ffmpeg", join(out, item.video), join(out, stacked), item);
  const problems = checkStacked("ffmpeg", join(out, item.video), join(out, stacked), item);
  if (problems.length) throw new Error(`${item.slug}: ${problems.join("; ")}`);
  const next = { ...item, stacked, stackedBytes: readFileSync(join(out, stacked)).byteLength, copiedFrom: v };
  items.push(next);
  const files = Object.fromEntries([item.video, item.hevc, item.poster].filter(Boolean).map((f) => [f, sha(join(out, f))]));
  if (reviewed && JSON.stringify(reviewed.files) === JSON.stringify(files)) review[item.slug] = { ...reviewed, carriedFrom: v };
  console.log(`${item.slug} (from ${v}): ${(next.stackedBytes / 1024).toFixed(0)} KB stacked${review[item.slug] ? "" : ", NOT REVIEWED"}`);
}
writeFileSync(join(out, "manifest.json"), JSON.stringify({ version: into, renderedAt: new Date().toISOString(), backfilledStacked: true, items }, null, 2));
writeFileSync(join(out, "review.json"), JSON.stringify(review, null, 2));
console.log(`${items.length} designs in ${into}.`);
