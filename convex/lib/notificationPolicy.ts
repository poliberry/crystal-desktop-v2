import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * Whether a given notification should reach a given user.
 *
 * Loaded once and consulted from both delivery paths — `notifyUsers`, which
 * writes the persisted notification and schedules push, and the `feed` query
 * the desktop background notifier subscribes to. Deciding here rather than in
 * the Electron main process means the rule holds for push and mobile too, and
 * the notifier stays dumb.
 *
 * Suppression is checked first and short-circuits everything: it is not one
 * preference among several, it's an override. Two statuses suppress — Do Not
 * Disturb and Busy — which are the same rule with different reasons behind
 * them (see src/lib/presence.ts).
 */

export type CommunityNotificationLevel = "all" | "mentions" | "none";

export interface NotificationPolicy {
  /** Which status is suppressing delivery, or null. While it is set, nothing
   * at all is delivered regardless of the rest of this object — and the client
   * says which one it was, since "Busy is on" and "Do Not Disturb is on" are
   * different sentences. */
  suppressedBy: "dnd" | "busy" | null;
  dmMessages: boolean;
  channelMessages: boolean;
  friendRequests: boolean;
  /** Someone rings you in a DM/group call. */
  incomingCalls: boolean;
  /** Someone joins a call you're in, or a voice channel shared with a friend. */
  callActivity: boolean;
  /** A friend starts streaming in a call. */
  streamActivity: boolean;
  /** Someone replies to one of your messages. */
  replies: boolean;
  communityLevels: Map<string, CommunityNotificationLevel>;
}

/**
 * Defaults for a user who has never touched the settings — chosen to match
 * the behaviour that existed before these settings did, so nobody's
 * notifications change until they ask.
 */
const DEFAULTS = {
  dmMessages: true,
  channelMessages: true,
  friendRequests: true,
  incomingCalls: true,
  callActivity: true,
  streamActivity: true,
  replies: true,
  communityLevel: "all" as CommunityNotificationLevel,
};

export async function loadNotificationPolicy(
  ctx: QueryCtx,
  userId: Id<"users">
): Promise<NotificationPolicy> {
  const [presence, settings, communitySettings] = await Promise.all([
    ctx.db
      .query("presence")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique(),
    ctx.db
      .query("notificationSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique(),
    ctx.db
      .query("communityNotificationSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect(),
  ]);

  return {
    // The *manual* choice, not the effective status: an idle user still wants
    // their notifications, but someone who deliberately set DND or Busy does
    // not — that is what those two mean.
    suppressedBy:
      presence?.manualStatus === "dnd" || presence?.manualStatus === "busy"
        ? presence.manualStatus
        : null,
    dmMessages: settings?.dmMessages ?? DEFAULTS.dmMessages,
    channelMessages: settings?.channelMessages ?? DEFAULTS.channelMessages,
    friendRequests: settings?.friendRequests ?? DEFAULTS.friendRequests,
    incomingCalls: settings?.incomingCalls ?? DEFAULTS.incomingCalls,
    callActivity: settings?.callActivity ?? DEFAULTS.callActivity,
    streamActivity: settings?.streamActivity ?? DEFAULTS.streamActivity,
    replies: settings?.replies ?? DEFAULTS.replies,
    communityLevels: new Map(communitySettings.map((row) => [row.communityId, row.level])),
  };
}

export function communityLevel(
  policy: NotificationPolicy,
  communityId: Id<"communities">
): CommunityNotificationLevel {
  return policy.communityLevels.get(communityId) ?? DEFAULTS.communityLevel;
}

/** Whether a direct or group message should notify. */
export function allowsDirectMessage(policy: NotificationPolicy): boolean {
  return !policy.suppressedBy && policy.dmMessages;
}

export function allowsFriendRequest(policy: NotificationPolicy): boolean {
  return !policy.suppressedBy && policy.friendRequests;
}

/** Whether an incoming-call ring should notify. */
export function allowsIncomingCall(policy: NotificationPolicy): boolean {
  return !policy.suppressedBy && policy.incomingCalls;
}

/** Whether "someone joined a call" should notify. */
export function allowsCallActivity(policy: NotificationPolicy): boolean {
  return !policy.suppressedBy && policy.callActivity;
}

/** Whether "someone started streaming" should notify. */
export function allowsStreamActivity(policy: NotificationPolicy): boolean {
  return !policy.suppressedBy && policy.streamActivity;
}

/** Whether a reply to one of your messages should notify. */
export function allowsReply(policy: NotificationPolicy): boolean {
  return !policy.suppressedBy && policy.replies;
}

/**
 * Whether a channel message should notify.
 *
 * A mention only needs the server to be above "none"; anything else needs the
 * server on "all" *and* the account-wide channel-messages switch on, so
 * either one can silence background chatter on its own.
 */
export function allowsChannelMessage(
  policy: NotificationPolicy,
  communityId: Id<"communities">,
  isMention: boolean
): boolean {
  if (policy.suppressedBy) return false;
  const level = communityLevel(policy, communityId);
  if (level === "none") return false;
  if (isMention) return true;
  return level === "all" && policy.channelMessages;
}
