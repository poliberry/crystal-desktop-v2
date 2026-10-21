#!/usr/bin/env bun
/**
 * Publishes the remade cosmetics rendered by scripts/render-cosmetics.mjs and repoints everything that uses the old ones.
 *
 *   bun scripts/publish-cosmetic-remakes.mjs --review a,b,c     record that these renders were looked at (all: --review all)
 *   bun scripts/publish-cosmetic-remakes.mjs --dry              upload nothing; say what would be repointed
 *   bun scripts/publish-cosmetic-remakes.mjs                    upload, verify, repoint (the dev deployment)
 *   bun scripts/publish-cosmetic-remakes.mjs --prod             the same against production
 *   ... --version v3                                            a later set (rendered with --out public/cosmetic-remakes/v3);
 *                                                               it replaces what earlier versions published for its slugs
 *
 * Refuses anything that failed the calm-motion check or was not reviewed as rendered: `--review` stores each file's
 * SHA-256, and a file that has changed since must be looked at again. Each file goes to a new, content-addressed key,
 * `marketplace/cosmetics/<version>/<slug>-<hash>.<ext>`, which is never overwritten (see convex/cosmeticRemake.ts).
 * Old files are not deleted.
 *
 * An effect or decoration also needs its stacked-alpha MP4 for Android (scripts/cosmetics/stacked.mjs). It is not part
 * of what is reviewed: it is decoded and compared with the reviewed WebM here instead, frame by frame.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { checkStacked } from "./cosmetics/stacked.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const version = arg("version") ?? "v2";
const dir = join(root, "public/cosmetic-remakes", version);
const prod = args.includes("--prod");
const dry = args.includes("--dry");
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
const reviewFile = join(dir, "review.json");
const review = existsSync(reviewFile) ? JSON.parse(readFileSync(reviewFile, "utf8")) : {};

const sha = (file) => createHash("sha256").update(readFileSync(join(dir, file))).digest("hex");
/** What is looked at and approved. */
const reviewedFiles = (item) => [item.video, item.hevc, item.poster].filter(Boolean);
const filesOf = (item) => [...reviewedFiles(item), item.stacked].filter(Boolean);
const fingerprint = (item) => Object.fromEntries(reviewedFiles(item).map((f) => [f, sha(f)]));

if (arg("review")) {
  const list = arg("review") === "all" ? manifest.items.map((i) => i.slug) : arg("review").split(",");
  for (const slug of list) {
    const item = manifest.items.find((i) => i.slug === slug);
    if (!item) throw new Error(`No render called ${slug}.`);
    if (!item.flash.pass) throw new Error(`${slug} failed its check (${item.flash.problems.join("; ")}); it can't be approved.`);
    review[slug] = { at: new Date().toISOString(), files: fingerprint(item) };
  }
  writeFileSync(reviewFile, JSON.stringify(review, null, 2));
  console.log(`Reviewed: ${list.join(", ")}.`);
  process.exit(0);
}

// What each remake replaces. Listings are looked up by slug on the server (whatever they sell now is replaced); the
// extras are older copies of the same cosmetic that are still equipped or in a submission.
const CDN = "https://cdn-dev.usecrystal.app/marketplace/creations/user_35DsG2BjQqKsjQKNVE6cgdS6l9q/";
const LISTING = {
  "storm-chaser-effect": { skus: ["storm-chaser"], extra: [`${CDN}32e7d2a7a00bcefc84b8afc782f735df.webm`] },
  "starlight-effect": { skus: ["starlight"], extra: [`${CDN}e4d183aa69450618e32d8e26fc13c9ff.webm`, `${CDN}1a18e001d8e19cc6da58250521f98711.webm`], keepText: true },
  "night-sky-effect": { skus: ["night-sky"], keepText: true },
};
/** Collection decorations with no listing on this deployment: published, and swapped in wherever one is equipped. */
const UNLISTED = new Set(["laurel", "lightning-corners", "flame-ring", "frost", "crystal-cluster", "pixel-frame", "horns"]);

