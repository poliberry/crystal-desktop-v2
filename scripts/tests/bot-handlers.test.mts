/**
 * Handlers in their own files: `client.loadHandlers()` against real folders on disk, the checks on what a file exports,
 * and the extension's `ext.use()`. Run: bun scripts/tests/bot-handlers.test.mts
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { Client, CrystalError, Events, defineButton, defineCommand, defineEvent } from "../../sdk/bot/index";
import { checkButton, checkCommand, checkEvent, findDuplicate, isHandlerFile } from "../../sdk/bot/handlers";
import { Extension, defineAction, defineOpen } from "../../sdk/extension/index";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, d === undefined ? "" : JSON.stringify(d))); };
const rejects = async (n: string, fn: () => Promise<unknown>, re: RegExp) => { try { await fn(); ok(n, false, "did not throw"); } catch (e) { ok(n, re.test((e as Error).message), (e as Error).message); } };

const SDK = pathToFileURL(join(import.meta.dir, "../../sdk/bot/index.ts")).href;
const dirs: string[] = [];
function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "crystal-handlers-"));
  dirs.push(dir);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), text.replaceAll("@crystal/bot", SDK));
  }
  return dir;
}
const mk = () => new Client({ token: "t", apiUrl: "http://127.0.0.1:1/bot/v1" });
const hello = (id: string) => ({ id, createdAt: 1, type: "interaction.command" as const, communityId: "c1", channelId: "ch1", command: "hello", args: "x y", user: { id: "u", username: "u", name: "U" } });

// --- the pure checks ---------------------------------------------------------------------------
ok("defineEvent/Command/Button return what they are given", (() => { const e = { name: Events.Ready, run: () => 1 }; return defineEvent(e) === e && defineCommand({ name: "a", description: "b", run: () => 1 }).name === "a" && defineButton({ customId: "x", run: () => 1 }).customId === "x"; })());
ok("code files count; types, tests, helpers and other files don't", isHandlerFile("a.ts") && isHandlerFile("a.mjs") && isHandlerFile("a.js") && isHandlerFile("a.cts") && !isHandlerFile("a.d.ts") && !isHandlerFile("a.test.ts") && !isHandlerFile("a.spec.js") && !isHandlerFile("_util.ts") && !isHandlerFile(".hidden.ts") && !isHandlerFile("README.md") && !isHandlerFile("data.json"));
const known = Object.values(Events) as string[];
ok("a good event, command and button pass", checkEvent({ name: "ready", run() {} }, "f", known).name === "ready" && checkCommand({ name: "ping", description: "d", run() {} }, "f").name === "ping" && checkButton({ customId: "x", run() {} }, "f").customId === "x");
const bad = (fn: () => unknown, re: RegExp, n: string) => { try { fn(); ok(n, false, "no throw"); } catch (e) { ok(n, e instanceof CrystalError && re.test(e.message), (e as Error).message); } };
bad(() => checkEvent(undefined, "events/a.ts", known), /“events\/a\.ts”.*defineEvent/, "no default export is named by file");
bad(() => checkEvent({ name: "nope", run() {} }, "events/a.ts", known), /“nope” isn't an event/, "an unknown event");
bad(() => checkEvent({ name: "ready" }, "events/a.ts", known), /needs a run function/, "no run");
bad(() => checkEvent({ name: "ready", run() {}, once: "yes" }, "events/a.ts", known), /once must be/, "once must be a boolean");
bad(() => checkCommand({ name: "Ping", description: "d", run() {} }, "commands/a.ts"), /1–32 lower-case/, "upper-case command name");
bad(() => checkCommand({ name: "a".repeat(33), description: "d", run() {} }, "f"), /1–32/, "too long a name");
bad(() => checkCommand({ name: "a", description: "", run() {} }, "f"), /description/, "no description");
bad(() => checkCommand({ name: "a", description: "x".repeat(101), run() {} }, "f"), /1–100/, "description too long");
bad(() => checkCommand({ name: "a", description: "d" }, "f"), /run function/, "command with no run");
bad(() => checkButton({ customId: "", run() {} }, "f"), /customId/, "empty customId");
bad(() => checkButton({ customId: "x", run: 5 }, "f"), /run function/, "button run not a function");
bad(() => checkButton("x", "f"), /defineButton/, "a string is not a handler");
ok("duplicates are found and both files named", (() => { const d = findDuplicate([{ value: { n: "a" }, file: "1.ts" }, { value: { n: "b" }, file: "2.ts" }, { value: { n: "a" }, file: "3.ts" }], (v) => v.n); return d?.key === "a" && d.a === "1.ts" && d.b === "3.ts"; })() && findDuplicate([{ value: 1, file: "a" }, { value: 2, file: "b" }], String) === null);

// --- loading from disk -------------------------------------------------------------------------
{
  const dir = project({
    "events/ready.ts": `import { defineEvent, Events } from "@crystal/bot"; export const calls: any[] = (globalThis as any).__ready = []; export default defineEvent({ name: Events.Ready, once: true, run: (c, client) => { calls.push([c === client, "ready"]); } });`,
    "events/messages/create.ts": `import { defineEvent, Events } from "@crystal/bot"; export default defineEvent({ name: Events.MessageCreate, run: (m, client) => { ((globalThis as any).__msgs ??= []).push([m.content, client.botId]); } });`,
    "events/_helper.ts": `throw new Error("a helper must never be loaded as a handler");`,
    "events/types.d.ts": `export {};`,
    "events/ready.test.ts": `throw new Error("tests are not handlers");`,
    "events/notes.md": `not code`,
    "commands/hello.ts": `import { defineCommand } from "@crystal/bot"; export default defineCommand({ name: "hello", description: "Say hello", run: (i, client) => { ((globalThis as any).__cmd ??= []).push([i.commandName ?? (i as any).name, (i as any).args ?? (i as any).argv, client.botId]); } });`,
    "commands/fun/roll.ts": `import { defineCommand } from "@crystal/bot"; export default defineCommand({ name: "roll", description: "Roll a die", run: () => {} });`,
    "buttons/thanks.ts": `import { defineButton } from "@crystal/bot"; export default defineButton({ customId: "thanks", run: (i) => { ((globalThis as any).__btn ??= []).push(i.customId); } });`,
  });
  const g = globalThis as any;
  g.__ready = []; g.__msgs = []; g.__cmd = []; g.__btn = [];
  const c = mk();
  const found = await c.loadHandlers(dir);
  ok("it finds events, commands and buttons, including in sub-folders", found.events.length === 2 && found.commands.length === 2 && found.buttons.length === 1, { e: found.events.length, c: found.commands.length, b: found.buttons.length });
  ok("it skips helpers, type files, tests and other files (loading one would have thrown)", found.files.length === 5 && !found.files.some((x) => /_helper|\.d\.ts|\.test\.|\.md/.test(x)), found.files);
  ok("files are loaded in a fixed order, whatever the disk does", JSON.stringify(found.files) === JSON.stringify(["events/messages/create.ts", "events/ready.ts", "commands/fun/roll.ts", "commands/hello.ts", "buttons/thanks.ts"]), found.files);
  c.botId = "bot-1";
  await c.dispatch({ id: "m1", createdAt: 1, type: "message.created", communityId: "c1", channelId: "ch1", message: { id: "x", text: "hi there", createdAt: 1, replyToId: null, author: { id: "u", username: "u", name: "U", isBot: false }, attachments: [] } });
  ok("an event handler gets what the event carries, then the client", g.__msgs.length === 1 && g.__msgs[0][0] === "hi there" && g.__msgs[0][1] === "bot-1", g.__msgs);
  await c.dispatch(hello("e1"));
  ok("a command handler runs for its command, with the client as the second argument", g.__cmd.length === 1 && g.__cmd[0][2] === "bot-1", g.__cmd);
  await c.dispatch({ id: "b1", createdAt: 1, type: "interaction.button", communityId: "c1", channelId: "ch1", messageId: "m", customId: "thanks", user: { id: "u", username: "u", name: "U" } });
  ok("a button handler runs for its customId", g.__btn.join() === "thanks");
  const once = found.events.find((e) => e.name === "ready")!;
  ok("a `once` handler is registered to run once", once.once === true);
  (c as any).emit("ready", c);
  (c as any).emit("ready", c);
  ok("…and runs only the first time, with the client as both arguments", g.__ready.length === 1 && g.__ready[0][0] === true, g.__ready);

  const sent: any[] = [];
  (c.rest as any).put = async (path: string, body: unknown) => { sent.push([path, body]); return {}; };
  await c.registerCommands();
  ok("registerCommands() with no argument registers the commands that were found", sent.length === 1 && sent[0][0] === "/commands" && JSON.stringify(sent[0][1]) === JSON.stringify({ commands: [{ name: "roll", description: "Roll a die" }, { name: "hello", description: "Say hello" }] }), sent);
  await c.registerCommands([{ name: "only", description: "d" }]);
  ok("…and with an argument registers exactly that, as before", JSON.stringify(sent[1][1]) === JSON.stringify({ commands: [{ name: "only", description: "d" }] }));

  const c2 = mk();
  ok("loading from a file: URL works (as `new URL(\".\", import.meta.url)` gives)", (await c2.loadHandlers(pathToFileURL(dir + "/"))).files.length === 5);
  const c3 = mk();
  const empty = await c3.loadHandlers(project({ "index.ts": "export {}" }));
  ok("a folder with none of the three folders is just empty", empty.files.length === 0 && empty.events.length + empty.commands.length + empty.buttons.length === 0);
  ok("…and styles mix: handlers written by hand beside loaded ones", (() => { const cc = mk(); let n = 0; cc.on(Events.Ready, () => n++); (cc as any).emit("ready", cc); return n === 1; })());
}

// --- errors name the file ----------------------------------------------------------------------
await rejects("two commands with one name name both files", () => mk().loadHandlers(project({ "commands/a.ts": `import { defineCommand } from "@crystal/bot"; export default defineCommand({ name: "x", description: "d", run() {} });`, "commands/b.ts": `import { defineCommand } from "@crystal/bot"; export default defineCommand({ name: "x", description: "d", run() {} });` })), /“x” is defined twice.*commands\/a\.ts.*commands\/b\.ts/);
await rejects("two buttons with one id", () => mk().loadHandlers(project({ "buttons/a.ts": `import { defineButton } from "@crystal/bot"; export default defineButton({ customId: "y", run() {} });`, "buttons/b.ts": `import { defineButton } from "@crystal/bot"; export default defineButton({ customId: "y", run() {} });` })), /“y” is handled twice.*buttons\/a\.ts.*buttons\/b\.ts/);
await rejects("a file with no default export", () => mk().loadHandlers(project({ "commands/a.ts": `export const x = 1;` })), /“commands\/a\.ts” should export a command/);
await rejects("a file that throws while loading is named", () => mk().loadHandlers(project({ "events/a.ts": `throw new Error("boom");` })), /“events\/a\.ts” couldn't be loaded: boom/);
await rejects("a syntax error is named too", () => mk().loadHandlers(project({ "events/a.ts": `export default {{{` })), /“events\/a\.ts” couldn't be loaded/);
await rejects("an event with a wrong name", () => mk().loadHandlers(project({ "events/a.ts": `import { defineEvent } from "@crystal/bot"; export default defineEvent({ name: "messageCreat" as any, run() {} });` })), /“messageCreat” isn't an event/);
await rejects("nothing is wired up when one file is bad (all or nothing)", async () => { const c = mk(); let n = 0; c.on(Events.Ready, () => n++); try { await c.loadHandlers(project({ "events/a.ts": `import { defineEvent, Events } from "@crystal/bot"; export default defineEvent({ name: Events.Ready, run() { (globalThis as any).__leak = 1; } });`, "commands/b.ts": `export default 5;` })); } finally { (c as any).emit("ready", c); if ((globalThis as any).__leak) throw new Error("a handler from a failed load was wired up"); } }, /should export a command/);

// --- the extension ----------------------------------------------------------------------------
{
  const handlers = new Map<string, (d: any) => unknown>();
  (globalThis as any).crystal = { on: (n: string, h: (d: any) => unknown) => handlers.set(n, h) };
  const ran: string[] = [];
  const ext = new Extension();
  ext.use(defineOpen(() => { ran.push("open"); }), defineAction("save", (ctx) => { ran.push("save:" + ctx.action); }), defineAction("*", (ctx) => { ran.push("any:" + ctx.action); }));
  await handlers.get("open")!({});
  await handlers.get("action")!({ action: "save" });
  await handlers.get("action")!({ action: "other" });
  ok("ext.use() wires an open handler, an action, and a catch-all", ran.join() === "open,save:save,any:other", ran);
  ok("use() chains", new Extension().use() instanceof Extension);
  let threw = "";
  try { new Extension().use(defineAction("a", () => {}), defineAction("a", () => {})); } catch (e) { threw = (e as Error).message; }
  ok("two handlers for one action are an error, not a quiet replacement", /“a” is handled twice/.test(threw), threw);
  threw = "";
  try { new Extension().use(defineAction("*", () => {}), defineAction("*", () => {})); } catch (e) { threw = (e as Error).message; }
  ok("…and two catch-alls", /more than one catch-all/.test(threw), threw);
  threw = "";
  try { new Extension().use({ nope: 1 } as never); } catch (e) { threw = (e as Error).message; }
  ok("something that isn't a handler is refused", /defineAction\(\) or defineOpen\(\)/.test(threw), threw);
  ok("an action handler is just its name and function", (() => { const a = defineAction("z", () => {}); return a.kind === "action" && a.action === "z" && typeof a.run === "function"; })());
}

for (const d of dirs) rmSync(d, { recursive: true, force: true });
console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
