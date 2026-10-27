"use client";

import {
  ArrowDownToLine,
  ArrowRight,
  Code2,
  Command,
  Compass,
  Headphones,
  Lock,
  Palette,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { ArrowDown, ArrowUp, Ring, Sparkle, Underline } from "./marketing-doodles";
import styles from "./marketing-page.module.css";
import { DownloadButton } from "./downloads";
import { Avatar, display, Note, PageShell, PEOPLE, Shot } from "./marketing-ui";

/*
 * The landing page at `/`.
 *
 * Everything pictured is the real app: the screenshots in public/marketing/shots
 * were taken from a live session of The Greenhouse, a small made-up friend group
 * (Alex, Maya, Jordan and Sam), and the chat replay below quotes the same
 * conversation. Keep it that way — if a feature changes, retake the picture
 * rather than mocking one up.
 *
 * Motion is CSS only (see marketing-page.module.css) and stops under
 * prefers-reduced-motion; the replay shows the whole conversation at once then.
 */


/** #game-chat in The Greenhouse, word for word. */
const REPLAY: { who: keyof typeof PEOPLE; text: string }[] = [
  { who: "maya", text: "finally finished the greenhouse in stardew!! ancient fruit season starts now 🍇" },
  { who: "jordan", text: "wait how. we've been broke for two whole seasons" },
  { who: "maya", text: "I may have sold all of your fish 🙃" },
  { who: "jordan", text: "MAYA. the legend was in there" },
  { who: "sam", text: "lmao. meanwhile I put a glass roof on the minecraft base and it looks so good at night" },
  { who: "alex", text: "screenshot or it didn't happen 👀" },
];

const STATUSES = [
  "🎲 Planning Friday’s game night",
  "🌱 Watering the crops",
  "☕ Back in 10, making coffee",
  "🎧 Stardew Valley Overture",
  "🔨 Building the greenhouse roof",
  "🍿 Spirited Away at 10?",
  "🌙 Deadline mode, ping me after 6",
  "🐟 Not talking about the fish",
];

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

/**
 * How many people are on Crystal, and how many are online now.
 *
 * The landing page runs without the Convex client (see components/providers.tsx), so this is one plain
 * request to the query HTTP endpoint. The numbers are a cached row the server recounts every few minutes
 * (convex/publicStats.ts), so it's cheap however many visitors there are. Until it answers, or if it
 * can't, the line reads without a number rather than showing a zero.
 */
function PeopleCount() {
  const [stats, setStats] = useState<{ members: number; online: number } | null>(null);

  useEffect(() => {
    if (!CONVEX_URL) return;
    const controller = new AbortController();
    fetch(`${CONVEX_URL}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "publicStats:get", args: {}, format: "json" }),
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (body?.status === "success" && body.value) setStats({ members: Number(body.value.members), online: Number(body.value.online) });
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const format = (n: number) => n.toLocaleString("en");

  return (
    <div className="mt-9 flex items-center gap-3.5">
      <div className="flex shrink-0 -space-x-2.5">
        {Object.values(PEOPLE).map((person) => (
          <Avatar key={person.name} person={person} className="size-9 ring-[3px] ring-[#0b0d12]" />
        ))}
      </div>
      <p className="text-[15px] leading-snug text-white/70" aria-live="polite">
        {stats ? (
          <>
            <b className="font-semibold text-white">{format(stats.members)} {stats.members === 1 ? "person" : "people"}</b> on Crystal
            {stats.online > 0 && (
              <span className="mt-0.5 flex items-center gap-1.5 text-[13px] text-white/55">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:hidden" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
                </span>
                {format(stats.online)} online right now
              </span>
            )}
          </>
        ) : (
          <>Your friends are probably already here.</>
        )}
      </p>
    </div>
  );
}


/**
 * The #game-chat conversation, typed out one message at a time once it scrolls
 * into view, then a pause and round again. Shows everything at once for anyone
 * who has asked for less motion.
 */
function ChatReplay() {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.35 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (reduced || !visible) return;
    const done = shown >= REPLAY.length;
    const timer = window.setTimeout(() => setShown(done ? 0 : shown + 1), done ? 4500 : shown === 0 ? 500 : 1500);
    return () => window.clearTimeout(timer);
  }, [reduced, visible, shown]);

  const count = reduced ? REPLAY.length : shown;
  const next = REPLAY[count];

  return (
    <div ref={ref} className="relative rounded-3xl border border-white/10 bg-[#121419] p-4 shadow-[0_30px_70px_-35px_rgb(0_0_0/0.9)] sm:p-5">
      <div className="mb-4 flex items-center gap-2 border-b border-white/[0.07] pb-3 text-sm">
        <img src="/marketing/avatars/greenhouse.svg" alt="" width={24} height={24} className="size-6 rounded-md" />
        <span className="font-semibold text-white/85">The Greenhouse</span>
        <span className="text-white/30">/</span>
        <span className="text-white/55"># game-chat</span>
      </div>
      {/* Fixed height so the page doesn't jump as messages arrive. */}
      <ol aria-label="Messages in #game-chat" className="flex h-[22rem] flex-col justify-end gap-3 overflow-hidden sm:h-[20rem]">
        {REPLAY.slice(0, count).map((message, index) => {
          const person = PEOPLE[message.who];
          return (
            <li key={`${shown}-${index}`} className={cn("flex items-start gap-3", !reduced && index === count - 1 && styles.pop)}>
              <Avatar person={person} className="mt-0.5 size-8 shrink-0" />
              <div className="min-w-0">
                <p className={cn("text-[13px] font-semibold", person.colour)}>{person.name}</p>
                <p className="text-[14px] leading-snug text-white/80">{message.text}</p>
              </div>
            </li>
          );
        })}
      </ol>
      <p aria-hidden className="mt-3 flex h-5 items-center gap-2 text-xs text-white/40">
        {next && !reduced && visible ? (
          <>
            <span className="flex gap-0.5">
              <span className={cn(styles.dot, "size-1 rounded-full bg-white/60")} />
              <span className={cn(styles.dot, "size-1 rounded-full bg-white/60")} />
              <span className={cn(styles.dot, "size-1 rounded-full bg-white/60")} />
            </span>
            {PEOPLE[next.who].name.split(" ")[0]} is typing…
          </>
        ) : null}
      </p>
    </div>
  );
}

const NOTES = [
  {
    icon: Headphones,
    title: "Voice, one click away",
    copy: "Drop into a voice channel when typing gets slow. Leave when dinner’s ready.",
    paper: "bg-emerald-300/[0.09] border-emerald-200/15 text-emerald-100",
    tilt: "-rotate-2",
  },
  {
    icon: Command,
    title: "Find anything with ⌘K",
    copy: "Jump to a channel, a friend or that one message from last Tuesday.",
    paper: "bg-sky-300/[0.09] border-sky-200/15 text-sky-100",
    tilt: "rotate-1",
  },
  {
    icon: Palette,
    title: "Dress up your profile",
    copy: "Avatar decorations, nameplates and effects from the shop. Plenty of them free.",
    paper: "bg-rose-300/[0.09] border-rose-200/15 text-rose-100",
    tilt: "-rotate-1",
  },
  {
    icon: Compass,
    title: "Find a new crowd",
    copy: "Browse public communities by interest, or keep yours invite-only.",
    paper: "bg-amber-300/[0.09] border-amber-200/15 text-amber-100",
    tilt: "rotate-2",
  },
];

export function MarketingPage() {
  const [username, setUsername] = useState("");
  const [usernameError, setUsernameError] = useState("");

  function tryCrystal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = username.trim().replace(/^@/, "");
    if (!value) {
      setUsernameError("Pick a username first. You can change it later.");
      return;
    }
    window.location.assign(`/app?username=${encodeURIComponent(value)}`);
  }

  function focusSignup(event: React.MouseEvent) {
    event.preventDefault();
    const input = document.getElementById("crystal-username");
    input?.scrollIntoView({ behavior: "smooth", block: "center" });
    input?.focus({ preventScroll: true });
  }

  return (
    <PageShell>

        {/* ---------------------------------------------------------------- Hero */}
        <section className="mx-auto grid max-w-7xl items-center gap-14 px-5 pb-16 pt-8 sm:px-8 sm:pt-14 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-8 lg:pb-24">
          <div className="relative z-10">
            <span className="inline-flex -rotate-2 items-center gap-2 rounded-full border border-amber-200/25 bg-amber-200/10 px-3 py-1 text-xs font-semibold text-amber-100">
              <Sparkle className="size-3 text-amber-200" /> Free, and still in beta
            </span>
            <h1 className={cn(display.className, "mt-6 text-[clamp(2.9rem,6vw,4.9rem)] font-black leading-[0.95] tracking-[-0.045em]")}>
              Your group chat
              <br />
              deserves a{" "}
              <span className="relative inline-block whitespace-nowrap">
                <span className="bg-gradient-to-r from-emerald-300 via-teal-300 to-sky-400 bg-clip-text text-transparent">real home.</span>
                <Underline className="absolute -bottom-3 left-0 h-4 w-full text-emerald-300/80" />
              </span>
            </h1>
            <p className="mt-8 max-w-[30rem] text-lg leading-8 text-white/60">
              Crystal is where your friends hang out between game nights: chat, voice, DMs and statuses that actually say what everyone’s up to.
            </p>

            <form onSubmit={tryCrystal} className="mt-8 max-w-[28rem]">
              <label htmlFor="crystal-username" className="sr-only">Pick a username</label>
              <div className="flex items-center gap-2 rounded-2xl border border-white/[0.12] bg-white/[0.05] p-1.5 focus-within:border-emerald-200/50 focus-within:ring-4 focus-within:ring-emerald-300/10">
                <span className="pl-3 text-white/35" aria-hidden>@</span>
                <input
                  id="crystal-username"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value);
                    setUsernameError("");
                  }}
                  placeholder="pick a username"
                  aria-describedby={usernameError ? "username-error" : "username-hint"}
                  className="h-11 min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-white/30"
                />
                <button type="submit" className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-emerald-300 px-4 text-sm font-bold text-[#06110c] transition hover:bg-emerald-200 active:scale-[0.97]">
                  Jump in <ArrowRight className="size-4" />
                </button>
              </div>
              {usernameError ? (
                <p id="username-error" role="alert" className="mt-2 text-sm text-rose-300">{usernameError}</p>
              ) : (
                <p id="username-hint" className="mt-2 text-[13px] text-white/40">Try it in your browser, no download. Make an account when you’re ready to keep it.</p>
              )}
            </form>

            <PeopleCount />
          </div>

          {/*
            The real app, slightly askew. Nothing sits on top of the picture itself: the pull-outs hang off its
            corners and the handwritten note lives underneath it, on the page, where it can be read.
          */}
          <div className="relative mx-auto w-full max-w-[46rem]">
            <div className="pt-8 sm:pl-[24%] sm:pt-6">
              <Shot
                src="/marketing/shots/hero-general.webp"
                alt="The #general channel in The Greenhouse, with Alex, Maya, Jordan and Sam chatting and the member list showing what each of them is up to"
                width={1888}
                height={1440}
                priority
                className="rotate-[1.5deg]"
              />
            </div>

            <figure className={cn(styles.float, "absolute -left-3 top-[30%] hidden w-[25%] max-w-[11rem] -rotate-[5deg] sm:block")}>
              <img src="/marketing/shots/profile-jordan.webp" alt="Jordan's profile card: “Back in 10, making coffee”, listening to the Stardew Valley Overture on Spotify" width={560} height={1120} loading="eager" className="h-auto w-full rounded-2xl border border-white/10 shadow-[0_30px_60px_-20px_rgb(0_0_0/0.95)]" />
            </figure>

            <div className={cn(styles.floatSlow, "absolute -top-1 right-0 flex rotate-[3deg] items-center gap-2 rounded-full border border-white/10 bg-[#16191f] py-1.5 pl-1.5 pr-4 text-sm shadow-xl sm:-right-4")}>
              <span className="relative">
                <Avatar person={PEOPLE.maya} className="size-7" />
                <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-400 ring-2 ring-[#16191f]" />
              </span>
              <span className="text-white/85">Maya is playing <b className="font-semibold text-white">Stardew Valley</b></span>
            </div>

            {/* Under the member list (the right third of the picture), with the arrow climbing into it. */}
            <div className="mt-1 flex items-end justify-end gap-1 pr-[8%]">
              <Note className="mb-1 max-w-[15rem] rotate-[-2deg] text-right text-amber-100">statuses that say something, not just “online”</Note>
              <ArrowUp className="h-16 w-11 shrink-0 text-amber-200" animate={false} />
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- Ticker */}
        <div className={cn(styles.marqueeTrack, "relative -rotate-1 overflow-hidden border-y border-white/[0.07] bg-white/[0.025] py-3.5")} aria-label="Things people in The Greenhouse are up to">
          <div className={cn(styles.marquee, "flex w-max gap-3")}>
            {[0, 1].map((copy) => (
              <ul key={copy} aria-hidden={copy === 1} className="flex gap-3">
                {STATUSES.map((status) => (
                  <li key={status} className="whitespace-nowrap rounded-full border border-white/[0.08] bg-[#14171d] px-4 py-1.5 text-sm text-white/70">{status}</li>
                ))}
              </ul>
            ))}
          </div>
        </div>

        {/* ------------------------------------------------------------ Tour */}
        <section id="tour" className="mx-auto max-w-7xl scroll-mt-8 px-5 pt-24 sm:px-8 sm:pt-32">
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
            <div>
              <Note className="text-emerald-200">meet the greenhouse ↓</Note>
              <h2 className={cn(display.className, "mt-2 text-4xl font-bold leading-[1.05] tracking-[-0.04em] sm:text-5xl")}>
                Four friends, one farm, <span className="text-emerald-300">too many fish.</span>
              </h2>
              <p className="mt-5 max-w-md text-[17px] leading-8 text-white/55">
                Every community gets text channels for the chatter, voice channels for the late nights and a members list that shows who’s around. Set it up in a minute, tidy it up whenever.
              </p>
              <ul className="mt-6 space-y-2.5 text-[15px] text-white/70">
                <li className="flex gap-3"><span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-emerald-300" />Channels and categories, sorted how you like</li>
                <li className="flex gap-3"><span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-sky-300" />Roles and permissions when the group grows</li>
                <li className="flex gap-3"><span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-violet-300" />Invite-only, or open to anyone who finds you</li>
              </ul>
            </div>
            <ChatReplay />
          </div>

          {/* Side quests */}
          <div className="mt-28 grid items-center gap-12 sm:mt-36 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-16">
            <div className="relative order-2 lg:order-1">
              <Shot src="/marketing/shots/dm.webp" alt="A direct message between Maya and Alex: Maya asks Alex not to tell Jordan about the fish" width={1888} height={1080} className="-rotate-1">
                {/* Around "…don't tell him 🤫". Measured from the capture, so it lands on that line at any width. */}
                <Ring className="pointer-events-none absolute left-[3.5%] top-[63%] h-[12%] w-[63%] text-rose-300" />
              </Shot>
              <Note className="absolute -bottom-9 left-[30%] rotate-[-3deg] text-rose-200">the fish incident</Note>
            </div>
            <div className="order-1 lg:order-2">
              <Note className="text-rose-200">psst</Note>
              <h2 className={cn(display.className, "mt-2 text-4xl font-bold leading-[1.05] tracking-[-0.04em] sm:text-5xl")}>
                DMs for the side quests.
              </h2>
              <p className="mt-5 max-w-md text-[17px] leading-8 text-white/55">
                Plan the surprise, share the cursed screenshot, or call when it’s quicker than typing. The fish thing stays between you two.
              </p>
            </div>
          </div>

          {/* Profiles */}
          <div className="mt-28 grid items-center gap-14 sm:mt-36 lg:grid-cols-2 lg:gap-16">
            <div>
              <Note className="text-sky-200">a bit more than a green dot</Note>
              <h2 className={cn(display.className, "mt-2 text-4xl font-bold leading-[1.05] tracking-[-0.04em] sm:text-5xl")}>
                See what everyone’s up to.
              </h2>
              <p className="mt-5 max-w-md text-[17px] leading-8 text-white/55">
                Set a status in a speech bubble (or a thought one, for the things you’re only thinking). Crystal’s desktop app can show the game you’re in or the song you’re playing, so “want to join?” gets easy.
              </p>
            </div>
            <div className="relative mx-auto flex w-full max-w-[34rem] items-start justify-center gap-4 pt-4 sm:gap-6">
              <img src="/marketing/shots/profile-sam.webp" alt="Sam's profile card: Do Not Disturb, “Deadline mode, ping me after 6”, playing Minecraft" width={560} height={1080} loading="lazy" decoding="async" className="h-auto w-[46%] -rotate-3 rounded-2xl border border-white/10 shadow-[0_30px_60px_-25px_rgb(0_0_0/0.9)]" />
              <img src="/marketing/shots/members.webp" alt="The member list: everyone online, each with a game, a song or a status underneath their name" width={608} height={720} loading="lazy" decoding="async" className="mt-14 h-auto w-[46%] rotate-2 rounded-2xl border border-white/10 shadow-[0_30px_60px_-25px_rgb(0_0_0/0.9)]" />
              <div className="absolute -left-2 -top-6 flex items-center gap-1 sm:-left-8">
                <Note className="-rotate-6 text-sky-200">Sam is busy, be nice</Note>
                <ArrowDown className="mt-6 h-12 w-7 -rotate-12 text-sky-200/80" />
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------- Sticky notes */}
        <section className="mx-auto max-w-7xl px-5 pt-28 sm:px-8 sm:pt-36">
          <h2 className={cn(display.className, "max-w-xl text-3xl font-bold tracking-[-0.035em] sm:text-4xl")}>
            And the small stuff that makes it feel like yours.
          </h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {NOTES.map(({ icon: Icon, title, copy, paper, tilt }) => (
              <div key={title} className={cn(styles.paper, "rounded-2xl border p-6 transition duration-300 hover:rotate-0 hover:-translate-y-1", paper, tilt)}>
                <Icon className="size-6 opacity-90" strokeWidth={1.75} />
                <h3 className="mt-6 text-lg font-semibold text-white">{title}</h3>
                <p className="mt-2 text-[15px] leading-7 text-white/60">{copy}</p>
              </div>
            ))}
          </div>
          <div className="mt-14 grid gap-6 lg:grid-cols-2">
            <figure>
              <Shot src="/marketing/shots/09-command-palette.webp" alt="The ⌘K search, listing settings, recent channels and conversations" />
              <figcaption className="mt-3 text-sm text-white/40">⌘K, from anywhere in the app.</figcaption>
            </figure>
            <figure>
              <Shot src="/marketing/shots/08-marketplace.webp" alt="The shop, with nameplates and avatar decorations previewed on Maya's own profile" />
              <figcaption className="mt-3 text-sm text-white/40">The shop previews everything on your own profile before you pick it.</figcaption>
            </figure>
          </div>
        </section>

        {/* --------------------------------------------------------- Privacy */}
        <section id="private" className="mx-auto max-w-7xl scroll-mt-8 px-5 pt-28 sm:px-8 sm:pt-36">
          <div className="relative overflow-hidden rounded-[2rem] border border-white/[0.08] bg-gradient-to-br from-[#10161a] to-[#0d1016] px-6 py-14 sm:px-14 sm:py-20">
            <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 size-80 rounded-full bg-emerald-400/10 blur-3xl" />
            <div className="relative grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
              <div>
                <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-emerald-300/10 text-emerald-200"><Lock className="size-5" /></span>
                <h2 className={cn(display.className, "mt-6 text-4xl font-bold leading-[1.05] tracking-[-0.04em] sm:text-5xl")}>
                  Locked before it leaves your device.
                </h2>
                <p className="mt-5 max-w-lg text-[17px] leading-8 text-white/55">
                  Messages in your DMs and communities are end-to-end encrypted. Crystal’s servers pass them along without being able to read them. You keep a recovery key, so a new laptop doesn’t mean losing your history.
                </p>
              </div>
              <div aria-hidden className="space-y-3 font-mono text-[13px]">
                <div className="rounded-2xl border border-white/[0.08] bg-black/30 p-4">
                  <p className="mb-1.5 text-[11px] uppercase tracking-[0.16em] text-white/30">What the server sees</p>
                  <p className="break-all text-white/35">5VDmbayV26pk3FOcMETt8qdYnOBbCJYQy80W_XqxcYvgZvucC_QMDT0cm4gLKGY7wZe7VD8Y…</p>
                </div>
                <div className="rounded-2xl border border-emerald-200/15 bg-emerald-300/[0.06] p-4 font-sans">
                  <p className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-emerald-200/60">What Alex sees</p>
                  <p className="text-[15px] text-white/85">jordan doesn’t know about the fish thing yet, don’t tell him 🤫</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- Makers */}
        <section id="makers" className="mx-auto grid max-w-7xl grid-cols-1 scroll-mt-8 items-center gap-12 px-5 pt-28 sm:px-8 sm:pt-36 lg:grid-cols-2">
          <div>
            <Note className="text-amber-200">for the tinkerers</Note>
            <h2 className={cn(display.className, "mt-2 text-4xl font-bold leading-[1.05] tracking-[-0.04em] sm:text-5xl")}>Build the bot your group keeps joking about.</h2>
            <p className="mt-5 max-w-md text-[17px] leading-8 text-white/55">
              Crystal Studio has the SDK, the API reference and examples in one place, plus somewhere to try your bot or extension before anyone else sees it.
            </p>
            <a href="/studio" className="mt-7 inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-white/85 transition hover:border-white/30 hover:bg-white/[0.04]">
              Open Studio <ArrowRight className="size-4" />
            </a>
          </div>
          <div className="min-w-0 rotate-1 rounded-2xl border border-white/10 bg-[#0e1116] shadow-[0_30px_70px_-35px_rgb(0_0_0/0.9)]">
            <div className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-3 font-mono text-xs text-white/45">
              <Code2 className="size-4 text-amber-200" /> fish-alarm.ts
            </div>
            <pre className="overflow-x-auto p-5 font-mono text-[12.5px] leading-6 text-white/80">
              <code>
                <span className="text-violet-300">import</span> {"{ Client, Events }"} <span className="text-violet-300">from</span> <span className="text-emerald-200">&quot;@crystal/bot&quot;</span>;{"\n\n"}
                <span className="text-violet-300">const</span> client = <span className="text-violet-300">new</span> <span className="text-sky-200">Client</span>();{"\n\n"}
                <span className="text-white/35">{"// Someone mentioned the fish again."}</span>{"\n"}
                client.<span className="text-sky-200">on</span>(Events.MessageCreate, <span className="text-violet-300">async</span> (message) =&gt; {"{"}{"\n"}
                {"  "}<span className="text-violet-300">if</span> (message.fromBot) <span className="text-violet-300">return</span>;{"\n"}
                {"  "}<span className="text-violet-300">if</span> (message.content.<span className="text-sky-200">includes</span>(<span className="text-emerald-200">&quot;fish&quot;</span>)) {"{"}{"\n"}
                {"    "}<span className="text-violet-300">await</span> message.<span className="text-sky-200">react</span>(<span className="text-emerald-200">&quot;🐟&quot;</span>);{"\n"}
                {"  }"}{"\n"}
                {"});"}
              </code>
            </pre>
          </div>
        </section>

        {/* ------------------------------------------------------------- CTA */}
        <section className="relative mx-auto max-w-4xl px-5 py-32 text-center sm:px-8 sm:py-40">
          <Sparkle className="absolute left-[12%] top-24 size-5 text-amber-200/70" />
          <Sparkle className="absolute right-[14%] top-36 size-3 text-emerald-200/70" />
          <Sparkle className="absolute bottom-28 left-[22%] size-3 text-sky-200/60" />
          <h2 className={cn(display.className, "text-5xl font-black leading-[0.95] tracking-[-0.045em] sm:text-7xl")}>
            Bring your people.
          </h2>
          <p className="mx-auto mt-5 max-w-md text-lg leading-8 text-white/55">Start in the browser, invite your friends, grab the desktop app when you want the extras.</p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row sm:items-start">
            <a href="#crystal-username" onClick={focusSignup} className="inline-flex items-center gap-2 rounded-xl bg-emerald-300 px-6 py-3.5 text-[15px] font-bold text-[#06110c] transition hover:bg-emerald-200 active:scale-[0.97]">
              Pick a username <ArrowRight className="size-4" />
            </a>
            <DownloadButton />
          </div>
        </section>

    </PageShell>
  );
}
