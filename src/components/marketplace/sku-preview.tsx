"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { Gem, Music4, Palette, Rocket, Type } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import { SceneBackground } from "@/components/lounge/scene-background";
import { Nameplate } from "@/components/profile/nameplate";
import { ProfileEffectLayer, ProfileFrameLayers } from "@/components/profile/profile-card-cosmetics";
import { Avatar, AvatarDecoration, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { normalizeLayers, type CosmeticLayer } from "@/lib/cosmetic-layers";
import { cn } from "@/lib/utils";
import { GRANT_KIND_META, primaryKind, type GrantKind } from "@/components/marketplace/sku-kinds";

/**
 * An item, shown on *you* — the way Discord's shop does it. A decoration is
 * drawn around your own avatar, a sticker on a card with your name on it, a
 * nameplate behind your name. Seeing it on yourself is most of the reason to buy
 * it, and it is the cheapest way to avoid buying the wrong one.
 *
 * Takes just the grants, so the same component draws a store item, an entry in
 * your collection, a creator's submission and the staff console's editor.
 */

export interface PreviewGrant {
  kind: GrantKind | string;
  payload?: string;
  label?: string;
}

export type PreviewSize = "sm" | "md" | "lg";

/** The viewer's own details, which every preview is drawn with. */
function useViewer() {
  const me = useQuery(api.users.getCurrentUser);
  return {
    name: me?.name ?? "You",
    username: me?.username ?? "you",
    imageUrl: me?.imageUrl,
    bannerUrl: me?.bannerUrl,
    accentStart: me?.borderGradientStart,
    accentEnd: me?.borderGradientEnd,
  };
}

type Viewer = ReturnType<typeof useViewer>;

const AVATAR_SIZE: Record<PreviewSize, string> = { sm: "size-12", md: "size-20", lg: "size-28" };
const CARD_WIDTH: Record<PreviewSize, string> = { sm: "w-16", md: "w-[6.5rem]", lg: "w-44" };
const PLATE_WIDTH: Record<PreviewSize, string> = { sm: "w-32", md: "w-40", lg: "w-72" };
const THEME_WIDTH: Record<PreviewSize, string> = { sm: "w-20", md: "w-32", lg: "w-60" };

function parseLayers(payload: string | undefined): CosmeticLayer[] {
  try {
    const parsed = JSON.parse(payload ?? "");
    return Array.isArray(parsed) ? normalizeLayers(parsed as CosmeticLayer[]) : [];
  } catch {
    return [];
  }
}

function parseTheme(payload: string | undefined): { start: string; end: string } | null {
  try {
    const parsed = JSON.parse(payload ?? "") as { start?: string; end?: string };
    return parsed.start && parsed.end ? { start: parsed.start, end: parsed.end } : null;
  } catch {
    return null;
  }
}

function ViewerAvatar({ viewer, className, decoration }: { viewer: Viewer; className?: string; decoration?: string }) {
  return (
    <Avatar className={cn("overflow-visible", className)}>
      <AvatarImage src={viewer.imageUrl} alt="" />
      <AvatarFallback>{viewer.name.slice(0, 2).toUpperCase()}</AvatarFallback>
      {decoration && <AvatarDecoration value={decoration} animate />}
    </Avatar>
  );
}

/** A small profile card to put stickers and effects on. */
function MiniCard({
  viewer,
  size,
  children,
  effect,
}: {
  viewer: Viewer;
  size: PreviewSize;
  children?: React.ReactNode;
  effect?: string;
}) {
  const accent = viewer.accentStart
    ? `linear-gradient(135deg, ${viewer.accentStart}, ${viewer.accentEnd ?? viewer.accentStart})`
    : "linear-gradient(135deg, oklch(0.55 0.15 280), oklch(0.45 0.12 320))";
  return (
    <div className={cn("relative aspect-[3/4] shrink-0 [container-type:inline-size]", CARD_WIDTH[size])}>
      <div className="absolute inset-0 overflow-hidden rounded-xl border border-white/10 bg-card text-[8.5cqw] shadow-xl shadow-black/30">
        <div
          className="h-[34%] bg-cover bg-center"
          style={viewer.bannerUrl ? { backgroundImage: `url(${viewer.bannerUrl})` } : { backgroundImage: accent }}
        />
        <div className="absolute top-[22%] left-[8%]">
          <ViewerAvatar viewer={viewer} className="size-[26cqw] ring-2 ring-card" />
        </div>
        <div className="absolute top-[58%] right-[8%] left-[8%] space-y-1">
          <div className="truncate text-[1em] leading-none font-semibold">{viewer.name}</div>
          <div className="truncate text-[0.8em] leading-none text-muted-foreground">@{viewer.username}</div>
          <div className="mt-2 space-y-1">
            <div className="h-1 w-4/5 rounded-full bg-foreground/10" />
            <div className="h-1 w-3/5 rounded-full bg-foreground/10" />
          </div>
        </div>
        {effect && <ProfileEffectLayer src={effect} rounded="rounded-xl" />}
      </div>
      {children}
    </div>
  );
}

function GrantPreview({ grant, viewer, size }: { grant: PreviewGrant; viewer: Viewer; size: PreviewSize }) {
  const layers = useMemo(
    () => (grant.kind === "profileSticker" ? parseLayers(grant.payload) : []),
    [grant.kind, grant.payload],
  );
  const theme = useMemo(() => (grant.kind === "communityTheme" ? parseTheme(grant.payload) : null), [grant]);

  switch (grant.kind) {
    case "avatarDecoration":
      return <ViewerAvatar viewer={viewer} className={AVATAR_SIZE[size]} decoration={`layers:${grant.payload ?? "[]"}`} />;

    case "profileSticker":
      return (
        <MiniCard viewer={viewer} size={size}>
          <ProfileFrameLayers layers={layers} sizeClass="compact" animate />
        </MiniCard>
      );

    case "profileEffect":
      return <MiniCard viewer={viewer} size={size} effect={grant.payload} />;

    case "nameplate":
      return (
        <div
          className={cn(
            "relative flex items-center gap-3 overflow-hidden rounded-xl border border-white/10 bg-card px-3 py-3 shadow-xl shadow-black/30",
            PLATE_WIDTH[size],
          )}
        >
          <Nameplate url={grant.payload} className="opacity-100" />
          <ViewerAvatar viewer={viewer} className="relative size-9 shrink-0" />
          <div className="relative min-w-0">
            <div className="truncate text-sm font-semibold">{viewer.name}</div>
            <div className="truncate text-xs text-muted-foreground">@{viewer.username}</div>
          </div>
        </div>
      );

    case "communityTheme":
      return (
        <div
          className={cn("relative aspect-[4/3] overflow-hidden rounded-xl border border-white/10 shadow-xl shadow-black/30", THEME_WIDTH[size])}
          style={{ backgroundImage: theme ? `linear-gradient(135deg, ${theme.start}, ${theme.end})` : undefined }}
        >
          <div className="absolute inset-x-3 top-3 space-y-1.5">
            <div className="h-2 w-1/2 rounded-full bg-white/60" />
            <div className="h-1.5 w-3/4 rounded-full bg-white/30" />
            <div className="h-1.5 w-2/3 rounded-full bg-white/30" />
          </div>
        </div>
      );

    case "loungeScene": {
      let scene: { backgroundUrl?: string; screen?: { x: number; y: number; w: number; h: number } } = {};
      try {
        scene = JSON.parse(grant.payload ?? "");
      } catch {
        /* an unreadable scene shows as an empty frame */
      }
      return (
        <div className={cn("relative aspect-video overflow-hidden rounded-xl border border-white/10 bg-neutral-900 shadow-xl shadow-black/30", size === "sm" ? "w-24" : size === "md" ? "w-40" : "w-72")}>
          {scene.backgroundUrl && (
            <div className="absolute inset-0">
              <SceneBackground url={scene.backgroundUrl} />
            </div>
          )}
          {scene.screen && (
            <div
              className="absolute bg-black/70 ring-1 ring-sky-300/40"
              style={{ left: `${scene.screen.x}%`, top: `${scene.screen.y}%`, width: `${scene.screen.w}%`, height: `${scene.screen.h}%` }}
            />
          )}
        </div>
      );
    }

    case "themePack": {
      let spec: { theme?: { colors?: Record<string, string> }; font?: unknown; sounds?: object; icons?: object } = {};
      try {
        spec = JSON.parse(grant.payload ?? "");
      } catch {
        /* unreadable: plain swatch */
      }
      const c = spec.theme?.colors ?? {};
      return (
        <div
          className={cn("relative aspect-[4/3] overflow-hidden rounded-xl border border-white/10 shadow-xl shadow-black/30", THEME_WIDTH[size])}
          style={{ background: c.background ?? "oklch(0.2 0 0)" }}
        >
          <div className="absolute inset-y-0 left-0 w-1/4" style={{ background: c.sidebar ?? "rgba(255,255,255,0.06)" }} />
          <div className="absolute top-[12%] right-[8%] left-[32%] h-[26%] rounded-md" style={{ background: c.card ?? "rgba(255,255,255,0.08)" }} />
          <div className="absolute right-[8%] bottom-[14%] left-[32%] flex gap-1.5">
            <div className="h-3 w-1/2 rounded" style={{ background: c.primary ?? "oklch(0.6 0.2 290)" }} />
            <div className="h-3 w-1/3 rounded" style={{ background: c.secondary ?? "rgba(255,255,255,0.15)" }} />
          </div>
          <div className="absolute bottom-1.5 left-1.5 flex gap-1 text-white/70">
            {spec.font ? <Type className="size-3" /> : null}
            {spec.sounds ? <Music4 className="size-3" /> : null}
            {spec.icons ? <Palette className="size-3" /> : null}
          </div>
        </div>
      );
    }

    case "plan":
      return (
        <div
          className={cn(
            "flex items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-sky-400 text-white shadow-xl shadow-fuchsia-500/20",
            size === "sm" ? "size-14" : size === "md" ? "size-24" : "size-32",
          )}
        >
          <Gem className={size === "sm" ? "size-7" : size === "md" ? "size-12" : "size-16"} />
        </div>
      );

    case "communityBoost":
      return (
        <div
          className={cn(
            "flex items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-rose-500 text-white shadow-xl shadow-rose-500/20",
            size === "sm" ? "size-14" : size === "md" ? "size-24" : "size-32",
          )}
        >
          <Rocket className={size === "sm" ? "size-7" : size === "md" ? "size-12" : "size-16"} />
        </div>
      );

    default:
      return null;
  }
}

/**
 * The preview itself, on a soft backdrop tinted with the viewer's own colours.
 * `bare` drops the backdrop for places that supply their own.
 */
export function SkuPreview({
  grants,
  size = "md",
  bare = false,
  className,
}: {
  grants: PreviewGrant[];
  size?: PreviewSize;
  bare?: boolean;
  className?: string;
}) {
  const viewer = useViewer();
  const kind = primaryKind({ grants: grants as { kind: GrantKind }[] });
  // A bundle shows its first few pieces side by side, smaller than one alone.
  const pieces = grants.length > 1 ? grants.slice(0, 3) : grants;
  const pieceSize: PreviewSize = pieces.length > 1 ? (size === "lg" ? "md" : "sm") : size;

  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden",
        !bare && "bg-gradient-to-br from-foreground/[0.10] via-foreground/[0.04] to-transparent",
        className,
      )}
      role="img"
      aria-label={`Preview of ${GRANT_KIND_META[kind]?.label ?? "item"}`}
    >
      {!bare && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            backgroundImage: viewer.accentStart
              ? `radial-gradient(circle at 30% 20%, ${viewer.accentStart}33, transparent 60%), radial-gradient(circle at 80% 90%, ${viewer.accentEnd ?? viewer.accentStart}2b, transparent 55%)`
              : "radial-gradient(circle at 30% 20%, oklch(0.6 0.12 280 / 0.25), transparent 60%)",
          }}
        />
      )}
      <div className={cn("relative flex items-center justify-center", pieces.length > 1 ? "-space-x-4" : "")}>
        {pieces.map((grant, i) => (
          <div key={`${grant.kind}-${i}`} className="relative" style={{ zIndex: pieces.length - i }}>
            <GrantPreview grant={grant} viewer={viewer} size={pieceSize} />
          </div>
        ))}
      </div>
    </div>
  );
}
