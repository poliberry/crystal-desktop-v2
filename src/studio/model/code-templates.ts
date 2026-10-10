import type { BotData, ExtensionData, Project } from "@/studio/model/types";

/**
 * What a new extension or bot project starts as: an ordinary TypeScript project in its own folder.
 *
 * Nothing here is special to Studio. `src/index.ts` is the code, `package.json` and `tsconfig.json`
 * are what any editor or `npm` expects, so a project can be opened in VS Code, committed to git or
 * built by CI. The only generated file is `types/crystal.d.ts` (an extension's SDK), which is
 * versioned so a newer Studio can refresh it without touching anything the author wrote.
 */

/** Where the SDK lives in a project. Copied there by Studio, which refreshes it when its own is newer. */
export const SDK_DIR = ".crystal/sdk";
export const sdkDirFor = (kind: "extension" | "bot") => `${SDK_DIR}/${kind}`;
/** What each kind of project imports the SDK as. */
export const SDK_PACKAGE = { extension: "@crystal/extension", bot: "@crystal/bot" } as const;

export const EXTENSION_STARTER = `// An extension is a TypeScript project that Studio bundles into one script and runs in a sandbox.
// It reaches Crystal only through the SDK: \`import … from "@crystal/extension"\`. Press F12 on
// anything imported to read its source — it is in .crystal/sdk/extension.
import { Extension, Panel, storage, ui } from "@crystal/extension";

const ext = new Extension();

const panel = new Panel(
  (s: { count: number }) =>
    ui.column([
      ui.heading("Hello from my extension"),
      ui.text(\`Clicked \${s.count} time\${s.count === 1 ? "" : "s"}\`),
      ui.row([ui.button("Click me", "click"), ui.button("Reset", "reset", { variant: "secondary" })]),
    ]),
  { count: 0 },
);

// Runs when the person opens the panel.
ext.onOpen(async () => {
  panel.setState({ count: (await storage.get<number>("count")) ?? 0 });
});

ext.onAction("click", async () => {
  const count = panel.state.count + 1;
  await storage.set("count", count);
  panel.setState({ count });
});

ext.onAction("reset", async () => {
  await storage.set("count", 0);
  panel.setState({ count: 0 });
});
`;

const slugOf = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "project";

/**
 * A bot's starter, written on the SDK: one small file per thing it does, found by `client.loadHandlers()`.
 * `src/index.ts` only creates the client and logs in; events are in `src/events`, slash commands in
 * `src/commands` and buttons in `src/buttons`. Generated from the project, so the commands in the
 * settings already have a file waiting.
 */
export function botIndexTs(name: string, bot: BotData): string {
  const label = name.replace(/[^\w .-]/g, "").slice(0, 40) || "bot";
  void bot;
  return `// ${label} — a Crystal bot, written with the SDK in .crystal/sdk/bot (F12 on anything to read it).
//
// Run it with \`npm start\` (copy .env.example to .env first). After \`login()\` the SDK asks Crystal
// for events, so the bot needs no public address. (To be called instead, set an Endpoint in the
// project settings and use \`client.listen()\`.)
//
// What the bot does is in its own files, one each, so this one stays short:
//   src/events/    what it does when something happens (a message, someone joining…)
//   src/commands/  its slash commands
//   src/buttons/   what it does when a button on one of its messages is pressed
import { Client } from "@crystal/bot";

// Reads CRYSTAL_BOT_TOKEN and CRYSTAL_SIGNING_SECRET from the environment.
const client = new Client({ presence: { activities: [{ type: "playing", name: "with Crystal" }] } });

// Finds every handler in those folders and wires it up. Call it before login().
const loaded = await client.loadHandlers(new URL(".", import.meta.url));
console.log(\`Loaded \${loaded.events.length} event\${loaded.events.length === 1 ? "" : "s"}, \${loaded.commands.length} command\${loaded.commands.length === 1 ? "" : "s"} and \${loaded.buttons.length} button\${loaded.buttons.length === 1 ? "" : "s"}.\`);

await client.login();
// Tells Crystal which commands exist, so they show up when someone types "/".
await client.registerCommands();
console.log("Listening for events.");
`;
}

const READY_TS = `import { defineEvent, Events } from "@crystal/bot";

// An event handler: say which event, and what to do. \`run\` is given what the event carries
// (here, the client), and then the client again as its last argument.
export default defineEvent({
  name: Events.Ready,
  once: true,
  run: (client) => {
    console.log(\`Online as \${client.user?.name} in \${client.communities.size} communit\${client.communities.size === 1 ? "y" : "ies"}.\`);
  },
});
`;

const ERROR_TS = `import { defineEvent, Events } from "@crystal/bot";

// Without a listener for Error, a problem in one of your handlers is only logged.
export default defineEvent({
  name: Events.Error,
  run: (error) => console.error("Something went wrong:", error),
});
`;

