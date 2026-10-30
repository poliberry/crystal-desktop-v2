import { requireAbility, requireCommunityOpen } from "./lib/moderation";
import { paginationOptsValidator } from "convex/server";
import { v, type ObjectType } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireCommunity } from "./communities";
import { logCommunityAudit } from "./lib/communityAudit";
import { notifyUsers } from "./notifications";
import { PERMISSIONS, can, getChannelPermissions } from "./permissions";
import { MAX_ATTACHMENT_BYTES, requireWithinUploadLimit } from "./uploadLimits";
import { getCurrentUserOrThrow } from "./users";
import { unexpiredCustomStatus } from "./lib/activities";
import { effectiveDecoration, isBirthdayNow } from "./lib/birthday";
import { renderMentionsAsText, resolveChannelMentions } from "./lib/mentions";
import { channelPageKeys } from "./lib/messageCacheKeys";
import {
  assertPlaintextAllowed,
  encValidator,
  mentionsValidator,
  validateEnvelope,
  validateMentions,
} from "./lib/e2eeEnforce";
import { sameEnvelope } from "./lib/e2eePure";
import { internal } from "./_generated/api";
import { markChannelRead } from "./channels";
import { isMessageHidden, windowsByTarget } from "./lib/blocking";
import { describeMessage, dispatchMessageCreated, fireCommunityEvent } from "./lib/botEvents";
import type { ActionRow } from "./lib/components";
import type { Embed } from "./lib/embeds";
import { isAcceptableAttachmentSource } from "./lib/klipy";
import { releaseFile } from "./lib/files";
import { recordMessageSent } from "./lib/communityInsights";
import { effectiveFileType } from "./lib/mediaType";
import { historyFloorFor, historyFloorIn, withinHistory, type HistoryFloor } from "./lib/history";
import { dropPollVotes, messageExtras, pollResults } from "./lib/messageExtras";
import { cleanPoll } from "./lib/pollPure";
import { enforceSlowmode } from "./lib/slowmode";
import { cleanVoiceMessage } from "./lib/voicePure";

