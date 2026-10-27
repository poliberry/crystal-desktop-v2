"use client";

import { Smartphone } from "lucide-react";

import { DownloadList } from "./downloads";
import { PageIntro, PageShell } from "./marketing-ui";

/** /download: every platform's latest build, for installing on another machine, plus the web app for phones. */
export function DownloadPage() {
  return (
    <PageShell>
      <PageIntro note="take it with you" title={<>Download <span className="text-emerald-300">Crystal.</span></>}>
        One small installer that sets up Crystal, Crystal Studio, or both. It keeps itself up to date after that.
      </PageIntro>
      <div className="mx-auto max-w-4xl space-y-10 px-5 pb-28 sm:px-8">
        <DownloadList />
        <section className="rounded-2xl border border-sky-200/15 bg-sky-300/[0.04] p-6">
          <p className="flex items-center gap-2 text-lg font-semibold text-white"><Smartphone className="size-5 text-sky-200" /> On your phone</p>
          <p className="mt-2 text-[15px] leading-7 text-white/60">
            Open <a href="/app" className="text-white underline underline-offset-4">usecrystal.app/app</a> and add it to your home screen: Share → “Add to Home Screen” on iPhone, or “Install app” in Chrome on Android. It opens full screen, like any other app, and can send you notifications.
          </p>
        </section>
      </div>
    </PageShell>
  );
}
