/** Temporary dev-only bootstrap for the marketing screenshots. Delete after capturing. */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { releaseCreationFiles } from "./creationFiles";
import { hashPassword } from "./lib/passwordHash";
import { DEFAULT_EVERYONE_PERMISSIONS, ROLE_PERMS_VERSION } from "./permissions";

const CAST_USERNAMES = ["maya_chen_demo", "jordan_lee_demo", "sam_patel_demo"];

export const seed = internalMutation({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const user = await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", username)).unique();
    if (!user) throw new Error("Demo user not found.");
    await ctx.db.patch(user._id, { name: "Alex Rivera" });
    const existing = (await ctx.db.query("communities").withIndex("by_owner", (q) => q.eq("ownerId", user._id)).collect())
      .find((community) => community.name === "The Greenhouse" || community.name === "Crystal Demo Lounge");
    if (existing) {
      if (existing.name !== "The Greenhouse") await ctx.db.patch(existing._id, { name: "The Greenhouse" });
      const channels = await ctx.db.query("channels").withIndex("by_community", (q) => q.eq("communityId", existing._id)).collect();
      return { communityId: existing._id, channels: channels.map(({ _id, name }) => ({ id: _id, name })) };
    }

    const communityId = await ctx.db.insert("communities", {
      name: "The Greenhouse",
      ownerId: user._id,
      createdAt: Date.now(),
      inviteOnly: true,
      kind: "clan",
      clanGames: [{ id: "stardew-valley", name: "Stardew Valley" }, { id: "minecraft", name: "Minecraft" }],
      themeStart: "#123c2a",
      themeEnd: "#23835a",
    });
    await ctx.db.insert("communityMembers", { communityId, userId: user._id, joinedAt: Date.now() });
    await ctx.db.patch(user._id, { name: "Alex Rivera" });
    await ctx.db.insert("roles", { communityId, name: "@everyone", permissions: DEFAULT_EVERYONE_PERMISSIONS, permsVersion: ROLE_PERMS_VERSION, position: 0, isEveryone: true });
    const categoryId = await ctx.db.insert("channelCategories", { communityId, name: "THE LOUNGE", position: 0 });
    const definitions = [
      { name: "general", type: "text" as const, topic: "A little bit of everything", position: 0 },
      { name: "game-chat", type: "text" as const, topic: "What are you playing lately?", position: 1 },
      { name: "plans", type: "text" as const, topic: "Make the next hangout happen", position: 2 },
      { name: "voice hangout", type: "voice" as const, topic: undefined, position: 3 },
    ];
    const channels = [];
    for (const definition of definitions) {
      const id = await ctx.db.insert("channels", { ...definition, communityId, categoryId, createdAt: Date.now() });
      channels.push({ id, name: definition.name });
    }
    return { communityId, channels };
  },
});

/** Temporary membership bootstrap for realistic multi-person marketing screenshots. */
export const addMember = internalMutation({
  args: { username: v.string(), memberUsername: v.string(), name: v.string() },
  handler: async (ctx, { username, memberUsername, name }) => {
    const owner = await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", username)).unique();
    const member = await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", memberUsername)).unique();
    if (!owner || !member) throw new Error("Demo account not found.");
    const community = (await ctx.db.query("communities").withIndex("by_owner", (q) => q.eq("ownerId", owner._id)).collect())
      .find((row) => row.name === "The Greenhouse");
    if (!community) throw new Error("Demo community not found.");
    const existing = await ctx.db.query("communityMembers").withIndex("by_community_user", (q) => q.eq("communityId", community._id).eq("userId", member._id)).first();
    if (!existing) await ctx.db.insert("communityMembers", { communityId: community._id, userId: member._id, joinedAt: Date.now() });
    await ctx.db.patch(member._id, { name });
    const channels = await ctx.db.query("channels").withIndex("by_community", (q) => q.eq("communityId", community._id)).collect();
    let queued = 0;
    for (const channel of channels) {
      const keys = await ctx.db.query("e2eeKeys").withIndex("by_channel", (q) => q.eq("channelId", channel._id)).collect();
      for (const key of keys.filter((row) => !row.supersededAt)) {
        const wrap = await ctx.db.query("e2eeKeyWraps").withIndex("by_key_user", (q) => q.eq("keyId", key._id).eq("userId", member._id)).first();
        if (wrap) continue;
        const requests = await ctx.db.query("e2eeWrapRequests").withIndex("by_key", (q) => q.eq("keyId", key._id)).collect();
        if (requests.some((row) => row.userId === member._id)) continue;
        await ctx.db.insert("e2eeWrapRequests", { keyId: key._id, userId: member._id, createdAt: Date.now() });
        queued++;
      }
    }
    return { communityId: community._id, queued };
  },
});

