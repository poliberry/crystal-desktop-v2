import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { PERMISSIONS, can, getChannelPermissions } from "../permissions";
import { resolveVoiceGrant, type VoiceGrant, type VoiceGrantInput } from "./voiceGrant";

/**
 * Everything the server decides about a person in a community voice channel, in one place: whether they
 * may be there at all, and what the room lets them send. Used when a token is minted
 * (channelCalls.join), when a bot joins (botOps `voice.prepare`) and whenever permissions change under
 * someone who is already connected (voiceSync) — so all three agree.
 */
export interface MemberVoiceAccess {
  perms: number;
  /** Connect, and not timed out. */
  allowed: boolean;
  /** Why not, for the person trying to join. */
  denial?: string;
  input: VoiceGrantInput;
  grant: VoiceGrant;
}

export async function loadMemberVoiceAccess(
  ctx: QueryCtx,
  community: Doc<"communities">,
  channel: Doc<"channels">,
  userId: Id<"users">,
  existingRow?: Doc<"channelCallParticipants"> | null,
): Promise<MemberVoiceAccess> {
  const [perms, membership, row] = await Promise.all([
    getChannelPermissions(ctx, community, channel._id, userId),
    ctx.db
      .query("communityMembers")
      .withIndex("by_community_user", (q) => q.eq("communityId", community._id).eq("userId", userId))
      .unique(),
    existingRow !== undefined
      ? Promise.resolve(existingRow)
      : ctx.db
          .query("channelCallParticipants")
          .withIndex("by_channel_user", (q) => q.eq("channelId", channel._id).eq("userId", userId))
          .unique(),
  ]);

  // A timeout keeps a member out of voice as well as out of the chat (see communities.timeoutMember).
  const timedOut = !!membership?.timeoutUntil && membership.timeoutUntil > Date.now();
  const connect = can(perms, PERMISSIONS.CONNECT);
  const allowed = connect && !!membership && !timedOut;
  const denial = !membership
    ? "Not a member of this community."
    : timedOut
      ? "You're timed out in this community, so you can't join voice right now."
      : !connect
        ? "You don't have permission to join this channel."
        : undefined;

  const input: VoiceGrantInput = {
    canSpeak: can(perms, PERMISSIONS.SPEAK),
    canVideo: can(perms, PERMISSIONS.VIDEO),
    canUseVad: can(perms, PERMISSIONS.USE_VAD),
    canSoundboard: can(perms, PERMISSIONS.USE_SOUNDBOARD),
    canExternalSounds: can(perms, PERMISSIONS.USE_EXTERNAL_SOUNDS),
    hasPriority: can(perms, PERMISSIONS.PRIORITY_SPEAKER),
    serverMuted: row?.serverMuted ?? false,
    serverDeafened: row?.serverDeafened ?? false,
    stage: channel.isStage === true,
    // Whoever can mute people can run the stage; they don't have to ask to speak.
    stageModerator: can(perms, PERMISSIONS.MUTE_MEMBERS),
    stageApproved: row?.stageApproved ?? false,
  };
  return { perms, allowed, denial, input, grant: resolveVoiceGrant(input) };
}

/**
 * Ask for a member's grant in LiveKit to be brought in line with their permissions as they are now —
 * call this after anything that can change what someone in voice may do (a role or channel overwrite
 * edit, a server mute, a stage promotion). Runs in the background; it only touches LiveKit for the
 * people whose grant actually changed, and disconnects anyone who may no longer be there.
 */
export async function scheduleVoiceSync(
  ctx: MutationCtx,
  scope: { communityId: Id<"communities">; channelId?: Id<"channels">; userId?: Id<"users"> },
): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.voiceSync.resync, scope);
}
