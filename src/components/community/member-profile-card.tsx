"use client";

import { useQuery } from "convex/react";
import { Crown, Settings } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getDesktopAPI } from "@/lib/desktop";
import { STATUS_DOT_CLASS, type FriendStatus } from "@/lib/presence";

export interface MemberProfileMember {
  userId: Id<"users">;
  name: string;
  username: string;
  imageUrl?: string;
  bio?: string;
  status: FriendStatus;
  /** Community-only — omitted for DM member profiles. */
  isOwner?: boolean;
  roles?: { id: Id<"roles">; name: string; color?: string }[];
}

/**
 * Discord-style "click a member to see their profile" card — avatar, display
 * name, username, roles, and bio. Meant to be rendered as `PopoverContent`
 * anchored to whatever the user clicked, not a centered dialog. Clicking
 * yourself offers a shortcut into Settings' Profile tab instead of
 * duplicating an editor here.
 */
export function MemberProfileCard({ member }: { member: MemberProfileMember }) {
  const me = useQuery(api.users.getCurrentUser);
  const isSelf = !!me && me._id === member.userId;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Avatar className="size-16">
          <AvatarImage src={member.imageUrl} alt={member.name} />
          <AvatarFallback className="text-lg">{member.name.slice(0, 2).toUpperCase()}</AvatarFallback>
          <AvatarBadge className={STATUS_DOT_CLASS[member.status]} />
        </Avatar>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-lg font-semibold">{member.name}</p>
            {member.isOwner && <Crown className="size-4 shrink-0 text-amber-500" />}
          </div>
          <p className="truncate text-sm text-muted-foreground">@{member.username}</p>
        </div>
      </div>

      {member.roles && member.roles.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {member.roles.map((role) => (
            <Badge
              key={role.id}
              variant="outline"
              style={role.color ? { borderColor: role.color, color: role.color } : undefined}
            >
              {role.name}
            </Badge>
          ))}
        </div>
      )}

      {member.bio ? (
        <p className="text-sm whitespace-pre-wrap">{member.bio}</p>
      ) : (
        <p className="text-sm text-muted-foreground italic">No bio yet.</p>
      )}

      {isSelf && (
        <Button
          variant="secondary"
          className="w-full gap-1.5"
          onClick={() => void getDesktopAPI()?.settings.open()}
        >
          <Settings className="size-4" />
          Edit profile in Settings
        </Button>
      )}
    </div>
  );
}
