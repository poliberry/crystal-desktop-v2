import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { PERMISSIONS, can, getBasePermissions } from "../permissions";
import {
  clampMentions,
  envelopeShapeProblem,
  genericNotificationBody,
  isMessageNotification,
  isSystemAuthor,
  mustGenericize,
  plaintextViolation,
} from "./e2eePure";

/**
 * Server-side handling of end-to-end encrypted messages (docs/E2EE.md, "Server rules once
 * E2EE_ENFORCE=1"). The server stores and routes ciphertext; it never reads a body. The pure rules
 * live in `e2eePure.ts` so they can be tested without a database.
 */

/** Whether plaintext writes from users and bots are refused. Read per call, not at import: the flag is
 * flipped from the dashboard without a deploy. */
export function e2eeEnforced(): boolean {
  return process.env.E2EE_ENFORCE === "1";
}

/** The wire shape of `messages.enc` / `channelMessages.enc`; the twin of the schema's validator. */
export const encValidator = v.object({
  keyId: v.id("e2eeKeys"),
  iv: v.string(),
  ct: v.string(),
});

/** Who a message pings, in the clear. The twin of the schema's validator. */
export const mentionsValidator = v.object({
  users: v.array(v.id("users")),
  roles: v.array(v.id("roles")),
  everyone: v.boolean(),
  here: v.boolean(),
});

export type Envelope = { keyId: Id<"e2eeKeys">; iv: string; ct: string };
export type Mentions = {
  users: Id<"users">[];
  roles: Id<"roles">[];
  everyone: boolean;
  here: boolean;
};

export type Room =
  | { scope: "conversation"; conversationId: Id<"conversations"> }
  | { scope: "channel"; channelId: Id<"channels"> };

/**
 * Refuse a write that carries plaintext where it must carry `enc`. `author` is the row's author, not
 * necessarily the caller (a bot's message is authored by its user).
 */
export function assertPlaintextAllowed(args: {
  author: Pick<Doc<"users">, "clerkId">;
  hasEnc: boolean;
  /** Non-empty `text`, `embeds` or `components`. */
  hasPlaintext: boolean;
}): void {
  const problem = plaintextViolation({
    enforced: e2eeEnforced(),
    system: isSystemAuthor(args.author),
    hasEnc: args.hasEnc,
    hasPlaintext: args.hasPlaintext,
  });
  if (problem) throw new Error(problem);
}

/**
 * Check that an envelope could be a message in this room.
 *
 * The server can't open it, so this is bookkeeping, not authentication: the key must be one of this
 * room's, so a ciphertext can't be filed under another room's key; and for a send it must be the
 * current epoch, so a client that missed a rotation (someone was removed) can't keep writing under
 * the key that person still holds. An edit may use any epoch: the message may be older than the
 * latest rotation, and the editor only holds the keys it was given.
 */
export async function validateEnvelope(
  ctx: QueryCtx,
  enc: Envelope,
  room: Room,
  mode: "send" | "edit" = "send"
): Promise<void> {
  const shape = envelopeShapeProblem(enc);
  if (shape) throw new Error(shape);

  const key = await ctx.db.get(enc.keyId);
  const belongs =
    !!key &&
    key.scope === room.scope &&
    (room.scope === "conversation"
      ? key.conversationId === room.conversationId
      : key.channelId === room.channelId);
  if (!key || !belongs) throw new Error("That message was encrypted for a different conversation.");

  if (mode === "edit") return;

  const [latest] =
    room.scope === "conversation"
      ? await ctx.db
          .query("e2eeKeys")
          .withIndex("by_conversation", (q) => q.eq("conversationId", room.conversationId))
          .order("desc")
          .take(1)
      : await ctx.db
          .query("e2eeKeys")
          .withIndex("by_channel", (q) => q.eq("channelId", room.channelId))
          .order("desc")
          .take(1);
  if (!latest || latest._id !== key._id || key.supersededAt !== undefined) {
    throw new Error("The encryption key for this conversation has changed. Try sending again.");
  }
}

/**
 * Cut the sender's mention metadata down to what they may ping.
 *
 * It is stated by the client and the server can't check it against the text, so the rules are the
 * ones that don't need the text: ids that aren't in the room are dropped, and `@everyone`, `@here`
 * and roles need MENTION_EVERYONE (dropped rather than rejected, as for plaintext, so the message
 * still goes through). A group DM has no roles or mass pings: everybody in it is notified anyway.
 */
export async function validateMentions(
  ctx: QueryCtx,
  mentions: Mentions,
  room: Room,
  author: Id<"users">
): Promise<Mentions> {
  const clamped = clampMentions(mentions);

  if (room.scope === "conversation") {
    const members = await ctx.db
      .query("conversationMembers")
      .withIndex("by_conversation", (q) => q.eq("conversationId", room.conversationId))
      .collect();
    const ids = new Set<Id<"users">>(members.map((m) => m.userId));
    const users = clamped.users
      .map((id) => ctx.db.normalizeId("users", id))
      .filter((id): id is Id<"users"> => id !== null && ids.has(id));
    return { users, roles: [], everyone: false, here: false };
  }

  const channel = await ctx.db.get(room.channelId);
  const community = channel ? await ctx.db.get(channel.communityId) : null;
  if (!channel || !community) throw new Error("Channel not found.");

  const users: Id<"users">[] = [];
  for (const rawUserId of clamped.users) {
    const userId = ctx.db.normalizeId("users", rawUserId);
    if (!userId) continue;
    const membership = await ctx.db
      .query("communityMembers")
      .withIndex("by_community_user", (q) => q.eq("communityId", community._id).eq("userId", userId))
      .unique();
    if (membership) users.push(userId);
  }

  const massPing = clamped.roles.length > 0 || clamped.everyone || clamped.here;
  if (!massPing || !can(await getBasePermissions(ctx, community, author), PERMISSIONS.MENTION_EVERYONE)) {
    return { users, roles: [], everyone: false, here: false };
  }

  const roles: Id<"roles">[] = [];
  for (const rawRoleId of clamped.roles) {
    const roleId = ctx.db.normalizeId("roles", rawRoleId);
    if (!roleId) continue;
    const role = await ctx.db.get(roleId);
    // A role from another community would otherwise ping its members here.
    if (role && role.communityId === community._id) roles.push(roleId);
  }
  return { users, roles, everyone: clamped.everyone, here: clamped.here };
}

/**
 * What a notification row may say about a message, given what's stored on it.
 *
 * Rows written before enforcement carry the message's text in `body`; once enforced (or when the row
 * is for an encrypted message) that text must not be served, whatever the table holds. System
 * messages are the exception: they are plaintext by design.
 */
export function publicNotificationBody(
  row: { type: string; body?: string | null; isMention?: boolean },
  actor: Pick<Doc<"users">, "clerkId"> | null | undefined
): string | null {
  if (
    isMessageNotification(row.type) &&
    mustGenericize({ systemAuthored: !!actor && isSystemAuthor(actor), enforced: e2eeEnforced() })
  ) {
    return genericNotificationBody(row.type, row.isMention);
  }
  return row.body ?? null;
}