const MESSAGE_TS = `import { ActionRowBuilder, ButtonBuilder, defineEvent, EmbedBuilder, Events } from "@crystal/bot";

export default defineEvent({
  name: Events.MessageCreate,
  run: async (message) => {
    // Never answer bots, or two bots will talk forever. Needs the "Read messages" access.
    if (message.fromBot) return;
    if (message.content.toLowerCase() === "!ping") {
      await message.reply({
        embeds: [new EmbedBuilder().setTitle("Pong").setDescription("I'm here.").setColor("#7c3aed")],
        // The button is answered by src/buttons/thanks.ts, found by its customId.
        components: [new ActionRowBuilder(new ButtonBuilder().setCustomId("thanks").setLabel("Thanks").setStyle("success"))],
      });
    }
  },
});
`;

const THANKS_TS = `import { defineButton } from "@crystal/bot";

// A button handler is found by the customId the button was given with setCustomId().
export default defineButton({
  customId: "thanks",
  run: async (interaction) => {
    await interaction.update({ components: [] });
    await interaction.reply(\`You're welcome, \${interaction.user.name}!\`);
  },
});
`;

const EXAMPLE_COMMAND_TS = `// A file whose name starts with "_" is skipped by client.loadHandlers(), so this one is only an example.
// Copy it to src/commands/hello.ts (no underscore) to add a "/hello" command.
import { defineCommand } from "@crystal/bot";

export default defineCommand({
  // What people type after the "/": lower-case letters, digits, - and _.
  name: "hello",
  // Shown in the list when someone types "/".
  description: "Say hello",
  run: async (interaction) => {
    await interaction.reply(\`Hi \${interaction.user.name}!\${interaction.args ? " You said: " + interaction.args : ""}\`);
  },
});
`;

/** A slash command in its own file, for a command named in the project settings. */
export function commandTs(c: { name: string; description: string }): string {
  return `import { defineCommand } from "@crystal/bot";

export default defineCommand({
  name: ${JSON.stringify(c.name)},
  description: ${JSON.stringify(c.description.slice(0, 100) || c.name)},
  run: async (interaction) => {
    await interaction.reply(\`Hi \${interaction.user.name}! You ran /${c.name}\${interaction.args ? " with: " + interaction.args : ""}.\`);
  },
});
`;
}

/** The handler files a new bot starts with, by path: the events, one file per command in the settings, and a button. */
export function botHandlerFiles(bot: BotData): Record<string, string> {
  const files: Record<string, string> = {
    "src/events/ready.ts": READY_TS,
    "src/events/error.ts": ERROR_TS,
    "src/events/messageCreate.ts": MESSAGE_TS,
    "src/buttons/thanks.ts": THANKS_TS,
  };
  const commands = bot.commands.filter((c) => /^[a-z0-9_-]{1,32}$/.test(c.name));
  for (const c of commands) files[`src/commands/${c.name}.ts`] = commandTs(c);
  if (commands.length === 0) files["src/commands/_example.ts"] = EXAMPLE_COMMAND_TS;
  return files;
}

