import { ACTIVITY_COLOR, STATUS_COLOR, type DisplayStatus, type FriendStatus } from "@/lib/presence";
import { cn } from "@/lib/utils";

/**
 * The glyph a presence dot draws — a status, or the activity that replaces it.
 *
 * Phosphor's Fill weight, drawn from the path data rather than imported from a
 * package: these are nine of them, they are the exact nine chosen in issue
 * #101, and inlining them means a status dot costs no icon-set import in a
 * component that renders once per row of a member list.
 *
 * Every one is a 256 unit square, which is what makes them interchangeable —
 * whatever the dot is sized to, the glyph fills it.
 */

export type PresenceGlyphKind =
  | DisplayStatus
  | FriendStatus
  | keyof typeof ACTIVITY_COLOR;

/** Path data, by glyph. Phosphor Fill, 0 0 256 256. */
const PATHS: Record<PresenceGlyphKind, string> = {
  // Circle — a solid dot, which is what a status has always been.
  online:
    "M232,128A104,104,0,1,1,128,24,104.13,104.13,0,0,1,232,128Z",
  // Circle Dashed — present, but flickering.
  idle:
    "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm54.59,45a8,8,0,0,1,11.29.7,88,88,0,0,1,17.6,30.47,8,8,0,0,1-15.18,5.08,71.87,71.87,0,0,0-14.4-25A8,8,0,0,1,182.59,69ZM73.41,187.05a8,8,0,0,1-11.29-.7,88,88,0,0,1-17.6-30.47A8,8,0,1,1,59.7,150.8a71.87,71.87,0,0,0,14.4,24.95A8,8,0,0,1,73.41,187.05Zm.69-106.8a71.87,71.87,0,0,0-14.4,25,8,8,0,1,1-15.18-5.08,88,88,0,0,1,17.6-30.47,8,8,0,1,1,12,10.6Zm71.49,134a87.8,87.8,0,0,1-35.18,0,8,8,0,0,1,3.18-15.68,72.08,72.08,0,0,0,28.82,0,8,8,0,0,1,3.18,15.68Zm6.25-163A8,8,0,0,1,144,57.61a7.89,7.89,0,0,1-1.6-.16,72.08,72.08,0,0,0-28.82,0,8,8,0,0,1-3.18-15.68,87.8,87.8,0,0,1,35.18,0A8,8,0,0,1,151.84,51.29Z",
  // Moon — gone to bed, or at least gone.
  away:
    "M235.54,150.21a104.84,104.84,0,0,1-37,52.91A104,104,0,0,1,32,120,103.09,103.09,0,0,1,52.88,57.48a104.84,104.84,0,0,1,52.91-37,8,8,0,0,1,10,10,88.08,88.08,0,0,0,109.8,109.8,8,8,0,0,1,10,10Z",
  // Prohibit — the crossed-out circle every messenger uses for "not now".
  dnd:
    "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm37.66,141.66a8,8,0,0,1-11.32,0l-64-64a8,8,0,0,1,11.32-11.32l64,64A8,8,0,0,1,165.66,165.66Z",
  // Circle Half — half here, half elsewhere.
  busy:
    "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24ZM40,128a88.1,88.1,0,0,1,88-88V216A88.1,88.1,0,0,1,40,128Z",
  // Power — switched off, whether or not that is the truth.
  offline:
    "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,176A72,72,0,0,1,92,65.64a8,8,0,0,1,8,13.85,56,56,0,1,0,56,0,8,8,0,0,1,8-13.85A72,72,0,0,1,128,200Z",
  // Invisible is offline, to you as much as to anyone: the whole point is
  // that the two are the same picture.
  invisible:
    "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,176A72,72,0,0,1,92,65.64a8,8,0,0,1,8,13.85,56,56,0,1,0,56,0,8,8,0,0,1,8-13.85A72,72,0,0,1,128,200Z",
  // Game Controller.
  playing:
    "M247.44,173.75a.68.68,0,0,0,0-.14L231.05,89.44c0-.06,0-.12,0-.18A60.08,60.08,0,0,0,172,40H83.89a59.88,59.88,0,0,0-59,49.52L8.58,173.61a.68.68,0,0,0,0,.14,36,36,0,0,0,60.9,31.71l.35-.37L109.52,160h37l39.71,45.09c.11.13.23.25.35.37A36.08,36.08,0,0,0,212,216a36,36,0,0,0,35.43-42.25ZM104,112H96v8a8,8,0,0,1-16,0v-8H72a8,8,0,0,1,0-16h8V88a8,8,0,0,1,16,0v8h8a8,8,0,0,1,0,16Zm40-8a8,8,0,0,1,8-8h24a8,8,0,0,1,0,16H152A8,8,0,0,1,144,104Zm84.37,87.47a19.84,19.84,0,0,1-12.9,8.23A20.09,20.09,0,0,1,198,194.31L167.8,160H172a60,60,0,0,0,51-28.38l8.74,45A19.82,19.82,0,0,1,228.37,191.47Z",
  // Music Notes.
  listening:
    "M212.92,17.71a7.89,7.89,0,0,0-6.86-1.46l-128,32A8,8,0,0,0,72,56V166.1A36,36,0,1,0,88,196V102.25l112-28V134.1A36,36,0,1,0,216,164V24A8,8,0,0,0,212.92,17.71Z",
  // Monitor Play — one screen for both, since either way there is a screen.
  watching:
    "M168,224a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,224ZM232,64V176a24,24,0,0,1-24,24H48a24,24,0,0,1-24-24V64A24,24,0,0,1,48,40H208A24,24,0,0,1,232,64Zm-68,56a8,8,0,0,0-3.41-6.55l-40-28A8,8,0,0,0,108,92v56a8,8,0,0,0,12.59,6.55l40-28A8,8,0,0,0,164,120Z",
  streaming:
    "M168,224a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,224ZM232,64V176a24,24,0,0,1-24,24H48a24,24,0,0,1-24-24V64A24,24,0,0,1,48,40H208A24,24,0,0,1,232,64Zm-68,56a8,8,0,0,0-3.41-6.55l-40-28A8,8,0,0,0,108,92v56a8,8,0,0,0,12.59,6.55l40-28A8,8,0,0,0,164,120Z",
};

/** The colour each glyph is drawn in. An activity keeps its own — the point of
 * showing it instead of the status is that it says something different. */
function colorFor(kind: PresenceGlyphKind): string {
  return (
    (ACTIVITY_COLOR as Record<string, string>)[kind] ??
    (STATUS_COLOR as Record<string, string>)[kind] ??
    STATUS_COLOR.offline
  );
}

export function PresenceGlyph({
  kind,
  className,
}: {
  kind: PresenceGlyphKind;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 256 256"
      fill={colorFor(kind)}
      aria-hidden
      className={cn("size-full", className)}
    >
      <path d={PATHS[kind]} />
    </svg>
  );
}
