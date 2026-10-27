/**
 * The parts of the server's E2EE handling that need no database, kept apart from
 * `e2eeEnforce.ts` so they can be tested as plain functions (scripts/tests/e2ee-server.test.mts).
 * See docs/E2EE.md, "Server rules once E2EE_ENFORCE=1".
 */

/** The only author whose rows may stay plaintext once enforcement is on. */
export const SYSTEM_CLERK_ID = "system:crystal";

export function isSystemAuthor(user: { clerkId?: string | null }): boolean {
  return user.clerkId === SYSTEM_CLERK_ID;
}

/** Who a message pings, as the sender's client states it. Ids are strings here so this file needs no
 * generated types; the callers' `Id<...>` values are assignable. */
export type MentionMeta = { users: string[]; roles: string[]; everyone: boolean; here: boolean };

/** More than this in one message is not a mention, it is an attempt to ping a room. The caps bound the
 * per-id lookups validation does. */
export const MAX_MENTION_USERS = 50;
export const MAX_MENTION_ROLES = 20;

/** A 96-bit IV is 16 base64url characters. */
export const ENVELOPE_IV_LENGTH = 16;
/** AES-GCM's tag alone is 16 bytes, 22 base64url characters. */
export const ENVELOPE_MIN_CT_LENGTH = 22;
/** Roughly 75 KB of plaintext. A bot message with embeds is well under this. */
export const ENVELOPE_MAX_CT_LENGTH = 100_000;

const B64URL = /^[A-Za-z0-9_-]+$/;

/** Why an envelope is malformed, or `null`. The server cannot check the contents, but it can refuse
 * what could not possibly be a ciphertext rather than store it. */
export function envelopeShapeProblem(enc: { iv: string; ct: string }): string | null {
  if (enc.iv.length !== ENVELOPE_IV_LENGTH || !B64URL.test(enc.iv)) return "That encrypted message is malformed.";
  if (
    enc.ct.length < ENVELOPE_MIN_CT_LENGTH ||
    enc.ct.length > ENVELOPE_MAX_CT_LENGTH ||
    !B64URL.test(enc.ct)
  ) {
    return "That encrypted message is malformed.";
  }
  return null;
}

/**
 * The rule for what a write may carry.
 *
 * - An encrypted row never also carries plaintext (even before enforcement: storing both would make
 *   the ciphertext pointless).
 * - Once enforced, anyone but the system account must send `enc` rather than `text`, `embeds` or
 *   `components`. Before that, plaintext is accepted so old clients keep working during rollout.
 */
export function plaintextViolation(args: {
  enforced: boolean;
  system: boolean;
  hasEnc: boolean;
  hasPlaintext: boolean;
}): string | null {
  if (args.hasEnc && args.hasPlaintext) return "An encrypted message can't also carry plain text.";
  if (args.enforced && !args.system && args.hasPlaintext) {
    return "Messages are end-to-end encrypted now. Update Crystal to keep sending.";
  }
  return null;
}

/** Whether an edit would write the very ciphertext already stored: an outbox retry of the same edit
 * converges instead of bumping `editedAt` again. */
export function sameEnvelope(
  a: { keyId: string; iv: string; ct: string } | null | undefined,
  b: { keyId: string; iv: string; ct: string }
): boolean {
  return !!a && a.keyId === b.keyId && a.iv === b.iv && a.ct === b.ct;
}

/** Drop repeats, then cap. Order is kept so the result is stable for an idempotent retry. */
export function clampMentions(m: MentionMeta): MentionMeta {
  return {
    users: [...new Set(m.users)].slice(0, MAX_MENTION_USERS),
    roles: [...new Set(m.roles)].slice(0, MAX_MENTION_ROLES),
    everyone: m.everyone === true,
    here: m.here === true,
  };
}

/**
 * Whether a message pings `me`, worked out from its metadata alone.
 *
 * `@everyone` and `@here` count: whether `@here` actually reaches somebody offline is the
 * notification policy's business, as it is for legacy rows. A role counts when `me` holds it.
 */
export function mentionsMe(
  mentions: MentionMeta | null | undefined,
  me: string,
  myRoleIds: Iterable<string> = []
): boolean {
  if (!mentions) return false;
  if (mentions.everyone || mentions.here) return true;
  if (mentions.users.includes(me)) return true;
  if (mentions.roles.length === 0) return false;
  const mine = new Set(myRoleIds);
  return mentions.roles.some((roleId) => mine.has(roleId));
}

/** What a mention preview calls the ping: the whole room, the people around, or just you. */
export function mentionKindOf(mentions: MentionMeta | null | undefined): "you" | "everyone" | "here" {
  if (mentions?.everyone) return "everyone";
  if (mentions?.here) return "here";
  return "you";
}

/** The notification types that carry (the fact of) a message. */
export type MessageNotificationType = "dm_message" | "channel_mention" | "reply";

export function isMessageNotification(type: string): type is MessageNotificationType {
  return type === "dm_message" || type === "channel_mention" || type === "reply";
}

/**
 * The body a notification gets in place of the message's text. Never derived from the message.
 * `channel_mention` rows with `isMention: false` are ordinary channel traffic.
 */
export function genericNotificationBody(type: MessageNotificationType, isMention = true): string {
  if (type === "reply") return "Replied to you";
  if (type === "channel_mention" && isMention) return "Mentioned you";
  return "New message";
}

/**
 * Whether a notification's body must be replaced by the generic one: the message was encrypted, or
 * enforcement is on and the author isn't the system account (whose rows are plaintext by design).
 */
export function mustGenericize(args: { encrypted?: boolean; systemAuthored?: boolean; enforced: boolean }): boolean {
  if (args.encrypted) return true;
  return args.enforced && !args.systemAuthored;
}