/** Everything a new project starts with, by path. Existing files are never overwritten by scaffolding. */
export function scaffoldFiles(project: Project, siteUrl: string): Record<string, string> {
  const slug = project.kind === "extension" ? (project.extension as ExtensionData).slug || slugOf(project.name) : slugOf(project.name);
  const json = (o: unknown) => JSON.stringify(o, null, 2) + "\n";
  if (project.kind === "extension") {
    return {
      "src/index.ts": EXTENSION_STARTER,
      "package.json": json({ name: slug, private: true, version: project.extension!.version, type: "module", scripts: { check: "tsc -p ." }, devDependencies: { typescript: "^5.6.0" } }),
      "tsconfig.json": json({
        compilerOptions: { target: "ES2020", module: "ESNext", moduleResolution: "Bundler", lib: ["ES2022"], types: [], strict: true, noEmit: true, skipLibCheck: true, paths: { [SDK_PACKAGE.extension]: [`./${sdkDirFor("extension")}/index.ts`] } },
        include: ["src", `${sdkDirFor("extension")}/globals.ts`],
      }),
      "README.md": `# ${project.name}\n\nA Crystal extension. Edit \`src/index.ts\`. In Studio, **Run** tries it in the real sandbox and **Build** produces \`dist/extension.js\`, the single script that is reviewed and published.\n\n- It imports Crystal through \`@crystal/extension\`, whose source is in \`.crystal/sdk/extension\`. Studio keeps that folder up to date; don't edit it.\n- It can import its own files (\`./like-this\`) but no other packages: the sandbox runs one script.\n- Name, version and what it asks for are in the project settings, saved to the \`.crysproj\`.\n`,
      ".gitignore": "node_modules\ndist\n",
    };
  }
  return {
    "src/index.ts": botIndexTs(project.name, project.bot!),
    ...botHandlerFiles(project.bot!),
    "package.json": json({
      name: slug,
      private: true,
      version: "1.0.0",
      type: "module",
      scripts: { start: "tsx --env-file=.env src/index.ts", dev: "tsx watch --env-file=.env src/index.ts", check: "tsc -p ." },
      devDependencies: { "@types/node": "^22.0.0", tsx: "^4.19.0", typescript: "^5.6.0" },
      // Only needed to join voice channels.
      optionalDependencies: { "@livekit/rtc-node": "^0.13.0" },
    }),
    "tsconfig.json": json({
      compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", lib: ["ES2022"], types: ["node"], strict: true, noEmit: true, skipLibCheck: true, paths: { [SDK_PACKAGE.bot]: [`./${sdkDirFor("bot")}/index.ts`] } },
      include: ["src", `${sdkDirFor("bot")}/*.ts`],
    }),
    ".env.example": `# Copy to .env (which is not committed) and fill in. The token and signing secret are shown once, when the bot is registered.\nCRYSTAL_BOT_TOKEN=\nCRYSTAL_SIGNING_SECRET=\n# Crystal's API address. This is the default, so you can leave it out.\n# CRYSTAL_API_URL=https://api.usecrystal.app/bot/v1\nPORT=3000\n`,
    "README.md": `# ${project.name}\n\nA Crystal bot, written with the SDK in \`.crystal/sdk/bot\` (Studio keeps that folder up to date; don't edit it). It runs on your own computer or server and talks to Crystal over the Bot API.\n\n\`\`\`sh\nnpm install\ncp .env.example .env   # then fill in the token and signing secret\nnpm start\n\`\`\`\n\n## Where things are\n\n- \`src/index.ts\` creates the client and logs in.\n- \`src/events/\` one file per event the bot reacts to; \`src/commands/\` one per slash command; \`src/buttons/\` one per button. Each exports a handler made with \`defineEvent\`, \`defineCommand\` or \`defineButton\`, and \`client.loadHandlers()\` finds them. A file starting with \`_\` is skipped, so helpers can sit beside them.\n\nAfter \`login()\` the bot asks Crystal for events itself, so it works from anywhere with no public address. (If you set an Endpoint in the project settings, Crystal calls that instead, and you use \`client.listen()\`.) To join voice channels, \`npm install @livekit/rtc-node\` too.\n`,
    ".gitignore": "node_modules\n.env\ndist\n",
  };
}

/**
 * Just enough of Node's types for the bot SDK to check cleanly before \`npm install\` has put the real
 * ones in the project. Dropped as soon as \`node_modules/@types/node\` is found.
 */
export const NODE_SHIM_DTS = `
declare module "node:events" { class EventEmitter { on(e: string, l: (...a: any[]) => void): this; emit(e: string, ...a: any[]): boolean } export { EventEmitter }; }
declare module "node:http" {
  interface IncomingMessage extends AsyncIterable<Uint8Array> { method?: string; url?: string; headers: Record<string, string | string[] | undefined> }
  interface ServerResponse { writeHead(status: number, headers?: Record<string, string>): ServerResponse; end(body?: string): void }
  interface Server { listen(port?: number, host?: string | (() => void), cb?: () => void): Server; close(cb?: () => void): Server; once(e: string, l: (...a: any[]) => void): Server; address(): { port: number } | string | null }
  function createServer(listener: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>): Server;
}
declare module "node:crypto" {
  function createHmac(algorithm: string, key: string): { update(data: string): { digest(): Uint8Array } };
  function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
}
declare module "node:fs/promises" { function readFile(path: string): Promise<Uint8Array>; function readdir(path: string, options: { withFileTypes: true }): Promise<{ name: string; isDirectory(): boolean; isFile(): boolean }[]>; }
declare module "node:path" { function basename(p: string): string; function extname(p: string): string; function join(...parts: string[]): string; }
declare module "node:url" { function pathToFileURL(path: string): { href: string }; function fileURLToPath(url: string | URL): string; }
declare class URL { constructor(url: string, base?: string | URL); readonly href: string }
declare const Buffer: { concat(chunks: Uint8Array[]): { toString(encoding?: string): string }; from(data: string, encoding?: string): Uint8Array };
declare const process: { env: Record<string, string | undefined> };
declare const console: { log(...a: unknown[]): void; error(...a: unknown[]): void; warn(...a: unknown[]): void; info(...a: unknown[]): void };
declare function setTimeout(h: () => void, ms?: number): number;
declare function setInterval(h: () => void, ms?: number): { unref?(): void };
declare function clearInterval(id: unknown): void;
declare function queueMicrotask(cb: () => void): void;
declare function structuredClone<T>(v: T): T;
declare class TextEncoder { encode(s: string): Uint8Array }
declare class URLSearchParams { constructor(init?: string | Record<string, string>); set(k: string, v: string): void; readonly size: number; toString(): string }
declare class Response { ok: boolean; status: number; statusText: string; headers: { get(name: string): string | null }; json(): Promise<unknown> }
declare function fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array }): Promise<Response>;
`;
