"use client";

import { Check, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

import { display, PageIntro, PageShell, SectionHeading, SUPPORT_EMAIL } from "./marketing-ui";

/*
 * /privacy: the plain-English account of what Crystal does with data. The
 * legal version is /legal/privacy-policy; the two must agree.
 *
 * Everything here is meant to match the code. When the code changes (a new
 * vendor, a new retention rule, account deletion shipping) change this page in
 * the same pull request. `TBC` marks facts that live in a dashboard rather
 * than the repo and still need confirming before launch.
 */

const UPDATED = "15 October 2026";
const TBC = "Being confirmed";

const SHORT = [
  "Message text in DMs and communities is end-to-end encrypted. Our servers pass it on without being able to read it.",
  "No ads, no analytics trackers, no selling your data, and no AI training on your messages.",
  "We use a small set of providers to run Crystal, listed below with what each one gets.",
  "Game detection happens on your computer. You can turn off sharing what you’re playing.",
  "Network addresses are stored hashed and encrypted, and only the last 25 per account.",
  "Download a copy of your data, or delete your account, yourself in Settings at any time.",
];

const ENCRYPTED = {
  yes: [
    "The text of DM and group messages",
    "The text of community channel messages",
    "Embeds and buttons sent by bots in those chats",
    "Slash-command arguments sent to bots",
  ],
  no: [
    "Attachments (the files and their names)",
    "Reactions, pins, and who replied to whom",
    "Who sent a message and when, and who it mentions",
    "Lounge chat, forum threads, AMA questions and support tickets",
    "Profiles, statuses, community and channel names",
    "Links you paste, which our server fetches to show a preview",
  ],
};

const COLLECT: { what: string; why: string; kept: string }[] = [
  { what: "Email address", why: "Signing in, sign-in codes and password resets.", kept: "While you have an account." },
  { what: "Password", why: "Signing in. Stored only as a salted scrypt hash, never in readable form.", kept: "While you have an account." },
  { what: "Username, display name, avatar, bio and other profile details", why: "Showing your profile to other people.", kept: "While you have an account." },
  { what: "Date of birth (optional)", why: "Birthday decorations and reminders for your friends. Nothing else.", kept: "Until you remove it." },
  { what: "Messages and attachments", why: "Delivering them. Message text is encrypted (see above).", kept: "Until you or a moderator deletes them, or you delete your account. Files are deleted from our storage along with them." },
  { what: "Friends, communities, roles and blocks", why: "Running the social side of Crystal.", kept: "While you have an account." },
  { what: "Online status and what you’re playing or listening to", why: "Showing your friends what you’re up to. Switch it off in Settings.", kept: "Live only. Cleared when you go offline." },
  { what: "Games you’ve played and for how long", why: "The “Recent activity” list on your profile. Music is not recorded.", kept: "While you have an account." },
  { what: "Network (IP) addresses", why: "Stopping abuse and enforcing bans. Stored as a keyed hash and encrypted, never in plain text.", kept: "The 25 most recent per account." },
  { what: "Two-factor secrets and passkeys", why: "Securing your account. Authenticator secrets are encrypted; passkeys are public keys only.", kept: "Until you remove them." },
  { what: "Purchases", why: "Giving you what you bought, refunds and creator payouts. We never see your card details.", kept: "As long as tax and accounting law requires." },
  { what: "Linked Twitch, YouTube or TikTok accounts", why: "Creator communities and members-only checks. Access tokens are encrypted.", kept: "Until you disconnect, or ask us to." },
  { what: "Reports and moderation records", why: "Keeping Crystal safe. A report keeps a copy of the reported content as evidence.", kept: "As long as needed to handle the report and repeat abuse." },
];

type Vendor = { name: string; role: string; gets: string; based: string; where: string };
const VENDORS: Vendor[] = [
  { name: "Convex", role: "Database and backend", gets: "Everything Crystal stores (encrypted message text stays encrypted).", based: "United States", where: "United States (Northern Virginia)" },
  { name: "Cloudflare", role: "Website hosting, file storage (R2) and the bot API", gets: "Uploaded files, and the requests your browser makes to our site.", based: "United States", where: "Global network" },
  { name: "LiveKit", role: "Voice, video and screen sharing", gets: "Your audio and video while you’re in a call. Calls aren’t recorded.", based: "United States", where: "Global network" },
  { name: "Krisp (via LiveKit)", role: "Noise suppression", gets: "Runs on your device as part of the call.", based: "United States", where: "Your device" },
  { name: "Stripe", role: "Payments and creator payouts", gets: "Payment details you enter at checkout, and payout details for creators.", based: "United States / Ireland", where: "United States (US East)" },
  { name: "Resend", role: "Email", gets: "Your email address and the sign-in or reset code we send you.", based: "United States", where: "United States (US East)" },
  { name: "KLIPY", role: "GIFs, clips and stickers", gets: "Your searches and a random per-install ID, sent straight from your device. Not your account.", based: TBC, where: "United States (US East)" },
  { name: "Google Fonts", role: "The colour emoji font", gets: "Your IP address when the font loads.", based: "United States", where: "Global network" },
  { name: "Twitch, YouTube (Google), TikTok", role: "Creator communities", gets: "Only if you link an account: your channel and membership status.", based: "United States", where: "Their own services" },
  { name: "GitHub", role: "Desktop app updates", gets: "A request to check for and download updates.", based: "United States", where: "Global network" },
  { name: "Apple (iTunes Search)", role: "Album art for “now playing”", gets: "The artist and song title you’re listening to (desktop app).", based: "United States", where: "Their own services" },
  { name: "Expo, Apple and Google", role: "Mobile push notifications", gets: "Only on mobile: your device’s push token and the notification text.", based: "United States", where: "Their own services" },
];

const DEVICE = [
  { title: "Game detection", copy: "The desktop app compares the programs running on your computer with a public list of games. The list of programs never leaves your computer; only the game it finds is shared, and only if “Share my activity” is on." },
  { title: "Your encryption keys", copy: "Created on your device and kept there (in your operating system’s secure storage on desktop). You get a recovery key that only you hold. We can’t recover it for you." },
  { title: "Crash diagnostics", copy: "Written to a file on your computer. Nothing is sent to us unless you choose to send it." },
  { title: "GIF searches", copy: "Go straight from your device to KLIPY with a random ID that isn’t linked to your account. We only store the GIFs you favourite." },
];

const PROTECT = [
  { title: "Encryption on your device", copy: "AES-256-GCM for messages, with keys shared between members using P-256 key agreement. Keys are created on your device." },
  { title: "Passwords done properly", copy: "Salted scrypt hashes. Wrong guesses are counted and lock the account for a while." },
  { title: "Two-factor and passkeys", copy: "Authenticator apps, backup codes and passkeys. Sensitive actions ask for a fresh code." },
  { title: "Sign out everywhere", copy: "Changing your password, or a ban, ends every session on every device at once." },
  { title: "Addresses we can’t read back casually", copy: "IP addresses are stored as a keyed hash plus an encrypted copy, trimmed to the last 25 per account." },
  { title: "Secrets encrypted at rest", copy: "Authenticator secrets, linked-account tokens and game-server keys are encrypted with AES-256-GCM." },
  { title: "Limits on guessing and spam", copy: "Rate limits on sign-in, code checks, account lookups, guest accounts and reports." },
  { title: "Guest accounts expire", copy: "Trying Crystal as a guest lasts 24 hours. After that the profile, its pictures, friends and memberships are wiped." },
  { title: "Files go when you remove them", copy: "Delete a message, a picture or an emoji and its file is deleted from our storage too, unless the same file is still in use elsewhere or held as evidence in a report." },
];

const GAPS = [
  "Attachments aren’t end-to-end encrypted yet. Anyone with a file’s link can open it, so don’t post anything in a file you wouldn’t want shared.",
  "Some messages from before encryption arrived were converted using a temporary server key. Those keys are deleted as soon as everyone involved has their own.",
  "Link previews are fetched by our server, so it sees the links you post.",
];

/** A table on wider screens; on a phone, each row becomes a small card so nothing scrolls sideways. */
function Table<T>({ head, rows, cell, className }: { head: string[]; rows: T[]; cell: (row: T) => React.ReactNode[]; className?: string }) {
  return (
    <>
      <ul className={cn("mt-8 space-y-3 md:hidden", className)}>
        {rows.map((row, i) => {
          const [first, ...rest] = cell(row);
          return (
            <li key={i} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
              <p className="font-semibold text-white/90">{first}</p>
              <dl className="mt-2.5 space-y-2 text-[14px] leading-6">
                {rest.map((value, j) => (
                  <div key={j}>
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/35">{head[j + 1]}</dt>
                    <dd className={cn("text-white/65", value === TBC && "italic text-amber-100/70")}>{value}</dd>
                  </div>
                ))}
              </dl>
            </li>
          );
        })}
      </ul>
      <TableWide head={head} rows={rows} cell={cell} className={className} />
    </>
  );
}

function TableWide<T>({ head, rows, cell, className }: { head: string[]; rows: T[]; cell: (row: T) => React.ReactNode[]; className?: string }) {
  return (
    <div className={cn("mt-8 hidden overflow-x-auto rounded-2xl border border-white/[0.08] md:block", className)}>
      <table className="w-full min-w-[640px] text-left text-[14px]">
        <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.1em] text-white/45">
          <tr>{head.map((h) => <th key={h} scope="col" className="px-4 py-3 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06]">
          {rows.map((row, i) => (
            <tr key={i} className="align-top">
              {cell(row).map((value, j) => (
                <td key={j} className={cn("px-4 py-3.5 leading-6", j === 0 ? "font-medium text-white/90" : "text-white/60", value === TBC && "italic text-amber-100/70")}>{value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cards({ items, tone }: { items: { title: string; copy: string }[]; tone: string }) {
  return (
    <ul className="mt-8 grid gap-4 sm:grid-cols-2">
      {items.map((item) => (
        <li key={item.title} className={cn("rounded-2xl border p-5", tone)}>
          <h3 className="font-semibold text-white">{item.title}</h3>
          <p className="mt-1.5 text-[15px] leading-7 text-white/60">{item.copy}</p>
        </li>
      ))}
    </ul>
  );
}

export function PrivacyPage() {
  return (
    <PageShell>
      <PageIntro note="no fine print here" noteClass="text-sky-200" title={<>How we handle <span className="text-sky-300">your data.</span></>}>
        What we keep, where it goes, who helps us run Crystal and how we protect it, in plain English. The legal version is our{" "}
        <a href="/legal/privacy-policy/" className="text-white underline underline-offset-4">privacy policy</a>. Last updated {UPDATED}.
      </PageIntro>

      <div className="mx-auto max-w-5xl space-y-24 px-5 pb-28 sm:px-8">
        <section className="rounded-[2rem] border border-white/[0.08] bg-white/[0.025] p-7 sm:p-10">
          <h2 className={cn(display.className, "text-2xl font-bold tracking-[-0.03em]")}>The short version</h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {SHORT.map((line) => (
              <li key={line} className="flex gap-3 text-[15px] leading-7 text-white/70">
                <Check className="mt-1 size-4 shrink-0 text-emerald-300" />
                {line}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <SectionHeading id="encryption" eyebrow="End-to-end encryption" title="What’s locked, and what isn’t.">
            Encryption covers what you say. It doesn’t hide that a conversation happened, so here’s exactly where the line is.
          </SectionHeading>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-emerald-200/15 bg-emerald-300/[0.05] p-6">
              <h3 className="font-semibold text-emerald-100">Encrypted on your device</h3>
              <ul className="mt-4 space-y-2.5">
                {ENCRYPTED.yes.map((item) => <li key={item} className="flex gap-2.5 text-[15px] text-white/75"><Check className="mt-1 size-4 shrink-0 text-emerald-300" />{item}</li>)}
              </ul>
            </div>
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
              <h3 className="font-semibold text-white/85">Not end-to-end encrypted</h3>
              <ul className="mt-4 space-y-2.5">
                {ENCRYPTED.no.map((item) => <li key={item} className="flex gap-2.5 text-[15px] text-white/60"><Minus className="mt-1 size-4 shrink-0 text-white/35" />{item}</li>)}
              </ul>
            </div>
          </div>
          <p className="mt-5 text-sm leading-6 text-white/45">Things in the right-hand column are still sent over encrypted connections and protected by access controls. They just aren’t locked with your own keys.</p>
        </section>

        <section>
          <SectionHeading id="collect" eyebrow="What we keep" title="The data we collect, and why.">
            Only what Crystal needs to work, and nothing for advertising.
          </SectionHeading>
          <Table head={["What", "Why", "How long"]} rows={COLLECT} cell={(r) => [r.what, r.why, r.kept]} />
        </section>

        <section>
          <SectionHeading id="vendors" eyebrow="Who helps us" title="The providers we use.">
            These companies run parts of Crystal for us. They only get what they need for their part, and we don’t sell data to anyone.
          </SectionHeading>
          <Table head={["Provider", "What for", "What they get", "Company based in", "Data stored in"]} rows={VENDORS} cell={(v) => [v.name, v.role, v.gets, v.based, v.where]} />
          <p className="mt-5 text-sm leading-6 text-white/45">
            Your data is stored in the United States: our database in Northern Virginia, and payments, email and GIF search in US East. Crystal itself is run from Australia. Bots, extensions and game-server panels that you or your community choose to add receive the data you allow them, under their own developers’ terms.
          </p>
        </section>

        <section>
          <SectionHeading id="device" eyebrow="Stays with you" title="Things that happen on your device." />
          <Cards items={DEVICE} tone="border-white/[0.08] bg-white/[0.02]" />
        </section>

        <section>
          <SectionHeading id="protect" eyebrow="Security" title="How we protect it." />
          <Cards items={PROTECT} tone="border-sky-200/10 bg-sky-300/[0.03]" />
        </section>

        <section className="rounded-[2rem] border border-amber-200/15 bg-amber-200/[0.04] p-7 sm:p-10">
          <SectionHeading id="gaps" eyebrow="Being upfront" title="What isn’t finished yet.">
            Crystal is in beta. These are the gaps we know about and are working on.
          </SectionHeading>
          <ul className="mt-6 space-y-3">
            {GAPS.map((gap) => <li key={gap} className="flex gap-3 text-[15px] leading-7 text-white/70"><span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-amber-200" />{gap}</li>)}
          </ul>
        </section>

        <section>
          <SectionHeading id="choices" eyebrow="Your choices" title="You’re in control.">
            <p>
              <b className="text-white/80">Settings → Privacy Center</b> has both buttons. <b className="text-white/80">Download your data</b> makes one file of your profile, friends, communities, purchases, settings and every message you’ve sent. Your messages are decrypted on your own device while the file is made, so we never see them. <b className="text-white/80">Delete your account</b> asks for your password or a 2FA code, signs you out everywhere, and then deletes your messages, their files, your profile, friends, memberships and the rest.
            </p>
            <p className="mt-4">
              A few things are kept after you delete, shown as “Deleted user”: purchase records (tax law needs them), reports and moderation records (for safety), and reactions, forum and AMA posts and lounge chat, which you can ask us to remove at{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-white underline underline-offset-4">{SUPPORT_EMAIL}</a>. Turn off activity sharing with “Share my activity” in <b className="text-white/80">Settings → Voice &amp; Video</b>, and remove your date of birth or status whenever you like.
            </p>
            <p className="mt-4">
              Depending on where you live (for example the EU, the UK, Australia or California) you have legal rights over your data. Our <a href="/legal/privacy-policy/" className="text-white underline underline-offset-4">privacy policy</a> explains them.
            </p>
          </SectionHeading>
        </section>
      </div>
    </PageShell>
  );
}
