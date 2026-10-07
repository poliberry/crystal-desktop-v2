import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireCommunity, requireMember } from "./communities";
import {
  assertPanelUrl,
  getResources,
  listPanelServers,
  PanelError,
  panelRequest,
  type PanelResources,
  type PanelServer,
} from "./lib/panelClient";
import { lookupModrinth, type ModrinthResult } from "./lib/modrinth";
import { decryptSecret, encryptSecret } from "./lib/secrets";
import { normalizeProfile, type ServerProfile } from "./lib/serverProfile";
import { r2PublicUrlForKey, dropR2Url } from "./lib/r2";
import { PERMISSIONS, getBasePermissions, can, requireCommunityPermission } from "./permissions";
import { getCurrentUserOrThrow } from "./users";

/**
 * Operating a community's game servers through its Pterodactyl panel.
 *
 * The panel's API key never leaves the server. A manager hands it over once, it
 * is stored encrypted, and every request to the panel is made by an action here
 * on behalf of a member whose *Crystal* permissions have been checked first —
 * the key's own reach on the panel is the most anyone can do, and each server's
 * access list is how much of that a given member may.
 */

type Level = "none" | "view" | "power" | "manage";
const RANK: Record<Level, number> = { none: 0, view: 1, power: 2, manage: 3 };
const SIGNALS = ["start", "stop", "restart", "kill"] as const;
const MAX_SERVERS = 25;

/** What a member may do to one server: everything for a manager, otherwise the
 * highest of what `@everyone` and each of their roles is given. */
async function levelFor(
  ctx: QueryCtx,
  community: Doc<"communities">,
  userId: Id<"users">,
  server: Doc<"gameServers">,
): Promise<Level> {
  const perms = await getBasePermissions(ctx, community, userId);
  if (can(perms, PERMISSIONS.MANAGE_GAME_SERVERS)) return "manage";
  let best: Level = server.everyoneLevel;
  const assigned = await ctx.db
    .query("memberRoles")
    .withIndex("by_member", (q) => q.eq("communityId", community._id).eq("userId", userId))
    .collect();
  for (const grant of server.roleAccess) {
    if (assigned.some((m) => m.roleId === grant.roleId) && RANK[grant.level] > RANK[best]) best = grant.level;
  }
  return best;
}

// --- What a client sees ---------------------------------------------------------------------

/**
 * The panel connection (for a manager) and the servers the caller may see, with
 * how much they may do to each. Reactive, so the list updates as access changes.
 */
export const overview = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMember(ctx, communityId, me._id);
    const community = await requireCommunity(ctx, communityId);
    const perms = await getBasePermissions(ctx, community, me._id);
    const canManage = can(perms, PERMISSIONS.MANAGE_GAME_SERVERS);

    const panel = await ctx.db
      .query("gameServerPanels")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .unique();
    const rows = await ctx.db
      .query("gameServers")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .collect();
    const servers = [];
    for (const server of rows) {
      const level = await levelFor(ctx, community, me._id, server);
      // A listed server is shown to everyone, to read about — without any
      // control over it, which is what `level` still says.
      if (level === "none" && !server.listed) continue;
      const profile = server.profile;
      const game = community.clanGames?.find((g) => g.id === server.gameId);
      servers.push({
        id: server._id,
        name: profile?.displayName ?? server.name,
        panelName: server.name,
        gameId: server.gameId,
        level,
        listed: server.listed === true,
        // A link straight to the server's page in the panel. Only managers get it:
        // it carries the panel's address, which is theirs to share or not.
        panelUrl: panel && canManage ? `${panel.baseUrl}/server/${server.identifier}` : undefined,
        info: {
          description: profile?.description,
          iconUrl: server.iconUrl,
          gameName: profile?.gameName ?? game?.name,
          gameVersion: profile?.gameVersion,
          address: profile?.address,
          minecraft: profile?.minecraft,
        },
        // Who is allowed what is for managers to see and change.
        ...(canManage ? { everyoneLevel: server.everyoneLevel, roleAccess: server.roleAccess, profile } : {}),
      });
    }
    return {
      canManage,
      // Never the key, and the address only for the people who set it up.
      panel: panel
        ? {
            connected: true as const,
            ...(canManage ? { baseUrl: panel.baseUrl, keyHint: panel.keyHint, lastError: panel.lastError } : {}),
          }
        : { connected: false as const },
      servers,
    };
  },
});

