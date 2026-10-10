"use client";

import { MonitorDown } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { getDesktopAPI } from "@/lib/desktop";
import { appLinkFor } from "@/lib/deeplinks";

/**
 * Hands a web page over to the installed app.
 *
 * A website can't know whether Crystal is installed; the only way is to try its `crystal://` link.
 * So on a computer, once per tab, the page tries it as it loads (the browser asks "Open Crystal?",
 * and does nothing if it isn't installed), and always leaves a button for the person who dismissed
 * that or whose browser blocked it. `Continue in the browser` stops the automatic attempt, which is
 * also off on phones (there's no app there to open) and inside the app itself.
 */
const TRIED = "crystal-open-in-app";

const looksLikeComputer = () => typeof navigator !== "undefined" && !/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

export function useOpenInApp(): string | null {
  const [link, setLink] = useState<string | null>(null);
  useEffect(() => {
    if (getDesktopAPI()) return; // already there
    const target = appLinkFor(window.location.pathname, window.location.search);
    setLink(target);
    if (!target || !looksLikeComputer() || new URLSearchParams(window.location.search).get("web") === "1") return;
    try {
      if (sessionStorage.getItem(TRIED) === target) return;
      sessionStorage.setItem(TRIED, target);
    } catch {
      /* no storage: try once per load */
    }
    window.location.assign(target);
  }, []);
  return link;
}

export function OpenInAppButton({ link, className }: { link: string | null; className?: string }) {
  if (!link) return null;
  return (
    <Button variant="outline" className={className} onClick={() => window.location.assign(link)}>
      <MonitorDown className="size-4" />
      Open in the Crystal app
    </Button>
  );
}
