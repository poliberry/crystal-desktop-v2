"use client";

import { useQuery } from "convex/react";
import { useEffect } from "react";

import { api } from "../../convex/_generated/api";
import { getDesktopAPI } from "@/lib/desktop";

/**
 * How many things are waiting for you, on the icon in the dock or taskbar.
 *
 * The same number the inbox shows — unread notifications, which is mentions,
 * direct messages and friend requests. Deliberately the same query rather than
 * a second count of the same idea: an icon that says three and an inbox that
 * says four is a bug report.
 *
 * The drawing is split across the process boundary because the platforms
 * disagree about whose job it is. macOS and Linux take a number and render the
 * badge themselves, in the system's own style. Windows composites an *image*
 * over the taskbar button and has no opinion about what it looks like — so it
 * is drawn here, where there is a canvas and a font to draw it with, and sent
 * over as a PNG.
 */

/** Past this the exact number stops being information. Matches the inbox. */
const BADGE_CAP = 99;

/** Windows taskbar overlays are drawn at 16px and scaled; twice that keeps the
 * digits sharp on a high-DPI display without paying for a full 4x. */
const OVERLAY_PX = 32;

export function useAppBadge(): void {
  const unread = useQuery(api.notifications.unreadCount) ?? 0;

  useEffect(() => {
    const desktop = getDesktopAPI();
    // Optional: an older preload has no badge channel, and the web build has
    // no desktop at all.
    if (!desktop?.badge) return;

    void desktop.badge.set(unread, unread > 0 ? drawOverlay(unread) : null);
  }, [unread]);
}

/**
 * The Windows overlay: a red disc with the count in it.
 *
 * Drawn rather than shipped as ten PNGs, because the number is unbounded — and
 * because a canvas is already here. Returns null if the canvas is unavailable,
 * which leaves Windows with no overlay rather than a broken one.
 */
function drawOverlay(count: number): string | null {
  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = OVERLAY_PX;
  canvas.height = OVERLAY_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const label = count > BADGE_CAP ? `${BADGE_CAP}+` : String(count);
  const centre = OVERLAY_PX / 2;

  ctx.fillStyle = "#ef4444";
  ctx.beginPath();
  ctx.arc(centre, centre, centre, 0, Math.PI * 2);
  ctx.fill();

  // Sized to the label rather than fixed: "9" and "99+" have to fit the same
  // disc, and a three-character badge set in the one-character size spills out
  // of it.
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${label.length > 2 ? 14 : label.length > 1 ? 18 : 22}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // A hair below centre: digits sit above the vertical middle of their box, so
  // a mathematically centred number reads as too high.
  ctx.fillText(label, centre, centre + 1);

  return canvas.toDataURL("image/png");
}