// --- Internal plumbing ----------------------------------------------------------------------

/** What `context` hands an action. Named, because an action that calls an internal
 * query in the same file can't have its types inferred through the generated api. */
interface ContextResult {
  userId: Id<"users">;
  panel: { id: Id<"gameServerPanels">; baseUrl: string; keyCipher: string } | null;
  server: { id: Id<"gameServers">; identifier: string; name: string } | null;
  level: Level;
}

/** What an action needs to act for the caller: who they are, what they may do to
 * the server, and the panel's address and (encrypted) key. */
export const context = internalQuery({
  args: { communityId: v.id("communities"), serverId: v.optional(v.id("gameServers")), needManage: v.optional(v.boolean()) },
  handler: async (ctx, { communityId, serverId, needManage }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMember(ctx, communityId, me._id);
    const community = await requireCommunity(ctx, communityId);
    if (needManage) await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_GAME_SERVERS);
    const panel = await ctx.db
      .query("gameServerPanels")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .unique();
    let server: Doc<"gameServers"> | null = null;
    let level: Level = "none";
    if (serverId) {
      server = await ctx.db.get(serverId);
      if (!server || server.communityId !== communityId) throw new Error("That server isn't part of this community.");
      level = await levelFor(ctx, community, me._id, server);
    }
    return {
      userId: me._id,
      panel: panel ? { id: panel._id, baseUrl: panel.baseUrl, keyCipher: panel.keyCipher } : null,
      server: server ? { id: server._id, identifier: server.identifier, name: server.name } : null,
      level,
    };
  },
});

export const savePanel = internalMutation({
  args: {
    communityId: v.id("communities"),
    userId: v.id("users"),
    baseUrl: v.string(),
    keyCipher: v.string(),
    keyHint: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("gameServerPanels")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .unique();
    const now = Date.now();
    if (existing) {
      // A new panel is a new set of servers: the old ones' ids mean nothing on it.
      if (existing.baseUrl !== args.baseUrl) {
        for (const s of await ctx.db.query("gameServers").withIndex("by_panel", (q) => q.eq("panelId", existing._id)).collect()) {
          await ctx.db.delete(s._id);
        }
      }
      await ctx.db.patch(existing._id, {
        baseUrl: args.baseUrl,
        keyCipher: args.keyCipher,
        keyHint: args.keyHint,
        connectedBy: args.userId,
        lastOkAt: now,
        lastError: undefined,
      });
      return existing._id;
    }
    return ctx.db.insert("gameServerPanels", {
      communityId: args.communityId,
      baseUrl: args.baseUrl,
      keyCipher: args.keyCipher,
      keyHint: args.keyHint,
      connectedBy: args.userId,
      createdAt: now,
      lastOkAt: now,
    });
  },
});

export const noteHealth = internalMutation({
  args: { panelId: v.id("gameServerPanels"), error: v.optional(v.string()) },
  handler: async (ctx, { panelId, error }) => {
    if (!(await ctx.db.get(panelId))) return;
    await ctx.db.patch(panelId, error ? { lastError: error.slice(0, 200) } : { lastOkAt: Date.now(), lastError: undefined });
  },
});

export const addServerRow = internalMutation({
  args: {
    communityId: v.id("communities"),
    panelId: v.id("gameServerPanels"),
    identifier: v.string(),
    name: v.string(),
    gameId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("gameServers")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();
    if (rows.some((r) => r.identifier === args.identifier)) throw new Error("That server is already added.");
    if (rows.length >= MAX_SERVERS) throw new Error(`A community can show up to ${MAX_SERVERS} servers.`);
    if (args.gameId) {
      const community = await ctx.db.get(args.communityId);
      if (!community?.clanGames?.some((g) => g.id === args.gameId)) throw new Error("That isn't one of the clan's games.");
    }
    return ctx.db.insert("gameServers", {
      ...args,
      // Nobody but managers until a manager says otherwise.
      everyoneLevel: "none",
      roleAccess: [],
      position: rows.length,
      createdAt: Date.now(),
    });
  },
});

export const recordAudit = internalMutation({
  args: {
    communityId: v.id("communities"),
    serverId: v.id("gameServers"),
    userId: v.id("users"),
    action: v.string(),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("gameServerAudit", { ...args, detail: args.detail?.slice(0, 400), createdAt: Date.now() });
  },
});

