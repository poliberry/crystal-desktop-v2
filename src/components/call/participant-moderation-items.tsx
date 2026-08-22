"use client";

import { useMutation, useQuery } from "convex/react";
import { HeadphoneOff, Headphones, Mic, MicOff, PhoneOff } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { PERMISSIONS, hasPermission } from "@/lib/permissions";

/**
 * Server mute / deafen / disconnect, for the call UI's per-participant
 * context menu.
 *
 * Renders nothing unless the viewer holds at least one of the permissions and
 * the target is someone else in a community voice channel — a DM call has no
 * roles to moderate under. The server re-checks every one of these plus role
 * hierarchy; hiding them here is only so the menu isn't full of things that
 * would fail.
 */
export function ParticipantModerationItems({
  communityId,
  channelId,
  userId,
  name,
}: {
  communityId: Id<"communities">;
  channelId: Id<"channels">;
  userId: Id<"users">;
  name: string;
}) {
  const me = useQuery(api.users.getCurrentUser);
  const myPermissions = useQuery(api.roles.myPermissions, { communityId }) ?? 0;
  const participants = useQuery(api.channels.listVoiceParticipants, { channelId }) ?? [];
  const setMemberVoiceState = useMutation(api.channels.setMemberVoiceState);
  const disconnectMember = useMutation(api.channels.disconnectMember);

  const target = participants.find((p) => p.id === userId);
  const canMute = hasPermission(myPermissions, PERMISSIONS.MUTE_MEMBERS);
  const canDeafen = hasPermission(myPermissions, PERMISSIONS.DEAFEN_MEMBERS);
  const canDisconnect = hasPermission(myPermissions, PERMISSIONS.MOVE_MEMBERS);

  if (!me || me._id === userId || !target) return null;
  if (!canMute && !canDeafen && !canDisconnect) return null;

  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Moderation
      </ContextMenuLabel>

      {canMute && (
        <ContextMenuItem
          onClick={() =>
            void setMemberVoiceState({
              channelId,
              userId,
              serverMuted: !target.serverMuted,
            }).catch(() => {})
          }
        >
          {target.serverMuted ? <Mic /> : <MicOff />}
          {target.serverMuted ? "Unmute on server" : "Server mute"}
        </ContextMenuItem>
      )}

      {canDeafen && (
        <ContextMenuItem
          onClick={() =>
            void setMemberVoiceState({
              channelId,
              userId,
              serverDeafened: !target.serverDeafened,
            }).catch(() => {})
          }
        >
          {target.serverDeafened ? <Headphones /> : <HeadphoneOff />}
          {target.serverDeafened ? "Undeafen on server" : "Server deafen"}
        </ContextMenuItem>
      )}

      {canDisconnect && (
        <ContextMenuItem
          variant="destructive"
          onClick={() => void disconnectMember({ channelId, userId }).catch(() => {})}
        >
          <PhoneOff />
          Disconnect {name}
        </ContextMenuItem>
      )}
    </>
  );
}
