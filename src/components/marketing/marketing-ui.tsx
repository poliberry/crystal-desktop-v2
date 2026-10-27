"use client";

import { ArrowRight } from "lucide-react";
import { Caveat, Google_Sans_Flex } from "next/font/google";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

import { DownloadButton } from "./downloads";

/*
 * Pieces every public page shares: the fonts, the header and footer, and the small
 * visual primitives (handwritten notes, framed screenshots, the cast's avatars).
 * The public pages run without the app's providers (see components/providers.tsx),
 * so nothing here may reach for Convex, auth or the theme.
 */

export const display = Google_Sans_Flex({ subsets: ["latin"] });
export const hand = Caveat({ subsets: ["latin"], weight: ["500", "700"] });

export const SUPPORT_EMAIL = "support@usecrystal.app";

export type Person = { name: string; avatar: string; colour: string };
export const PEOPLE = {
  alex: { name: "Alex Rivera", avatar: "/marketing/avatars/alex.svg", colour: "text-sky-200" },
  maya: { name: "Maya Chen", avatar: "/marketing/avatars/maya.svg", colour: "text-rose-200" },
  jordan: { name: "Jordan Lee", avatar: "/marketing/avatars/jordan.svg", colour: "text-violet-200" },
  sam: { name: "Sam Patel", avatar: "/marketing/avatars/sam.svg", colour: "text-emerald-200" },
} satisfies Record<string, Person>;

export function Avatar({ person, className }: { person: Person; className?: string }) {
  return <img src={person.avatar} alt="" width={40} height={40} className={cn("rounded-full bg-white/10", className)} />;
}

/** Handwriting. Bold and large on purpose: Caveat's lighter weights turn to thread on a dark page. */
export function Note({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn(hand.className, "pointer-events-none inline-block select-none text-[1.5rem] font-bold leading-[1.1] sm:text-[1.65rem]", className)}>{children}</span>;
}

