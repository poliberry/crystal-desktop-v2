import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/** A Rich Presence activity — the subset of Discord's activity shape the
 * client actually renders (see src/components/rich-presence-card.tsx).
 * `type` mirrors Discord's activity types, and decides both the card's verb
 * ("Playing" / "Listening to" / …) and the small icon shown next to the
 * user's status. */
const activityValidator = v.object({
  type: v.union(
    v.literal("playing"),
    v.literal("listening"),
    v.literal("watching"),
    v.literal("streaming")
  ),
  /** Game/app name, or the music app ("Spotify", "Apple Music"). */
  name: v.string(),
  /** First detail line — the track title, for music. */
  details: v.optional(v.string()),
  /** Second detail line — the artist/album, for music. */
  state: v.optional(v.string()),
  /** Large image (box art / album art) when one is known. */
  imageUrl: v.optional(v.string()),
  /** Epoch ms the activity started, for the elapsed-time counter. */
  startedAt: v.optional(v.number()),
  /** Album name, for music. */
  album: v.optional(v.string()),
  /** Track length in ms, when the player reports one. */
  durationMs: v.optional(v.number()),
  /** Playback position in ms, accurate as of `positionUpdatedAt`. */
  positionMs: v.optional(v.number()),
  /** Server clock reading when `positionMs` was recorded. Stamped by
   * `presence.setActivity` rather than sent by the client, so viewers
   * interpolate the seek bar against one authoritative clock instead of the
   * broadcaster's — which may be minutes off. */
  positionUpdatedAt: v.optional(v.number()),
  /** Where this came from: "detectable" (process scan), "ipc" (a game
   * connected to our Discord-compatible RPC socket), or "music". */
  source: v.optional(v.string()),
});

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    name: v.string(),
    username: v.string(),
    imageUrl: v.optional(v.string()),
    bio: v.optional(v.string()),
    avatarStorageId: v.optional(v.id("_storage")),
    /** Dominant colour of the avatar, sampled on the client (see
     * src/lib/avatar-color.ts) and cached here so a call tile can paint it on
     * its first frame instead of flashing while it re-samples the image.
     * Stored with the URL it was derived from, so a new avatar invalidates it
     * rather than tinting the tile with the old one. */
    avatarAccent: v.optional(v.string()),
    avatarAccentUrl: v.optional(v.string()),
    /** The picture as uploaded, before cropping. `imageUrl` is the cropped
     * render that everything actually displays; this is kept only so the crop
     * can be adjusted later without asking for the file again, and without
     * re-cropping an already-cropped image. */
    avatarOriginalUrl: v.optional(v.string()),
    avatarOriginalStorageId: v.optional(v.id("_storage")),
    // Profile cosmetics
    bannerUrl: v.optional(v.string()),
    bannerStorageId: v.optional(v.id("_storage")),
    bannerOriginalUrl: v.optional(v.string()),
    bannerOriginalStorageId: v.optional(v.id("_storage")),
    borderGradientStart: v.optional(v.string()),
    borderGradientEnd: v.optional(v.string()),
    profileBg: v.optional(v.string()),
    customStatus: v.optional(v.string()),
    nameplateUrl: v.optional(v.string()),
    nameplateStorageId: v.optional(v.id("_storage")),
    /** Clip played to everyone else when this user joins a call. Either a
     * `builtin:<name>` id or a `communitySounds` document id — see
     * src/lib/soundboard.ts. A per-server override lives on
     * `serverProfiles.joinSoundId`. */
    joinSoundId: v.optional(v.string()),
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_username", ["username"]),

  friendships: defineTable({
    ownerId: v.id("users"),
    friendId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_friend", ["ownerId", "friendId"]),

  friendRequests: defineTable({
    requesterId: v.id("users"),
    recipientId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_recipient", ["recipientId"])
    .index("by_requester", ["requesterId"])
    .index("by_pair", ["requesterId", "recipientId"]),

  presence: defineTable({
    userId: v.id("users"),
    manualStatus: v.union(
      v.literal("online"),
      v.literal("idle"),
      v.literal("dnd"),
      v.literal("invisible")
    ),
    isIdle: v.boolean(),
    lastHeartbeat: v.number(),
    effective: v.union(
      v.literal("online"),
      v.literal("dnd"),
      v.literal("idle"),
      v.literal("offline")
    ),
    /** Rich Presence, richest first — a user can be playing something and
     * listening to something at once (see electron/richPresence.ts). Empty or
     * undefined when nothing is detected. */
    activities: v.optional(v.array(activityValidator)),
    /** @deprecated Superseded by `activities`. Kept so presence rows written
     * before the list existed still validate; read via `activitiesOf`. */
    activity: v.optional(activityValidator),
  })
    .index("by_user", ["userId"])
    .index("by_last_heartbeat", ["lastHeartbeat"]),

  /**
   * Play history, one row per (user, game) rather than per session — the
   * profile's "Recent activity" list only needs "what, when last, how long in
   * total", and collapsing it this way keeps the table bounded no matter how
   * often someone alt-tabs.
   *
   * Games only. Music and other activity types are deliberately not recorded:
   * a track-by-track history is a different feature with very different
   * privacy weight, and the live `presence.activities` already covers
   * "what are they listening to right now".
   */
  gameHistory: defineTable({
    userId: v.id("users"),
    /** Lowercased game name — stable across the detectable and IPC sources,
     * which can report the same title with different casing. */
    gameKey: v.string(),
    name: v.string(),
    imageUrl: v.optional(v.string()),
    /** Start of the session currently being timed, if one is running. */
    startedAt: v.optional(v.number()),
    /** Epoch ms the game was last seen running. */
    lastPlayedAt: v.number(),
    /** Total play time across every recorded session, in ms. */
    totalMs: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_game", ["userId", "gameKey"])
    .index("by_user_last_played", ["userId", "lastPlayedAt"]),

  conversations: defineTable({
    type: v.union(v.literal("dm"), v.literal("group")),
    name: v.optional(v.string()),
    dmKey: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    /** Custom group icon (group conversations only) — falls back to the
     * first two members' avatars overlapping when unset. */
    imageUrl: v.optional(v.string()),
    iconStorageId: v.optional(v.id("_storage")),
  }).index("by_dm_key", ["dmKey"]),

  conversationMembers: defineTable({
    conversationId: v.id("conversations"),
    userId: v.id("users"),
    joinedAt: v.number(),
    lastReadAt: v.number(),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_user", ["userId"])
    .index("by_conversation_user", ["conversationId", "userId"]),

  messages: defineTable({
    conversationId: v.id("conversations"),
    authorId: v.id("users"),
    text: v.optional(v.string()),
    editedAt: v.optional(v.number()),
    pinnedAt: v.optional(v.number()),
  }).index("by_conversation", ["conversationId"]),

  messageAttachments: defineTable({
    messageId: v.id("messages"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    fileType: v.string(),
    fileSize: v.number(),
  }).index("by_message", ["messageId"]),

  messageReactions: defineTable({
    messageId: v.id("messages"),
    userId: v.id("users"),
    emoji: v.string(),
  })
    .index("by_message", ["messageId"])
    .index("by_message_user_emoji", ["messageId", "userId", "emoji"]),

  callParticipants: defineTable({
    conversationId: v.id("conversations"),
    userId: v.id("users"),
    joinedAt: v.number(),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_conversation_user", ["conversationId", "userId"]),

  /**
   * An in-flight "someone is calling you" for a DM or group conversation.
   *
   * One row per recipient rather than one per call, so each person's ring can
   * be answered, declined or expired independently. Rows are deleted the
   * moment they're resolved — a row existing *is* the ringing state, which
   * keeps the recipient's query trivial.
   */
  callRings: defineTable({
    conversationId: v.id("conversations"),
    callerId: v.id("users"),
    recipientId: v.id("users"),
    createdAt: v.number(),
    /** Scheduled sweep that turns an unanswered ring into a missed call. */
    expiryJobId: v.optional(v.id("_scheduled_functions")),
  })
    .index("by_recipient", ["recipientId"])
    .index("by_conversation", ["conversationId"])
    .index("by_conversation_recipient", ["conversationId", "recipientId"]),

  linkPreviews: defineTable({
    url: v.string(),
    status: v.union(v.literal("ok"), v.literal("error")),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    image: v.optional(v.string()),
    siteName: v.optional(v.string()),
    /** Recognised provider key ("youtube", "spotify", …) — see
     * convex/lib/richEmbeds.ts. Absent for the ordinary scraped link that
     * just gets a generic card. */
    provider: v.optional(v.string()),
    /** What the card should offer: a plain link, or something playable. */
    kind: v.optional(v.union(v.literal("link"), v.literal("video"), v.literal("audio"))),
    /** Who made it — the uploader, artist or author, where a provider says. */
    authorName: v.optional(v.string()),
    authorUrl: v.optional(v.string()),
    /** In-place player. Always built from a parsed resource id rather than
     * copied out of a provider's oEmbed HTML, and framed by the client only
     * if its host is on the client's allow-list. */
    embedUrl: v.optional(v.string()),
    /** Player aspect ratio (width ÷ height), for video. */
    embedAspect: v.optional(v.number()),
    /** Fixed player height in pixels, for audio. */
    embedHeight: v.optional(v.number()),
    /** The site's own accent colour, used for the card's edge. */
    themeColor: v.optional(v.string()),
    faviconUrl: v.optional(v.string()),
    fetchedAt: v.number(),
  }).index("by_url", ["url"]),

  // --- Communities ---------------------------------------------------------

  communities: defineTable({
    name: v.string(),
    ownerId: v.id("users"),
    imageUrl: v.optional(v.string()),
    iconStorageId: v.optional(v.id("_storage")),
    createdAt: v.number(),
    inviteCode: v.optional(v.string()),
    bannerUrl: v.optional(v.string()),
    bannerStorageId: v.optional(v.id("_storage")),
  })
    .index("by_owner", ["ownerId"])
    .index("by_invite_code", ["inviteCode"]),

  communityMembers: defineTable({
    communityId: v.id("communities"),
    userId: v.id("users"),
    joinedAt: v.number(),
    /** Epoch ms a timeout expires. While in the future the member stays in
     * the server but can't send messages or join voice. */
    timeoutUntil: v.optional(v.number()),
  })
    .index("by_community", ["communityId"])
    .index("by_user", ["userId"])
    .index("by_community_user", ["communityId", "userId"]),

  /** Bans are kept after the membership row is deleted, so a banned user
   * can't simply rejoin with a fresh invite. */
  communityBans: defineTable({
    communityId: v.id("communities"),
    userId: v.id("users"),
    bannedBy: v.id("users"),
    reason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_community", ["communityId"])
    .index("by_community_user", ["communityId", "userId"]),

  /** A role's `permissions` is a bitfield — see convex/permissions.ts. Every
   * community gets one `isEveryone` role at creation (the permission floor
   * every member has); it can't be renamed or deleted. */
  roles: defineTable({
    communityId: v.id("communities"),
    name: v.string(),
    color: v.optional(v.string()),
    permissions: v.number(),
    position: v.number(),
    isEveryone: v.boolean(),
    /** "Display members with this role separately from online members" —
     * mirrors Discord's per-role hoist toggle. Used to group the member
     * list (src/components/community/member-list.tsx). */
    hoist: v.optional(v.boolean()),
  })
    .index("by_community", ["communityId"])
    .index("by_community_position", ["communityId", "position"]),

  memberRoles: defineTable({
    communityId: v.id("communities"),
    userId: v.id("users"),
    roleId: v.id("roles"),
  })
    .index("by_member", ["communityId", "userId"])
    .index("by_role", ["roleId"]),

  /** A community's channels can be grouped under collapsible categories
   * (or left uncategorized — `channels.categoryId` unset). `position`
   * orders categories relative to each other, same convention as
   * `channels.position` ordering channels within one. */
  channelCategories: defineTable({
    communityId: v.id("communities"),
    name: v.string(),
    position: v.number(),
  })
    .index("by_community", ["communityId"])
    .index("by_community_position", ["communityId", "position"]),

  channels: defineTable({
    communityId: v.id("communities"),
    name: v.string(),
    type: v.union(v.literal("text"), v.literal("voice")),
    topic: v.optional(v.string()),
    categoryId: v.optional(v.id("channelCategories")),
    position: v.number(),
    createdAt: v.number(),
  })
    .index("by_community", ["communityId"])
    .index("by_community_position", ["communityId", "position"]),

  /** Per-channel allow/deny overwrite for a role OR a specific member
   * (exactly one of `roleId`/`userId` is set) — see
   * `computeChannelPermissions` in convex/permissions.ts for precedence. */
  channelPermissionOverwrites: defineTable({
    channelId: v.id("channels"),
    roleId: v.optional(v.id("roles")),
    userId: v.optional(v.id("users")),
    allow: v.number(),
    deny: v.number(),
  }).index("by_channel", ["channelId"]),

  channelMessages: defineTable({
    channelId: v.id("channels"),
    authorId: v.id("users"),
    text: v.optional(v.string()),
    editedAt: v.optional(v.number()),
    pinnedAt: v.optional(v.number()),
  }).index("by_channel", ["channelId"]),

  channelMessageAttachments: defineTable({
    messageId: v.id("channelMessages"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    fileType: v.string(),
    fileSize: v.number(),
  }).index("by_message", ["messageId"]),

  channelMessageReactions: defineTable({
    messageId: v.id("channelMessages"),
    userId: v.id("users"),
    emoji: v.string(),
  })
    .index("by_message", ["messageId"])
    .index("by_message_user_emoji", ["messageId", "userId", "emoji"]),

  channelCallParticipants: defineTable({
    channelId: v.id("channels"),
    userId: v.id("users"),
    joinedAt: v.number(),
    /** Live call state, mirrored here by the connected client so the channel
     * list can show it to people who aren't in that call themselves — LiveKit
     * only tells you about rooms you're connected to. */
    muted: v.optional(v.boolean()),
    deafened: v.optional(v.boolean()),
    streaming: v.optional(v.boolean()),
    /** Moderator-imposed, unlike `muted`/`deafened` above which the member
     * sets themselves. The connected client enforces these on itself — see
     * CallProvider — so they survive a reconnect. */
    serverMuted: v.optional(v.boolean()),
    serverDeafened: v.optional(v.boolean()),
  })
    .index("by_channel", ["channelId"])
    .index("by_channel_user", ["channelId", "userId"]),

  /** Custom emoji uploaded per-community. Emoji are referenced in message
   * text and reactions as `<:name:id>` where `id` is the Convex document _id.
   * Each community can have at most 50 custom emoji slots. */
  communityEmojis: defineTable({
    communityId: v.id("communities"),
    /** Short identifier used in `<:name:id>` encoding — alphanumeric + underscores. */
    name: v.string(),
    /** Public served URL from Convex file storage — populated on add. */
    imageUrl: v.string(),
    storageId: v.id("_storage"),
    uploadedBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_community", ["communityId"])
    .index("by_community_name", ["communityId", "name"]),

  /** Soundboard clips uploaded per-community, playable into a voice call by
   * any member. Built-in sounds (src/lib/soundboard.ts) ship with the app and
   * are available everywhere, so they are deliberately not stored here. */
  communitySounds: defineTable({
    communityId: v.id("communities"),
    name: v.string(),
    /** Emoji shown on the soundboard button. */
    emoji: v.optional(v.string()),
    /** Public served URL from Convex file storage — populated on add. */
    soundUrl: v.string(),
    storageId: v.id("_storage"),
    /** Clip length in ms, measured client-side at upload time. */
    durationMs: v.optional(v.number()),
    uploadedBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_community", ["communityId"])
    .index("by_community_name", ["communityId", "name"]),

  /** Per-server profile overrides. Fields left undefined fall back to the
   * user's global profile. */
  serverProfiles: defineTable({
    userId: v.id("users"),
    communityId: v.id("communities"),
    displayName: v.optional(v.string()),
    bio: v.optional(v.string()),
    customStatus: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    avatarStorageId: v.optional(v.id("_storage")),
    /** Same pairing as `users.avatarAccent`, for the per-server avatar. */
    avatarAccent: v.optional(v.string()),
    avatarAccentUrl: v.optional(v.string()),
    /** Pre-crop originals, as on `users` — kept so the crop stays adjustable. */
    avatarOriginalUrl: v.optional(v.string()),
    avatarOriginalStorageId: v.optional(v.id("_storage")),
    bannerUrl: v.optional(v.string()),
    bannerStorageId: v.optional(v.id("_storage")),
    bannerOriginalUrl: v.optional(v.string()),
    bannerOriginalStorageId: v.optional(v.id("_storage")),
    borderGradientStart: v.optional(v.string()),
    borderGradientEnd: v.optional(v.string()),
    profileBg: v.optional(v.string()),
    nameplateUrl: v.optional(v.string()),
    nameplateStorageId: v.optional(v.id("_storage")),
    /** Overrides `users.joinSoundId` in this community. */
    joinSoundId: v.optional(v.string()),
  })
    .index("by_user_community", ["userId", "communityId"])
    .index("by_community", ["communityId"]),

  typing: defineTable({
    userId: v.id("users"),
    channelId: v.optional(v.id("channels")),
    conversationId: v.optional(v.id("conversations")),
    scheduledJobId: v.optional(v.id("_scheduled_functions")),
  })
    .index("by_channel", ["channelId"])
    .index("by_conversation", ["conversationId"])
    .index("by_user_channel", ["userId", "channelId"])
    .index("by_user_conversation", ["userId", "conversationId"]),

  // --- Notifications (mobile) ----------------------------------------------

  /** Persisted, per-recipient notification. Created by `notifyUsers` in
   * convex/notifications.ts, called from message-send/friend-request
   * mutations. Powers both the mobile app's Notifications tab and, via
   * convex/push.ts, real device push delivery. */
  notifications: defineTable({
    userId: v.id("users"),
    type: v.union(
      v.literal("dm_message"),
      v.literal("channel_mention"),
      v.literal("friend_request"),
      v.literal("friend_accept")
    ),
    actorId: v.optional(v.id("users")),
    conversationId: v.optional(v.id("conversations")),
    channelId: v.optional(v.id("channels")),
    communityId: v.optional(v.id("communities")),
    messageId: v.optional(v.id("messages")),
    channelMessageId: v.optional(v.id("channelMessages")),
    requestId: v.optional(v.id("friendRequests")),
    title: v.string(),
    body: v.optional(v.string()),
    read: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_read", ["userId", "read"])
    .index("by_user_created", ["userId", "createdAt"]),

  /**
   * Account-wide notification switches. Absent means the defaults in
   * `convex/lib/notificationPolicy.ts` apply, so a user who has never opened
   * the settings behaves exactly as before.
   */
  notificationSettings: defineTable({
    userId: v.id("users"),
    /** Direct and group messages. */
    dmMessages: v.boolean(),
    /** Channel messages that don't mention you. Mentions are governed by the
     * per-community level below. */
    channelMessages: v.boolean(),
    friendRequests: v.boolean(),
  }).index("by_user", ["userId"]),

  /** Per-server override of how much a user wants to hear from it. */
  communityNotificationSettings: defineTable({
    userId: v.id("users"),
    communityId: v.id("communities"),
    level: v.union(v.literal("all"), v.literal("mentions"), v.literal("none")),
  })
    .index("by_user", ["userId"])
    .index("by_user_community", ["userId", "communityId"]),

  /** One row per (user, device) Expo push token, so `push.sendExpoPush` can
   * fan a single notification out to every device a user is signed into. */
  devicePushTokens: defineTable({
    userId: v.id("users"),
    expoPushToken: v.string(),
    platform: v.union(v.literal("ios"), v.literal("android")),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_token", ["expoPushToken"]),
});
