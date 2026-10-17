"use client";

import { ArrowRight, FileText, HeartHandshake, ShieldCheck } from "lucide-react";

import { PageIntro, PageShell, SUPPORT_EMAIL } from "./marketing-ui";

const DOCS = [
  { href: "/legal/terms/", icon: FileText, title: "Terms of service", copy: "The agreement between you and Poliberry for using Crystal, buying things and selling in the shop." },
  { href: "/legal/privacy-policy/", icon: ShieldCheck, title: "Privacy policy", copy: "What personal information we collect, why, who we share it with, and your rights over it." },
  { href: "/legal/guidelines/", icon: HeartHandshake, title: "Community guidelines", copy: "What’s allowed on Crystal, how to report problems, and what happens when rules are broken." },
];

export function LegalIndexPage() {
  return (
    <PageShell>
      <PageIntro note="the official bits" noteClass="text-white/70" title="Legal">
        Crystal is run by Poliberry in Australia. These documents apply to everyone who uses it. For the plain-English version of how we handle data, see{" "}
        <a href="/privacy/" className="text-white underline underline-offset-4">How we handle your data</a>.
      </PageIntro>
      <section className="mx-auto max-w-7xl px-5 pb-28 sm:px-8">
        <ul className="grid gap-4 md:grid-cols-3">
          {DOCS.map(({ href, icon: Icon, title, copy }) => (
            <li key={href}>
              <a href={href} className="group flex h-full flex-col rounded-2xl border border-white/[0.08] bg-white/[0.025] p-6 transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.04]">
                <Icon className="size-6 text-emerald-200" strokeWidth={1.75} />
                <h2 className="mt-6 text-lg font-semibold text-white">{title}</h2>
                <p className="mt-2 flex-1 text-[15px] leading-7 text-white/55">{copy}</p>
                <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-white/80 group-hover:text-white">Read <ArrowRight className="size-4 transition group-hover:translate-x-0.5" /></span>
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-10 text-sm text-white/45">Questions? Email <a href={`mailto:${SUPPORT_EMAIL}`} className="text-white/75 underline underline-offset-4">{SUPPORT_EMAIL}</a>.</p>
      </section>
    </PageShell>
  );
}
