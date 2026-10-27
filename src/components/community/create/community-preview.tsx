"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Crown } from "lucide-react";

import { ChannelGlyph } from "@/components/community/channel-glyph";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import type { StepId } from "@/components/community/create/wizard";
import type { CommunitySetup } from "@/lib/community-templates";
import { cn } from "@/lib/utils";

/**
 * A miniature of the community being made, drawn from what has been decided so
 * far and redrawn as the flow goes: the sidebar with its banner, icon, name and
 * channels; the overview with the rules; the members list with the roles.
 *
 * The part the current step is about is outlined, so the picture says where
 * what you are doing ends up. Uses the app's own colour tokens, so it is in the
 * theme the app is.
 *
 * Drawn at a fixed natural size — `CommunityPreviewBackdrop` scales it up and
 * pans it, so it is a picture to be cropped rather than a panel to be fitted.
 */

const ITEM = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: "auto" },
  exit: { opacity: 0, height: 0 },
  transition: { type: "spring" as const, stiffness: 420, damping: 34 },
};

/** A region of the mock, outlined while it is what the step is editing. */
function Region({
  active,
  className,
  children,
}: {
  active: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg transition-[box-shadow,background-color] duration-300",
        active ? "bg-primary/[0.06] ring-2 ring-primary/60" : "ring-0 ring-transparent",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CommunityPreview({
  name,
  iconUrl,
  bannerUrl,
  setup,
  focus,
}: {
  name: string;
  iconUrl?: string;
  bannerUrl?: string;
  setup: CommunitySetup;
  /** The step being edited, outlined in the mock; none for the finished view. */
  focus: StepId | null;
}) {
  const displayName = name.trim() || "Your community";

  const groups = useMemo(() => {
    const order: (string | undefined)[] = [];
    const byCategory = new Map<string | undefined, CommunitySetup["channels"]>();
    for (const channel of setup.channels) {
      if (!channel.name.trim()) continue;
      if (!byCategory.has(channel.category)) {
        byCategory.set(channel.category, []);
        order.push(channel.category);
      }
      byCategory.get(channel.category)!.push(channel);
    }
    return order.map((category) => ({ category, channels: byCategory.get(category)! }));
  }, [setup.channels]);

  const startHere = setup.channels.filter((c) => c.type === "text" && c.name.trim()).slice(0, 3);
  const hoisted = setup.roles.filter((r) => r.hoist && r.name.trim());
  const rules = setup.rules.filter((r) => r.title.trim());

  return (
    <div className="flex h-[27rem] w-[36rem] gap-2 overflow-hidden rounded-2xl border border-foreground/10 bg-background/80 p-2 shadow-lg shadow-black/10">
      {/* Sidebar */}
      <div className="flex w-[34%] min-w-0 flex-col gap-2 overflow-hidden rounded-xl border border-sidebar-border bg-sidebar p-2">
        <Region active={focus === "profile"} className="p-1">
          <div className="relative h-16 overflow-hidden rounded-md bg-gradient-to-br from-primary/40 to-primary/5">
            {bannerUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={bannerUrl} alt="" className="size-full object-cover" />
            )}
          </div>
          <div className="relative -mt-4 flex items-end gap-2 px-1">
            <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-sidebar bg-muted text-[11px] font-semibold">
              {iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={iconUrl} alt="" className="size-full object-cover" />
              ) : (
                displayName.slice(0, 2).toUpperCase()
              )}
            </div>
          </div>
          <p
            className={cn(
              "mt-1 truncate px-1 text-xs font-semibold",
              !name.trim() && "text-muted-foreground",
            )}
          >
            {displayName}
          </p>
        </Region>

        <Region
          active={focus === "channels" || focus === "template" || focus === "games" || focus === "creator"}
          className="min-h-0 flex-1 overflow-hidden p-1"
        >
          <AnimatePresence initial={false}>
            {groups.map((group, groupIndex) => (
              <motion.div
                key={group.category ?? `__none${groupIndex}`}
                {...ITEM}
                className="overflow-hidden"
              >
                {group.category && (
                  <p className="truncate px-1 pt-1 text-[9px] font-semibold tracking-wide text-muted-foreground uppercase">
                    {group.category}
                  </p>
                )}
                <AnimatePresence initial={false}>
                  {group.channels.map((channel, index) => (
                    <motion.div
                      key={`${channel.name}:${index}`}
                      {...ITEM}
                      className="flex items-center gap-1 overflow-hidden rounded px-1 py-0.5 text-[11px] text-muted-foreground"
                    >
                      <ChannelGlyph type={channel.type} surface={channel.surface} className="size-3 shrink-0" />
                      <span className="truncate">{channel.name}</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>
            ))}
          </AnimatePresence>
        </Region>
      </div>

      {/* Overview */}
      <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden p-1">
        <div className="flex items-center gap-2">
          <div className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-[10px] font-semibold">
            {iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={iconUrl} alt="" className="size-full object-cover" />
            ) : (
              displayName.slice(0, 2).toUpperCase()
            )}
          </div>
          <p className="truncate text-sm font-semibold">{displayName}</p>
        </div>

        <Region
          active={focus === "rules"}
          className="overflow-hidden border border-foreground/10 bg-card/60"
        >
          <p className="border-b border-foreground/10 px-3 py-1.5 text-[11px] font-semibold">Rules</p>
          <div className="space-y-1.5 p-3">
            {rules.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No rules yet.</p>
            ) : (
              <AnimatePresence initial={false}>
                {rules.slice(0, 5).map((rule, index) => (
                  <motion.div
                    key={`${rule.title}:${index}`}
                    {...ITEM}
                    className="flex gap-2 overflow-hidden"
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[9px] font-semibold text-primary">
                      {index + 1}
                    </span>
                    <span className="truncate text-[11px]">{rule.title}</span>
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
            {rules.length > 5 && (
              <p className="text-[10px] text-muted-foreground">+{rules.length - 5} more</p>
            )}
          </div>
        </Region>

        <div className="overflow-hidden rounded-lg border border-foreground/10 bg-card/60">
          <p className="border-b border-foreground/10 px-3 py-1.5 text-[11px] font-semibold">Start here</p>
          <div className="space-y-0.5 p-2">
            {startHere.map((channel, index) => (
              <div
                key={`${channel.name}:${index}`}
                className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground"
              >
                <ChannelGlyph type={channel.type} surface={channel.surface} className="size-3 shrink-0" />
                <span className="truncate">{channel.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Members */}
      <Region
        active={focus === "roles" || focus === "invite"}
        className="w-[24%] min-w-0 shrink-0 overflow-hidden border border-sidebar-border bg-sidebar p-2"
      >
        <p className="px-1 pb-1 text-[11px] font-semibold">Members</p>
        <AnimatePresence initial={false}>
          {hoisted.map((role, index) => (
            <motion.div key={`${role.name}:${index}`} {...ITEM} className="overflow-hidden">
              <p
                className="truncate px-1 pt-1 text-[9px] font-semibold tracking-wide uppercase"
                style={{ color: role.color }}
              >
                {role.name}
              </p>
              <div className="flex items-center gap-1 px-1 py-0.5">
                <div
                  className="size-3.5 shrink-0 rounded"
                  style={{ background: role.color ?? "var(--muted)" }}
                />
                <div className="h-1 flex-1 rounded-full bg-muted-foreground/30" />
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        <p className="truncate px-1 pt-1 text-[9px] font-semibold tracking-wide text-muted-foreground uppercase">
          Owner
        </p>
        <div className="flex items-center gap-1 px-1 py-0.5 text-[11px]">
          <div className="size-3.5 shrink-0 rounded bg-primary/70" />
          <span className="truncate">You</span>
          <Crown className="size-3 shrink-0 text-yellow-400" />
        </div>
      </Region>
    </div>
  );
}

/** How far the picture is scaled up from its natural size. */
const SCALE = 1.8;

/**
 * Where the picture sits for each step, as how far (in rem) it is slid left and
 * up from resting with its top-left corner in the frame. Sliding left brings
 * the right of the picture into view, up takes the top out of it — so each step
 * lands on the part of the mock it is editing.
 */
const PAN: Record<StepId, { x: number; y: number }> = {
  type: { x: 0, y: 0 },
  games: { x: 0, y: 0 },
  creator: { x: 0, y: 0 },
  template: { x: 0, y: 0 },
  profile: { x: 0, y: 0 },
  rules: { x: -18, y: 0 },
  channels: { x: 0, y: -5 },
  roles: { x: -30, y: 0 },
  invite: { x: -30, y: 0 },
};

const FADE = [
  "linear-gradient(to right, transparent 0%, #000 8%)",
  "linear-gradient(to bottom, #000 45%, transparent 98%)",
].join(", ");

/**
 * The preview as a decoration: much larger than life, with its top-left corner
 * sitting in the page's right-hand half and the rest running off the right and
 * bottom of the page, panned to the part each step is about as the steps change.
 *
 * Meant to be a direct child of the page, which crops it at its edges. Faded
 * with a mask rather than a gradient laid over it, so it dissolves into
 * whatever the page background is — including the page's own tinted glow — and
 * the edge it is cropped at on the left, when panned, doesn't show as an edge.
 * It takes no clicks.
 */
export function CommunityPreviewBackdrop(props: React.ComponentProps<typeof CommunityPreview>) {
  const pan = props.focus ? PAN[props.focus] : { x: 0, y: 0 };
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute top-[18%] right-0 bottom-0 left-[54%] z-0 hidden overflow-hidden lg:block"
      style={{
        maskImage: FADE,
        maskComposite: "intersect",
        WebkitMaskImage: FADE,
        WebkitMaskComposite: "source-in",
      }}
    >
      <motion.div
        className="absolute top-0 left-0"
        initial={false}
        animate={{ x: `${pan.x}rem`, y: `${pan.y}rem` }}
        transition={{ type: "spring", stiffness: 90, damping: 22 }}
      >
        <div className="origin-top-left" style={{ transform: `scale(${SCALE})` }}>
          <CommunityPreview {...props} />
        </div>
      </motion.div>
    </motion.div>
  );
}

/** How long the finished view takes to fade away. The host waits this long
 * before letting go of the overlay. */
export const FINALE_FADE_SECONDS = 0.6;
const FINALE_FADE = { duration: FINALE_FADE_SECONDS, ease: "easeInOut" as const };

/**
 * The finished view: the whole mock, sized to sit in the middle of the page
 * with whatever the page puts under it (`children`), laid over the page's
 * blurred content. Zooms out to its place as it arrives.
 *
 * With `entering` the mock and the text fade out together, handing over to
 * the real community beneath.
 *
 * Sized from the container rather than in CSS: the mock is a fixed-size picture
 * scaled with a transform, which doesn't take up the room it looks like it
 * does, so the text under it has to be given a box of the scaled size.
 */
export function CommunityPreviewFinale({
  entering,
  children,
  ...preview
}: Omit<React.ComponentProps<typeof CommunityPreview>, "focus"> & {
  entering: boolean;
  children: React.ReactNode;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const mockRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ scale: number; width: number; height: number }>();

  useLayoutEffect(() => {
    const layer = layerRef.current;
    const mock = mockRef.current;
    if (!layer || !mock) return;
    const measure = () => {
      const width = mock.offsetWidth;
      const height = mock.offsetHeight;
      const scale = Math.min(1.6, (layer.clientWidth * 0.72) / width, (layer.clientHeight * 0.5) / height);
      setFit({ scale, width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(layer);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={layerRef}
      className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-8 overflow-hidden px-8"
    >
      <motion.div
        className="relative shrink-0"
        style={fit ? { width: fit.width * fit.scale, height: fit.height * fit.scale } : { opacity: 0 }}
        initial={{ opacity: 0, scale: 1.5 }}
        animate={entering ? { opacity: 0, scale: 1 } : { opacity: fit ? 1 : 0, scale: 1 }}
        transition={entering ? FINALE_FADE : { type: "spring", stiffness: 80, damping: 20 }}
      >
        <div
          ref={mockRef}
          className="absolute top-0 left-0 origin-top-left"
          style={{ transform: `scale(${fit?.scale ?? 1})` }}
        >
          <CommunityPreview {...preview} focus={null} />
        </div>
      </motion.div>

      <motion.div
        className="flex flex-col items-center gap-4 text-center"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: entering ? 0 : 1, y: 0 }}
        transition={entering ? FINALE_FADE : { delay: 0.35, duration: 0.4, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </div>
  );
}
