"use client";

import { cn } from "@/lib/utils";

import { display, PageShell } from "./marketing-ui";

export type LegalSection = { id: string; title: string; body: React.ReactNode };
export type LegalDoc = {
  slug: string;
  title: string;
  updated: string;
  /** One or two plain sentences at the top: what this document is, before the detail. */
  summary: React.ReactNode;
  sections: LegalSection[];
};

const DOCS = [
  { href: "/legal/terms/", label: "Terms of service" },
  { href: "/legal/privacy-policy/", label: "Privacy policy" },
  { href: "/legal/guidelines/", label: "Community guidelines" },
];

/** Prose styles for legal bodies, so the content files stay plain JSX. */
export const prose =
  "space-y-4 text-[15.5px] leading-[1.8] text-white/70 [&_a]:text-white [&_a]:underline [&_a]:underline-offset-4 [&_b]:font-semibold [&_b]:text-white/90 [&_h3]:mt-6 [&_h3]:font-semibold [&_h3]:text-white [&_li]:pl-1 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5";

export function LegalDocument({ doc }: { doc: LegalDoc }) {
  return (
    <PageShell>
      <div className="mx-auto max-w-7xl px-5 pb-28 pt-10 sm:px-8 sm:pt-14">
        <nav aria-label="Legal documents" className="flex flex-wrap gap-2 text-sm">
          <a href="/legal/" className="rounded-full px-3 py-1.5 text-white/50 transition hover:text-white">Legal</a>
          {DOCS.map((item) => {
            const current = item.href === `/legal/${doc.slug}/`;
            return (
              <a key={item.href} href={item.href} aria-current={current ? "page" : undefined} className={cn("rounded-full border px-3 py-1.5 transition", current ? "border-white/25 bg-white/[0.06] text-white" : "border-white/10 text-white/60 hover:text-white")}>
                {item.label}
              </a>
            );
          })}
        </nav>

        <header className="mt-10 max-w-3xl">
          <h1 className={cn(display.className, "text-[clamp(2.4rem,5vw,3.8rem)] font-black leading-[1] tracking-[-0.04em]")}>{doc.title}</h1>
          <p className="mt-4 text-sm text-white/45">Last updated {doc.updated}</p>
          <div className="mt-6 rounded-2xl border border-emerald-200/15 bg-emerald-300/[0.05] p-5 text-[15.5px] leading-7 text-white/75">{doc.summary}</div>
        </header>

        <div className="mt-14 grid gap-12 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <nav aria-label="Contents" className="lg:sticky lg:top-8 lg:self-start">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/35">Contents</p>
            <ol className="mt-4 space-y-2 text-sm">
              {doc.sections.map((section, index) => (
                <li key={section.id}>
                  <a href={`#${section.id}`} className="flex gap-2 text-white/55 transition hover:text-white">
                    <span className="w-5 shrink-0 text-white/30">{index + 1}.</span>
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <article className="max-w-3xl space-y-14">
            {doc.sections.map((section, index) => (
              <section key={section.id} id={section.id} className="scroll-mt-8">
                <h2 className={cn(display.className, "text-2xl font-bold tracking-[-0.025em]")}>
                  <span className="mr-2 text-white/30">{index + 1}.</span>
                  {section.title}
                </h2>
                <div className={cn("mt-4", prose)}>{section.body}</div>
              </section>
            ))}
          </article>
        </div>
      </div>
    </PageShell>
  );
}
