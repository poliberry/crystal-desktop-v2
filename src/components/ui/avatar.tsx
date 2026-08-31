"use client"

import * as React from "react"
import { Avatar as AvatarPrimitive } from "radix-ui"

import { LayerContent } from "@/components/profile/layer-content"
import { decorationLayers, decorationSrc } from "@/lib/avatar-decorations"
import { layerStyle, type CosmeticLayer } from "@/lib/cosmetic-layers"
import { useCachedImageSrc } from "@/lib/image-cache"
import { cn } from "@/lib/utils"

function Avatar({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root> & {
  size?: "default" | "sm" | "lg"
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        // rounded-full without overflow-hidden: keeps a ring/border applied
        // directly to this root circular instead of square, without
        // clipping AvatarBadge, a sibling positioned at this box's corner.
        // The actual circular clip of the image/fallback content lives on
        // AvatarImage/AvatarFallback themselves, below.
        "group/avatar relative flex size-8 shrink-0 rounded-full select-none data-[size=lg]:size-10 data-[size=sm]:size-6",
        className
      )}
      {...props}
    />
  )
}

function AvatarImage({
  src,
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  // Every avatar in the app renders through here, which is what makes this
  // the one place worth caching from — see src/lib/image-cache.ts.
  const cachedSrc = useCachedImageSrc(typeof src === "string" ? src : undefined);
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      src={cachedSrc ?? src}
      className={cn("aspect-square size-full rounded-full object-cover", className)}
      {...props}
    />
  )
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center rounded-full bg-muted text-sm text-muted-foreground group-data-[size=sm]/avatar:text-xs",
        className
      )}
      {...props}
    />
  )
}

/**
 * The decoration worn around an avatar — see src/lib/avatar-decorations.ts.
 *
 * A sibling of AvatarImage rather than a wrapper, so it costs a render site one
 * line and nothing when there's nothing to draw. It overflows the avatar's box
 * on every side (which is the point) and so has to be a child of the root,
 * whose `rounded-full` deliberately doesn't clip.
 *
 * Takes the *stored value* rather than an image source, because a decoration
 * can be several images now and only this file should have to know how one is
 * spelled. `decorationLayers` turns any of its forms — a preset, a birthday
 * gift, an upload, a list of placed layers — into the same list of boxes.
 *
 * ## Why a container
 *
 * The stack is `container-type: size`, which makes `cqw` one percent of the
 * avatar's width, and every layer is positioned in those units. That is what
 * lets one placement be right at 24 pixels in a member list and at 96 on a
 * profile card. It also fixes the older bug this replaced: an `<img>` given
 * insets and no width is a replaced element and falls back to its intrinsic
 * pixel size, which is how an uploaded PNG once drew itself a thousand pixels
 * wide across the window.
 *
 * Under the badge (`z-10`) rather than over it: a decoration is jewellery and
 * a presence dot is information.
 */
function AvatarDecoration({
  value,
  animate = "hover",
  className,
}: {
  /** The decoration as stored. Undefined draws nothing. */
  value: string | undefined;
  /**
   * When an animated decoration is allowed to play. `"hover"` — the default —
   * holds it on its first frame until the avatar is pointed at, because a
   * member list is fifty avatars and fifty looping animations is a room full
   * of moving parts nobody asked to look at. `true` is for the places that are
   * *about* one person, where the decoration is worth seeing in full.
   */
  animate?: boolean | "hover";
  className?: string;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = React.useState(false);
  const layers = React.useMemo(() => decorationLayers(value), [value]);
  const frozen = animate !== true && !hovered;

  // The hover target is the avatar, not this: the decoration is
  // `pointer-events-none` (it overhangs the avatar on every side, and a frame
  // that swallowed clicks would break whatever the avatar is a button for), so
  // it can't be told about its own hover. Its parent is the `Avatar` root by
  // construction — this has to be a child of one to be positioned at all.
  React.useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent || animate === true) return;
    const enter = () => setHovered(true);
    const leave = () => setHovered(false);
    parent.addEventListener("pointerenter", enter);
    parent.addEventListener("pointerleave", leave);
    return () => {
      parent.removeEventListener("pointerenter", enter);
      parent.removeEventListener("pointerleave", leave);
    };
  }, [animate]);

  if (layers.length === 0) return null;
  return (
    <span
      ref={ref}
      data-slot="avatar-decoration"
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 z-1 select-none [container-type:size]",
        className
      )}
    >
      {layers.map((layer) => (
        <CosmeticLayerImage key={layer.id} layer={layer} frozen={frozen} />
      ))}
    </span>
  );
}

/**
 * One placed image, held still or let run.
 *
 * Its own component because freezing an animation needs a hook per layer — see
 * `useStaticFrame`, which draws a one-frame copy to a canvas since there is no
 * way to pause a GIF in an `<img>`.
 */
function CosmeticLayerImage({
  layer,
  frozen,
}: {
  layer: CosmeticLayer;
  frozen: boolean;
}) {
  return (
    <span
      className="pointer-events-none absolute select-none"
      style={layerStyle(layer)}
    >
      {/* A layer's url is whatever was stored — a storage URL, or a preset key
          this build draws from code. Resolved at the last moment, so a preset
          is redrawn rather than frozen into the picture it made when it was
          chosen. */}
      <LayerContent layer={layer} resolveSrc={(url) => decorationSrc(url) ?? url} frozen={frozen} />
    </span>
  );
}

function AvatarBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        "absolute right-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background select-none",
        "group-data-[size=sm]/avatar:size-2 group-data-[size=sm]/avatar:[&>svg]:hidden",
        "group-data-[size=default]/avatar:size-2.5 group-data-[size=default]/avatar:[&>svg]:size-2",
        "group-data-[size=lg]/avatar:size-3 group-data-[size=lg]/avatar:[&>svg]:size-2",
        className
      )}
      {...props}
    />
  )
}

function AvatarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        "group/avatar-group flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background",
        className
      )}
      {...props}
    />
  )
}

function AvatarGroupCount({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group-count"
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm text-muted-foreground ring-2 ring-background group-has-data-[size=lg]/avatar-group:size-10 group-has-data-[size=sm]/avatar-group:size-6 [&>svg]:size-4 group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3",
        className
      )}
      {...props}
    />
  )
}

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarDecoration,
  AvatarBadge,
  AvatarGroup,
  AvatarGroupCount,
}