// --- Managing: the panel and the list ------------------------------------------------------

/** Connect (or reconnect) the community's panel. The key is checked against the
 * panel before anything is stored. */
export const connectPanel = action({
  args: { communityId: v.id("communities"), baseUrl: v.string(), apiKey: v.string() },
  handler: async (ctx, { communityId, baseUrl, apiKey }): Promise<{ ok: true }> => {
    const origin = assertPanelUrl(baseUrl);
    const key = apiKey.trim();
    if (key.startsWith("ptla_")) {
      throw new Error("That's an application (admin) key. Crystal needs a client key, which starts with ptlc_ — make one under Account → API Credentials in the panel.");
    }
    // Only the shape: the panel is the judge of whether it is a real key. Real
    // client keys are about 48 characters, but nothing here depends on that.
    if (!/^[A-Za-z0-9_-]{8,120}$/.test(key)) {
      throw new Error("That doesn't look like an API key. It's a single token with no spaces, like ptlc_…");
    }
    const info: ContextResult = await ctx.runQuery(internal.gameServers.context, { communityId, needManage: true });
    try {
      // Listing is also the proof the key works, and that it is a *client* key —
      // an application (admin) key is refused by this endpoint.
      await panelRequest(origin, key, "/api/client");
    } catch (e) {
      throw new Error(e instanceof PanelError ? e.message : "Couldn't reach the panel.");
    }
    await ctx.runMutation(internal.gameServers.savePanel, {
      communityId,
      userId: info.userId,
      baseUrl: origin,
      keyCipher: await encryptSecret(key),
      keyHint: key.slice(-4),
    });
    return { ok: true as const };
  },
});

export const disconnectPanel = mutation({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_GAME_SERVERS);
    const panel = await ctx.db
      .query("gameServerPanels")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .unique();
    if (!panel) return;
    for (const s of await ctx.db.query("gameServers").withIndex("by_panel", (q) => q.eq("panelId", panel._id)).collect()) {
      await ctx.db.delete(s._id);
    }
    // The key goes with it.
    await ctx.db.delete(panel._id);
  },
});

/** The panel's servers that aren't shown yet, for the "add a server" picker. */
export const discover = action({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }): Promise<PanelServer[]> => {
    const info: ContextResult = await ctx.runQuery(internal.gameServers.context, { communityId, needManage: true });
    if (!info.panel) throw new Error("Connect a panel first.");
    const key = await decryptSecret(info.panel.keyCipher);
    try {
      const all = await listPanelServers(info.panel.baseUrl, key);
      await ctx.runMutation(internal.gameServers.noteHealth, { panelId: info.panel.id });
      const shown: string[] = await ctx.runQuery(internal.gameServers.shownIdentifiers, { communityId });
      return all.filter((s) => !shown.includes(s.identifier));
    } catch (e) {
      const message = e instanceof PanelError ? e.message : "Couldn't reach the panel.";
      await ctx.runMutation(internal.gameServers.noteHealth, { panelId: info.panel.id, error: message });
      throw new Error(message);
    }
  },
});

export const shownIdentifiers = internalQuery({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const rows = await ctx.db
      .query("gameServers")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .collect();
    return rows.map((r) => r.identifier);
  },
});

export const addServer = action({
  args: { communityId: v.id("communities"), identifier: v.string(), gameId: v.optional(v.string()) },
  handler: async (ctx, { communityId, identifier, gameId }): Promise<void> => {
    const info: ContextResult = await ctx.runQuery(internal.gameServers.context, { communityId, needManage: true });
    if (!info.panel) throw new Error("Connect a panel first.");
    const key = await decryptSecret(info.panel.keyCipher);
    // The name comes from the panel, not the caller, and the server has to be one
    // this key can really see.
    const servers = await listPanelServers(info.panel.baseUrl, key).catch((e) => {
      throw new Error(e instanceof PanelError ? e.message : "Couldn't reach the panel.");
    });
    const found = servers.find((s) => s.identifier === identifier);
    if (!found) throw new Error("The panel doesn't list that server for this key.");
    await ctx.runMutation(internal.gameServers.addServerRow, {
      communityId,
      panelId: info.panel.id,
      identifier: found.identifier,
      name: found.name,
      gameId,
    });
  },
});

