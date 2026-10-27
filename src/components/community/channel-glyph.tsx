import { Armchair, Hash, Volume2 } from "lucide-react";

import { SURFACE_ICONS, SURFACE_META, type ChannelSurface } from "@/lib/community-kinds";

/**
 * The icon for a channel, wherever channels are listed — the sidebar, the setup
 * flow, the settings list — so a newsfeed is a feed and a calendar is a calendar
 * everywhere, not a `#` that happens to have a different view.
 */
export function ChannelGlyph({
  type,
  surface,
  isLounge,
  className,
}: {
  type: "text" | "voice";
  surface?: string;
  isLounge?: boolean;
  className?: string;
}) {
  if (type === "text" && surface && surface in SURFACE_ICONS) {
    const Icon = SURFACE_ICONS[surface as ChannelSurface];
    return <Icon className={className} />;
  }
  if (type === "voice") {
    const Icon = isLounge ? Armchair : Volume2;
    return <Icon className={className} />;
  }
  return <Hash className={className} />;
}

/** What to call a channel's kind, for tooltips. */
export function channelKindLabel(type: "text" | "voice", surface?: string, isLounge?: boolean): string {
  if (type === "text" && surface && surface in SURFACE_META) return SURFACE_META[surface as ChannelSurface].label;
  if (type === "voice") return isLounge ? "Lounge" : "Voice";
  return "Text";
}
