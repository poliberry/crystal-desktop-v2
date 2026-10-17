"use client";

import {
  AtSign,
  Bell,
  Bookmark,
  CalendarDays,
  Cake,
  Clapperboard,
  Crown,
  Gamepad2,
  Gavel,
  Hash,
  Headphones,
  Laptop,
  LayoutGrid,
  ListChecks,
  Lock,
  MessageCircleQuestion,
  MessagesSquare,
  MonitorUp,
  Music,
  Newspaper,
  PanelsTopLeft,
  PictureInPicture2,
  Radio,
  Search,
  Server,
  Shield,
  ShieldCheck,
  Smile,
  Sparkles,
  Store,
  Swords,
  Trophy,
  UserCog,
  Users,
  Volume2,
  Wand2,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

import { CtaBand, display, Note, PageIntro, PageShell, SectionHeading, Shot } from "./marketing-ui";

/*
 * /features: what Crystal does today. Only list what ships. If something is
 * half-built, leave it off or label it, and retake a screenshot rather than
 * mocking one up.
 */

type Feature = { icon: LucideIcon; title: string; copy: string; tag?: string };

function FeatureGrid({ items, tone }: { items: Feature[]; tone: string }) {
  return (
    <ul className="mt-10 grid gap-x-8 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(({ icon: Icon, title, copy, tag }) => (
        <li key={title} className="flex gap-4">
          <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", tone)}>
            <Icon className="size-[18px]" strokeWidth={1.9} />
          </span>
          <div>
            <h3 className="flex items-center gap-2 font-semibold text-white">
              {title}
              {tag && <span className="rounded-full border border-amber-200/25 bg-amber-200/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-100">{tag}</span>}
            </h3>
            <p className="mt-1 text-[15px] leading-7 text-white/55">{copy}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

const JUMP = [
  { id: "chat", label: "Chat" },
  { id: "voice", label: "Voice & video" },
  { id: "gaming", label: "Gaming" },
  { id: "creators", label: "Creators" },
  { id: "profiles", label: "Profiles" },
  { id: "moderation", label: "Running a community" },
  { id: "platforms", label: "Where it runs" },
];

const CHAT: Feature[] = [
  { icon: Hash, title: "Communities and channels", copy: "Text and voice channels in collapsible categories, each with its own banner and background." },
  { icon: MessagesSquare, title: "DMs and group chats", copy: "Name the group, give it an icon and a wallpaper, and pin the conversations you open the most." },
  { icon: LayoutGrid, title: "Community overview", copy: "A home page for your space with cards for rules, recent messages, a countdown, events and polls." },
  { icon: AtSign, title: "Replies, reactions and mentions", copy: "Reply, react with any emoji (including your community’s own), pin, forward, and @ the people who need to see it." },
  { icon: Smile, title: "GIFs, stickers and custom emoji", copy: "Search GIFs, clips and stickers, keep favourites, and upload up to 50 emoji per community." },
  { icon: Search, title: "Search that finds it", copy: "Search a channel, a community or a DM. Encrypted chats are searched on your device." },
  { icon: Bookmark, title: "Saved messages", copy: "Save a message for later and set a reminder so you actually come back to it." },
  { icon: Bell, title: "Notifications your way", copy: "One inbox for mentions and replies, and all, mentions-only or nothing for each community." },
  { icon: PanelsTopLeft, title: "Tabs and a priority list", copy: "Keep chats open as tabs and pin the people and channels that matter to the top of the sidebar." },
];

const VOICE: Feature[] = [
  { icon: Headphones, title: "Voice channels", copy: "Drop in and out without calling anyone. Turn your camera on if you like." },
  { icon: Radio, title: "DM and group calls", copy: "Ring a friend or the whole group. Missed a call? It shows up in the chat." },
  { icon: MonitorUp, title: "Screen sharing up to 1080p60", copy: "Share a screen or a window with its sound. The desktop app shares system audio natively on Windows, macOS and Linux, and on Linux you can pick a single app’s audio." },
  { icon: PictureInPicture2, title: "Pop-out player", copy: "Keep a call in a mini player, or pop it into its own always-on-top window on desktop." },
  { icon: Volume2, title: "Noise suppression", copy: "Krisp filters out the keyboard, the fan and the dog." },
  { icon: Music, title: "Soundboard and join sounds", copy: "Built-in sounds plus your community’s own uploads, and a sound that plays when you join." },
];

const GAMING: Feature[] = [
  { icon: Gamepad2, title: "Game detection", copy: "The desktop app recognises what you’re playing and shows it on your profile, with box art and time played." },
  { icon: Music, title: "Now playing", copy: "Shows the song you’re listening to with a live progress bar, on Windows, macOS and Linux." },
  { icon: Trophy, title: "Recent activity", copy: "Your profile lists the games you’ve played lately and for how long. Music isn’t recorded." },
  { icon: Swords, title: "Clans", copy: "A community built around up to five games, with a roster of everyone’s in-game names, ranks and roles." },
  { icon: Users, title: "Looking for group", copy: "Post an open slot for a game. People join in one tap, and the post tidies itself away when it expires." },
  { icon: CalendarDays, title: "Scrims and events", copy: "A calendar with going/maybe RSVPs, a lineup and a cap on numbers." },
  { icon: Server, title: "Game server control", copy: "Connect a Pterodactyl panel to see live stats and start, stop or restart servers, with access set per role." },
  { icon: Sparkles, title: "Lounges", copy: "Turn a voice channel into a little 2D room: walk around, sit down and watch whoever’s streaming on the wall TV." },
  { icon: Radio, title: "Active now", copy: "See what your friends are playing and which calls you could join, from your home page." },
];

const CREATORS: Feature[] = [
  { icon: Clapperboard, title: "Link your channel", copy: "Connect Twitch, YouTube or TikTok and make it your community’s home channel.", tag: "Soon" },
  { icon: Lock, title: "Members-only spaces", copy: "Let in only your Twitch subscribers or YouTube channel members. Crystal checks when they join.", tag: "Soon" },
  { icon: Crown, title: "Tiers become roles", copy: "Membership tiers turn into roles automatically, and are re-checked every few hours.", tag: "Soon" },
  { icon: Newspaper, title: "A newsfeed for your uploads", copy: "Your streams, VODs, videos and Shorts in one channel, with a “Live now” badge when you’re on.", tag: "Soon" },
  { icon: MessageCircleQuestion, title: "AMA channels", copy: "Fans send in and upvote questions, and you answer them one at a time." },
  { icon: Store, title: "Sell your own cosmetics", copy: "Design decorations, nameplates and effects in Studio and sell them in the shop. You keep 80%." },
];

const PROFILES: Feature[] = [
  { icon: Wand2, title: "Decorations, effects and nameplates", copy: "Dress up your avatar and name. Animated ones play when someone looks at your profile." },
  { icon: Sparkles, title: "Statuses with personality", copy: "Say it in a speech bubble, think it in a thought bubble, and clear it automatically later." },
  { icon: Gamepad2, title: "Custom activity", copy: "Set your own “Playing…” or “Watching…”, with link buttons, even when nothing is detected." },
  { icon: UserCog, title: "A different you per server", copy: "Use a different name, avatar or look in each community." },
  { icon: Cake, title: "Birthdays", copy: "A cake where your status dot normally is, and a nudge for your friends to say happy birthday." },
  { icon: Store, title: "The shop", copy: "Cosmetics, community themes, lounge scenes and theme packs. Plenty of them are free." },
];

const MODERATION: Feature[] = [
  { icon: ShieldCheck, title: "Roles and permissions", copy: "21 permissions, a role hierarchy, and overrides for each channel or member." },
  { icon: Gavel, title: "Kick, ban and time out", copy: "Bans stick even if someone gets a new invite. A timeout lets them read but not talk." },
  { icon: Shield, title: "2FA for moderators", copy: "Require two-factor for your mods, and Crystal asks for a fresh code before big admin actions." },
  { icon: ListChecks, title: "Report to Crystal", copy: "Report a person, a message or a whole community to our team when something crosses the line." },
  { icon: Server, title: "Bots that help", copy: "Add bots with exactly the permissions you choose. Everything they do is logged for 30 days." },
  { icon: LayoutGrid, title: "Templates", copy: "Start a community from a template, or share yours with a code so others can copy the setup." },
];

const PLATFORMS: Feature[] = [
  { icon: Laptop, title: "Windows, macOS and Linux", copy: "An installer for Windows, a dmg for Mac, and AppImage, deb and AUR packages for Linux." },
  { icon: PanelsTopLeft, title: "In your browser", copy: "Everything except the desktop extras (game detection, native system-audio sharing and the pop-out) works on the web." },
  { icon: Sparkles, title: "Updates when you want them", copy: "The app checks for updates and installs them when you’re ready. Pick Stable, PTB or Canary." },
];

export function FeaturesPage() {
  return (
    <PageShell>
      <PageIntro note="take a look around" title={<>Everything your group needs, <span className="text-emerald-300">nothing it doesn’t.</span></>}>
        Chat, voice, game nights and the odd creator community: here’s what Crystal does today. It’s in beta, so this list keeps growing.
      </PageIntro>

      <nav aria-label="On this page" className="mx-auto max-w-7xl px-5 sm:px-8">
        <ul className="flex flex-wrap gap-2">
          {JUMP.map((item) => (
            <li key={item.id}>
              <a href={`#${item.id}`} className="inline-block rounded-full border border-white/10 bg-white/[0.03] px-4 py-1.5 text-sm text-white/70 transition hover:border-white/25 hover:text-white">{item.label}</a>
            </li>
          ))}
        </ul>
      </nav>

      <section className="mx-auto max-w-7xl px-5 pt-20 sm:px-8">
        <Shot src="/marketing/shots/10-community-overview.webp" alt="The Greenhouse community open in Crystal, with its channel list, the #general conversation and the member list" priority className="rotate-[-0.6deg]" />
      </section>

      <div className="mx-auto max-w-7xl space-y-28 px-5 pt-28 sm:px-8">
        <section>
          <SectionHeading id="chat" eyebrow="Chat" title="Somewhere for every conversation.">
            Big community, small group chat or a quick DM: it’s all in the same sidebar.
          </SectionHeading>
          <FeatureGrid items={CHAT} tone="bg-emerald-300/10 text-emerald-200" />
        </section>

        <section>
          <SectionHeading id="voice" eyebrow="Voice & video" title="Talk when typing gets slow.">
            Voice channels you can wander into, calls when you want to ring someone, and screen sharing that looks sharp.
          </SectionHeading>
          <FeatureGrid items={VOICE} tone="bg-sky-300/10 text-sky-200" />
        </section>

        <section>
          <div className="grid items-end gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
            <SectionHeading id="gaming" eyebrow="Gaming" title="Built for game night.">
              Crystal knows what you’re playing, helps you find a squad and keeps the clan organised.
            </SectionHeading>
            <div className="relative mx-auto flex w-full max-w-md items-end justify-center gap-4">
              <img src="/marketing/shots/profile-sam.webp" alt="Sam's profile card showing Minecraft, with time played" width={560} height={1080} loading="lazy" className="h-auto w-[48%] -rotate-3 rounded-2xl border border-white/10 shadow-2xl" />
              <img src="/marketing/shots/profile-jordan.webp" alt="Jordan's profile card showing the song he's listening to on Spotify" width={560} height={1120} loading="lazy" className="h-auto w-[48%] rotate-2 rounded-2xl border border-white/10 shadow-2xl" />
            </div>
          </div>
          <FeatureGrid items={GAMING} tone="bg-violet-300/10 text-violet-200" />
        </section>

        <section className="relative overflow-hidden rounded-[2rem] border border-white/[0.08] bg-gradient-to-br from-[#1a1220] to-[#0e1016] px-6 py-14 sm:px-12 sm:py-16">
          <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-fuchsia-500/10 blur-3xl" />
          <div className="relative">
            <SectionHeading id="creators" eyebrow="For YouTube & Twitch creators" title="A home for your community, not just your chat.">
              Link your channel and Crystal brings your uploads, your streams and your members together in one place. Your fans already have a Crystal account for their friends, so there’s nothing new to sign up for.
            </SectionHeading>
            <FeatureGrid items={CREATORS} tone="bg-fuchsia-300/10 text-fuchsia-200" />
            <p className="mt-10 max-w-2xl text-sm leading-6 text-white/45">
              Creator communities are coming soon: we’re finishing verification with the platforms before opening them up. Members-only gating will use Twitch subscriptions (Affiliate and Partner channels) and YouTube channel memberships. TikTok has no membership data, so TikTok communities will be public.
            </p>
          </div>
        </section>

        <section>
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <div>
              <SectionHeading id="profiles" eyebrow="Profiles" title="Look like yourself.">
                Your profile is more than a picture and a name. Make it as loud or as quiet as you like.
              </SectionHeading>
              <Note className="mt-6 rotate-[-2deg] text-rose-200">try them on before you pick ↓</Note>
            </div>
            <Shot src="/marketing/shots/08-marketplace.webp" alt="The Crystal shop, previewing a nameplate and avatar decorations on Maya's own profile" className="rotate-1" />
          </div>
          <FeatureGrid items={PROFILES} tone="bg-rose-300/10 text-rose-200" />
        </section>

        <section>
          <SectionHeading id="moderation" eyebrow="Running a community" title="Tools for the people keeping it nice.">
            Owners and mods get proper controls, and our team is there for the things a community can’t handle on its own.
          </SectionHeading>
          <FeatureGrid items={MODERATION} tone="bg-amber-300/10 text-amber-200" />
        </section>

        <section className="grid items-center gap-10 rounded-[2rem] border border-emerald-200/10 bg-emerald-300/[0.04] px-6 py-12 sm:px-12 lg:grid-cols-[auto_1fr_auto]">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-emerald-300/10 text-emerald-200"><Lock className="size-5" /></span>
          <div>
            <h2 className={cn(display.className, "text-2xl font-bold tracking-[-0.03em] sm:text-3xl")}>Messages are end-to-end encrypted.</h2>
            <p className="mt-2 max-w-2xl text-[15px] leading-7 text-white/55">The text of your DMs and community messages is locked on your device before it’s sent. Read exactly what is and isn’t encrypted, and who we share data with.</p>
          </div>
          <a href="/privacy/" className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-white/85 transition hover:border-white/30 hover:bg-white/[0.04]">How we handle your data</a>
        </section>

        <section>
          <SectionHeading id="platforms" eyebrow="Where it runs" title="On your computer, or in a browser tab.">
            The desktop app has a few extras. Everything else works the same on the web.
          </SectionHeading>
          <FeatureGrid items={PLATFORMS} tone="bg-white/[0.06] text-white/80" />
        </section>
      </div>

      <CtaBand />
    </PageShell>
  );
}