export const removeServer = mutation({
  args: { serverId: v.id("gameServers") },
  handler: async (ctx, { serverId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const server = await ctx.db.get(serverId);
    if (!server) return;
    const community = await requireCommunity(ctx, server.communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_GAME_SERVERS);
    await ctx.db.delete(serverId);
  },
});

/** Who may do what to a server. A manager's own access can't be taken away: it
 * is not in this list. */
export const setAccess = mutation({
  args: {
    serverId: v.id("gameServers"),
    everyoneLevel: v.union(v.literal("none"), v.literal("view"), v.literal("power")),
    roleAccess: v.array(
      v.object({
        roleId: v.id("roles"),
        level: v.union(v.literal("view"), v.literal("power")),
      }),
    ),
  },
  handler: async (ctx, { serverId, everyoneLevel, roleAccess }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const server = await ctx.db.get(serverId);
    if (!server) throw new Error("That server doesn't exist.");
    const community = await requireCommunity(ctx, server.communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_GAME_SERVERS);

    const seen = new Set<string>();
    const cleaned: typeof roleAccess = [];
    for (const grant of roleAccess) {
      const role = await ctx.db.get(grant.roleId);
      if (!role || role.communityId !== server.communityId) throw new Error("That role isn't in this community.");
      if (seen.has(grant.roleId)) continue;
      seen.add(grant.roleId);
      cleaned.push(grant);
    }
    await ctx.db.patch(serverId, { everyoneLevel, roleAccess: cleaned });
    await ctx.db.insert("gameServerAudit", {
      communityId: server.communityId,
      serverId,
      userId: me._id,
      action: "access.change",
      detail: `everyone: ${everyoneLevel}, ${cleaned.length} role${cleaned.length === 1 ? "" : "s"}`,
      createdAt: Date.now(),
    });
  },
});

/** The most recent things done to the community's servers, for managers. */
export const auditLog = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_GAME_SERVERS);
    const rows = await ctx.db
      .query("gameServerAudit")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .order("desc")
      .take(60);
    return Promise.all(
      rows.map(async (row) => {
        const [user, server] = await Promise.all([ctx.db.get(row.userId), ctx.db.get(row.serverId)]);
        return {
          id: row._id,
          at: row.createdAt,
          action: row.action,
          detail: row.detail,
          who: user?.name ?? "Someone",
          server: server?.name ?? "A removed server",
        };
      }),
    );
  },
});

// --- Using a server ------------------------------------------------------------------------

interface Authorised {
  userId: Id<"users">;
  communityId: Id<"communities">;
  panelId: Id<"gameServerPanels">;
  baseUrl: string;
  key: string;
  server: { id: Id<"gameServers">; identifier: string; name: string };
}

/** Check the caller may do something to a server, and hand back what it takes to do it. */
async function authorise(ctx: ActionCtx, serverId: Id<"gameServers">, need: Level): Promise<Authorised> {
  const communityId: Id<"communities"> = await ctx.runQuery(internal.gameServers.serverCommunity, { serverId });
  const info: ContextResult = await ctx.runQuery(internal.gameServers.context, { communityId, serverId });
  if (!info.panel || !info.server) throw new Error("That server isn't connected.");
  if (RANK[info.level] < RANK[need]) throw new Error("You don't have access to do that.");
  return {
    userId: info.userId,
    communityId,
    panelId: info.panel.id,
    baseUrl: info.panel.baseUrl,
    key: await decryptSecret(info.panel.keyCipher),
    server: info.server,
  };
}

export const serverCommunity = internalQuery({
  args: { serverId: v.id("gameServers") },
  handler: async (ctx, { serverId }) => {
    const server = await ctx.db.get(serverId);
    if (!server) throw new Error("That server doesn't exist.");
    return server.communityId;
  },
});

/** A failure from the panel, as an error a person can read — and a note against the panel. */
async function fail(ctx: ActionCtx, panelId: Id<"gameServerPanels">, e: unknown): Promise<never> {
  const message = e instanceof PanelError ? e.message : "Couldn't reach the panel.";
  // Only a rejected key or an unreachable panel says something about the panel
  // itself; "that server is busy" does not.
  if (!(e instanceof PanelError) || e.status === 0 || e.status === 401 || e.status === 403) {
    await ctx.runMutation(internal.gameServers.noteHealth, { panelId, error: message });
  }
  throw new Error(message);
}

