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
  /** Up to two link buttons under the card, the same shape Discord's Rich
   * Presence uses. Only custom activities set these today — nothing we detect
   * has anywhere to point. */
  buttons: v.optional(v.array(v.object({ label: v.string(), url: v.string() }))),
  /** Where this came from: "detectable" (process scan), "ipc" (a game
   * connected to our Discord-compatible RPC socket), "music", or "custom"
   * (written by the user themselves). */
  source: v.optional(v.string()),
});

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    name: v.string(),
    username: v.string(),
    imageUrl: v.optional(v.string()),
    dob: v.optional(v.string()),
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
    /** How the custom status is drawn beside this user's avatar on their
     * profile card: said, or thought. Cosmetic and chosen by the person whose
     * status it is, so it travels with the status rather than being a viewer's
     * setting. Absent means "speech", which is what everyone had before the
     * choice existed. */
    statusBubble: v.optional(v.union(v.literal("speech"), v.literal("thought"))),
    /** When the custom status stops being shown, for the "clear after…"
     * presets. Absent means it stays until cleared by hand. Enforced on read
     * as well as by the sweep, so an expired status is never shown even if
     * nothing has run to delete it yet. */
    customStatusExpiresAt: v.optional(v.number()),
    /**
     * A Rich Presence activity the user wrote themselves, shown ahead of
     * anything detected.
     *
     * Lives on the profile rather than on `presence` because it outlives a
     * session: detected activities are cleared when the last desktop client
     * disconnects (see `reconcile`), whereas "I'm at work until 5" should
     * survive closing the app and be visible from a phone.
     */
    customActivity: v.optional(activityValidator),
    /** When `customActivity` stops being shown. Same rules as
     * `customStatusExpiresAt`. */
    customActivityExpiresAt: v.optional(v.number()),
    nameplateUrl: v.optional(v.string()),
    nameplateStorageId: v.optional(v.id("_storage")),
    /** The frame drawn around this user's avatar: a `builtin:<key>` preset or
     * the storage URL of a picture they uploaded. One field rather than a key
     * and a URL, so the queries that carry it to every avatar on screen carry
     * one thing — see src/lib/avatar-decorations.ts, which draws it. */
    avatarDecoration: v.optional(v.string()),
    avatarDecorationStorageId: v.optional(v.id("_storage")),
    /** The decoration generated as a birthday present, and when it stops being
     * worn. Kept separate from `avatarDecoration` so the user's own choice is
     * still there underneath and comes back by itself the next day.
     *
     * `birthdayUntil` is local midnight as reported by the user's own client
     * (see `claimBirthday`), because the server has no timezone and a birthday
     * is a local date. It's also what tells everyone *else* it's this person's
     * birthday — the cake in place of a presence dot, the prompt above a
     * friend's composer. See convex/lib/birthday.ts. */
    birthdayDecoration: v.optional(v.string()),
    birthdayUntil: v.optional(v.number()),
    /** Clip played to everyone else when this user joins a call. Either a
     * `builtin:<name>` id or a `communitySounds` document id — see
     * src/lib/soundboard.ts. A per-server override lives on
     * `serverProfiles.joinSoundId`. */
    joinSoundId: v.optional(v.string()),
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_username", ["username"]),

  /**
   * What each badge looks like and means — the catalogue the ids in
   * `userBadges` point at.
   *
   * Data rather than code, so a new badge is a row instead of a release: the
   * definition used to live in the client bundle, which meant granting one to
   * somebody on an older build showed them nothing at all.
   *
   * A badge is drawn as *either* an icon or a picture. `icon` is the export
   * name of a react-icons glyph ("BsFillPersonBadgeFill"), which the client
   * resolves at render time — see src/lib/react-icons.ts for which packs it
   * knows how to reach and what a name has to look like. `imageUrl` is for the
   * ones a glyph can't be: a logo, an event badge, anything with more than one
   * colour in it. Set both and the picture wins.
   */
  badges: defineTable({
    /** Stable key. What `userBadges.badgeId` holds, and what a grant names. */
    badgeId: v.string(),
    label: v.string(),
    /** Shown on hover — the reason someone has it. */
    description: v.string(),
    /** A react-icons export name, e.g. "BsBugFill". */
    icon: v.optional(v.string()),
    /** Or a picture, for badges a single-colour glyph can't carry. */
    imageUrl: v.optional(v.string()),
    /** Tailwind classes for the glyph's colour. Each badge gets its own so a
     * row of them reads as distinct things rather than one thing repeated.
     * Ignored for `imageUrl` badges, which bring their own colours. */
    className: v.optional(v.string()),
    /**
     * Badges that are tiers of one thing — Bug Hunter bronze through diamond —
     * share a `group`, and only the highest `tier` a user holds is drawn. Five
     * identical bug glyphs say less than one diamond one.
     *
     * A group rather than a level field on `userBadges`, because a promotion
     * stays "revoke tier N, grant tier N+1" with no new machinery, and the
     * grant history keeps the date each tier was reached.
     */
    group: v.optional(v.string()),
    tier: v.optional(v.number()),
    /** Where it sits in a row of badges. Ties fall back to when it was
     * granted, so an unordered catalogue still renders consistently. */
    position: v.optional(v.number()),
  }).index("by_badge_id", ["badgeId"]),

  /**
   * Badges earned by a user — "Early Supporter" and whatever comes after.
   *
   * A row per (user, badge) rather than a field on `users`, so granting one
   * doesn't rewrite the user document and `grantedAt` is recorded per badge
   * ("Early Supporter since March"). `badgeId` names a row in `badges` above;
   * an id with no definition is skipped on read rather than breaking the card,
   * so deleting a definition is safe.
   */
  userBadges: defineTable({
    userId: v.id("users"),
    badgeId: v.string(),
    grantedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_badge", ["userId", "badgeId"]),

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
   * One row per signed-in device, so "is this user online" becomes a question
   * about their devices rather than about a single shared counter.
   *
   * The `presence` row above is the *answer* — one status per user, which is
   * what every viewer renders. It used to be the question too: it carried the
   * only `lastHeartbeat`, so whichever client wrote last owned it, and the
   * stale sweep flipped the user offline the moment that client stopped. A
   * phone going into the background could therefore mark someone offline while
   * their desktop app sat open in front of them.
   *
   * Splitting the two lets the sweep ask "are *any* of this user's devices
   * still beating?" and only fall back to offline when none are.
   */
  presenceSessions: defineTable({
    userId: v.id("users"),
    /** Stable per-install id. Two clients on one account are two rows. */
    deviceId: v.string(),
    platform: v.union(v.literal("desktop"), v.literal("mobile"), v.literal("web")),
    /** This device's own idle state. A user counts as idle only when every
     * live device is — a phone in a pocket shouldn't idle out a desktop. */
    isIdle: v.boolean(),
    lastHeartbeat: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_device", ["userId", "deviceId"])
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
    /** This message was sent from the "wish them a happy birthday" prompt.
     * Recorded on the message rather than announced some other way because
     * both people need to see the cakes fall and both are already subscribed
     * to this conversation — the message arriving *is* the signal. */
    birthdayWish: v.optional(v.boolean()),
  })
    .index("by_conversation", ["conversationId"])
    // Scoped search — see convex/search.ts. The filter field is what lets a
    // search mean "in this conversation" without scanning every message.
    .searchIndex("search_text", {
      searchField: "text",
      filterFields: ["conversationId"],
    }),

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
    /** Screen-share state, as on `channelCallParticipants`. */
    streaming: v.optional(v.boolean()),
    streamThumbnailUrl: v.optional(v.string()),
    streamThumbnailStorageId: v.optional(v.id("_storage")),
    streamThumbnailAt: v.optional(v.number()),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_conversation_user", ["conversationId", "userId"])
    .index("by_user", ["userId"]),

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
    /** Which version of the unfurler produced this row — see
     * `UNFURL_VERSION` in convex/lib/richEmbeds.ts. Anything older is
     * re-unfurled on sight. */
    version: v.optional(v.number()),
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
    /** When the newest message landed, denormalised from `channelMessages`.
     * Unread state is a comparison against `channelReads.lastReadAt`, and
     * doing it from here means one read per channel list rather than one
     * "newest message" query per channel every time anyone says anything
     * anywhere. */
    lastMessageAt: v.optional(v.number()),
  })
    .index("by_community", ["communityId"])
    .index("by_community_position", ["communityId", "position"]),

  /**
   * How far a member has read in a channel.
   *
   * Absent means "never opened it", which reads as unread if the channel has
   * any message at all — the same thing Discord does with a channel you've
   * just been invited to. Carries `communityId` so a server's worth of
   * markers is one indexed read rather than a scan of every channel the user
   * has ever opened.
   */
  channelReads: defineTable({
    userId: v.id("users"),
    channelId: v.id("channels"),
    communityId: v.id("communities"),
    lastReadAt: v.number(),
  })
    .index("by_user_channel", ["userId", "channelId"])
    .index("by_user_community", ["userId", "communityId"]),

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
  })
    .index("by_channel", ["channelId"])
    // Scoped search — see convex/search.ts. Filtered by channel rather than
    // community because these rows carry no community id; a server-wide search
    // fans out over the channels the caller can see instead, which needs no
    // backfill of existing messages.
    .searchIndex("search_text", {
      searchField: "text",
      filterFields: ["channelId"],
    }),

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
    /** A recent still from this member's screen share, published by their own
     * client every few seconds while they're sharing. Lets somebody outside
     * the call see what's on before deciding to join it — the stream itself
     * can't be sampled without subscribing to it. */
    streamThumbnailUrl: v.optional(v.string()),
    streamThumbnailStorageId: v.optional(v.id("_storage")),
    streamThumbnailAt: v.optional(v.number()),
    /** Moderator-imposed, unlike `muted`/`deafened` above which the member
     * sets themselves. The connected client enforces these on itself — see
     * CallProvider — so they survive a reconnect. */
    serverMuted: v.optional(v.boolean()),
    serverDeafened: v.optional(v.boolean()),
  })
    .index("by_channel", ["channelId"])
    .index("by_channel_user", ["channelId", "userId"])
    .index("by_user", ["userId"]),

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