/** Temporary fictional roster for the marketing conversation screenshots. */
export const prepareCast = internalMutation({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const owner = await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", username)).unique();
    if (!owner) throw new Error("Demo user not found.");
    const community = (await ctx.db.query("communities").withIndex("by_owner", (q) => q.eq("ownerId", owner._id)).collect())
      .find((row) => row.name === "The Greenhouse" || row.name === "Crystal Demo Lounge");
    if (!community) throw new Error("Demo community not found.");
    const cast = [
      { name: "Maya Chen", username: "maya_chen_demo" },
      { name: "Jordan Lee", username: "jordan_lee_demo" },
      { name: "Sam Patel", username: "sam_patel_demo" },
    ];
    for (const person of cast) {
      let member = await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", person.username)).unique();
      if (!member) {
        const id = await ctx.db.insert("users", { name: person.name, username: person.username, clerkId: `marketing-demo:${person.username}` });
        member = await ctx.db.get(id);
      } else await ctx.db.patch(member._id, { name: person.name });
      if (member && !(await ctx.db.query("communityMembers").withIndex("by_community_user", (q) => q.eq("communityId", community._id).eq("userId", member._id)).first())) {
        await ctx.db.insert("communityMembers", { communityId: community._id, userId: member._id, joinedAt: Date.now() });
      }
    }
    return { communityId: community._id, cast: cast.map(({ name, username }) => ({ name, username })) };
  },
});

/** Give the fictional cast an email + password so each can sign in from its own browser session. */
export const enableCastLogins = internalAction({
  args: { password: v.string() },
  handler: async (ctx, { password }): Promise<string[]> => {
    const passwordHash = await hashPassword(password);
    return ctx.runMutation(internal.marketingDemo.storeCastLogins, { passwordHash });
  },
});

export const storeCastLogins = internalMutation({
  args: { passwordHash: v.string() },
  handler: async (ctx, { passwordHash }) => {
    const emails: string[] = [];
    for (const username of CAST_USERNAMES) {
      const user = await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", username)).unique();
      if (!user) continue;
      const email = `${username.replace(/_demo$/, "").replace("_", ".")}@greenhouse-demo.example.com`;
      if (!(await ctx.db.query("userEmails").withIndex("by_user", (q) => q.eq("userId", user._id)).first())) {
        await ctx.db.insert("userEmails", { userId: user._id, email, verifiedAt: Date.now(), source: "signup" });
      }
      const credential = await ctx.db.query("authCredentials").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
      if (credential) await ctx.db.patch(credential._id, { passwordHash, updatedAt: Date.now() });
      else await ctx.db.insert("authCredentials", { userId: user._id, passwordHash, updatedAt: Date.now() });
      emails.push(email);
    }
    return emails;
  },
});

/** Attribute the latest locally-created sample messages to the fictional cast. */
export const assignAuthors = internalMutation({
  args: { channelId: v.id("channels"), authors: v.array(v.string()) },
  handler: async (ctx, { channelId, authors }) => {
    const messages = (await ctx.db.query("channelMessages").withIndex("by_channel", (q) => q.eq("channelId", channelId)).collect())
      .sort((a, b) => a._creationTime - b._creationTime);
    const rows = messages.slice(-authors.length);
    for (let i = 0; i < rows.length; i++) {
      const author = await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", authors[i])).unique();
      if (!author) throw new Error(`Demo author ${authors[i]} not found.`);
      await ctx.db.patch(rows[i]._id, { authorId: author._id });
    }
    return { updated: rows.length };
  },
});

