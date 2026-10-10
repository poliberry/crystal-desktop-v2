/**
 * The SDK reference: that it is read from the SDKs (so it can't be out of date), that nothing public is missing from it or
 * undocumented, and that the pure functions the Reference tab is drawn with do what the tab says.
 * Run: bun scripts/tests/reference.test.mts
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { OUT, renderModule } from "../build-reference.mjs";
import * as botSdk from "../../sdk/bot/index";
import * as extSdk from "../../sdk/extension/index";
import {
  KIND_ORDER, SDK_KINDS, STARTING_POINTS, anchorOf, findItem, findMember, firstLine, groupItems, importLine, knownNames, memberGroups, parseAnchor, searchItems, sourcePath, tokenize,
  type RefItem,
} from "../../src/studio/docs/reference";
import { SDK_REFERENCE } from "../../src/studio/docs/reference.generated";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, d === undefined ? "" : JSON.stringify(d).slice(0, 600))); };
const root = join(import.meta.dir, "../..");

// --- the generated file is the SDKs' ----------------------------------------------------------------------
ok("the generated reference is up to date with the SDKs and their comments", readFileSync(OUT, "utf8") === renderModule(), "run: bun scripts/build-reference.mjs");
for (const kind of SDK_KINDS) {
  const ref = SDK_REFERENCE[kind];
  const pkg = JSON.parse(readFileSync(join(root, "sdk", kind, "package.json"), "utf8")) as { name: string; version: string };
  ok(`${kind}: names the package and the version that is in package.json`, ref.package === pkg.name && ref.version === pkg.version, [ref.package, ref.version, pkg]);
  ok(`${kind}: item names are unique`, new Set(ref.items.map((i) => i.name)).size === ref.items.length);
  ok(`${kind}: every item's source file exists`, ref.items.every((i) => existsSync(join(root, "sdk", kind, i.file))), ref.items.filter((i) => !existsSync(join(root, "sdk", kind, i.file))).map((i) => i.file));

  // Everything documented.
  const undocumented: string[] = [];
  for (const i of ref.items) {
    if (!i.doc.summary.trim()) undocumented.push(i.name);
    if ("members" in i) for (const m of i.members) if (!m.doc.summary.trim()) undocumented.push(`${i.name}.${m.name}`);
  }
  ok(`${kind}: every public item and member has documentation`, undocumented.length === 0, undocumented);

  // No description cut short where TypeScript took an at-sign for a tag.
  const stray: string[] = [];
  for (const i of ref.items) for (const d of [i.doc, ...("members" in i ? i.members.map((m) => m.doc) : [])]) for (const t of d.tags) if (!["param", "returns", "example", "deprecated", "see", "throws"].includes(t.name)) stray.push(`${i.name}: @${t.name}`);
  ok(`${kind}: no description was cut short by an at-sign`, stray.length === 0, stray);
  const cut = ref.items.flatMap((i) => [i.doc.summary, ...("members" in i ? i.members.map((m) => m.doc.summary) : [])]).filter((s) => /\b(the|a|an|of|to|and|without)$/.test(s.trim()));
  ok(`${kind}: no description ends mid-sentence`, cut.length === 0, cut);
  ok(`${kind}: no `+"`{@link}`"+` is left in the text`, !JSON.stringify(ref).includes("{@link"));

  // Signatures agree with themselves.
  const bad: string[] = [];
  for (const i of ref.items) {
    const sigs = i.kind === "function" ? i.signatures : i.kind === "class" ? [...i.constructors, ...i.members.flatMap((m) => (m.kind === "method" ? m.signatures : []))] : "members" in i ? i.members.flatMap((m) => (m.kind === "method" ? m.signatures : [])) : [];
    for (const s of sigs) if (s.text !== `(${s.params.map((q) => `${q.rest ? "..." : ""}${q.name}${q.optional ? "?" : ""}: ${q.type}`).join(", ")}) => ${s.returns}`) bad.push(`${i.name}: ${s.text}`);
  }
  ok(`${kind}: every signature's text is made from its own parameters`, bad.length === 0, bad);

  // Private things stay private.
  const leaked = ref.items.flatMap((i) => ("members" in i ? i.members.filter((m) => m.name.startsWith("_") || m.name.startsWith("#")).map((m) => `${i.name}.${m.name}`) : []));
  ok(`${kind}: nothing private or underscored is listed`, leaked.length === 0, leaked);
}
const members = (name: string, kind: "bot" | "extension" = "bot") => { const i = SDK_REFERENCE[kind].items.find((x) => x.name === name); return i && "members" in i ? i.members.map((m) => m.name) : []; };
ok("private and protected members are not listed", !members("Client").includes("signingSecret") && !members("Client").includes("startPolling") && !members("REST").includes("options") && !members("Emitter").includes("listeners"));
ok("standard-library members inherited from Map or Error are not listed", !members("Collection").includes("forEach") && !members("CrystalAPIError").includes("stack") && !members("CrystalAPIError").includes("captureStackTrace"));
ok("inherited members of the SDK's own base types are", members("MessageCreatedEvent").includes("createdAt") && members("APIMemberDetail").includes("username"));

// --- everything exported is in it -----------------------------------------------------------------------------
{
  const names = (k: "bot" | "extension") => new Set(SDK_REFERENCE[k].items.map((i) => i.name));
  const miss = (sdk: object, k: "bot" | "extension") => Object.keys(sdk).filter((n) => !names(k).has(n));
  ok("every runtime export of @crystal/bot is in the reference", miss(botSdk, "bot").length === 0, miss(botSdk, "bot"));
  ok("every runtime export of @crystal/extension is in the reference", miss(extSdk, "extension").length === 0, miss(extSdk, "extension"));
  // Type-only exports named in index.ts.
  for (const k of SDK_KINDS) {
    const text = readFileSync(join(root, "sdk", k, "index.ts"), "utf8");
    const typeNames = [...text.matchAll(/\btype\s+([A-Z]\w+)/g)].map((m) => m[1]);
    ok(`${k}: every type exported by name from index.ts is in the reference`, typeNames.every((n) => names(k).has(n)), typeNames.filter((n) => !names(k).has(n)));
  }
  ok("the new file-handler API is in the reference", ["defineEvent", "defineCommand", "defineButton", "EventHandler", "CommandHandler", "ButtonHandler", "LoadedHandlers"].every((n) => names("bot").has(n)) && members("Client").includes("loadHandlers") && ["defineAction", "defineOpen", "ActionHandler", "OpenHandler"].every((n) => names("extension").has(n)) && members("Extension", "extension").includes("use"));
  ok("the reference says what loadHandlers is for, with an example", /defineEvent/.test(JSON.stringify(SDK_REFERENCE.bot.items.find((i) => i.name === "Client"))) && /loadHandlers\(new URL/.test(JSON.stringify(SDK_REFERENCE.bot)));
}

// --- reading it ----------------------------------------------------------------------------------------------------
{
  const bot = SDK_REFERENCE.bot;
  ok("parseAnchor reads an item, a member, and refuses nonsense", JSON.stringify(parseAnchor("bot/Client")) === JSON.stringify({ sdk: "bot", name: "Client" }) && JSON.stringify(parseAnchor("extension/ui.render")) === JSON.stringify({ sdk: "extension", name: "ui", member: "render" }) && parseAnchor("bots/Client") === null && parseAnchor("bot/") === null && parseAnchor("bot/1x") === null && parseAnchor("bot/a.b.c") === null && parseAnchor("") === null && parseAnchor("bot/Client; drop") === null);
  ok("anchorOf and parseAnchor are inverses", (() => { const a = parseAnchor(anchorOf("bot", "Client", "on")); return a?.sdk === "bot" && a.name === "Client" && a.member === "on"; })());
  ok("every starting point exists in its SDK", SDK_KINDS.every((k) => STARTING_POINTS[k].every((n) => !!findItem(SDK_REFERENCE[k], n))), SDK_KINDS.map((k) => STARTING_POINTS[k].filter((n) => !findItem(SDK_REFERENCE[k], n))));
  ok("findItem and findMember", findItem(bot, "Client")?.kind === "class" && findItem(bot, "Nope") === undefined && !!findMember(findItem(bot, "Client")!, "login") && findMember(findItem(bot, "Client")!, "nope") === undefined && findMember(findItem(bot, "inviteUrl")!, "x") === undefined);

  const imp = (n: string) => importLine(bot, findItem(bot, n)!);
  ok("a value is imported as a value, an interface or type as a type", imp("Client") === 'import { Client } from "@crystal/bot";' && imp("APIMessage") === 'import type { APIMessage } from "@crystal/bot";' && imp("ButtonStyle") === 'import type { ButtonStyle } from "@crystal/bot";' && imp("defineCommand") === 'import { defineCommand } from "@crystal/bot";');
  ok("the imports it suggests are real exports", SDK_KINDS.every((k) => SDK_REFERENCE[k].items.filter((i) => i.kind !== "interface" && i.kind !== "type").every((i) => i.name in (k === "bot" ? botSdk : extSdk))), "");
  ok("sourcePath is where Studio puts the SDK in a project", sourcePath(bot, findItem(bot, "Client")!) === ".crystal/sdk/bot/client.ts" && sourcePath(SDK_REFERENCE.extension, findItem(SDK_REFERENCE.extension, "ui")!) === ".crystal/sdk/extension/ui.ts");

  const known = knownNames(bot);
  const seg = (t: string) => tokenize(t, known).map((s) => (s.link ? `[${s.text}]` : s.text)).join("");
  ok("tokenize links the names of items and nothing else", seg("Promise<Message>") === "Promise<[Message]>" && seg("(channel: Channel, user: User) => void") === "(channel: [Channel], user: [User]) => void" && seg("string | null") === "string | null");
  ok("…not a property that happens to share a name, nor part of a longer word", seg("{ Message: string }") === "{ Message: string }" && seg("MessageOptions") === "[MessageOptions]" && seg("Messages") === "Messages" && seg("a.Message") === "a.Message" && seg("xMessage") === "xMessage");
  ok("tokenize keeps all the text, whatever it is", ["", "()", "Map<string, Collection<Message>>", "'a' | 'b'", "😀 Message"].every((t) => tokenize(t, known).map((s) => s.text).join("") === t));
  ok("every linked name is an item", SDK_KINDS.every((k) => { const kn = knownNames(SDK_REFERENCE[k]); return SDK_REFERENCE[k].items.every((i) => (i.kind === "function" ? i.signatures.map((s) => s.text) : []).every((t) => tokenize(t, kn).every((s) => !s.link || kn.has(s.link)))); }));

  // search
  const names = (q: string) => searchItems(bot.items, q).map((i) => i.name);
  ok("search with nothing typed is everything", searchItems(bot.items, "").length === bot.items.length && searchItems(bot.items, "   ").length === bot.items.length);
  ok("a name ranks first", names("client")[0] === "Client" && names("message")[0] === "Message" && names("embedbuilder")[0] === "EmbedBuilder");
  ok("it finds by a member's name", names("loadHandlers").includes("Client") && names("bulkDelete").includes("Channel") && names("setThumbnail").includes("EmbedBuilder"));
  ok("it finds by what the documentation says", names("soundboard").includes("VoiceConnection"));
  ok("it needs every word", names("client zzzzqq").length === 0 && names("embed title").includes("EmbedBuilder"));
  ok("case doesn't matter and nonsense finds nothing", names("CLIENT")[0] === "Client" && names("qqqzzz").length === 0);
  ok("a search is only over its own SDK", searchItems(SDK_REFERENCE.extension.items, "client").every((i) => !!i));

  // grouping
  const g = groupItems(bot.items);
  ok("items are grouped by kind in reading order with no empty groups", g.every((x) => x.items.length > 0 && x.items.every((i) => i.kind === x.kind)) && g.map((x) => x.kind).join() === KIND_ORDER.filter((k) => bot.items.some((i) => i.kind === k)).join() && g.reduce((n, x) => n + x.items.length, 0) === bot.items.length);
  const groupsOf = (n: string) => memberGroups(findItem(bot, n) as RefItem).map((x) => x.label);
  ok("a class lists properties then methods; static ones first; empty groups are dropped", groupsOf("Client").join() === "Properties,Methods" && groupsOf("Permissions").join() === "Static,Properties,Methods" && groupsOf("APIUser").join() === "Properties" && groupsOf("inviteUrl").length === 0);
  ok("memberGroups loses nothing", ["Client", "Message", "Permissions", "APIMessage", "ClientEvents"].every((n) => { const it = findItem(bot, n)! as Extract<RefItem, { members: unknown[] }>; return memberGroups(it).reduce((a, x) => a + x.members.length, 0) === it.members.length; }));
  ok("firstLine is the first paragraph on one line", firstLine({ summary: "One two\nthree.\n\nSecond paragraph.", tags: [] }) === "One two three." && firstLine({ summary: "", tags: [] }) === "");
}

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