function r2UrlForKey(key: string): string | null {
  const base = process.env.R2_PUBLIC_URL ?? process.env.CDN_URL ?? "";
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/${key.replace(/^\//, "")}`;
}

async function requireChannelPerm(
  ctx: QueryCtx,
  channelId: Id<"channels">,
  userId: Id<"users">,
  flag: number
): Promise<void> {
  const channel = await ctx.db.get(channelId);
  if (!channel) throw new Error("Channel not found.");
  const community = await requireCommunity(ctx, channel.communityId);
  const perms = await getChannelPermissions(ctx, community, channelId, userId);
  if (!can(perms, flag)) throw new Error("You don't have permission to do that.");
}

/**
 * A reaction that is another community's custom emoji (`<:name:id>`) takes Use External Emojis
 * here. Unicode emoji and this community's own are always fine.
 */
async function requireOwnCommunityEmoji(ctx: QueryCtx, channelId: Id<"channels">, userId: Id<"users">, emoji: string): Promise<void> {
  const tag = /^<:[a-zA-Z0-9_]+:([a-zA-Z0-9]+)>$/.exec(emoji);
  if (!tag) return;
  const channel = await ctx.db.get(channelId);
  if (!channel) return;
  const doc = await ctx.db.get(tag[1] as Id<"communityEmojis">).catch(() => null);
  if (!doc || doc.communityId === channel.communityId) return;
  if (!(await channelPermitted(ctx, channelId, userId, PERMISSIONS.USE_EXTERNAL_EMOJIS))) {
    throw new Error("You can't use emojis from other communities here.");
  }
}

/** Whether `userId` holds `flag` in the channel — the question, not the refusal. */
async function channelPermitted(ctx: QueryCtx, channelId: Id<"channels">, userId: Id<"users">, flag: number): Promise<boolean> {
  const channel = await ctx.db.get(channelId);
  if (!channel) return false;
  const community = await requireCommunity(ctx, channel.communityId);
  return can(await getChannelPermissions(ctx, community, channelId, userId), flag);
}

/** Where `userId` starts reading in a channel: see lib/history.ts. */
async function channelHistoryFloor(ctx: QueryCtx, channelId: Id<"channels">, userId: Id<"users">): Promise<HistoryFloor> {
  const channel = await ctx.db.get(channelId);
  if (!channel) return { restricted: false };
  return historyFloorIn(ctx, await requireCommunity(ctx, channel.communityId), channelId, userId);
}

/** Pinning is its own permission now; Manage Messages still does it, as it always did. */
async function requirePinPerm(ctx: QueryCtx, channelId: Id<"channels">, userId: Id<"users">): Promise<void> {
  const channel = await ctx.db.get(channelId);
  if (!channel) throw new Error("Channel not found.");
  const community = await requireCommunity(ctx, channel.communityId);
  const perms = await getChannelPermissions(ctx, community, channelId, userId);
  if (!can(perms, PERMISSIONS.MANAGE_MESSAGES) && !can(perms, PERMISSIONS.PIN_MESSAGES)) {
    throw new Error("You don't have permission to do that.");
  }
}

const MAX_REACTION_ROWS = 200;

async function reactionsFor(ctx: QueryCtx, messageId: Id<"channelMessages">, me: Id<"users">) {
  const rows = await ctx.db
    .query("channelMessageReactions")
    .withIndex("by_message", (q) => q.eq("messageId", messageId))
    // Bounded: one viral message must not make every page that shows it read thousands of rows.
    .take(MAX_REACTION_ROWS);
  const grouped = new Map<string, { emoji: string; count: number; reactedByMe: boolean }>();
  for (const row of rows) {
    const g = grouped.get(row.emoji) ?? { emoji: row.emoji, count: 0, reactedByMe: false };
    g.count += 1;
    if (row.userId === me) g.reactedByMe = true;
    grouped.set(row.emoji, g);
  }
  return Array.from(grouped.values());
}

/** Longest a reply preview snippet gets — a preview is one line. */
const REPLY_SNIPPET_MAX = 140;

/** The compact "replying to…" card for a channel message. See the twin in
 * convex/messages.ts. */
async function resolveReplyPreview(
  ctx: QueryCtx,
  replyToId: Id<"channelMessages"> | undefined,
  floor: HistoryFloor = { restricted: false },
) {
  if (!replyToId) return null;
  const target = await ctx.db.get(replyToId);
  // A reply to something from before the viewer's history starts: the quote would hand it over.
  if (target && !withinHistory(floor, target._creationTime)) {
    return {
      id: replyToId as string,
      authorId: undefined as Id<"users"> | undefined,
      createdAt: undefined as number | undefined,
      authorName: "Earlier message",
      authorImageUrl: undefined as string | undefined,
      text: null as string | null,
      enc: null as Doc<"channelMessages">["enc"] | null,
      hasAttachment: false,
      deleted: true,
      hidden: true,
    };
  }
  if (!target) {
    return {
      id: replyToId as string,
      authorId: undefined as Id<"users"> | undefined,
      createdAt: undefined as number | undefined,
      authorName: "Unknown",
      authorImageUrl: undefined as string | undefined,
      text: null as string | null,
      enc: null as Doc<"channelMessages">["enc"] | null,
      hasAttachment: false,
      deleted: true,
    };
  }
  const [author, firstAttachment] = await Promise.all([
    ctx.db.get(target.authorId),
    target.hasAttachments === false
      ? []
      : ctx.db
          .query("channelMessageAttachments")
          .withIndex("by_message", (q) => q.eq("messageId", target._id))
          .take(1),
  ]);
  return {
    id: target._id as string,
    // For the per-viewer pass in `withoutHidden`; see the twin in
    // convex/messages.ts.
    authorId: target.authorId as Id<"users"> | undefined,
    createdAt: target._creationTime as number | undefined,
    authorName: author?.name ?? "Unknown",
    authorImageUrl: author?.imageUrl,
    // See the twin in convex/messages.ts: no snippet is built from ciphertext.
    text:
      !target.enc && target.text
        ? (await renderMentionsAsText(ctx, target.text)).slice(0, REPLY_SNIPPET_MAX)
        : null,
    enc: target.enc ?? null,
    hasAttachment: firstAttachment.length > 0,
    deleted: false,
  };
}

type PageMessage = {
  createdAt: number;
  author: { id: Id<"users"> } | null;
  replyTo: {
    id: string;
    authorId?: Id<"users">;
    createdAt?: number;
    authorName: string;
    authorImageUrl?: string;
    text: string | null;
    enc?: Doc<"channelMessages">["enc"] | null;
    hasAttachment: boolean;
    deleted: boolean;
    hidden?: boolean;
  } | null;
};

/**
 * Take what the viewer has ignored or blocked out of a page of channel
 * messages — after the shared first-page cache, never before it. See the twin
 * in convex/messages.ts for why, and for what a reply to a hidden message
 * becomes.
 */
function withoutHidden<T extends PageMessage>(
  hidden: ReadonlyMap<Id<"users">, Doc<"userSuppressions">[]>,
  messages: T[]
): T[] {
  if (hidden.size === 0) return messages;
  return messages
    .filter((m) => !m.author || !isMessageHidden(hidden, m.author.id, m.createdAt))
    .map((m) => {
      const quoted = m.replyTo;
      if (
        !quoted?.authorId ||
        quoted.createdAt === undefined ||
        !isMessageHidden(hidden, quoted.authorId, quoted.createdAt)
      ) {
        return m;
      }
      return {
        ...m,
        replyTo: {
          id: quoted.id,
          authorName: "Hidden user",
          text: null,
          hasAttachment: false,
          deleted: true,
          hidden: true,
        },
      };
    });
}

/**
 * Per-community presentation for a message author: the nickname and avatar
 * from their server profile (falling back to their global profile), plus the
 * colour of their highest-positioned coloured role.
 *
 * Resolved once per distinct author rather than per message — a page of
 * messages is usually a handful of people talking, so this collapses dozens
 * of lookups into a few.
 */
async function communityAuthorDecorations(
  ctx: QueryCtx,
  communityId: Id<"communities">,
  userIds: Id<"users">[]
) {
  const roles = await ctx.db
    .query("roles")
    .withIndex("by_community", (q) => q.eq("communityId", communityId))
    .collect();
  const roleById = new Map(roles.map((r) => [r._id, r]));

  const entries = await Promise.all(
    userIds.map(async (userId) => {
      const [serverProfile, assigned] = await Promise.all([
        ctx.db
          .query("serverProfiles")
          .withIndex("by_user_community", (q) =>
            q.eq("userId", userId).eq("communityId", communityId)
          )
          .unique(),
        ctx.db
          .query("memberRoles")
          .withIndex("by_member", (q) =>
            q.eq("communityId", communityId).eq("userId", userId)
          )
          .collect(),
      ]);

      // Discord's rule: the name takes the colour of the highest-positioned
      // role that actually defines one, so an uncoloured role above a
      // coloured one doesn't blank the name out.
      const roleColor = assigned
        .map((m) => roleById.get(m.roleId))
        .filter((r): r is Doc<"roles"> => !!r && !!r.color)
        .sort((a, b) => b.position - a.position)[0]?.color;

      return [userId, { serverProfile, roleColor }] as const;
    })
  );
  return new Map(entries);
}

const EMPTY_PAGE = { page: [] as never[], isDone: true, continueCursor: "" };

export const list = query({
  args: { channelId: v.id("channels"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { channelId, paginationOpts }) => {
    const me = await getCurrentUserOrThrow(ctx);

    // An empty, finished page rather than a throw when the channel is gone or
    // can't be seen any more. The data preloader keeps this subscribed for
    // recently-viewed channels, so deleting or leaving a community re-runs it
    // against a channel that no longer exists — and a throw from a query is an
    // uncaught render error for the whole app.
    const channel = await ctx.db.get(channelId);
    const community = channel ? await ctx.db.get(channel.communityId) : null;
    if (!channel || !community) return EMPTY_PAGE;
    const membership = await ctx.db
      .query("communityMembers")
      .withIndex("by_community_user", (q) => q.eq("communityId", community._id).eq("userId", me._id))
      .unique();
    if (!membership) return EMPTY_PAGE;
    const perms = await getChannelPermissions(ctx, community, channelId, me._id);
    if (!can(perms, PERMISSIONS.VIEW_CHANNELS)) return EMPTY_PAGE;

    // Without Read Message History a member starts where they last opened the channel; a member who
    // has never opened it yet sees nothing.
    const floor = await historyFloorFor(ctx, channelId, me._id, perms);
    if (floor.restricted && floor.after === Number.POSITIVE_INFINITY) return EMPTY_PAGE;

    const hidden = await windowsByTarget(ctx, me._id);
    const page = await ctx.db
      .query("channelMessages")
      .withIndex("by_channel", (q) => (floor.restricted ? q.eq("channelId", channelId).gt("_creationTime", floor.after) : q.eq("channelId", channelId)))
      .order("desc")
      .paginate(paginationOpts);

    const authorIds = [...new Set(page.page.map((m) => m.authorId))];
    // Each distinct author read once for the page, like their decorations below.
    const [decorations, authorRows] = await Promise.all([
      communityAuthorDecorations(ctx, channel.communityId, authorIds),
      Promise.all(authorIds.map((id) => ctx.db.get(id))),
    ]);
    const authors = new Map(authorIds.map((id, i) => [id, authorRows[i]] as const));

    const messages = await Promise.all(
      page.page.map(async (message) => {
        const author = authors.get(message.authorId) ?? null;
        const decoration = decorations.get(message.authorId);
        const serverProfile = decoration?.serverProfile;
        // Known to have none (set on write): no lookup. Unset on older messages, which are looked up.
        const attachmentRows =
          message.hasAttachments === false
            ? []
            : await ctx.db
                .query("channelMessageAttachments")
                .withIndex("by_message", (q) => q.eq("messageId", message._id))
                .collect();
        const attachments = await Promise.all(
          attachmentRows.map(async (attachment) => {
            const anyAtt = attachment as unknown as { storageId?: string; cdnUrl?: string; cdnKey?: string };
            const directCdn = anyAtt.cdnUrl ?? (anyAtt.cdnKey ? r2UrlForKey(anyAtt.cdnKey) : null);
            // Only a CDN address the attachment actually has. It used to fall back to
            // `migrated/<storageId>` for any attachment with a Convex file, which
            // is a guess that a copy exists — and 404s for every one not yet
            // copied the moment the CDN is switched on.
            const cdnUrl = directCdn;
            return {
              id: attachment._id,
              fileName: attachment.fileName,
              fileType: effectiveFileType(attachment.fileType, attachment.fileName),
              fileSize: attachment.fileSize,
              url: cdnUrl ?? (anyAtt.storageId ? await ctx.storage.getUrl(anyAtt.storageId as never) : null),
            };
          })
        );
        return {
          id: message._id,
          text: message.text ?? null,
          /** End-to-end encrypted body (embeds and components included) and who
           * it pings, exactly as stored — see the twin in convex/messages.ts. */
          enc: message.enc ?? null,
          mentions: message.mentions ?? null,
          replyToId: message.replyToId ?? null,
          createdAt: message._creationTime,
          editedAt: message.editedAt ?? null,
          // A forwarded copy carries its author's name, but it isn't theirs to edit or delete here.
          isMine: message.authorId === me._id && !message.forwardedFrom,
          replyTo: await resolveReplyPreview(ctx, message.replyToId, floor),
          /** Idempotency key of the send that made this row — see the twin in
           * convex/messages.ts and src/lib/outbox-overlay.ts. */
          clientId: message.clientId ?? null,
          author: author
            ? {
                id: author._id,
                // Server profile overrides win here so a nickname/avatar set
                // for this community is what the channel actually shows.
                name: serverProfile?.displayName ?? author.name,
                username: author.username,
                imageUrl: serverProfile?.imageUrl ?? author.imageUrl,
                bio: serverProfile?.bio ?? author.bio,
                bannerUrl: serverProfile?.bannerUrl ?? author.bannerUrl,
                customStatus: serverProfile?.customStatus ?? unexpiredCustomStatus(author),
                // Not overridden per server: the frame is worn by the account.
                avatarDecoration: effectiveDecoration(author),
                isBirthday: isBirthdayNow(author),
                isBot: !!author.isBot,
                roleColor: decoration?.roleColor,
              }
            : null,
          attachments,
          embeds: message.embeds ?? [],
          components: message.components ?? [],
          /** Where a copy delivered by following an announcements channel came from. */
          forwardedFrom: message.forwardedFrom ?? null,
          noEmbeds: message.noEmbeds ?? false,
          reactions: await reactionsFor(ctx, message._id, me._id),
          /** Poll, voice message, sticker and text-to-speech flag — see lib/messageExtras.ts. */
          ...(await messageExtras(ctx, message)),
        };
      })
    );

    return { ...page, page: withoutHidden(hidden, messages) };
  },
});

/** Refuse the action if the member is currently timed out in this channel's
 * community. Checked server-side so hiding the composer is only a courtesy. */
async function requireNotTimedOut(
  ctx: QueryCtx,
  channelId: Id<"channels">,
  userId: Id<"users">
): Promise<void> {
  const channel = await ctx.db.get(channelId);
  if (!channel) return;
  const membership = await ctx.db
    .query("communityMembers")
    .withIndex("by_community_user", (q) =>
      q.eq("communityId", channel.communityId).eq("userId", userId)
    )
    .unique();
  if (membership?.timeoutUntil && membership.timeoutUntil > Date.now()) {
    throw new Error("You're timed out in this server.");
  }
}

/** What sending a message takes. Shared by the `send` mutation and the Bot API, so a bot's message
 * goes through exactly what a person's does: mentions, notifications, unread state, caches. */
const sendArgs = {
  channelId: v.id("channels"),
  text: v.optional(v.string()),
  attachments: v.optional(
    v.array(
      v.object({
        storageId: v.optional(v.id("_storage")),
        cdnKey: v.optional(v.string()),
        cdnUrl: v.optional(v.string()),
        fileName: v.string(),
        fileType: v.string(),
        fileSize: v.number(),
      })
    )
  ),
  /** The message being replied to. Dropped silently unless it's in this
   * channel. */
  replyToId: v.optional(v.id("channelMessages")),
  /** Whether the reply notifies its target — defaults to true, the "@"
   * toggle sends false. */
  pingReply: v.optional(v.boolean()),
  /** Idempotency key from the durable send outbox — see convex/messages.ts
   * and src/lib/outbox.ts. */
  clientId: v.optional(v.string()),
  /** The body, end-to-end encrypted, embeds and components inside (docs/E2EE.md). Replaces `text`;
   * the two are never stored together. `text` stays accepted until E2EE_ENFORCE=1. */
  enc: v.optional(encValidator),
  /** Who the message pings, in the clear — the server can't read `enc`. Only kept with `enc`. */
  mentions: v.optional(mentionsValidator),
  /** Read aloud to people with the channel open. Takes Send TTS; refused otherwise. */
  tts: v.optional(v.boolean()),
  /** The one audio attachment is a recording. Takes Send Voice Messages, not Attach Files. */
  voiceMessage: v.optional(v.object({ durationMs: v.number(), waveform: v.array(v.number()) })),
  /**
   * A poll on the message. Takes Create Polls. In an end-to-end encrypted channel the words travel
   * inside `enc` and only `optionCount` is sent here; otherwise `question` and `options` are.
   */
  poll: v.optional(
    v.object({
      question: v.optional(v.string()),
      options: v.optional(v.array(v.string())),
      optionCount: v.optional(v.number()),
      multi: v.optional(v.boolean()),
      durationMs: v.optional(v.number()),
    }),
  ),
  /** A community sticker as the message. One from another community takes Use External Stickers. */
  stickerId: v.optional(v.id("communityStickers")),
};
export type SendArgs = ObjectType<typeof sendArgs>;

/**
 * Post a message as `me`. The caller has already said who `me` is. Unless `permissionChecked`, this
 * checks they may send in the channel; a bot's caller has done its own check, which is stricter
 * (it also cuts the bot down to what the person who authorised it can still do).
 */
export async function sendChannelMessage(
  ctx: MutationCtx,
  me: Doc<"users">,
  { channelId, text, attachments, replyToId, pingReply, clientId, enc, mentions, tts, voiceMessage, poll, stickerId }: SendArgs,
  opts: {
    permissionChecked?: boolean;
    /** Already validated by `validateEmbeds`. Only the Bot API passes these. */
    embeds?: Embed[];
    /** Already validated by `validateComponents`. */
    components?: ActionRow[];
  } = {}
): Promise<Id<"channelMessages">> {
  const channelRow = await ctx.db.get(channelId);
  if (!channelRow) throw new Error("Channel not found.");
  const community = await requireCommunity(ctx, channelRow.communityId);
  // What the sender's own account holds here, a bot's included (its grant is checked by the Bot API
  // before it gets this far, and only ever narrows this).
  const perms = await getChannelPermissions(ctx, community, channelId, me._id);
  const deny = (what: string): never => {
    throw new Error(`You don't have permission to ${what} here.`);
  };
  if (!opts.permissionChecked) {
    if (!can(perms, PERMISSIONS.SEND_MESSAGES)) throw new Error("You don't have permission to do that.");
    // A voice message is its own permission, and doesn't need Attach Files.
    if (attachments?.length && !voiceMessage && !can(perms, PERMISSIONS.ATTACH_FILES)) throw new Error("You don't have permission to do that.");
  }
  // These are checked whoever is sending, the Bot API included.
  if (voiceMessage && !can(perms, PERMISSIONS.SEND_VOICE_MESSAGES)) deny("send voice messages");
  if (poll && !can(perms, PERMISSIONS.CREATE_POLLS)) deny("create polls");
  if (tts && !can(perms, PERMISSIONS.SEND_TTS)) deny("send text-to-speech messages");
  if (stickerId) {
    const sticker = await ctx.db.get(stickerId);
    if (!sticker) throw new Error("That sticker doesn't exist any more.");
    if (sticker.communityId !== channelRow.communityId) {
      // Another community's sticker is only usable by someone who is in that community, as well as
      // being allowed external stickers here — otherwise any id would do.
      const membership = await ctx.db
        .query("communityMembers")
        .withIndex("by_community_user", (q) => q.eq("communityId", sticker.communityId).eq("userId", me._id))
        .unique();
      if (!membership) throw new Error("You can only use stickers from communities you're in.");
      if (!can(perms, PERMISSIONS.USE_EXTERNAL_STICKERS)) throw new Error("You can't use stickers from other communities here.");
    }
  }
  // Staff can take sending away from an account; a bot's user is never limited, so this
  // only ever stops a person (including one a bot acts for, which re-reads the row).
  requireAbility(me, "send_messages");
  if (attachments?.length) requireAbility(me, "upload_media");
  await requireNotTimedOut(ctx, channelId, me._id);
  // An announcements channel is plaintext by design (followers hold no key to its room).
  let plaintextRoom = false;
  {
    const channel = await ctx.db.get(channelId);
    if (channel) await requireCommunityOpen(ctx, channel.communityId, "post");
    plaintextRoom = channel?.isAnnouncement === true;
  }
  if (plaintextRoom && enc) throw new Error("Announcements are public, so they aren't end-to-end encrypted.");
  // Embeds and components live inside `enc` for an encrypted message, so they count as plaintext
  // here: a person and the Bot API are held to the same rule.
  assertPlaintextAllowed({
    author: me,
    hasEnc: !!enc,
    // A plaintext poll's question and options are as readable to the server as text is.
    hasPlaintext: !!text?.trim() || !!opts.embeds?.length || !!opts.components?.length || (!!poll && !enc),
    plaintextRoom,
  });

  if (clientId) {
    const existing = await ctx.db
      .query("channelMessages")
      .withIndex("by_client_id", (q) => q.eq("clientId", clientId))
      .unique();
    if (existing) return existing._id;
  }

  const trimmed = text?.trim();
  // An encrypted body can't be checked for emptiness here; the sender's client does.
  if (!enc && !trimmed && (!attachments || attachments.length === 0) && !opts.embeds?.length && !opts.components?.length && !poll && !stickerId) {
    throw new Error("Message needs text, an attachment, an embed or buttons.");
  }
  if (tts && !enc && !trimmed) throw new Error("There's nothing to read aloud.");
  // A sticker, a poll and a recording are each a message of their own kind.
  if ((stickerId ? 1 : 0) + (poll ? 1 : 0) + (voiceMessage ? 1 : 0) > 1) throw new Error("A message can be a sticker, a poll or a voice message, not a mix.");
  if (stickerId && (trimmed || enc || attachments?.length || tts)) throw new Error("A sticker is sent on its own.");
  if (poll && attachments?.length) throw new Error("A poll can't carry attachments.");
  if (voiceMessage && (tts || trimmed)) throw new Error("A voice message can't carry text.");
  const cleanPollDoc = poll ? cleanPoll(poll, Date.now(), !!enc) : undefined;
  const cleanVoice = voiceMessage ? cleanVoiceMessage(voiceMessage, attachments ?? [], { hasText: !!trimmed || !!enc }) : undefined;
  if (enc) await validateEnvelope(ctx, enc, { scope: "channel", channelId }, "send");
  const cleanMentions = enc
    ? await validateMentions(
        ctx,
        mentions ?? { users: [], roles: [], everyone: false, here: false },
        { scope: "channel", channelId },
        me._id
      )
    : undefined;

  for (const attachment of attachments ?? []) {
    if (attachment.storageId) {
      await requireWithinUploadLimit(ctx, attachment.storageId, MAX_ATTACHMENT_BYTES, "Attachments");
    } else if (!attachment.cdnKey && !attachment.cdnUrl) {
      throw new Error("Attachment missing storageId/cdnKey");
    }
    // An address with nothing uploaded behind it is only ever a KLIPY GIF, clip or sticker.
    if (!isAcceptableAttachmentSource(attachment)) throw new Error("That attachment isn't from somewhere Crystal can show.");
  }

  const replyTarget = replyToId ? await ctx.db.get(replyToId) : null;
  const validReplyToId =
    replyTarget && replyTarget.channelId === channelId ? replyToId : undefined;
  const replyPingUserId =
    validReplyToId && pingReply !== false && replyTarget && replyTarget.authorId !== me._id
      ? replyTarget.authorId
      : null;

  // Links only unfurl for someone who may embed them. Recorded on the row because the list can't
  // derive it later, once the sender's roles have changed.
  const noEmbeds = !can(perms, PERMISSIONS.EMBED_LINKS);

  // Last, so a send refused for any other reason doesn't use up the sender's turn.
  await enforceSlowmode(ctx, channelRow, me._id, "message", perms);

  const messageId = await ctx.db.insert("channelMessages", {
    channelId,
    authorId: me._id,
    hasAttachments: (attachments?.length ?? 0) > 0,
    ...(noEmbeds ? { noEmbeds: true } : {}),
    ...(tts ? { tts: true } : {}),
    ...(cleanVoice ? { voiceMessage: cleanVoice } : {}),
    ...(cleanPollDoc ? { poll: cleanPollDoc } : {}),
    ...(stickerId ? { stickerId } : {}),
    // Never both: an encrypted row has no `text`, `embeds` or `components`.
    text: enc ? undefined : trimmed || undefined,
    replyToId: validReplyToId,
    clientId: clientId || undefined,
    ...(enc ? { enc, mentions: cleanMentions } : {}),
    ...(!enc && opts.embeds?.length ? { embeds: opts.embeds } : {}),
    ...(!enc && opts.components?.length ? { components: opts.components } : {}),
  });

  for (const attachment of attachments ?? []) {
    await ctx.db.insert("channelMessageAttachments", { messageId, ...attachment, fileType: effectiveFileType(attachment.fileType, attachment.fileName) });
  }

  const channel = await ctx.db.get(channelId);
  // Denormalised so unread state is a field comparison rather than a
  // "newest message" query per channel — see the schema.
  if (channel) await ctx.db.patch(channelId, { lastMessageAt: Date.now() });
  if (channel && !me.isBot) await recordMessageSent(ctx, channel.communityId, me._id);
  // Having just written it, I've read it.
  if (channel) await markChannelRead(ctx, channelId, channel.communityId, me._id);

  // Who the message pings. An encrypted message is routed from its metadata, since the text isn't the
  // server's to parse; only a legacy plaintext row is parsed.
  const mentioned: Id<"users">[] = !channel
    ? []
    : enc
      ? await resolveChannelMentions(
          ctx,
          channel.communityId,
          cleanMentions ?? { users: [], roles: [], everyone: false, here: false },
          me._id
        )
      : trimmed
        ? await resolveChannelMentions(ctx, channel.communityId, trimmed, me._id)
        : [];

  if (channel && (trimmed || enc || cleanPollDoc)) {
    // Rendered once and shared by both notifications below — it's a plain
    // text body, so the `<@id>` tags have to become readable names here;
    // nothing downstream of this renders them. Never for an encrypted message:
    // its notifications say only that something arrived (`notifyUsers` enforces
    // the same once E2EE_ENFORCE=1).
    const bodyText = enc ? undefined : trimmed ? await renderMentionsAsText(ctx, trimmed) : `Poll: ${cleanPollDoc?.question ?? ""}`;

    if (mentioned.length > 0) {
      await notifyUsers(ctx, {
        userIds: mentioned,
        actorId: me._id,
        type: "channel_mention",
        channelId,
        communityId: channel.communityId,
        channelMessageId: messageId,
        title: `${me.name} mentioned you in #${channel.name}`,
        body: bodyText,
        isMention: true,
        encrypted: !!enc,
      });
    }

    // Everyone else in the channel.
    //
    // Only reaches people whose per-server setting is "all messages":
    // `notifyUsers` asks `allowsChannelMessage(policy, communityId, false)`
    // for each of them, so the default ("mentions only") is untouched and
    // nobody starts getting notified without having asked to be.
    //
    // Membership alone can't decide who this is. A private channel is
    // private because of permission overwrites, so notifying past them
    // would leak both the message and the channel's existence.
    const community = await ctx.db.get(channel.communityId);
    if (community) {
      const mentionedSet = new Set<string>(mentioned);
      const members = await ctx.db
        .query("communityMembers")
        .withIndex("by_community", (q) => q.eq("communityId", channel.communityId))
        .collect();

      const others: Id<"users">[] = [];
      for (const member of members) {
        if (member.userId === me._id || mentionedSet.has(member.userId)) continue;
        // The reply target gets the `reply` notification below instead.
        if (member.userId === replyPingUserId) continue;
        const perms = await getChannelPermissions(ctx, community, channelId, member.userId);
        if (!can(perms, PERMISSIONS.VIEW_CHANNELS)) continue;
        others.push(member.userId);
      }

      if (others.length > 0) {
        await notifyUsers(ctx, {
          userIds: others,
          actorId: me._id,
          type: "channel_mention",
          channelId,
          communityId: channel.communityId,
          channelMessageId: messageId,
          title: `${me.name} in #${channel.name}`,
          body: bodyText,
          isMention: false,
          encrypted: !!enc,
        });
      }
    }
  }

  // The reply ping — even for an attachment-only reply, and regardless of
  // the target's per-server "all messages" setting (a direct reply is
  // addressed to them). Skipped when they were also @-mentioned: that
  // notification is the more specific one.
  if (channel && replyPingUserId) {
    const mentionedReplyTarget = mentioned.includes(replyPingUserId);
    if (!mentionedReplyTarget) {
      await notifyUsers(ctx, {
        userIds: [replyPingUserId],
        actorId: me._id,
        type: "reply",
        channelId,
        communityId: channel.communityId,
        channelMessageId: messageId,
        title: `${me.name} replied to you in #${channel.name}`,
        body: enc ? undefined : trimmed ? await renderMentionsAsText(ctx, trimmed) : cleanPollDoc ? "Created a poll" : stickerId ? "Sent a sticker" : cleanVoice ? "Sent a voice message" : "Sent an attachment",
        encrypted: !!enc,
      });
    }
  }

  try {
    const { cacheInvalidateKeys } = await import("./cache");
    await cacheInvalidateKeys(...channelPageKeys(channelId), `channel:${channelId}:meta`);
  } catch {}
  try {
    const { internal } = await import("./_generated/api");
    await ctx.scheduler.runAfter(0, internal.cache.invalidateChannelCache, { channelId });
  } catch {}

  // Bots in this community that can see the channel are told. Never allowed to get in the way.
  if (channel) await dispatchMessageCreated(ctx, channel, messageId, me);

  // Followers of an announcements channel get it delivered after this commits — their copies are
  // theirs to fail or be slow without holding up the post.
  if (channel?.isAnnouncement && !enc) {
    await ctx.scheduler.runAfter(0, internal.announcements.deliverToFollowers, { messageId });
  }

  return messageId;
}

export const send = mutation({
  args: sendArgs,
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    return sendChannelMessage(ctx, me, args);
  },
});

/** Rewrite a message's text and/or cards, or replace its encrypted body. Shared by a person's edit
 * and a bot's. */
export async function editChannelMessage(
  ctx: MutationCtx,
  message: Doc<"channelMessages">,
  change: {
    text?: string;
    embeds?: Embed[];
    components?: ActionRow[];
    /** The new body, encrypted (embeds and components inside). Under any epoch of this channel. */
    enc?: Doc<"channelMessages">["enc"];
    mentions?: Doc<"channelMessages">["mentions"];
  },
): Promise<void> {
  const hasPlaintext = change.text !== undefined || change.embeds !== undefined || change.components !== undefined;
  const author = await ctx.db.get(message.authorId);
  const sourceChannel = await ctx.db.get(message.channelId);
  const plaintextRoom = sourceChannel?.isAnnouncement === true;
  if (plaintextRoom && change.enc) throw new Error("Announcements are public, so they aren't end-to-end encrypted.");
  // Whether the *edit* may carry plaintext. A text edit that only clears (empty string) still is one.
  if (author) assertPlaintextAllowed({ author, hasEnc: !!change.enc, hasPlaintext, plaintextRoom });

  if (change.enc) {
    const room = { scope: "channel", channelId: message.channelId } as const;
    await validateEnvelope(ctx, change.enc, room, "edit");
    // Same ciphertext again: an outbox retry converges instead of bumping `editedAt`.
    if (sameEnvelope(message.enc, change.enc)) return;
    const cleanMentions = await validateMentions(
      ctx,
      change.mentions ?? { users: [], roles: [], everyone: false, here: false },
      room,
      message.authorId
    );
    // The plaintext fields are cleared so a legacy row that is edited moves wholly to ciphertext.
    await ctx.db.patch(message._id, {
      enc: change.enc,
      mentions: cleanMentions,
      text: undefined,
      embeds: undefined,
      components: undefined,
      editedAt: Date.now(),
    });
    const channel = await ctx.db.get(message.channelId);
    const fresh = await ctx.db.get(message._id);
    if (channel && fresh) await fireCommunityEvent(ctx, channel.communityId, "message.updated", { channelId: channel._id, message: await describeMessage(ctx, fresh) }, { scope: "messages.read", channelId: channel._id, exceptUserId: message.authorId });
    return;
  }
  // Writing plaintext over ciphertext would quietly undo the encryption and leave both on the row.
  if (message.enc && hasPlaintext) throw new Error("This message is end-to-end encrypted. Edit it with an encrypted body.");

  const patch: Partial<Doc<"channelMessages">> = {};
  if (change.text !== undefined) {
    const t = change.text.trim();
    if (!t && !(change.embeds ?? message.embeds)?.length && !(change.components ?? message.components)?.length) throw new Error("Message can't be empty.");
    patch.text = t || undefined;
  }
  if (change.embeds !== undefined) patch.embeds = change.embeds.length ? change.embeds : undefined;
  if (change.components !== undefined) patch.components = change.components.length ? change.components : undefined;
  // Converge rather than re-stamp `editedAt` when an outbox retry replays the same edit.
  const same = Object.entries(patch).every(([k, v]) => JSON.stringify((message as Record<string, unknown>)[k]) === JSON.stringify(v));
  if (same) return;
  await ctx.db.patch(message._id, { ...patch, editedAt: Date.now() });
  const channel = await ctx.db.get(message.channelId);
  const fresh = await ctx.db.get(message._id);
  if (channel && fresh) await fireCommunityEvent(ctx, channel.communityId, "message.updated", { channelId: channel._id, message: await describeMessage(ctx, fresh) }, { scope: "messages.read", channelId: channel._id, exceptUserId: message.authorId });
}

export const update = mutation({
  args: {
    messageId: v.id("channelMessages"),
    /** Legacy plaintext edit. Refused once E2EE_ENFORCE=1, and on a row that is already encrypted. */
    text: v.optional(v.string()),
    enc: v.optional(encValidator),
    mentions: v.optional(mentionsValidator),
  },
  handler: async (ctx, { messageId, text, enc, mentions }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const message = await ctx.db.get(messageId);
    if (!message) return;
    if (message.authorId !== me._id) throw new Error("You can only edit your own messages.");
    // A copy delivered by following an announcements channel carries its author's name but isn't theirs to change here.
    if (message.forwardedFrom) throw new Error("A forwarded announcement can't be edited.");
    // A poll's words, a recording and a sticker aren't text; an edit would only ever damage them.
    if (message.poll || message.voiceMessage || message.stickerId) throw new Error("This kind of message can't be edited.");
    // Whether its links unfurl follows what the author may do now, so an edit can't smuggle a link
    // past an Embed Links they have lost since sending (the text may be encrypted: it can't be told).
    const embeds = await channelPermitted(ctx, message.channelId, me._id, PERMISSIONS.EMBED_LINKS);
    if (!embeds !== (message.noEmbeds ?? false)) await ctx.db.patch(message._id, { noEmbeds: embeds ? undefined : true });
    if (enc) {
      await editChannelMessage(ctx, message, { enc, mentions });
      return;
    }
    if (text === undefined || !text.trim()) throw new Error("Message can't be empty.");
    await editChannelMessage(ctx, message, { text });
  },
});

/** Delete a message and what hangs off it. Shared by a person's delete, a bot's, and bulk delete. */
export async function deleteChannelMessage(ctx: MutationCtx, message: Doc<"channelMessages">, by?: Id<"users">): Promise<void> {
  const [attachments, reactions] = await Promise.all([
    ctx.db.query("channelMessageAttachments").withIndex("by_message", (q) => q.eq("messageId", message._id)).collect(),
    ctx.db.query("channelMessageReactions").withIndex("by_message", (q) => q.eq("messageId", message._id)).collect(),
  ]);
  for (const attachment of attachments) {
    await ctx.db.delete(attachment._id);
    await releaseFile(ctx, attachment);
  }
  for (const reaction of reactions) await ctx.db.delete(reaction._id);
  await dropPollVotes(ctx, message._id);
  await ctx.db.delete(message._id);
  const channel = await ctx.db.get(message.channelId);
  if (channel) await fireCommunityEvent(ctx, channel.communityId, "message.deleted", { channelId: channel._id, messageId: message._id }, { scope: "messages.read", channelId: channel._id, exceptUserId: by });
}

export const remove = mutation({
  args: { messageId: v.id("channelMessages") },
  handler: async (ctx, { messageId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const message = await ctx.db.get(messageId);
    if (!message) return;

    const byModerator = message.authorId !== me._id;
    if (byModerator) {
      await requireChannelPerm(ctx, message.channelId, me._id, PERMISSIONS.MANAGE_MESSAGES);
    }
    await deleteChannelMessage(ctx, message, me._id);
    if (byModerator) {
      // Who wrote it and where — never what it said.
      const [channel, author] = await Promise.all([ctx.db.get(message.channelId), ctx.db.get(message.authorId)]);
      if (channel) await logCommunityAudit(ctx, { communityId: channel.communityId, actorId: me._id, action: "message.delete", target: { type: "user", id: message.authorId, name: author?.name }, details: `In #${channel.name}` });
    }
  },
});

/** Put a reaction in (or take it out) for `userId`. Shared by a person and a bot. Returns whether anything changed. */
export async function setChannelReaction(ctx: MutationCtx, message: Doc<"channelMessages">, userId: Id<"users">, emoji: string, desired?: "add" | "remove"): Promise<boolean> {
  const existing = await ctx.db
    .query("channelMessageReactions")
    .withIndex("by_message_user_emoji", (q) => q.eq("messageId", message._id).eq("userId", userId).eq("emoji", emoji))
    .unique();
  const shouldExist = desired ? desired === "add" : !existing;
  let changed = false;
  if (existing && !shouldExist) {
    await ctx.db.delete(existing._id);
    changed = true;
  } else if (!existing && shouldExist) {
    await ctx.db.insert("channelMessageReactions", { messageId: message._id, userId, emoji });
    changed = true;
  }
  if (changed) {
    const channel = await ctx.db.get(message.channelId);
    const user = await ctx.db.get(userId);
    if (channel && user) await fireCommunityEvent(ctx, channel.communityId, shouldExist ? "reaction.added" : "reaction.removed", { channelId: channel._id, messageId: message._id, emoji, user: { id: user._id, username: user.username, name: user.name, isBot: !!user.isBot } }, { scope: "messages.read", channelId: channel._id, exceptUserId: userId });
  }
  return changed;
}

/**
 * What adding a reaction takes, for a person and for a bot alike: another community's emoji needs
 * Use External Emojis, and an emoji nobody has put on the message yet needs Add Reactions.
 * Reacting with one already there (joining in) is always allowed, as is taking your own away.
 */
export async function requireMayReact(ctx: QueryCtx, message: Doc<"channelMessages">, userId: Id<"users">, emoji: string): Promise<void> {
  await requireOwnCommunityEmoji(ctx, message.channelId, userId, emoji);
  const used = await ctx.db
    .query("channelMessageReactions")
    .withIndex("by_message", (q) => q.eq("messageId", message._id))
    .collect();
  if (!used.some((r) => r.emoji === emoji)) {
    await requireChannelPerm(ctx, message.channelId, userId, PERMISSIONS.ADD_REACTIONS);
  }
}

export const toggleReaction = mutation({
  args: {
    messageId: v.id("channelMessages"),
    emoji: v.string(),
    /** Converge to this end state instead of flipping — see the twin in
     * convex/messages.ts. */
    desired: v.optional(v.union(v.literal("add"), v.literal("remove"))),
  },
  handler: async (ctx, { messageId, emoji, desired }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const message = await ctx.db.get(messageId);
    if (!message) throw new Error("Message not found.");
    await requireChannelPerm(ctx, message.channelId, me._id, PERMISSIONS.VIEW_CHANNELS);
    // Nor can a message be reacted to that the member can't read.
    if (!withinHistory(await channelHistoryFloor(ctx, message.channelId, me._id), message._creationTime)) throw new Error("Message not found.");
    // Reacting with something already on the message is always allowed; a reaction nobody has
    // used yet is a new one, and takes Add Reactions. Taking your own away never does.
    if (desired !== "remove") await requireMayReact(ctx, message, me._id, emoji);
    await setChannelReaction(ctx, message, me._id, emoji, desired);
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await getCurrentUserOrThrow(ctx, "upload_media");
    return ctx.storage.generateUploadUrl();
  },
});

// --- Pinned messages (mobile "Pinned" tab) ----------------------------------

export const pin = mutation({
  args: { messageId: v.id("channelMessages") },
  handler: async (ctx, { messageId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const message = await ctx.db.get(messageId);
    if (!message) throw new Error("Message not found.");
    await requirePinPerm(ctx, message.channelId, me._id);
    await ctx.db.patch(messageId, { pinnedAt: Date.now() });
  },
});

export const unpin = mutation({
  args: { messageId: v.id("channelMessages") },
  handler: async (ctx, { messageId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const message = await ctx.db.get(messageId);
    if (!message) throw new Error("Message not found.");
    await requirePinPerm(ctx, message.channelId, me._id);
    await ctx.db.patch(messageId, { pinnedAt: undefined });
  },
});

export const listPinned = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireChannelPerm(ctx, channelId, me._id, PERMISSIONS.VIEW_CHANNELS);
    // Pins from before a member's history starts are as unreadable as the rest of it.
    const floor = await channelHistoryFloor(ctx, channelId, me._id);

    const pinned = await ctx.db
      .query("channelMessages")
      .withIndex("by_channel_pinned", (q) => q.eq("channelId", channelId).gt("pinnedAt", 0))
      .order("desc")
      .collect();
    const hidden = await windowsByTarget(ctx, me._id);
    const visible = pinned.filter((m) => withinHistory(floor, m._creationTime) && !isMessageHidden(hidden, m.authorId, m._creationTime));

    return Promise.all(
      visible.map(async (message) => {
        const author = await ctx.db.get(message.authorId);
        return {
          id: message._id,
          text: message.text ?? null,
          enc: message.enc ?? null,
          mentions: message.mentions ?? null,
          replyToId: message.replyToId ?? null,
          createdAt: message._creationTime,
          pinnedAt: message.pinnedAt ?? null,
          author: author
            ? { id: author._id, name: author.name, username: author.username, imageUrl: author.imageUrl }
            : null,
        };
      })
    );
  },
});

// --- Attachments (mobile "Files" tab) ---------------------------------------

/** Same "flatten this page's attachments" approach as `messages.listAttachments`
 * — a page can surface zero attachments if that batch of messages happened
 * to be text-only, so the client should keep requesting more until `isDone`. */
export const listAttachments = query({
  args: { channelId: v.id("channels"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { channelId, paginationOpts }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireChannelPerm(ctx, channelId, me._id, PERMISSIONS.VIEW_CHANNELS);
    const floor = await channelHistoryFloor(ctx, channelId, me._id);
    if (floor.restricted && floor.after === Number.POSITIVE_INFINITY) return EMPTY_PAGE;

    const page = await ctx.db
      .query("channelMessages")
      .withIndex("by_channel", (q) => (floor.restricted ? q.eq("channelId", channelId).gt("_creationTime", floor.after) : q.eq("channelId", channelId)))
      .order("desc")
      .paginate(paginationOpts);

    const hidden = await windowsByTarget(ctx, me._id);
    const perMessage = await Promise.all(
      page.page
        .filter((m) => !isMessageHidden(hidden, m.authorId, m._creationTime))
        .map(async (message) => {
        const rows = await ctx.db
          .query("channelMessageAttachments")
          .withIndex("by_message", (q) => q.eq("messageId", message._id))
          .collect();
        return Promise.all(
          rows.map(async (attachment) => {
            const anyAtt = attachment as unknown as { storageId?: string; cdnUrl?: string; cdnKey?: string };
            const directCdn = anyAtt.cdnUrl ?? (anyAtt.cdnKey ? r2UrlForKey(anyAtt.cdnKey) : null);
            // Only a CDN address the attachment actually has. It used to fall back to
            // `migrated/<storageId>` for any attachment with a Convex file, which
            // is a guess that a copy exists — and 404s for every one not yet
            // copied the moment the CDN is switched on.
            const cdnUrl = directCdn;
            return {
              id: attachment._id,
              messageId: message._id,
              fileName: attachment.fileName,
              fileType: effectiveFileType(attachment.fileType, attachment.fileName),
              fileSize: attachment.fileSize,
              url: cdnUrl ?? (anyAtt.storageId ? await ctx.storage.getUrl(anyAtt.storageId as never) : null),
              createdAt: message._creationTime,
            };
          })
        );
      }),
    );

    return { ...page, page: perMessage.flat() };
  },
});
