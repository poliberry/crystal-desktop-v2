"use client";

import { GEODE_TIERS, geodeTierByKey } from "../../convex/lib/geode";
import { LogoMark } from "@/components/logo-mark";
import { geodeGemSrc } from "@/lib/geode-art";
import { cn } from "@/lib/utils";

/**
 * The Geode artwork, as components.
 *
 * `GeodeGem` is one tier's gem — what the badge pill on a profile draws. `GeodeMark` is the standard picture, the split geode
 * the membership is named for: it is what stands for Geode itself wherever it is being offered (the Marketplace, the
 * Subscriptions page) rather than one person's rank in it. `GeodeLadder` is every gem in order, for showing what a
 * membership grows into.
 *
 * All of it is drawn from code (src/lib/geode-art.ts), so it works with no network and a new build can't leave an old one
 * with a picture it can't fetch.
 */

export function GeodeGem({ tier, className, label }: { tier: string; className?: string; label?: string }) {
  const src = geodeGemSrc(tier);
  // A gem this build doesn't know (a badge from a newer one) draws as nothing, as an unknown icon always has.
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={label ?? `${geodeTierByKey(tier)?.name ?? "Geode"} gem`}
      draggable={false}
      // `object-contain`: a gem is a shape on its own canvas, and cropping one to a square would clip the stone itself.
      className={cn("size-4 shrink-0 select-none object-contain", className)}
    />
  );
}

/**
 * The standard Geode picture, for marketing: the Crystal logo itself, white on a flat violet tile. It stands for the membership,
 * not anyone's rank in it. The logo is the app's own component (so it is always the current mark); `className` sizes the tile.
 */
export function GeodeMark({ className }: { className?: string }) {
  return (
    <span role="img" aria-label="Crystal Geode" className={cn("flex size-10 shrink-0 select-none items-center justify-center rounded-[28%] bg-violet-600 text-white", className)}>
      <LogoMark className="size-[58%]" />
    </span>
  );
}

/**
 * Every gem, in order, with when each is reached.
 *
 * With `current` (a tier key), the gems up to and including it are lit and the rest are dimmed, which turns it from a
 * description of the ladder into a picture of where you are on it; without, they are all lit, for the places that only
 * want to say what is on offer.
 */
export function GeodeLadder({ current, compact = false, className }: { current?: string; compact?: boolean; className?: string }) {
  const at = current ? (geodeTierByKey(current)?.tier ?? 0) : GEODE_TIERS.length;
  return (
    <ol className={cn("grid grid-cols-4 gap-x-2 gap-y-3 sm:grid-cols-8", className)} aria-label="Geode badges, from the first month to six years and over">
      {GEODE_TIERS.map((tier) => {
        const reached = tier.tier <= at;
        const here = tier.key === current;
        return (
          <li key={tier.key} className={cn("flex flex-col items-center gap-1 text-center transition-opacity", !reached && "opacity-35 saturate-50")} aria-current={here ? "step" : undefined}>
            <span className={cn("flex items-center justify-center rounded-xl", compact ? "size-9" : "size-12", here && "bg-foreground/10 ring-2 ring-fuchsia-400/60")}>
              <GeodeGem tier={tier.key} className={compact ? "size-7" : "size-9"} />
            </span>
            <span className="text-[11px] leading-tight font-medium">{tier.name}</span>
            <span className="text-[10px] leading-tight text-muted-foreground">{tier.after}</span>
          </li>
        );
      })}
    </ol>
  );
}
