"use client";

import {
  ArrowRight,
  Blocks,
  Bot,
  BrushIcon,
  Code2,
  FileCode2,
  KeyRound,
  Library,
  MessageSquareCode,
  MousePointerClick,
  PenTool,
  Rocket,
  ShieldCheck,
  Sparkles,
  Store,
  Terminal,
  Timer,
  Wallet,
  Webhook,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

import { CtaBand, display, Note, PageIntro, PageShell, SectionHeading } from "./marketing-ui";

/*
 * /makers: Crystal Studio, the bot and extension SDKs, and selling in the shop.
 * The code samples are copied from the Studio guides (src/studio/docs/content),
 * which are type-checked against the SDKs. If the SDK changes, copy them again.
 */

type Item = { icon: LucideIcon; title: string; copy: string };

function Grid({ items, tone }: { items: Item[]; tone: string }) {
  return (
    <ul className="mt-10 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(({ icon: Icon, title, copy }) => (
        <li key={title} className="flex gap-4">
          <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", tone)}><Icon className="size-[18px]" strokeWidth={1.9} /></span>
          <div>
            <h3 className="font-semibold text-white">{title}</h3>
            <p className="mt-1 text-[15px] leading-7 text-white/55">{copy}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Code({ file, children }: { file: string; children: string }) {
  return (
    <figure className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[#0e1116] shadow-[0_30px_70px_-35px_rgb(0_0_0/0.9)]">
      <figcaption className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-3 font-mono text-xs text-white/45">
        <Code2 className="size-4 text-amber-200" /> {file}
      </figcaption>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words p-5 font-mono text-[12.5px] leading-6 text-white/80"><code>{children}</code></pre>
    </figure>
  );
}

const BOT_EXAMPLE = `import { Client, Events } from "@crystal/bot";

const client = new Client(); // reads CRYSTAL_BOT_TOKEN and CRYSTAL_SIGNING_SECRET

client.on(Events.Ready, (c) => {
  console.log("Online as " + c.user?.name + " in " + c.communities.size + " communities.");
});

client.on(Events.MessageCreate, async (message) => {
  if (message.fromBot) return; // never answer bots, or two bots will talk forever
  if (message.content === "!ping") await message.reply("pong");
});

await client.login(); // checks the token, loads the communities, shows the bot online`;

const EXTENSION_EXAMPLE = `import { Extension, Panel, storage, ui } from "@crystal/extension";

const ext = new Extension();

const panel = new Panel(
  (s: { count: number }) =>
    ui.column([
      ui.heading("Hello from my extension"),
      ui.text("Clicked " + s.count + " times"),
      ui.row([ui.button("Click me", "click"), ui.button("Reset", "reset", { variant: "secondary" })]),
    ]),
  { count: 0 },
);

ext.onOpen(async () => {
  panel.setState({ count: (await storage.get<number>("count")) ?? 0 });
});

ext.onAction("click", async () => {
  const count = panel.state.count + 1;
  await storage.set("count", count);
  panel.setState({ count });
});`;

const STUDIO: Item[] = [
  { icon: PenTool, title: "A design editor", copy: "Pen, brushes, shapes and text, procedural materials, glows and shaders, with snapping and unlimited undo." },
  { icon: Timer, title: "A timeline for animation", copy: "Animate nameplates and profile effects on a proper timeline, up to 12 seconds long." },
  { icon: Sparkles, title: "Real previews", copy: "See your work on Crystal’s actual renderers: a real profile card, a real member list." },
  { icon: Terminal, title: "A code workbench", copy: "Monaco editor, file tree, terminal and git, with the SDK types and Crystal’s lint rules built in." },
  { icon: Library, title: "Docs where you work", copy: "Step-by-step guides and a full API reference generated from the SDKs, right inside Studio." },
  { icon: MessageSquareCode, title: "Bring your AI tools", copy: "Every project comes with an AGENTS.md and a local MCP server, so Claude Code, Cursor or Codex can read the guides and help. They can’t publish for you." },
];

const BOTS: Item[] = [
  { icon: Webhook, title: "Events for everything", copy: "Messages, reactions, members, channels, voice and button clicks, delivered as they happen." },
  { icon: MousePointerClick, title: "Slash commands and buttons", copy: "Register up to 25 commands, and reply with embeds and rows of buttons." },
  { icon: ShieldCheck, title: "Only the powers it’s given", copy: "A bot can do what its community granted and no more. It can never be made an administrator." },
  { icon: KeyRound, title: "End-to-end encryption", copy: "Bots have their own keys and decrypt messages themselves, so encrypted chats stay encrypted." },
  { icon: Rocket, title: "Run it anywhere", copy: "You host your bot. By default it polls for events, so it works on a laptop with no public address." },
  { icon: FileCode2, title: "Any language", copy: "Prefer Python or Go? The HTTP Bot API at api.usecrystal.app does everything the SDK does." },
];

const SELL: Item[] = [
  { icon: BrushIcon, title: "Make it in Studio", copy: "Avatar decorations, stickers, nameplates, profile effects, lounge scenes and theme packs." },
  { icon: ShieldCheck, title: "We review every item", copy: "A person checks each submission before it goes on sale, and again when you update it." },
  { icon: Store, title: "Set your price", copy: "Free, or anywhere from 0.50 to 500 in USD, AUD, EUR or GBP. Bundle up to 8 items in a pack." },
  { icon: Wallet, title: "Keep 80%", copy: "Paid out through Stripe. Sales made before you set up payouts are held for you, not lost." },
];

export function MakersPage() {
  return (
    <PageShell>
      <PageIntro note="for the tinkerers" noteClass="text-amber-200" title={<>Make something <span className="text-amber-200">people will use.</span></>}>
        Crystal Studio is where you design cosmetics, write bots and build extensions, with the docs, previews and tools in one app.
      </PageIntro>

      <div className="mx-auto flex max-w-7xl flex-wrap gap-3 px-5 sm:px-8">
        <a href="/studio" className="inline-flex items-center gap-2 rounded-xl bg-amber-200 px-5 py-3 text-sm font-bold text-[#1a1306] transition hover:bg-amber-100 active:scale-[0.97]">Open Studio <ArrowRight className="size-4" /></a>
        <a href="#bots" className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold text-white/80 transition hover:border-white/30 hover:text-white">Build a bot</a>
        <a href="#sell" className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold text-white/80 transition hover:border-white/30 hover:text-white">Sell cosmetics</a>
      </div>

      <div className="mx-auto max-w-7xl space-y-28 px-5 pt-24 sm:px-8">
        <section>
          <SectionHeading id="studio" eyebrow="Crystal Studio" title="One app for designing and coding.">
            Open it from Settings in Crystal, or at <span className="font-mono text-white/75">/studio</span> in your browser. Your projects are plain files on your computer, and nothing is uploaded until you submit.
          </SectionHeading>
          <Grid items={STUDIO} tone="bg-amber-300/10 text-amber-200" />
        </section>

        <section className="grid grid-cols-1 items-start gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div>
            <SectionHeading id="bots" eyebrow={"Bots · @crystal/bot"} title="A bot in a dozen lines.">
              The SDK has no dependencies and runs on Node 18 or newer. Make a bot in Studio, copy its token, and this is all it takes to answer <span className="font-mono text-white/75">!ping</span>.
            </SectionHeading>
            <Note className="mt-6 rotate-[-2deg] text-amber-200">yes, really, that’s the whole thing →</Note>
          </div>
          <Code file="index.ts">{BOT_EXAMPLE}</Code>
        </section>
        <Grid items={BOTS} tone="bg-sky-300/10 text-sky-200" />

        <section className="grid grid-cols-1 items-start gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="order-2 min-w-0 lg:order-1"><Code file="extension.ts">{EXTENSION_EXAMPLE}</Code></div>
          <div className="order-1 lg:order-2">
            <SectionHeading id="extensions" eyebrow={"Extensions · @crystal/extension"} title="Add a panel to Crystal.">
              <p>Extensions are small apps that open inside Crystal. Their code runs on the user’s own computer in a locked-down sandbox: no access to the page, no network except the sites they list, and a UI built from Crystal’s own components so it always fits in.</p>
              <p className="mt-4">They can keep a little storage, call the sites they’ve declared, and send notifications. Every version is read by a person before anyone can install it.</p>
            </SectionHeading>
            <p className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm leading-6 text-white/55">
              <Blocks className="mr-1.5 inline size-4 align-[-3px] text-white/70" />
              Extensions are in early access: you can build and test them in Studio today, and we’re opening publishing to everyone soon.
            </p>
          </div>
        </section>

        <section className="relative overflow-hidden rounded-[2rem] border border-white/[0.08] bg-gradient-to-br from-[#1a1710] to-[#0e1016] px-6 py-14 sm:px-12 sm:py-16">
          <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 size-80 rounded-full bg-amber-400/10 blur-3xl" />
          <div className="relative">
            <SectionHeading id="sell" eyebrow="The shop" title="Get paid for what you make.">
              Design something people want on their profile and sell it to everyone on Crystal.
            </SectionHeading>
            <Grid items={SELL} tone="bg-amber-300/10 text-amber-200" />
          </div>
        </section>

        <section className="grid items-center gap-10 lg:grid-cols-[1fr_auto]">
          <div>
            <h2 className={cn(display.className, "text-3xl font-bold tracking-[-0.035em] sm:text-4xl")}>Run a YouTube or Twitch channel?</h2>
            <p className="mt-3 max-w-2xl text-[17px] leading-8 text-white/55">
              Creator communities are coming soon: link your channel, turn memberships into roles, and keep your uploads and streams in a newsfeed. Pair them with your own cosmetics in the shop.
            </p>
          </div>
          <a href="/features/#creators" className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold text-white/85 transition hover:border-white/30 hover:bg-white/[0.04]">
            <Bot className="size-4" /> See creator features
          </a>
        </section>
      </div>

      <CtaBand title="Start building.">Studio is free. Open it in your browser or from Settings in the desktop app.</CtaBand>
    </PageShell>
  );
}
