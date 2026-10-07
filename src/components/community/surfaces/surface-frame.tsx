"use client";

import type { LucideIcon } from "lucide-react";

import type { Id } from "../../../../convex/_generated/dataModel";
import { CommunityThemeWash } from "@/components/community/community-theme-wash";

/**
 * The frame every special channel sits in: a header like a chat's, and a
 * scrolling body. Kept here so a feed, a calendar and a server list all look like
 * they belong to the same app.
 */
export function SurfaceFrame({
  communityId,
  icon: Icon,
  name,
  topic,
  actions,
  children,
}: {
  communityId: Id<"communities">;
  icon: LucideIcon;
  name: string;
  topic?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <CommunityThemeWash communityId={communityId} />
      <header className="relative flex h-12 shrink-0 items-center gap-2 border-b border-border/50 px-4">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <h1 className="truncate text-sm font-semibold">{name}</h1>
        {topic && <p className="truncate text-xs text-muted-foreground">— {topic}</p>}
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </header>
      <div className="relative min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, body, children }: { icon: LucideIcon; title: string; body?: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-2 px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-foreground/5 text-muted-foreground">
        <Icon className="size-6" />
      </div>
      <h2 className="text-base font-semibold">{title}</h2>
      {body && <p className="text-sm text-muted-foreground">{body}</p>}
      {children && <div className="pt-2">{children}</div>}
    </div>
  );
}

/** A thrown Convex error, as a sentence. */
export function errorText(error: unknown, fallback = "Something went wrong."): string {
  if (!(error instanceof Error)) return fallback;
  const message = error.message.replace(/\[CONVEX [^\]]*\]\s*/g, "").replace(/^.*Uncaught Error:\s*/s, "").split("\n")[0]?.trim();
  return message || fallback;
}