export const resources = action({
  args: { serverId: v.id("gameServers") },
  handler: async (ctx, { serverId }): Promise<PanelResources> => {
    const a = await authorise(ctx, serverId, "view");
    try {
      const r = await getResources(a.baseUrl, a.key, a.server.identifier);
      await ctx.runMutation(internal.gameServers.noteHealth, { panelId: a.panelId });
      return r;
    } catch (e) {
      return fail(ctx, a.panelId, e);
    }
  },
});

export const power = action({
  args: { serverId: v.id("gameServers"), signal: v.union(v.literal("start"), v.literal("stop"), v.literal("restart"), v.literal("kill")) },
  handler: async (ctx, { serverId, signal }): Promise<void> => {
    if (!(SIGNALS as readonly string[]).includes(signal)) throw new Error("That isn't a power action.");
    const a = await authorise(ctx, serverId, "power");
    try {
      await panelRequest(a.baseUrl, a.key, `/api/client/servers/${a.server.identifier}/power`, { method: "POST", body: { signal } });
    } catch (e) {
      return fail(ctx, a.panelId, e);
    }
    await ctx.runMutation(internal.gameServers.recordAudit, {
      communityId: a.communityId,
      serverId,
      userId: a.userId,
      action: `power.${signal}`,
    });
  },
});

// --- What the server says about itself --------------------------------------------------------

/** Set what people are told about a server, and whether everyone is told. */
export const setProfile = mutation({
  args: { serverId: v.id("gameServers"), listed: v.boolean(), profile: v.any() },
  handler: async (ctx, { serverId, listed, profile }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const server = await ctx.db.get(serverId);
    if (!server) throw new Error("That server doesn't exist.");
    const community = await requireCommunity(ctx, server.communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_GAME_SERVERS);
    const cleaned: ServerProfile = normalizeProfile(profile);
    await ctx.db.patch(serverId, { listed, profile: cleaned as never });
    await ctx.db.insert("gameServerAudit", {
      communityId: server.communityId,
      serverId,
      userId: me._id,
      action: "profile.change",
      detail: listed ? "shown to everyone" : "managers only",
      createdAt: Date.now(),
    });
  },
});

/** The server's picture, from an upload the way a community's icon is. */
export const setServerIcon = mutation({
  args: {
    serverId: v.id("gameServers"),
    storageId: v.optional(v.id("_storage")),
    cdnKey: v.optional(v.string()),
    cdnUrl: v.optional(v.string()),
  },
  handler: async (ctx, { serverId, storageId, cdnKey, cdnUrl }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const server = await ctx.db.get(serverId);
    if (!server) throw new Error("That server doesn't exist.");
    const community = await requireCommunity(ctx, server.communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_GAME_SERVERS);

    let url: string | null = null;
    let isR2 = false;
    if (cdnKey) {
      isR2 = true;
      url = r2PublicUrlForKey(cdnKey);
    } else if (cdnUrl) {
      // Only an address on our own CDN: this is shown to every member.
      const base = (process.env.R2_PUBLIC_URL ?? process.env.CDN_URL ?? "").replace(/\/$/, "");
      if (!base || !cdnUrl.startsWith(`${base}/`)) throw new Error("That picture isn't hosted by Crystal.");
      isR2 = true;
      url = cdnUrl;
    } else if (storageId) {
      url = await ctx.storage.getUrl(storageId);
    }
    if (!url) throw new Error("The upload didn't finish.");

    const previousUrl = server.iconUrl;
    const previousStorage = server.iconStorageId;
    await ctx.db.patch(serverId, { iconUrl: url, iconStorageId: storageId });
    if (isR2 && previousUrl) await dropR2Url(ctx, previousUrl);
    else if (previousStorage && previousStorage !== storageId) await ctx.storage.delete(previousStorage).catch(() => {});
  },
});

export const clearServerIcon = mutation({
  args: { serverId: v.id("gameServers") },
  handler: async (ctx, { serverId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const server = await ctx.db.get(serverId);
    if (!server) return;
    const community = await requireCommunity(ctx, server.communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_GAME_SERVERS);
    if (server.iconUrl) await dropR2Url(ctx, server.iconUrl);
    if (server.iconStorageId) await ctx.storage.delete(server.iconStorageId).catch(() => {});
    await ctx.db.patch(serverId, { iconUrl: undefined, iconStorageId: undefined });
  },
});

export const generateIconUploadUrl = mutation({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_GAME_SERVERS);
    return ctx.storage.generateUploadUrl();
  },
});

