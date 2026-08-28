"use client";

import { cn } from "@/lib/utils";

/**
 * Which shape someone's custom status is drawn in on their profile card.
 *
 * Stored on the user (`users.statusBubble`), so it is the choice of the person
 * whose status it is rather than of whoever is looking — the two shapes read
 * differently ("I'm at work until 5" said, "should really be working" thought),
 * and which of those a status is only its author knows.
 */
export type StatusBubbleKind = "speech" | "thought";

export const STATUS_BUBBLE_KINDS: {
  kind: StatusBubbleKind;
  label: string;
  hint: string;
}[] = [
  { kind: "speech", label: "Speech", hint: "Said out loud." },
  { kind: "thought", label: "Thought", hint: "Just thinking it." },
];

/**
 * A custom status, beside the avatar rather than over it.
 *
 * It used to be pinned across the avatar's top corner, which was fine until
 * avatars grew decorations: a pill sitting on top of one cuts a chunk out of
 * the frame. Out here it has the whole width of the card's avatar row, which
 * nothing else occupies, so neither has to give way to the other.
 *
 * The tail is what makes the two shapes different, and it points back at the
 * avatar in both — a bubble whose tail points nowhere is just a pill.
 */
export function StatusBubble({
  text,
  kind = "speech",
  onClick,
  className,
}: {
  text: string;
  kind?: StatusBubbleKind;
  /** Present only on your own card, where the bubble is the shortcut to
   * changing what it says. */
  onClick?: () => void;
  className?: string;
}) {
  const thought = kind === "thought";
  const surface = "bg-accent/60 shadow-lg backdrop-blur-sm";

  const body = (
    <>
      {text}
      {thought ? (
        // Two dots trailing back towards the avatar, smaller as they go and
        // dropping a little as they do, the way a thought bubble is drawn
        // everywhere.
        <>
          <span
            aria-hidden
            className={cn("absolute bottom-1 -left-2 size-2.5 rounded-full", surface)}
          />
          <span
            aria-hidden
            className={cn("absolute -bottom-0.5 -left-4 size-1.5 rounded-full", surface)}
          />
        </>
      ) : (
        // A square turned 45°: two of its sides make the tail, and the other
        // two are hidden behind the bubble it is attached to.
        <span
          aria-hidden
          className={cn(
            "absolute top-1/2 -left-1 size-2.5 -translate-y-1/2 rotate-45 rounded-[2px]",
            surface
          )}
        />
      )}
    </>
  );

  const shape = cn(
    "relative max-w-full truncate px-3 py-1 text-sm font-medium text-white",
    // A thought is rounder than a speech bubble; the difference is small but
    // it's the same difference the tails make, and the two agree.
    thought ? "rounded-full" : "rounded-2xl",
    surface,
    className
  );

  if (!onClick) return <span className={shape}>{body}</span>;

  return (
    <button type="button" title="Change your status" onClick={onClick} className={cn(shape, "cursor-pointer hover:bg-accent/80")}>
      {body}
    </button>
  );
}