/** Illustrated stock avatars (DiceBear "Notionists" by Zoish, CC0) for the fictional cast and community. */
const DICEBEAR = "https://api.dicebear.com/9.x";
const castAvatar = (seed: string, background: string) =>
  `${DICEBEAR}/notionists/svg?seed=${encodeURIComponent(seed)}&backgroundColor=${background}`;

export const applyAvatars = internalMutation({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const avatars: Record<string, string> = {
      [username]: castAvatar("Alex Rivera", "b6e3f4"),
      maya_chen_demo: castAvatar("Maya Chen", "ffd5dc"),
      jordan_lee_demo: castAvatar("Jordan Lee", "c0aede"),
      sam_patel_demo: castAvatar("Sam Patel", "d1f4d9"),
    };
    let updated = 0;
    for (const [handle, imageUrl] of Object.entries(avatars)) {
      const user = await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", handle)).unique();
      if (!user) continue;
      await ctx.db.patch(user._id, { imageUrl });
      updated++;
    }
    const owner = await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", username)).unique();
    const community = owner && (await ctx.db.query("communities").withIndex("by_owner", (q) => q.eq("ownerId", owner._id)).collect())
      .find((row) => row.name === "The Greenhouse");
    if (community) await ctx.db.patch(community._id, { imageUrl: `${DICEBEAR}/icons/svg?seed=greenhouse&icon=flower1&backgroundColor=23835a` });
    return { users: updated, community: Boolean(community) };
  },
});

/**
 * Presence and custom statuses for the fictional cast. The cast has no clients sending heartbeats, so their
 * `lastHeartbeat` is pinned a day ahead: `sweepStale` never selects them and `reconcile` treats them as a live
 * desktop client, which keeps both the status dot and the activity on screen for the shoot.
 */
export const applyPresence = internalMutation({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const now = Date.now();
    const pinned = now + 24 * 60 * 60 * 1000;
    const cast = [
      {
        username,
        customStatus: "Planning Friday’s game night 🎲",
        statusBubble: "speech" as const,
      },
      {
        username: "maya_chen_demo",
        customStatus: "Watering the crops 🌱",
        statusBubble: "thought" as const,
        status: "online" as const,
        activities: [{ type: "playing" as const, name: "Stardew Valley", details: "Spring, Year 3", state: "Co-op farm", startedAt: now - 47 * 60 * 1000 }],
      },
      {
        username: "jordan_lee_demo",
        customStatus: "Back in 10, making coffee ☕",
        statusBubble: "speech" as const,
        status: "idle" as const,
        activities: [{ type: "listening" as const, name: "Spotify", details: "Stardew Valley Overture", state: "ConcernedApe", album: "Stardew Valley OST", startedAt: now - 3 * 60 * 1000 }],
      },
      {
        username: "sam_patel_demo",
        customStatus: "Deadline mode, ping me after 6",
        statusBubble: "speech" as const,
        status: "dnd" as const,
        activities: [{ type: "playing" as const, name: "Minecraft", details: "Building the greenhouse roof", startedAt: now - 12 * 60 * 1000 }],
      },
    ];
    const bios: Record<string, string> = {
      [username]: "Runs game night. Owes everyone a rematch.",
      maya_chen_demo: "Farmer by night 🌾 illustrator by day. Will trade fish for seeds.",
      jordan_lee_demo: "East coast, always a few timezones behind. Coffee first ☕",
      sam_patel_demo: "Builds things in Minecraft and, occasionally, at work.",
    };
    let updated = 0;
    for (const person of cast) {
      const user = await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", person.username)).unique();
      if (!user) continue;
      // As a *custom* activity on the profile rather than a detected one on the presence row: a real
      // session (used for the screenshots) re-merges detected activities from its devices and would
      // erase one written straight onto the row.
      const activity = "activities" in person ? person.activities?.[0] : undefined;
      await ctx.db.patch(user._id, {
        bio: bios[person.username],
        customStatus: person.customStatus,
        statusBubble: person.statusBubble,
        customStatusExpiresAt: undefined,
        customActivity: activity,
        customActivityExpiresAt: undefined,
      });
      updated++;
      // The signed-in account keeps its real, heartbeat-driven presence.
      if (!("status" in person) || !person.status) continue;
      const row = await ctx.db.query("presence").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
      const fields = {
        manualStatus: person.status,
        effective: person.status,
        isIdle: person.status === "idle",
        lastHeartbeat: pinned,
        activities: [],
      };
      if (row) await ctx.db.patch(row._id, fields);
      else await ctx.db.insert("presence", { userId: user._id, ...fields });
    }
    return { updated };
  },
});