/** A screenshot in a soft window frame. */
export function Shot({
  src,
  alt,
  className,
  priority = false,
  width = 1920,
  height = 1200,
  children,
}: {
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
  width?: number;
  height?: number;
  /** Doodles positioned over the picture, in percentages of it. */
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-2xl border border-white/10 bg-[#0f1116] p-1.5 shadow-[0_40px_80px_-30px_rgb(0_0_0/0.8)]", className)}>
      <div className="relative">
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          className="block h-auto w-full rounded-[11px]"
        />
        {children}
      </div>
    </div>
  );
}

const NAV = [
  { href: "/features/", label: "Take a look" },
  { href: "/privacy/", label: "Privacy" },
  { href: "/makers/", label: "For makers" },
];

function useActive() {
  const pathname = usePathname() ?? "/";
  const path = pathname.endsWith("/") ? pathname : `${pathname}/`;
  return (href: string) => path === href || (href !== "/" && path.startsWith(href));
}

export function SiteHeader() {
  const active = useActive();
  return (
    <header className="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-5 sm:px-8">
      <a href="/" aria-label="Crystal home" className="flex items-center gap-2.5">
        <img src="/logo.svg" alt="" width={28} height={28} className="h-7 w-auto" />
        <span className={cn(display.className, "text-lg font-bold tracking-tight")}>Crystal</span>
      </a>
      <nav aria-label="Main navigation" className="hidden items-center gap-7 text-sm md:flex">
        {NAV.map((item) => (
          <a
            key={item.href}
            href={item.href}
            aria-current={active(item.href) ? "page" : undefined}
            className={cn("transition hover:text-white", active(item.href) ? "text-white" : "text-white/55")}
          >
            {item.label}
          </a>
        ))}
      </nav>
      <div className="flex items-center gap-1.5 sm:gap-2">
        <a href="/login" className="rounded-lg px-3 py-2 text-sm text-white/65 transition hover:text-white">Log in</a>
        <a href="/app" className="rounded-lg bg-white px-3.5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-100">Open Crystal</a>
      </div>
    </header>
  );
}

const FOOTER = [
  {
    title: "Crystal",
    links: [
      { href: "/features/", label: "Features" },
      { href: "/makers/", label: "For makers" },
      { href: "/download/", label: "Download" },
      { href: "/app", label: "Open in your browser" },
    ],
  },
  {
    title: "Trust",
    links: [
      { href: "/privacy/", label: "How we handle your data" },
      { href: "/legal/guidelines/", label: "Community guidelines" },
      { href: `mailto:${SUPPORT_EMAIL}`, label: "Report a problem" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/legal/terms/", label: "Terms of service" },
      { href: "/legal/privacy-policy/", label: "Privacy policy" },
      { href: "/legal/guidelines/", label: "Community guidelines" },
      { href: "/legal/", label: "All legal documents" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-white/[0.07]">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <a href="/" className="flex items-center gap-2.5">
            <img src="/logo.svg" alt="" width={24} height={24} className="h-6 w-auto" />
            <span className={cn(display.className, "text-base font-bold")}>Crystal</span>
          </a>
          <p className="mt-4 max-w-xs text-sm leading-6 text-white/45">A home for your group chat. Made by Poliberry in Australia.</p>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="mt-3 inline-block text-sm text-white/60 underline-offset-4 transition hover:text-white hover:underline">{SUPPORT_EMAIL}</a>
        </div>
        {FOOTER.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/35">{column.title}</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              {column.links.map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    {...("external" in link && link.external ? { target: "_blank", rel: "noreferrer" } : {})}
                    className="text-white/60 transition hover:text-white"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-white/[0.05]">
        <p className="mx-auto max-w-7xl px-5 py-5 text-xs text-white/35 sm:px-8">© {new Date().getFullYear()} Poliberry. Crystal is in beta, so things here will keep changing.</p>
      </div>
    </footer>
  );
}

/** The scrolling page every public route sits in: background light, header, content, footer. */
export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="fixed inset-0 z-[100] overflow-x-hidden overflow-y-auto bg-[#0b0d12] text-white selection:bg-emerald-300/30 selection:text-white">
      {/* Two soft lights, the same green-to-blue as the sign-in screen. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[900px] bg-[radial-gradient(ellipse_60%_50%_at_20%_0%,rgb(52_211_153/0.13),transparent),radial-gradient(ellipse_50%_45%_at_85%_10%,rgb(96_165_250/0.12),transparent)]" />
      <div className="relative">
        <SiteHeader />
        {children}
        <SiteFooter />
      </div>
    </main>
  );
}

/** The opening of an inner page: a handwritten aside, a big title, a lead paragraph. */
export function PageIntro({ note, noteClass = "text-emerald-200", title, children }: { note: string; noteClass?: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section className="mx-auto max-w-7xl px-5 pb-12 pt-10 sm:px-8 sm:pt-16">
      <Note className={noteClass}>{note}</Note>
      <h1 className={cn(display.className, "mt-2 max-w-4xl text-[clamp(2.6rem,6vw,4.6rem)] font-black leading-[0.98] tracking-[-0.045em]")}>{title}</h1>
      {children && <div className="mt-6 max-w-2xl text-lg leading-8 text-white/60">{children}</div>}
    </section>
  );
}

export function SectionHeading({ eyebrow, title, children, id }: { eyebrow?: string; title: React.ReactNode; children?: React.ReactNode; id?: string }) {
  return (
    <div id={id} className="max-w-2xl scroll-mt-8">
      {eyebrow && <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/40">{eyebrow}</p>}
      <h2 className={cn(display.className, "mt-2 text-3xl font-bold leading-[1.08] tracking-[-0.035em] sm:text-4xl")}>{title}</h2>
      {children && <div className="mt-4 text-[17px] leading-8 text-white/55">{children}</div>}
    </div>
  );
}

export function CtaBand({ title = "Bring your people.", children }: { title?: string; children?: React.ReactNode }) {
  return (
    <section className="mx-auto max-w-4xl px-5 py-28 text-center sm:px-8">
      <h2 className={cn(display.className, "text-4xl font-black leading-[0.98] tracking-[-0.04em] sm:text-6xl")}>{title}</h2>
      <p className="mx-auto mt-5 max-w-md text-lg leading-8 text-white/55">{children ?? "Start in your browser and invite your friends. Get the desktop app when you want the extras."}</p>
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:items-start">
        <a href="/app" className="inline-flex items-center gap-2 rounded-xl bg-emerald-300 px-6 py-3.5 text-[15px] font-bold text-[#06110c] transition hover:bg-emerald-200 active:scale-[0.97]">
          Open Crystal <ArrowRight className="size-4" />
        </a>
        <DownloadButton />
      </div>
    </section>
  );
}
