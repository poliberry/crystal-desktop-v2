import { PresenceDot } from "@/components/presence-dot";
import { Nameplate } from "@/components/profile/nameplate";
import {
  ActivityStatusIcon,
  activitySummary,
  topActivity,
} from "@/components/rich-presence-card";
import {
  Avatar,
  AvatarDecoration,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { STATUS_LABEL, type FriendStatus } from "@/lib/presence";
import type { RichPresenceActivity } from "@/types/desktop-api";
import { cn } from "@/lib/utils";

interface FriendRowProps {
  name: string;
  username: string;
  imageUrl?: string;
  status?: FriendStatus;
  /** Overrides the presence line entirely — used where the row is about
   * something else, like a pending request. */
  subtitle?: string;
  /** Their own words about what they're up to, which outrank a detected
   * activity. */
  customStatus?: string;
  activities?: RichPresenceActivity[];
  nameplateUrl?: string;
  /** The frame around their avatar, as stored — see `decorationLayers`. */
  avatarDecoration?: string;
  /** Their birthday is today: the presence dot becomes a cake. */
  isBirthday?: boolean;
  actions?: React.ReactNode;
}

export function FriendRow({
  name,
  username,
  imageUrl,
  status,
  subtitle,
  customStatus,
  activities,
  nameplateUrl,
  avatarDecoration,
  isBirthday,
  actions,
}: FriendRowProps) {
  const offline = !status || status === "offline";
  // No activity glyph for someone offline — an icon for what they were last
  // playing is a claim about right now.
  const activity = offline ? null : topActivity(activities);

  const line =
    subtitle ??
    (offline ? null : customStatus) ??
    (offline ? null : activitySummary(activity)) ??
    (status ? STATUS_LABEL[status] : `@${username}`);

  return (
    <div className="group relative flex items-center gap-3 overflow-hidden rounded-md px-2 py-2 mb-2 hover:bg-accent/60">
      {/* Nameplate behind the row, faded towards the name so it decorates
          rather than competes with it. */}
      <Nameplate url={nameplateUrl} />
      <Avatar className="relative">
        <AvatarImage src={imageUrl} alt={name} />
        <AvatarFallback>{name.slice(0, 2).toUpperCase()}</AvatarFallback>
        <AvatarDecoration value={avatarDecoration} />
        {status && (
          <PresenceDot
            status={status}
            isBirthday={isBirthday}
            decorated={!!avatarDecoration}
            className="absolute -right-0.5 -bottom-0.5 z-10 size-3"
          />
        )}
      </Avatar>
      <div className={cn("relative min-w-0 flex-1")}>
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
          {activity && <ActivityStatusIcon activities={activities} />}
          <span className="truncate">{line}</span>
        </p>
      </div>
      {actions && <div className="relative flex items-center gap-1">{actions}</div>}
    </div>
  );
}
