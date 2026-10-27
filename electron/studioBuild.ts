import type * as esbuild from "esbuild";
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * esbuild, loaded on first use and pointed at its real binary.
 *
 * esbuild runs a native program, found with `require.resolve`. In the packaged app that resolves *inside* `app.asar` (Electron
 * answers with the archive path even for a file that is unpacked beside it), and esbuild then `spawn`s that path, which fails
 * with ENOTDIR: Electron redirects asar paths for `execFile`, not for `spawn`. The binary is shipped unpacked (see
 * `asarUnpack` in electron-builder.yml), so the fix is to tell esbuild where it really is. It reads `ESBUILD_BINARY_PATH` when
 * it is loaded, which is why this is a lazy `require` and not an `import` at the top of the file. (The literal
 * `require("esbuild")` is also what scripts/stage-app.mjs looks for to ship the package.)
 */
let esbuildModule: typeof esbuild | null = null;
function loadEsbuild(): typeof esbuild {
  if (esbuildModule) return esbuildModule;
  if (!process.env.ESBUILD_BINARY_PATH) {
    try {
      const pkgJson = require.resolve("esbuild/package.json");
      if (pkgJson.includes("app.asar")) {
        // The platform package is found the way esbuild itself finds it: looking from esbuild's own folder, which reaches the
        // copy nested inside it before any other. That matters: another package's (Convex's) older esbuild can leave a
        // different version of the same platform package hoisted above, and esbuild refuses to run a binary whose version
        // isn't its own ("Host version does not match binary version" - which surfaces as "The service is no longer running").
        const fromEsbuild = path.dirname(pkgJson);
        const platform = `${process.platform}-${process.arch}`;
        const rel = process.platform === "win32" ? "esbuild.exe" : "bin/esbuild";
        const inAsar = require.resolve(`@esbuild/${platform}/${rel}`, { paths: [fromEsbuild] });
        const real = inAsar.replace("app.asar", "app.asar.unpacked");
        if (fs.existsSync(real)) process.env.ESBUILD_BINARY_PATH = real;
      }
    } catch {
      /* leave it to esbuild, which will say what it couldn't find */
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  esbuildModule = require("esbuild") as typeof esbuild;
  return esbuildModule;
}

/**
 * Turning an extension's TypeScript project into the one plain script the sandbox runs.
 *
 * The sandbox executes a single script with no module loader, so the project's own files are
 * bundled together (esbuild strips the types — checking them is the editor's job, and is done
 * there with the TypeScript service) and written to `dist/extension.js`. That compiled script,
 * not the TypeScript, is what is scanned, hashed, reviewed and shipped.
 *
 * What may be bundled is decided here, not by esbuild: every import is resolved by the plugin
 * below. Allowed: relative imports of files that really are inside the project's `src` folder, and
 * the one package "@crystal/extension", which is Crystal's own SDK copied into the project at
 * `.crystal/sdk/extension` — both checked on the real path, so a symlink in the project can't lead
 * out of them. Any other package import is refused with an explanation rather than being fetched
 * from `node_modules`, because third-party code would otherwise be bundled in unread.
 */

const MAX_FILE = 1024 * 1024;
const MAX_FILES = 200;

export interface BuildError {
  file?: string;
  line?: number;
  column?: number;
  text: string;
}
export type BuildResult = { ok: true; code: string; bytes: number; files: number } | { ok: false; errors: BuildError[] };

const inside = (parent: string, child: string) => child === parent || child.startsWith(parent + path.sep);

export async function buildExtension(projectDir: string): Promise<BuildResult> {
  let srcDir: string;
  try {
    srcDir = fs.realpathSync(path.join(projectDir, "src"));
  } catch {
    return { ok: false, errors: [{ text: "There is no src folder to build." }] };
  }
  let sdkDir: string | null = null;
  try {
    sdkDir = fs.realpathSync(path.join(projectDir, ".crystal", "sdk", "extension"));
    // The SDK has to be where Crystal put it: a symlinked-in directory elsewhere isn't the SDK.
    if (!inside(fs.realpathSync(projectDir), sdkDir)) sdkDir = null;
  } catch {
    sdkDir = null;
  }
  const roots = sdkDir ? [srcDir, sdkDir] : [srcDir];
  const entry = path.join(srcDir, "index.ts");
  if (!fs.existsSync(entry)) return { ok: false, errors: [{ text: "There is no src/index.ts to build." }] };
  // Files are named by their place in the project ("src/util.ts"), never by their place on this
  // computer: esbuild writes each file's name into the bundle as a comment, and the bundle is what
  // gets submitted, so an absolute path would carry the author's username and folders with it.
  const label = (abs: string) => (sdkDir && inside(sdkDir, abs) ? `.crystal/sdk/extension/${path.relative(sdkDir, abs).split(path.sep).join("/")}` : `src/${path.relative(srcDir, abs).split(path.sep).join("/")}`);
  let files = 0;

  const projectOnly: esbuild.Plugin = {
    name: "project-only",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point") return { path: label(entry), namespace: "project", pluginData: { abs: entry } };
        if (args.path === "@crystal/extension") {
          if (!sdkDir) return { errors: [{ text: "The Crystal SDK isn't in this project. Reopen the project in Studio to install it." }] };
          const index = path.join(sdkDir, "index.ts");
          if (!fs.existsSync(index)) return { errors: [{ text: "The Crystal SDK in this project is incomplete. Reopen the project in Studio to repair it." }] };
          return { path: label(fs.realpathSync(index)), namespace: "project", pluginData: { abs: fs.realpathSync(index) } };
        }
        if (!args.path.startsWith("./") && !args.path.startsWith("../")) {
          return { errors: [{ text: `“${args.path}” can't be imported. An extension is one script that runs in a sandbox, so it can only import its own files, like “./helpers”, and “@crystal/extension”.` }] };
        }
        const base = path.resolve(args.resolveDir || srcDir, args.path);
        // `./util.js` is how TypeScript spells an import of util.ts.
        const stem = base.replace(/\.(m?js)$/, "");
        for (const candidate of [base, `${base}.ts`, path.join(base, "index.ts"), `${stem}.ts`]) {
          try {
            if (!fs.statSync(candidate).isFile()) continue;
            const real = fs.realpathSync(candidate);
            if (!roots.some((r) => inside(r, real))) return { errors: [{ text: `“${args.path}” points outside the project's src folder.` }] };
            if (!/\.(ts|mts)$/.test(real)) continue;
            return { path: label(real), namespace: "project", pluginData: { abs: real } };
          } catch {
            /* try the next spelling */
          }
        }
        return { errors: [{ text: `Can't find “${args.path}”. Imports have to be TypeScript files inside src.` }] };
      });
      build.onLoad({ filter: /.*/, namespace: "project" }, (args) => {
        if (++files > MAX_FILES) return { errors: [{ text: `More than ${MAX_FILES} files were imported.` }] };
        const abs = (args.pluginData as { abs: string }).abs;
        const st = fs.statSync(abs);
        if (st.size > MAX_FILE) return { errors: [{ text: `${path.basename(abs)} is over 1 MB.` }] };
        return { contents: fs.readFileSync(abs, "utf8"), loader: "ts", resolveDir: path.dirname(abs) };
      });
    },
  };

  try {
    const result = await loadEsbuild().build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: "iife",
      target: "es2020",
      platform: "neutral",
      logLevel: "silent",
      legalComments: "none",
      absWorkingDir: srcDir,
      plugins: [projectOnly],
    });
    const out = result.outputFiles?.[0]?.text ?? "";
    return { ok: true, code: out, bytes: Buffer.byteLength(out), files };
  } catch (e) {
    const errors = ((e as esbuild.BuildFailure).errors ?? []).slice(0, 30).map((m) => ({
      text: m.text,
      file: m.location?.file?.replace(/^project:/, ""),
      line: m.location?.line,
      column: m.location ? m.location.column + 1 : undefined,
    }));
    return { ok: false, errors: errors.length ? errors : [{ text: e instanceof Error ? e.message : "The build failed." }] };
  }
}

export function registerStudioBuild(dirPath: (rel: string) => string, writeText: (rel: string, text: string) => void, isStudio: (sender: WebContents) => boolean) {
  ipcMain.handle("studio:build:extension", async (event: IpcMainInvokeEvent, folder: string): Promise<BuildResult> => {
    if (!isStudio(event.sender)) throw new Error("Not allowed.");
    const result = await buildExtension(dirPath(folder));
    // The compiled script goes where the workbench and the submission read it from.
    if (result.ok) writeText(`${folder}/dist/extension.js`, result.code);
    return result;
  });
}
