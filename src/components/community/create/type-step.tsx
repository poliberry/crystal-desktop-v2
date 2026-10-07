"use client";

import { Check, Shield, Sparkles, Users } from "lucide-react";

import { cn } from "@/lib/utils";

export type CommunityKindChoice = "standard" | "creator" | "clan";

const KINDS: { id: CommunityKindChoice; title: string; description: string; icon: React.ComponentType<{ className?: string }>; points: string[] }[] = [
  {
    id: "standard",
    title: "Community",
    description: "A place for any group of people — friends, a project, a hobby.",
    icon: Users,
    points: ["Start from a template or from scratch", "Text and voice channels, roles, rules"],
  },
  {
    id: "creator",
    title: "Creator community",
    description: "Built around your Twitch, YouTube or TikTok channel.",
    icon: Sparkles,
    points: ["Public, or members-only", "Your subscriber tiers become roles", "Newsfeed, calendar, AMA and thread channels", "Game server management"],
  },
  {
    id: "clan",
    title: "Clan",
    description: "A team centred on up to five games.",
    icon: Shield,
    points: ["A roster and a corner for each game", "Looking-for-group and scrim scheduling", "Game server management"],
  },
];

/** The first question: what kind of community is this. */
export function TypeStep({ value, onChange }: { value: CommunityKindChoice; onChange: (kind: CommunityKindChoice) => void }) {
  return (
    <div className="grid gap-3">
      {KINDS.map((kind) => {
        const selected = value === kind.id;
        return (
          <button
            key={kind.id}
            type="button"
            onClick={() => onChange(kind.id)}
            aria-pressed={selected}
            className={cn(
              "group relative flex items-start gap-4 rounded-xl border bg-gradient-to-br from-foreground/[0.07] via-foreground/[0.02] to-transparent p-4 text-left transition-colors",
              selected ? "border-primary" : "border-foreground/10 hover:border-foreground/25",
            )}
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <kind.icon className="size-5" />
            </span>
            <span className="min-w-0 flex-1 space-y-1.5">
              <span className="block text-base font-semibold">{kind.title}</span>
              <span className="block text-sm text-muted-foreground">{kind.description}</span>
              <ul className="space-y-0.5 pt-1 text-xs text-muted-foreground">
                {kind.points.map((p) => (
                  <li key={p} className="flex items-center gap-1.5">
                    <span className="size-1 rounded-full bg-primary/60" /> {p}
                  </li>
                ))}
              </ul>
            </span>
            {selected && <Check className="size-4 shrink-0 text-primary" />}
          </button>
        );
      })}
    </div>
  );
}
