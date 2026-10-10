import type * as Monaco from "monaco-editor";

/**
 * Snippets for the Crystal SDKs, offered as completions beside TypeScript's own.
 *
 * TypeScript already completes every class, method and option of the SDK, with its documentation,
 * because the SDK's source is in the project. These are for the *shapes* people write over and over
 * and have to look up: a handler, a panel, a request with its sites, an embed with buttons. Each
 * says in its description which power it needs, so asking for it doesn't come as a surprise later.
 */

export interface Snippet {
  /** What is typed to get it. */
  label: string;
  detail: string;
  documentation: string;
  /** Monaco snippet syntax: `${1:placeholder}` stops, `$0` the end. */
  body: string;
}

export const EXTENSION_SNIPPETS: Snippet[] = [
  {
    label: "crystal-extension",
    detail: "A new extension with a panel",
    documentation: "The whole shape of an extension: a panel drawn from state, and a handler for its button. Needs the “Show a panel” power.",
    body: [
      'import { Extension, Panel, ui } from "@crystal/extension";',
      "",
      "const ext = new Extension();",
      "",
      "const panel = new Panel(",
      "  (s: { ${1:count}: number }) => ui.column([ui.heading(\"${2:Title}\"), ui.button(\"${3:Click}\", \"${4:click}\")]),",
      "  { ${1:count}: 0 },",
      ");",
      "",
      "ext.onOpen(() => panel.render());",
      'ext.onAction("${4:click}", () => {',
      "  panel.setState({ ${1:count}: panel.state.${1:count} + 1 });",
      "});",
      "$0",
    ].join("\n"),
  },
  {
    label: "onAction",
    detail: "Handle a button or input in the panel",
    documentation: "Runs when the control with this action name is used. The context has `action`, `id`, `value` and `values` (every input in the panel).",
    body: 'ext.onAction("${1:name}", async (ctx) => {\n  $0\n});',
  },
  {
    label: "onOpen",
    detail: "Run when the panel is opened",
    documentation: "Draw the panel here, and load what it shows.",
    body: "ext.onOpen(async () => {\n  $0\n});",
  },
  {
    label: "panel",
    detail: "A panel that redraws when its state changes",
    documentation: "`panel.setState({ … })` changes some of the state and redraws. Needs the “Show a panel” power.",
    body: "const ${1:panel} = new Panel(\n  (s: { ${2:value}: string }) => ui.column([\n    ui.text(s.${2:value}),\n    $0\n  ]),\n  { ${2:value}: \"\" },\n);",
  },
  {
    label: "storage-load-save",
    detail: "Keep a value between sessions",
    documentation: "Up to 100 keys and 256 KB, private to the extension. Needs the “Keep some data” power.",
    body: 'const ${1:saved} = (await storage.get<${2:number}>("${3:key}")) ?? ${4:0};\nawait storage.set("${3:key}", ${1:saved});\n$0',
  },
  {
    label: "http-json",
    detail: "Fetch JSON from a site",
    documentation: "Only sites listed under “Sites it may talk to”, over https. Needs the “Talk to the internet” power.",
    // `\\${` is a literal `${` in snippet syntax; an unescaped one would be read as a variable.
    body: 'const res = await http.fetch("https://${1:api.example.org}/${2:path}");\nif (!res.ok) throw new Error(`Request failed: \\${res.status}`);\nconst data = res.json<${3:unknown}>();\n$0',
  },
  {
    label: "notify",
    detail: "Show a short notice",
    documentation: "Up to 200 characters, five a minute. Needs the “Show notices” power.",
    body: 'await notify("${1:Done}");',
  },
  {
    label: "ui-form",
    detail: "A card with an input and a save button",
    documentation: "`ctx.values.name` in the button's handler is whatever was typed.",
    body: 'ui.card("${1:Settings}", [\n  ui.input("${2:name}", "", { label: "${3:Your name}" }),\n  ui.button("Save", "${4:save}"),\n])',
  },
];

