/**
 * What a new project is made of, written to a real folder and used: the bot starter type-checks against the SDK copy
 * in `.crystal/sdk/bot` exactly as the project's own tsconfig says, its handlers load, and the extension starter still
 * type-checks. Run: bun scripts/tests/scaffold.test.mts
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { Client } from "../../sdk/bot/index";
import { botHandlerFiles, commandTs, scaffoldFiles, sdkDirFor } from "../../src/studio/model/code-templates";
import { emptyBot } from "../../src/studio/model/types";
import { newProject } from "../../src/studio/storage/use-projects";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, d === undefined ? "" : String(d).slice(0, 1500))); };
const root = join(import.meta.dir, "../..");
const made: string[] = [];

function materialise(kind: "bot" | "extension", setup?: (p: ReturnType<typeof newProject>) => void) {
  const project = newProject(kind, "Test Thing");
  setup?.(project);
  const dir = mkdtempSync(join(tmpdir(), "crystal-scaffold-"));
  made.push(dir);
  for (const [rel, text] of Object.entries(scaffoldFiles(project, "https://usecrystal.app"))) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  cpSync(join(root, "sdk", kind), join(dir, sdkDirFor(kind)), { recursive: true });
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
  return { dir, project };
}
const tsc = (dir: string) => spawnSync(join(root, "node_modules/.bin/tsc"), ["-p", ".", "--noEmit"], { cwd: dir, encoding: "utf8" });

// --- a bot with commands in its settings -----------------------------------------------------------------
{
  const { dir } = materialise("bot", (pr) => { pr.bot = { ...emptyBot(), commands: [{ name: "hello", description: "Say hello" }, { name: "roll-dice", description: "Roll a die" }, { name: "Bad Name", description: "never" }] }; });
  const files = (await import("node:fs")).readdirSync(dir, { recursive: true }).map(String).filter((x) => !x.startsWith("node_modules"));
  ok("a command in the settings gets its own file, an invalid name doesn't", files.includes("src/commands/hello.ts") && files.includes("src/commands/roll-dice.ts") && !files.some((x) => /Bad/.test(x)), files.filter((x) => x.startsWith("src")));
  ok("the layout is index + events + commands + buttons", ["src/index.ts", "src/events/ready.ts", "src/events/error.ts", "src/events/messageCreate.ts", "src/buttons/thanks.ts"].every((x) => files.includes(x)));
  const r = tsc(dir);
  ok("the whole project type-checks with its own tsconfig against the SDK copy", r.status === 0, r.stdout + r.stderr);
  const c = new Client({ token: "t", apiUrl: "http://127.0.0.1:1/bot/v1" });
  const sdkUrl = pathToFileURL(join(dir, ".crystal/sdk/bot/index.ts")).href;
  void sdkUrl;
  const found = await c.loadHandlers(join(dir, "src"));
  ok("its handlers load: 3 events, 2 commands, 1 button", found.events.length === 3 && found.commands.length === 2 && found.buttons.length === 1, JSON.stringify({ e: found.events.map((e) => e.name), c: found.commands.map((x) => x.name), b: found.buttons.length }));
  ok("the commands are the ones from the settings, with their descriptions", found.commands.map((x) => `${x.name}:${x.description}`).sort().join() === "hello:Say hello,roll-dice:Roll a die");
  ok("the button answers the customId the message handler gives its button", found.buttons[0].customId === "thanks");
  ok("index.ts says where to put things", /src\/events\//.test(await Bun.file(join(dir, "src/index.ts")).text()) && /loadHandlers/.test(await Bun.file(join(dir, "src/index.ts")).text()));
  ok("the README says where things are", /Where things are/.test(await Bun.file(join(dir, "README.md")).text()));
}

// --- a bot with no commands --------------------------------------------------------------------------------
{
  const { dir } = materialise("bot");
  const r = tsc(dir);
  ok("a bot with no commands type-checks too", r.status === 0, r.stdout + r.stderr);
  const c = new Client({ token: "t", apiUrl: "http://127.0.0.1:1/bot/v1" });
  const found = await c.loadHandlers(join(dir, "src"));
  ok("…and the example command is skipped, because its name starts with _", found.commands.length === 0 && found.files.every((x) => !/_example/.test(x)) && (await import("node:fs")).existsSync(join(dir, "src/commands/_example.ts")));
  ok("…but it is a working command once the underscore is dropped", (() => { const t = botHandlerFiles(emptyBot())["src/commands/_example.ts"]; return /defineCommand/.test(t) && /name: "hello"/.test(t); })());
}

// --- the generators --------------------------------------------------------------------------------------------
ok("a command file with quotes in its description is still valid code", (() => { const t = commandTs({ name: "a", description: 'say "hi" \\ there' }); return t.includes(JSON.stringify('say "hi" \\ there')); })());
ok("a very long description is cut to the 100 the server allows", /description: "x{100}"/.test(commandTs({ name: "a", description: "x".repeat(500) })));

// --- the extension starter ----------------------------------------------------------------------------------------
{
  const { dir } = materialise("extension");
  const r = tsc(dir);
  ok("the extension starter still type-checks", r.status === 0, r.stdout + r.stderr);
}

for (const d of made) rmSync(d, { recursive: true, force: true });
console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