const items = manifest.items;
const problems = [];
for (const item of items) {
  if (!item.flash.pass) problems.push(`${item.slug}: failed its check`);
  else if (!review[item.slug]) problems.push(`${item.slug}: not reviewed`);
  else if (JSON.stringify(review[item.slug].files) !== JSON.stringify(fingerprint(item))) problems.push(`${item.slug}: re-rendered since it was reviewed`);
  if (!item.hevc) problems.push(`${item.slug}: has no HEVC copy for Safari`);
  if (item.kind !== "nameplate") {
    if (!item.stacked) problems.push(`${item.slug}: has no stacked-alpha copy for Android`);
    else for (const p of checkStacked("ffmpeg", join(dir, item.video), join(dir, item.stacked), item)) problems.push(`${item.slug}: ${p}`);
  }
}
if (problems.length) {
  console.error(`Not publishing:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

const convex = (fn, payload) => {
  const res = spawnSync("npx", ["convex", "run", ...(prod ? ["--prod"] : []), fn, JSON.stringify(payload)], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`${fn} failed:\n${res.stderr || res.stdout}`);
  return JSON.parse(res.stdout.slice(res.stdout.search(/[[{]/)));
};

const ext = (file) => file.split(".").pop();
const keyOf = (item, file) => `marketplace/cosmetics/${version}/${item.slug}-${sha(file).slice(0, 16)}.${ext(file)}`;
const uploads = items.flatMap((item) => filesOf(item).map((file) => ({ item, file, key: keyOf(item, file), bytes: readFileSync(join(dir, file)).byteLength })));

let urls = new Map();
if (dry) {
  // The public address is the CDN base and the key; the server's own idea of the base is used for the real thing.
  for (const u of uploads) urls.set(u.key, `https://cdn-dev.usecrystal.app/${u.key}`);
} else {
  const signed = [];
  for (let i = 0; i < uploads.length; i += 40) signed.push(...convex("cosmeticRemake:presignUploads", { files: uploads.slice(i, i + 40).map(({ key, bytes }) => ({ key, bytes })) }));
  for (const s of signed) {
    const u = uploads.find((x) => x.key === s.key);
    urls.set(s.key, s.publicUrl);
    if (s.exists) {
      console.log(`exists   ${s.key}`);
      continue;
    }
    const body = readFileSync(join(dir, u.file));
    const res = await fetch(s.uploadUrl, { method: "PUT", body, headers: s.headers });
    if (!res.ok) throw new Error(`Uploading ${s.key} failed (${res.status}): ${await res.text()}`);
    console.log(`uploaded ${s.key} (${(body.byteLength / 1024).toFixed(0)} KB)`);
  }
  // Read every file back from the CDN before anything points at it.
  for (const u of uploads) {
    const url = urls.get(u.key);
    const res = await fetch(url, { cache: "no-store" });
    const body = new Uint8Array(await res.arrayBuffer());
    const digest = createHash("sha256").update(body).digest("hex");
    if (!res.ok || digest !== sha(u.file)) throw new Error(`${url} does not serve what was uploaded (${res.status}).`);
  }
  console.log(`All ${uploads.length} files verified on the CDN.`);
}

const payloadOf = (item) => {
  const at = (file) => urls.get(keyOf(item, file));
  const tags = [
    ...(item.refract ? [`refract=${item.refract}`] : []),
    `cosmetic-poster=${encodeURIComponent(at(item.poster))}`,
    `cosmetic-loop=${item.loopFrom}`,
    `cosmetic-hevc=${encodeURIComponent(at(item.hevc))}`,
    ...(item.stacked ? [`cosmetic-stacked=${encodeURIComponent(at(item.stacked))}`] : []),
  ];
  return `${at(item.video)}#${tags.join("&")}`;
};
// A remake can itself be remade under a later version (a design redrawn after review): whatever an earlier version
// published for the same slug is replaced too, wherever it is still referenced. (The server skips sources under the
// version being published, so only older remakes are claimed.)
const superseded = new Map();
for (const other of readdirSync(join(root, "public/cosmetic-remakes"))) {
  const file = join(root, "public/cosmetic-remakes", other, "published.json");
  if (other === version || !existsSync(file)) continue;
  const { prod: wasProd, items: earlier = [] } = JSON.parse(readFileSync(file, "utf8"));
  if (!!wasProd !== prod) continue;
  for (const e of earlier) {
    const list = superseded.get(e.slug) ?? [];
    list.push(e.payload.split("#", 1)[0]);
    superseded.set(e.slug, list);
  }
}
const repointItems = items.map((item) => {
  const listing = LISTING[item.slug];
  const kind = item.kind === "nameplate" ? "nameplate" : item.kind === "effect" ? "profileEffect" : "avatarDecoration";
  const skuSlugs = listing?.skus ?? (UNLISTED.has(item.slug) ? [] : [item.slug]);
  const sources = [...(listing?.extra ?? []), ...(superseded.get(item.slug) ?? []), ...(kind === "avatarDecoration" ? [`builtin:${item.slug}`] : [])];
  return { slug: item.slug, kind, sources, payload: payloadOf(item), posterUrl: urls.get(keyOf(item, item.poster)), skuSlugs, ...(listing?.keepText ? {} : { name: item.name, description: item.description }) };
});
const result = convex("cosmeticRemake:repoint", { items: repointItems, version, dryRun: dry });
console.log(JSON.stringify(result, null, 2));
writeFileSync(join(dir, dry ? "publish-plan.json" : "published.json"), JSON.stringify({ at: new Date().toISOString(), prod, items: repointItems, result }, null, 2));
