import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    name: v.string(),
    username: v.string(),
    imageUrl: v.optional(v.string()),
    bio: v.optional(v.string()),
    /** Storage id backing `imageUrl` when it's a user-uploaded avatar, so the
     * old file can be deleted when it's replaced or removed. */
    avatarStorageId: v.optional(v.id("_storage")),
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
  })
    .index("by_user", ["userId"])
    .index("by_last_heartbeat", ["lastHeartbeat"]),

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
  }).index("by_conversation", ["conversationId"]),

  messageAttachments: defineTable({
    messageId: v.id("messages"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    fileType: v.string(),
    fileSize: v.number(),
  })
    .index("by_message", ["messageId"])
    .index("by_storageId", ["storageId"]),

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

  linkPreviews: defineTable({
    url: v.string(),
    status: v.union(v.literal("ok"), v.literal("error")),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    image: v.optional(v.string()),
    siteName: v.optional(v.string()),
    fetchedAt: v.number(),
  }).index("by_url", ["url"]),

  // --- Communities ---------------------------------------------------------

  communities: defineTable({
    name: v.string(),
    ownerId: v.id("users"),
    imageUrl: v.optional(v.string()),
    iconStorageId: v.optional(v.id("_storage")),
    createdAt: v.number(),
    /** One active invite code per community — regenerating replaces it,
     * invalidating whatever was posted/copied before. */
    inviteCode: v.optional(v.string()),
  })
    .index("by_owner", ["ownerId"])
    .index("by_invite_code", ["inviteCode"]),

  communityMembers: defineTable({
    communityId: v.id("communities"),
    userId: v.id("users"),
    joinedAt: v.number(),
  })
    .index("by_community", ["communityId"])
    .index("by_user", ["userId"])
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
  }).index("by_channel", ["channelId"]),

  channelMessageAttachments: defineTable({
    messageId: v.id("channelMessages"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    fileType: v.string(),
    fileSize: v.number(),
  })
    .index("by_message", ["messageId"])
    .index("by_storageId", ["storageId"]),

  channelMessageReactions: defineTable({
    messageId: v.id("channelMessages"),
    userId: v.id("users"),
    emoji: v.string(),
  })
    .index("by_message", ["messageId"])
    .index("by_message_user_emoji", ["messageId", "userId", "emoji"]),

  /** Who's connected to a voice channel's LiveKit room right now — mirrors
   * `callParticipants` but for community voice channels instead of DM calls. */
  channelCallParticipants: defineTable({
    channelId: v.id("channels"),
    userId: v.id("users"),
    joinedAt: v.number(),
  })
    .index("by_channel", ["channelId"])
    .index("by_channel_user", ["channelId", "userId"]),
});
