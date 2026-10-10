#!/usr/bin/env bun
/**
 * Build the website and publish it to Cloudflare Pages (project `crystal-web`, which serves
 * https://usecrystal.app).
 *
 *   bun scripts/deploy-web.mjs                 a preview, at https://preview.crystal-web-5bh.pages.dev
 *   bun scripts/deploy-web.mjs --production    the live site (branch `main`)
 *   bun scripts/deploy-web.mjs --skip-build    publish what is already in .next-web
 *
 * Always try a preview first: it is a separate URL, so a broken build never touches the live site.
 * A bad production deploy is undone from the Pages dashboard (Deployments → "Rollback to this
 * deployment") or by deploying an earlier build.
 *
 * What it does, and why:
 *  - builds into `.next-web` (NEXT_DIST_DIR), so it can run while `next dev` is using `.next`;
 *  - the build reads NEXT_PUBLIC_* from the environment / .env.local, which is what decides which
 *    Clerk instance and Convex deployment the site talks to. It prints them first, because
 *    publishing a build made against the wrong backend is the easy mistake;
 *  - leaves out Monaco (the code editor's files): that editor only runs in the desktop app;
 *  - needs `wrangler login` (or CLOUDFLARE_API_TOKEN) for the account that owns the project.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const production = args.has("--production");
const branch = production ? "main" : "preview";
const PROJECT = "crystal-web";
const out = join(root, ".next-web");

const run = (cmd, argv, env = {}) => {
  const r = spawnSync(cmd, argv, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) {
    console.error(`\n${cmd} ${argv.join(" ")} failed.`);
    process.exit(r.status ?? 1);
  }
};

// Which backend is this build for? next build reads .env.local itself; this just shows the same values.
const fromEnvFile = {};
if (existsSync(join(root, ".env.local"))) {
  for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
    const m = /^(NEXT_PUBLIC_(?:CONVEX_URL|CLERK_PUBLISHABLE_KEY))=(.*)$/.exec(line.trim());
    if (m) fromEnvFile[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
const convex = process.env.NEXT_PUBLIC_CONVEX_URL ?? fromEnvFile.NEXT_PUBLIC_CONVEX_URL ?? "(not set)";
const clerk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? fromEnvFile.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "(not set)";
console.log(`Target:  ${production ? "PRODUCTION https://usecrystal.app" : "preview (branch preview)"}`);
console.log(`Convex:  ${convex}`);
console.log(`Clerk:   ${clerk.slice(0, 8)}… (${clerk.startsWith("pk_live") ? "live" : "test"} instance)\n`);
if (production && (convex === "(not set)" || clerk === "(not set)")) {
  console.error("Refusing to publish a production build without NEXT_PUBLIC_CONVEX_URL and NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.");
  process.exit(1);
}

if (!args.has("--skip-build")) {
  rmSync(out, { recursive: true, force: true });
  run("bun", ["scripts/prepare-studio-assets.mjs"], { NEXT_DIST_DIR: ".next-web" });
  run("npx", ["next", "build"], { NEXT_DIST_DIR: ".next-web" });
}
for (const needed of ["index.html", "invite/index.html", "oauth/authorize/index.html", "_redirects", "_headers"]) {
  if (!existsSync(join(out, needed))) {
    console.error(`The build is missing ${needed}; not publishing.`);
    process.exit(1);
  }
}

const stage = mkdtempSync(join(tmpdir(), "crystal-web-"));
try {
  cpSync(out, stage, { recursive: true });
  rmSync(join(stage, "monaco"), { recursive: true, force: true });
  run("npx", ["wrangler", "pages", "deploy", stage, "--project-name", PROJECT, "--branch", branch, "--commit-dirty=true"]);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