/** Read a Modrinth link — a modpack, a resource pack — into what the editor needs. */
export const lookupModrinthLink = action({
  args: { communityId: v.id("communities"), url: v.string() },
  handler: async (ctx, { communityId, url }): Promise<ModrinthResult> => {
    await ctx.runQuery(internal.gameServers.context, { communityId, needManage: true });
    return lookupModrinth(url);
  },
});

export interface Detected {
  name?: string;
  description?: string;
  address?: string;
  isMinecraft: boolean;
  gameVersion?: string;
  loader?: string;
  loaderVersion?: string;
}

interface RawServer {
  attributes?: {
    name?: string;
    description?: string;
    egg_features?: string[] | null;
    relationships?: { allocations?: { data?: { attributes?: { ip?: string; ip_alias?: string | null; port?: number; is_default?: boolean } }[] } };
  };
}
interface RawStartup {
  data?: { attributes?: { env_variable?: string; server_value?: string | null; default_value?: string } }[];
}

/**
 * What the panel already knows about a server, to fill the form with: its name and
 * description, the address it listens on, and — for Minecraft — the version and
 * loader its startup variables imply. Best effort: eggs differ, so anything it
 * can't tell is left for the manager.
 */
export const detectFromPanel = action({
  args: { serverId: v.id("gameServers") },
  handler: async (ctx, { serverId }): Promise<Detected> => {
    const communityId: Id<"communities"> = await ctx.runQuery(internal.gameServers.serverCommunity, { serverId });
    const info: ContextResult = await ctx.runQuery(internal.gameServers.context, { communityId, serverId, needManage: true });
    if (!info.panel || !info.server) throw new Error("That server isn't connected.");
    const key = await decryptSecret(info.panel.keyCipher);
    const id = info.server.identifier;
    try {
      const [server, startup] = await Promise.all([
        panelRequest<RawServer>(info.panel.baseUrl, key, `/api/client/servers/${id}`),
        panelRequest<RawStartup>(info.panel.baseUrl, key, `/api/client/servers/${id}/startup`).catch(() => ({ status: 200, data: null })),
      ]);
      const a = server.data?.attributes;
      const env = new Map<string, string>();
      for (const row of startup.data?.data ?? []) {
        const k = row.attributes?.env_variable;
        const val = row.attributes?.server_value ?? row.attributes?.default_value;
        if (k && val) env.set(k, val);
      }
      const alloc = a?.relationships?.allocations?.data?.map((d) => d.attributes).find((x) => x?.is_default) ?? a?.relationships?.allocations?.data?.[0]?.attributes;
      const host = alloc?.ip_alias || alloc?.ip;
      const address = host && alloc?.port ? (alloc.port === 25565 ? host : `${host}:${alloc.port}`) : undefined;

      // The "eula" egg feature is what Minecraft eggs declare.
      const isMinecraft = !!a?.egg_features?.includes("eula") || env.has("MINECRAFT_VERSION") || env.has("MC_VERSION");
      const version = env.get("MINECRAFT_VERSION") ?? env.get("MC_VERSION") ?? env.get("VERSION");
      let loader: string | undefined;
      let loaderVersion: string | undefined;
      for (const [variable, name] of [
        ["NEOFORGE_VERSION", "neoforge"],
        ["FORGE_VERSION", "forge"],
        ["FABRIC_VERSION", "fabric"],
        ["FABRIC_LOADER_VERSION", "fabric"],
        ["QUILT_LOADER_VERSION", "quilt"],
      ] as const) {
        if (env.has(variable)) {
          loader = name;
          loaderVersion = env.get(variable);
          break;
        }
      }
      return {
        name: a?.name,
        description: a?.description || undefined,
        address,
        isMinecraft,
        gameVersion: version && version.toLowerCase() !== "latest" ? version : undefined,
        loader,
        loaderVersion: loaderVersion && loaderVersion.toLowerCase() !== "latest" ? loaderVersion : undefined,
      };
    } catch (e) {
      throw new Error(e instanceof PanelError ? e.message : "Couldn't read the server from the panel.");
    }
  },
});
