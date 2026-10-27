"use client";

import { Check, Globe, Lock } from "lucide-react";

import { CREATOR_PLATFORM_LIST } from "@/lib/community-kinds";
import { cn } from "@/lib/utils";

export type CreatorPlatformChoice = "twitch" | "youtube" | "tiktok";
export type CreatorAudienceChoice = "public" | "members";

/** Which platform is home, and who may join. The account itself is connected
 * after the community exists, from its settings. */
export function CreatorStep({
  platform,
  onPlatform,
  audience,
  onAudience,
}: {
  platform: CreatorPlatformChoice | null;
  onPlatform: (p: CreatorPlatformChoice) => void;
  audience: CreatorAudienceChoice;
  onAudience: (a: CreatorAudienceChoice) => void;
}) {
  const tiers = platform ? CREATOR_PLATFORM_LIST.find((p) => p.id === platform)?.supportsTiers : false;
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Where is your channel?</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {CREATOR_PLATFORM_LIST.map((p) => {
            const selected = platform === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onPlatform(p.id)}
                aria-pressed={selected}
                className={cn(
                  "relative rounded-xl border p-3 text-left transition-colors",
                  selected ? "border-primary bg-primary/5" : "border-foreground/10 hover:border-foreground/25",
                )}
              >
                <p className="text-sm font-semibold">{p.label}</p>
                <p className="pt-0.5 text-xs text-muted-foreground">
                  {p.supportsTiers ? `Import ${p.tierNoun} as roles` : "No membership tiers to import"}
                </p>
                {selected && <Check className="absolute top-2.5 right-2.5 size-4 text-primary" />}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          You&apos;ll connect your account from the community&apos;s settings once it&apos;s made — that&apos;s what lets Crystal show your streams and
          match your members to their tiers.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Who can join?</h2>
        <div className="grid gap-2">
          {(
            [
              { id: "public", icon: Globe, title: "Public", body: "Anyone with the link can join." },
              {
                id: "members",
                icon: Lock,
                title: "Members only",
                body: tiers
                  ? "Only people who are members of your channel on the platform. Crystal checks."
                  : "Needs a platform with memberships — pick Twitch or YouTube.",
              },
            ] as const
          ).map((a) => {
            const disabled = a.id === "members" && !tiers;
            const selected = audience === a.id;
            return (
              <button
                key={a.id}
                type="button"
                disabled={disabled}
                onClick={() => onAudience(a.id)}
                aria-pressed={selected}
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:opacity-50",
                  selected ? "border-primary bg-primary/5" : "border-foreground/10 hover:border-foreground/25",
                )}
              >
                <a.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{a.title}</span>
                  <span className="block text-xs text-muted-foreground">{a.body}</span>
                </span>
                {selected && <Check className="size-4 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