export const BOT_SNIPPETS: Snippet[] = [
  {
    label: "crystal-bot",
    detail: "A new bot",
    documentation: "Logs in, answers a message, and listens for Crystal's events. Reads CRYSTAL_BOT_TOKEN and CRYSTAL_SIGNING_SECRET from the environment.",
    body: [
      'import { Client, Events } from "@crystal/bot";',
      "",
      "const client = new Client();",
      "",
      "client.on(Events.MessageCreate, async (message) => {",
      "  if (message.fromBot) return;",
      '  if (message.content === "${1:!ping}") await message.reply("${2:pong}");',
      "});",
      "",
      "await client.login();",
      "await client.listen();",
      "$0",
    ].join("\n"),
  },
  {
    label: "command",
    detail: "Handle a slash command",
    documentation: "Also list it under Commands in the project settings (or `client.registerCommands`) so it shows when people type “/”. `interaction.argv` is the arguments split on spaces.",
    body: 'client.command("${1:name}", async (interaction) => {\n  await interaction.reply(`${2:Hello} \\${interaction.user.name}`);\n});',
  },
  {
    label: "button",
    detail: "Handle a button press",
    documentation: "`interaction.update(...)` changes the message the button is on.",
    body: 'client.button("${1:customId}", async (interaction) => {\n  await interaction.update({ content: "${2:Done}", components: [] });\n});',
  },
  {
    label: "embed",
    detail: "A message with an embed and buttons",
    documentation: "Buttons need a customId (handled by `client.button`) or a https URL.",
    body: [
      "await ${1:channel}.send({",
      "  embeds: [new EmbedBuilder().setTitle(\"${2:Title}\").setDescription(\"${3:Text}\").setColor(\"#${4:7c5cff}\")],",
      "  components: [new ActionRowBuilder(new ButtonBuilder().setCustomId(\"${5:yes}\").setLabel(\"${6:Yes}\").setStyle(\"success\"))],",
      "});",
      "$0",
    ].join("\n"),
  },
  {
    label: "moderation",
    detail: "Ban, kick or time out a member",
    documentation: "Needs the matching permission granted when the bot was added, and the member must be below the bot's role.",
    body: 'await message.channel.community?.${1|ban,kick,timeout|}(${2:userId}${3:, "reason"});',
  },
  {
    label: "voice-join",
    detail: "Join a voice channel and play a sound",
    documentation: "Needs “Join voice channels” and `npm install @livekit/rtc-node`. Bots can speak and use the soundboard; they can't stream video or share a screen.",
    body: "const voice = await ${1:channel}.join();\nawait voice.playSound(\"${2|ping,boop,pop,chime,buzz,zap,horn,drumroll|}\");\n$0",
  },
  {
    label: "presence",
    detail: "Set what the bot is doing",
    documentation: "Shown on the bot's profile. The SDK keeps the bot online with a heartbeat.",
    body: 'await client.setPresence({ status: "online", activities: [{ type: "${1|playing,listening,watching|}", name: "${2:with Crystal}" }] });',
  },
  {
    label: "dm",
    detail: "Message someone privately",
    documentation: "Only someone who used one of the bot's commands or buttons in the last 15 minutes, in a community that gave it “Send direct messages”. Three per person per window.",
    body: "await interaction.user.send(\"${1:Thanks for using me!}\");",
  },
];

/** Offer the snippets for one kind of project, in that project's files only. Returns a way to stop. */
export function registerSnippets(monaco: typeof Monaco, kind: "extension" | "bot"): Monaco.IDisposable {
  const snippets = kind === "bot" ? BOT_SNIPPETS : EXTENSION_SNIPPETS;
  return monaco.languages.registerCompletionItemProvider("typescript", {
    provideCompletionItems(model, position) {
      // The author's own code, not the SDK's.
      if (!model.uri.path.startsWith("/src/")) return { suggestions: [] };
      const word = model.getWordUntilPosition(position);
      const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
      return {
        suggestions: snippets.map((s) => ({
          label: s.label,
          kind: monaco.languages.CompletionItemKind.Snippet,
          detail: s.detail,
          documentation: { value: s.documentation },
          insertText: s.body,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          // Sorted after TypeScript's own suggestions for the same word, so a real symbol isn't buried.
          sortText: "z" + s.label,
          range,
        })),
      };
    },
  });
}