export const deleteMessage = internalMutation({
  args: { messageId: v.union(v.id("channelMessages"), v.id("messages")) },
  handler: async (ctx, { messageId }) => {
    await ctx.db.delete(messageId);
  },
});

/**
 * Wipe The Greenhouse's messages and room keys so the next sender opens a fresh epoch wrapped to every
 * member who now has an identity (the cast included), instead of the old one only Alex holds.
 */
export const resetChannels = internalMutation({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const owner = await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", username)).unique();
    if (!owner) throw new Error("Demo user not found.");
    const community = (await ctx.db.query("communities").withIndex("by_owner", (q) => q.eq("ownerId", owner._id)).collect())
      .find((row) => row.name === "The Greenhouse");
    if (!community) throw new Error("Demo community not found.");
    let removed = 0;
    for (const channel of await ctx.db.query("channels").withIndex("by_community", (q) => q.eq("communityId", community._id)).collect()) {
      for (const message of await ctx.db.query("channelMessages").withIndex("by_channel", (q) => q.eq("channelId", channel._id)).collect()) {
        await ctx.db.delete(message._id);
        removed++;
      }
      for (const key of await ctx.db.query("e2eeKeys").withIndex("by_channel", (q) => q.eq("channelId", channel._id)).collect()) {
        for (const wrap of await ctx.db.query("e2eeKeyWraps").withIndex("by_key", (q) => q.eq("keyId", key._id)).collect()) await ctx.db.delete(wrap._id);
        for (const request of await ctx.db.query("e2eeWrapRequests").withIndex("by_key", (q) => q.eq("keyId", key._id)).collect()) await ctx.db.delete(request._id);
        await ctx.db.delete(key._id);
      }
      const roomState = await ctx.db.query("e2eeRoomState").withIndex("by_channel", (q) => q.eq("channelId", channel._id)).first();
      if (roomState) await ctx.db.delete(roomState._id);
    }
    return { removed };
  },
});

/** Make the whole cast friends with each other, both directions, so Friends and DMs have people in them. */
export const befriendCast = internalMutation({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const people = [];
    for (const handle of [username, ...CAST_USERNAMES]) {
      const user = await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", handle)).unique();
      if (user) people.push(user._id);
    }
    let added = 0;
    for (const ownerId of people) {
      for (const friendId of people) {
        if (ownerId === friendId) continue;
        const existing = await ctx.db.query("friendships").withIndex("by_owner_friend", (q) => q.eq("ownerId", ownerId).eq("friendId", friendId)).first();
        if (existing) continue;
        await ctx.db.insert("friendships", { ownerId, friendId, createdAt: Date.now() });
        added++;
      }
    }
    return { added };
  },
});

export const clearChannelMessages = internalMutation({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const rows = await ctx.db.query("channelMessages").withIndex("by_channel", (q) => q.eq("channelId", channelId)).collect();
    for (const row of rows) await ctx.db.delete(row._id);
    return { removed: rows.length };
  },
});

