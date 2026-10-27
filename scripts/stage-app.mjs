#!/usr/bin/env bun
/**
 * Lays out Crystal (and Crystal Studio, which is the same code) as a small app of its own in `.app-stage/`, for
 * electron-builder to package (`directories.app` in scripts/electron-builder-config.cjs).
 *
 * Why not package from the repo: electron-builder bundles every production dependency in the nearest package.json,
 * whatever `files` says, and this repo's are the whole web app's (Next, React, three.js, Monaco, Stripe, ...). The window
 * is the static export in `out/`, which has all of that compiled into it already, so shipping the packages as well put
 * about 900 MB of source nobody runs into every install. The main process itself loads a handful of packages.
 *
 * Which ones is not written down here: it is read from the compiled main process (`require("x")` in dist-electron), so a
 * package the code starts using is shipped, and one it stops using is dropped, with nothing to keep in step. What they
 * need in turn is found by walking their dependencies.
 *
 *   .app-stage/
 *     package.json     what electron-builder reads: name, version, author, main, and exactly those packages
 *     dist-electron/   the compiled main process and preload (not the installer's, which has its own folder)
 *     out/             the static export
 *     node_modules/    those packages and what they need, for this machine's platform
 *
 * Run after `bun run build` (which makes dist-electron/ and out/).
 */
import { builtinModules } from "node:module";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist-electron");
const out = join(root, ".app-stage");

for (const [what, path] of [["dist-electron/main.js", join(dist, "main.js")], ["out/index.html", join(root, "out", "index.html")]]) {
  if (!existsSync(path)) {
    console.error(`${what} is missing: run \`bun run build\` first.`);
    process.exit(1);
  }
}

const readPkg = (name) => {
  try {
    return JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8"));
  } catch {
    return null;
  }
};

/** The packages the compiled main process asks for by name: not Node's, not Electron's, not its own files. */
export function requiredPackages(files) {
  const found = new Set();
  const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);
  for (const text of files) {
    for (const [, spec] of text.matchAll(/\brequire\(\s*["']([^"'.][^"']*)["']\s*\)/g)) {
      if (builtins.has(spec) || builtins.has(spec.split("/")[0]) || spec.startsWith("node:") || spec === "electron") continue;
      // `convex/browser` is the package `convex`; `@scope/pkg/sub` is `@scope/pkg`.
      found.add(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);
    }
  }
  return [...found].sort();
}

const mainFiles = readdirSync(dist)
  .filter((f) => f.endsWith(".js"))
  .map((f) => readFileSync(join(dist, f), "utf8"));
const roots = requiredPackages(mainFiles);
const missing = roots.filter((n) => !readPkg(n));
if (missing.length) {
  console.error(`The main process requires ${missing.join(", ")}, which isn't installed: run \`bun install\`.`);
  process.exit(1);
}

// Everything those need, found by walking dependencies. An optional dependency that isn't installed is one for another
// platform (esbuild's per-OS binaries), which is exactly what should be left out.
const wanted = new Set();
const walk = (name) => {
  if (wanted.has(name)) return;
  const pkg = readPkg(name);
  if (!pkg) return;
  wanted.add(name);
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) walk(dep);
};
roots.forEach(walk);

const rootPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

writeFileSync(
  join(out, "package.json"),
  JSON.stringify(
    {
      name: rootPkg.name,
      version: rootPkg.version,
      description: rootPkg.description,
      author: rootPkg.author,
      homepage: rootPkg.homepage,
      main: rootPkg.main,
      dependencies: Object.fromEntries(roots.map((n) => [n, readPkg(n).version])),
    },
    null,
    2,
  ) + "\n",
);

// The installer is its own app (.installer-app); source maps are for debugging the build, not something to ship.
cpSync(dist, join(out, "dist-electron"), {
  recursive: true,
  filter: (src) => !/[\\/]dist-electron[\\/]installer([\\/]|$)/.test(src) && !src.endsWith(".map"),
});
cpSync(join(root, "out"), join(out, "out"), { recursive: true, filter: (src) => !src.endsWith(".map") });
for (const name of wanted) cpSync(join(root, "node_modules", name), join(out, "node_modules", name), { recursive: true });

// node-pty carries a prebuilt binary for every platform; the one for this machine is the only one that can run. (Builds are
// made natively on each OS in CI, so this machine is the target.)
const prebuilds = join(out, "node_modules", "node-pty", "prebuilds");
if (existsSync(prebuilds)) {
  const mine = `${process.platform}-${process.arch}`;
  for (const dir of readdirSync(prebuilds)) if (dir !== mine) rmSync(join(prebuilds, dir), { recursive: true, force: true });
}
// convex's command-line tool is the biggest thing in the package and is never loaded by `convex/browser` or `convex/server`.
for (const f of ["cli.bundle.cjs", "cli.bundle.cjs.map"]) rmSync(join(out, "node_modules", "convex", "dist", f), { force: true });

console.log(`staged .app-stage: ${roots.join(", ")} (${wanted.size} packages in all)`);
