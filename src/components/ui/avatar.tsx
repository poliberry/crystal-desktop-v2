"use client"

import * as React from "react"
import { Avatar as AvatarPrimitive } from "radix-ui"

import { useStaticFrame } from "@/hooks/use-static-frame"
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
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
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
 * The frame drawn around an avatar — see src/lib/avatar-decorations.ts.
 *
 * A sibling of AvatarImage rather than a wrapper, so it costs a render site one
 * line and nothing when there's no decoration to draw. It overflows the
 * avatar's box on every side (which is the point) and so has to be a child of
 * the root, whose `rounded-full` deliberately doesn't clip.
 *
 * Sized as a percentage of the avatar and centred on it, rather than by four
 * negative insets. An `<img>` is a replaced element: given `inset` on every
 * side but no width, it falls back to the picture's *intrinsic* size and
 * honours only `left`/`top` — so the SVG presets (which have no intrinsic size)
 * fitted the box while an uploaded PNG rendered at its own pixel dimensions,
 * a thousand pixels of decoration across the window.
 *
 * The ratio is the one the built-in presets are laid out for: the avatar
 * occupies the centred 76-unit square of their 100-unit viewBox. Custom uploads
 * drawn to the same convention (which is Discord's) therefore line up without
 * being told anything.
 *
 * Under the badge (`z-10`) rather than over it: a decoration is jewellery and
 * a presence dot is information.
 */
function AvatarDecoration({
  src,
  animate = "hover",
  className,
  ...props
}: React.ComponentProps<"img"> & {
  src: string | undefined;
  /**
   * When an animated decoration is allowed to play. `"hover"` — the default —
   * holds it on its first frame until the avatar is pointed at, because a
   * member list is fifty avatars and fifty looping animations is a room full
   * of moving parts nobody asked to look at. `true` is for the places that are
   * *about* one person, where the decoration is worth seeing in full.
   */
  animate?: boolean | "hover";
}) {
  const ref = React.useRef<HTMLImageElement>(null);
  const [hovered, setHovered] = React.useState(false);
  const frozen = animate !== true && !hovered;
  const poster = useStaticFrame(src, frozen);

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

  if (!src) return null;
  return (
    <img
      ref={ref}
      data-slot="avatar-decoration"
      // The poster is a still of this same file, so a decoration that isn't
      // animated in the first place is bit-for-bit what it always was.
      src={poster ?? src}
      alt=""
      aria-hidden
      draggable={false}
      className={cn(
        "pointer-events-none absolute top-1/2 left-1/2 z-1 h-[126%] w-[126%] max-w-none -translate-x-1/2 -translate-y-1/2 select-none object-contain",
        className
      )}
      {...props}
    />
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