export const cleanup = internalMutation({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const user = await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", username)).unique();
    if (!user) return { removed: 0 };
    const communities = await ctx.db.query("communities").withIndex("by_owner", (q) => q.eq("ownerId", user._id)).collect();
    let removed = 0;
    for (const community of communities.filter((row) => row.name === "The Greenhouse")) {
      const channels = await ctx.db.query("channels").withIndex("by_community", (q) => q.eq("communityId", community._id)).collect();
      for (const channel of channels) {
        const messages = await ctx.db.query("channelMessages").withIndex("by_channel", (q) => q.eq("channelId", channel._id)).collect();
        for (const message of messages) { await ctx.db.delete(message._id); removed++; }
        const keys = await ctx.db.query("e2eeKeys").withIndex("by_channel", (q) => q.eq("channelId", channel._id)).collect();
        for (const key of keys) {
          for (const wrap of await ctx.db.query("e2eeKeyWraps").withIndex("by_key", (q) => q.eq("keyId", key._id)).collect()) await ctx.db.delete(wrap._id);
          await ctx.db.delete(key._id);
        }
        const roomState = await ctx.db.query("e2eeRoomState").withIndex("by_channel", (q) => q.eq("channelId", channel._id)).first();
        if (roomState) await ctx.db.delete(roomState._id);
        await ctx.db.delete(channel._id);
      }
      for (const member of await ctx.db.query("communityMembers").withIndex("by_community", (q) => q.eq("communityId", community._id)).collect()) await ctx.db.delete(member._id);
      for (const role of await ctx.db.query("roles").withIndex("by_community", (q) => q.eq("communityId", community._id)).collect()) await ctx.db.delete(role._id);
      for (const category of await ctx.db.query("channelCategories").withIndex("by_community", (q) => q.eq("communityId", community._id)).collect()) await ctx.db.delete(category._id);
      await ctx.db.delete(community._id);
    }
    for (const username of ["maya_chen_demo", "jordan_lee_demo", "sam_patel_demo"]) {
      const person = await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", username)).unique();
      if (!person) continue;
      for (const row of await ctx.db.query("presence").withIndex("by_user", (q) => q.eq("userId", person._id)).collect()) await ctx.db.delete(row._id);
      for (const row of await ctx.db.query("userEmails").withIndex("by_user", (q) => q.eq("userId", person._id)).collect()) await ctx.db.delete(row._id);
      for (const row of await ctx.db.query("authCredentials").withIndex("by_user", (q) => q.eq("userId", person._id)).collect()) await ctx.db.delete(row._id);
      for (const row of await ctx.db.query("friendships").withIndex("by_owner", (q) => q.eq("ownerId", person._id)).collect()) await ctx.db.delete(row._id);
      for (const row of (await ctx.db.query("friendships").withIndex("by_owner", (q) => q.eq("ownerId", user._id)).collect()).filter((f) => f.friendId === person._id)) await ctx.db.delete(row._id);
      await ctx.db.delete(person._id);
    }
    return { removed };
  },
});

/** Dev-only: a throwaway account for testing export and deletion, friends with Maya so it can DM her. */
export const createTestAccount = internalAction({
  args: { username: v.string(), email: v.string(), password: v.string() },
  handler: async (ctx, args): Promise<string> => {
    const passwordHash = await hashPassword(args.password);
    return ctx.runMutation(internal.marketingDemo.storeTestAccount, { username: args.username, email: args.email, passwordHash });
  },
});

export const storeTestAccount = internalMutation({
  args: { username: v.string(), email: v.string(), passwordHash: v.string() },
  handler: async (ctx, { username, email, passwordHash }) => {
    const userId = await ctx.db.insert("users", { name: "Deletion Tester", username, bio: "Here to be deleted." });
    await ctx.db.insert("userEmails", { userId, email, verifiedAt: Date.now(), source: "signup" });
    await ctx.db.insert("authCredentials", { userId, passwordHash, updatedAt: Date.now() });
    const maya = await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", "maya_chen_demo")).unique();
    if (maya) {
      await ctx.db.insert("friendships", { ownerId: userId, friendId: maya._id, createdAt: Date.now() });
      await ctx.db.insert("friendships", { ownerId: maya._id, friendId: userId, createdAt: Date.now() });
    }
    return userId;
  },
});

/** Dev-only: open the DM between two accounts, as `conversations.getOrCreateDirect` would. */
export const openTestDm = internalMutation({
  args: { a: v.string(), b: v.string() },
  handler: async (ctx, { a, b }) => {
    const ua = await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", a)).unique();
    const ub = await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", b)).unique();
    if (!ua || !ub) throw new Error("Account not found.");
    const dmKey = [ua._id, ub._id].sort().join(":");
    const existing = await ctx.db.query("conversations").withIndex("by_dm_key", (q) => q.eq("dmKey", dmKey)).unique();
    if (existing) return existing._id;
    const now = Date.now();
    const conversationId = await ctx.db.insert("conversations", { type: "dm", dmKey, createdBy: ua._id, createdAt: now });
    await ctx.db.insert("conversationMembers", { conversationId, userId: ua._id, joinedAt: now, lastReadAt: now });
    await ctx.db.insert("conversationMembers", { conversationId, userId: ub._id, joinedAt: now, lastReadAt: 0 });
    return conversationId;
  },
});

/** Dev-only: what's left of an account after deletion, for checking the job did its work. */
export const inspectAccount = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    const count = async (table: string, index: string, field = "userId") =>
      (await ctx.db.query(table as never).withIndex(index as never, ((q: { eq: (f: string, v: unknown) => unknown }) => q.eq(field, userId)) as never).collect()).length;
    return {
      user: user && { name: user.name, username: user.username, deletedAt: user.deletedAt, bio: user.bio ?? null, imageUrl: user.imageUrl ?? null },
      job: await ctx.db.query("accountDeletions").withIndex("by_user", (q) => q.eq("userId", userId)).unique(),
      dmMessages: await count("messages", "by_author", "authorId"),
      emails: await count("userEmails", "by_user"),
      credentials: await count("authCredentials", "by_user"),
      friendships: await count("friendships", "by_owner", "ownerId"),
      conversationMembers: await count("conversationMembers", "by_user"),
      e2eeIdentities: await count("e2eeIdentities", "by_user"),
      sessions: (await ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", userId)).collect()).length,
      attachmentRow: await ctx.db.query("messageAttachments").withIndex("by_cdn_key", (q) => q.eq("cdnKey", "attachments/ee2bf501e86fe3ec/test-attachment.png")).first(),
      r2Asset: await ctx.db.query("r2Assets").withIndex("by_key", (q) => q.eq("key", "attachments/ee2bf501e86fe3ec/test-attachment.png")).first(),
    };
  },
});

/** Dev-only: exercise creationFiles.releaseIfUnused with one referenced and one orphaned fake file. */
export const testCreationRelease = internalMutation({
  args: { phase: v.union(v.literal("seed"), v.literal("check"), v.literal("clean")) },
  handler: async (ctx, { phase }) => {
    const alex = await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", "crystal_marketing_demo")).unique();
    if (!alex) throw new Error("no alex");
    const kept = "marketplace/creations/test/kept-by-submission.webp";
    const orphan = "marketplace/creations/test/orphaned.webp";
    const base = process.env.R2_PUBLIC_URL ?? process.env.CDN_URL ?? "";
    if (phase === "seed") {
      for (const key of [kept, orphan]) {
        await ctx.db.insert("r2Assets", { key, kind: "nameplates" as never, ownerId: alex._id, userId: alex._id, fileName: key, ext: "webp", hash: "test", size: 1, contentType: "image/webp", createdAt: Date.now() });
      }
      await ctx.db.insert("marketplaceSubmissions", {
        creatorId: alex._id, name: "Release test", type: "cosmetic", grants: [{ kind: "nameplate", payload: `${base}/${kept}` }],
        requestedPriceCents: 0, currency: "usd", status: "pending", createdAt: Date.now(), updatedAt: Date.now(),
      });
      await releaseCreationFiles(ctx, alex._id, [kept, orphan]);
      return "seeded";
    }
    const rows = await Promise.all([kept, orphan].map((key) => ctx.db.query("r2Assets").withIndex("by_key", (q) => q.eq("key", key)).unique()));
    if (phase === "check") return { keptStillThere: !!rows[0], orphanStillThere: !!rows[1] };
    for (const row of rows) if (row) await ctx.db.delete(row._id);
    for (const sub of await ctx.db.query("marketplaceSubmissions").withIndex("by_creator", (q) => q.eq("creatorId", alex._id)).collect()) if (sub.name === "Release test") await ctx.db.delete(sub._id);
    return "cleaned";
  },
});
