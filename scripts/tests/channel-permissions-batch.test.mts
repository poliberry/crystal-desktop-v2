// Run: bun scripts/tests/channel-permissions-batch.test.mts
// getChannelPermissionsBatch (channel list) must give exactly what getChannelPermissions gives per
// channel, and both must give what the original per-call implementation (kept below as the
// reference) gave. Runs the real functions against an in-memory stand-in for ctx.db.
import { PERMISSIONS as P, NEW_DEFAULT_EVERYONE_FLAGS, getChannelPermissions, getChannelPermissionsBatch, getBasePermissions, effectiveRolePermissions } from "../../convex/permissions";
import { bitsOr, bitsWithout } from "../../convex/lib/permissionBits";

let fails = 0, passes = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? passes++ : fails++; if (!c) console.log("FAIL", n, JSON.stringify(d)); };

type Row = Record<string, any>;
function fakeCtx(tables: Record<string, Row[]>) {
  const reads = { queries: 0, gets: 0 };
  const ctx: any = {
    db: {
      get: async (id: string) => { reads.gets++; for (const rows of Object.values(tables)) { const r = rows.find((x) => x._id === id); if (r) return r; } return null; },
      query: (table: string) => ({
        withIndex: (_name: string, build: (q: any) => any) => {
          const eqs: Array<[string, unknown]> = [];
          const q: any = { eq: (f: string, v: unknown) => { eqs.push([f, v]); return q; } };
          build(q);
          const rows = () => { reads.queries++; return (tables[table] ?? []).filter((r) => eqs.every(([f, v]) => r[f] === v)); };
          return { collect: async () => rows(), unique: async () => { const r = rows(); if (r.length > 1) throw new Error("not unique"); return r[0] ?? null; } };
        },
      }),
    },
  };
  return { ctx, reads };
}

/** The pre-refactor implementation, verbatim apart from the reads going through the fake. */
async function reference(ctx: any, community: Row, channelId: string, userId: string): Promise<number> {
  const base = async () => {
    if (community.ownerId === userId) return ~0;
    const everyoneRole = await ctx.db.query("roles").withIndex("by_community_everyone", (q: any) => q.eq("communityId", community._id).eq("isEveryone", true)).unique();
    const assigned = await ctx.db.query("memberRoles").withIndex("by_member", (q: any) => q.eq("communityId", community._id).eq("userId", userId)).collect();
    const roles = await Promise.all(assigned.map((m: Row) => ctx.db.get(m.roleId)));
    let perms = everyoneRole ? effectiveRolePermissions(everyoneRole) : 0;
    for (const role of roles) if (role) perms = bitsOr(perms, role.permissions);
    return perms;
  };
  const b = await base();
  if (community.ownerId === userId) return b;
  const overwrites: Row[] = await ctx.db.query("channelPermissionOverwrites").withIndex("by_channel", (q: any) => q.eq("channelId", channelId)).collect();
  if (overwrites.length === 0) return b;
  const everyoneRole = await ctx.db.query("roles").withIndex("by_community_everyone", (q: any) => q.eq("communityId", community._id).eq("isEveryone", true)).unique();
  const assigned = await ctx.db.query("memberRoles").withIndex("by_member", (q: any) => q.eq("communityId", community._id).eq("userId", userId)).collect();
  const roleIds = new Set(assigned.map((m: Row) => m.roleId));
  let perms = b;
  const eo = everyoneRole ? overwrites.find((o) => o.roleId === everyoneRole._id) : undefined;
  if (eo) perms = bitsOr(bitsWithout(perms, eo.deny), eo.allow);
  let allow = 0, deny = 0;
  for (const o of overwrites) if (o.roleId && roleIds.has(o.roleId) && o.roleId !== everyoneRole?._id) { allow = bitsOr(allow, o.allow); deny = bitsOr(deny, o.deny); }
  perms = bitsOr(bitsWithout(perms, deny), allow);
  const mo = overwrites.find((o) => o.userId === userId);
  if (mo) perms = bitsOr(bitsWithout(perms, mo.deny), mo.allow);
  return perms;
}

const community = { _id: "c1", ownerId: "owner" };
const roles: Row[] = [
  { _id: "everyone", communityId: "c1", isEveryone: true, permissions: P.VIEW_CHANNELS | P.SEND_MESSAGES | P.CONNECT, permsVersion: 1 },
  { _id: "legacy", communityId: "c2", isEveryone: true, permissions: P.VIEW_CHANNELS | P.SEND_MESSAGES }, // no permsVersion: gets the new defaults
  { _id: "mod", communityId: "c1", isEveryone: false, permissions: P.MANAGE_MESSAGES | P.KICK_MEMBERS },
  { _id: "vip", communityId: "c1", isEveryone: false, permissions: P.ATTACH_FILES },
  { _id: "admin", communityId: "c1", isEveryone: false, permissions: P.ADMINISTRATOR },
];
const memberRoles: Row[] = [
  { communityId: "c1", userId: "mod1", roleId: "mod" },
  { communityId: "c1", userId: "both", roleId: "mod" }, { communityId: "c1", userId: "both", roleId: "vip" },
  { communityId: "c1", userId: "adm", roleId: "admin" },
  { communityId: "c1", userId: "ghost", roleId: "deleted-role" }, // role row is gone
];
const ow = (channelId: string, o: Row) => ({ _id: `${channelId}-${Object.keys(o).join("")}-${o.roleId ?? o.userId}`, channelId, ...o });
const channels = ["open", "readonly", "private", "modonly", "memberdeny", "memberallow", "conflict", "unknownrole", "empty"];
const overwrites: Row[] = [
  ow("readonly", { roleId: "everyone", allow: 0, deny: P.SEND_MESSAGES }),
  ow("private", { roleId: "everyone", allow: 0, deny: P.VIEW_CHANNELS }),
  ow("private", { roleId: "mod", allow: P.VIEW_CHANNELS, deny: 0 }),
  ow("modonly", { roleId: "everyone", allow: 0, deny: P.VIEW_CHANNELS | P.SEND_MESSAGES }),
  ow("modonly", { roleId: "mod", allow: P.VIEW_CHANNELS, deny: 0 }),
  ow("modonly", { roleId: "vip", allow: P.SEND_MESSAGES, deny: 0 }),
  ow("memberdeny", { userId: "mod1", allow: 0, deny: P.VIEW_CHANNELS }),
  ow("memberallow", { roleId: "everyone", allow: 0, deny: P.VIEW_CHANNELS }),
  ow("memberallow", { userId: "plain", allow: P.VIEW_CHANNELS | P.MANAGE_MESSAGES, deny: 0 }),
  // role overwrites union, then the member overwrite wins over both
  ow("conflict", { roleId: "mod", allow: P.SEND_MESSAGES, deny: 0 }),
  ow("conflict", { roleId: "vip", allow: 0, deny: P.SEND_MESSAGES }),
  ow("conflict", { userId: "both", allow: 0, deny: P.ATTACH_FILES }),
  ow("unknownrole", { roleId: "deleted-role", allow: P.MANAGE_CHANNELS, deny: P.VIEW_CHANNELS }),
  ow("open", { userId: "someone-else", allow: P.MANAGE_ROLES, deny: 0 }),
  ow("memberdeny", { roleId: "everyone", allow: P.USE_SOUNDBOARD, deny: 0 }),
];

const users = ["owner", "plain", "mod1", "both", "adm", "ghost", "nobody"];
const { ctx } = fakeCtx({ roles, memberRoles, channelPermissionOverwrites: overwrites });

for (const u of users) {
  const batch = await getChannelPermissionsBatch(ctx, community as any, channels as any, u as any);
  ok(`batch covers every channel for ${u}`, batch.size === channels.length);
  for (const ch of channels) {
    const single = await getChannelPermissions(ctx, community as any, ch as any, u as any);
    const ref = await reference(ctx, community, ch, u);
    ok(`single == reference: ${u} in ${ch}`, single === ref, { single, ref });
    ok(`batch == single: ${u} in ${ch}`, batch.get(ch as any) === single, { batch: batch.get(ch as any), single });
  }
}

// ---- spot checks that the answers are the intended ones, not merely consistent
const at = async (u: string, ch: string) => (await getChannelPermissionsBatch(ctx, community as any, channels as any, u as any)).get(ch as any)!;
const has = (set: number, flag: number) => (set & flag) !== 0;
ok("owner: everything everywhere", (await at("owner", "private")) === ~0);
ok("plain member can send in an open channel", has(await at("plain", "open"), P.SEND_MESSAGES));
ok("@everyone overwrite makes a channel read-only", !has(await at("plain", "readonly"), P.SEND_MESSAGES) && has(await at("plain", "readonly"), P.VIEW_CHANNELS));
ok("private channel hides it from a plain member", !has(await at("plain", "private"), P.VIEW_CHANNELS));
ok("role overwrite re-allows view for a mod", has(await at("mod1", "private"), P.VIEW_CHANNELS));
ok("member overwrite beats role/@everyone", has(await at("plain", "memberallow"), P.VIEW_CHANNELS | P.MANAGE_MESSAGES));
ok("member deny beats role allow", !has(await at("mod1", "memberdeny"), P.VIEW_CHANNELS));
ok("role allow wins over role deny from another role (merged)", has(await at("both", "conflict"), P.SEND_MESSAGES));
ok("member deny beats the merged role result", !has(await at("both", "conflict"), P.ATTACH_FILES));
ok("administrator keeps ADMINISTRATOR even where overwrites strip other bits (callers check it via can())", has(await at("adm", "private"), P.ADMINISTRATOR) && !has(await at("adm", "private"), P.VIEW_CHANNELS));
// A member row pointing at a role that's gone still counts as "assigned" for overwrites (as it always did).
ok("overwrite for a still-assigned but deleted role keeps applying", !has(await at("ghost", "unknownrole"), P.VIEW_CHANNELS) && has(await at("ghost", "unknownrole"), P.MANAGE_CHANNELS));
ok("a user with no roles gets @everyone only", (await at("nobody", "open")) === (P.VIEW_CHANNELS | P.SEND_MESSAGES | P.CONNECT));

// ---- legacy @everyone (no permsVersion) is read as holding the new defaults, in both paths
{
  const legacyCommunity = { _id: "c2", ownerId: "owner" };
  const t = fakeCtx({ roles, memberRoles: [], channelPermissionOverwrites: [] });
  const single = await getChannelPermissions(t.ctx, legacyCommunity as any, "x" as any, "plain" as any);
  const batch = await getChannelPermissionsBatch(t.ctx, legacyCommunity as any, ["x"] as any, "plain" as any);
  const base = await getBasePermissions(t.ctx, legacyCommunity as any, "plain" as any);
  ok("legacy @everyone: batch == single == base", single === batch.get("x" as any) && single === base);
  ok("legacy @everyone includes the new defaults", has(single, P.ATTACH_FILES) && has(single, P.ADD_REACTIONS) && NEW_DEFAULT_EVERYONE_FLAGS !== 0);
}

// ---- community without an @everyone role at all
{
  const t = fakeCtx({ roles: [], memberRoles, channelPermissionOverwrites: overwrites });
  const batch = await getChannelPermissionsBatch(t.ctx, community as any, channels as any, "both" as any);
  for (const ch of channels) ok(`no @everyone role: batch == single (${ch})`, batch.get(ch as any) === (await getChannelPermissions(t.ctx, community as any, ch as any, "both" as any)));
}

// ---- the point: reads do not grow with the number of channels the way they did
{
  const many = Array.from({ length: 40 }, (_, i) => `ch${i}`);
  const single = fakeCtx({ roles, memberRoles, channelPermissionOverwrites: overwrites });
  for (const ch of many) await getChannelPermissions(single.ctx, community as any, ch as any, "both" as any);
  const batch = fakeCtx({ roles, memberRoles, channelPermissionOverwrites: overwrites });
  await getChannelPermissionsBatch(batch.ctx, community as any, many as any, "both" as any);
  const s = single.reads.queries + single.reads.gets, b = batch.reads.queries + batch.reads.gets;
  ok(`batch reads far less than per-channel calls (${b} vs ${s})`, b < s / 2, { b, s });
  const empty = await getChannelPermissionsBatch(batch.ctx, community as any, [] as any, "both" as any);
  ok("empty channel list", empty.size === 0);
}

console.log(fails ? `${fails} FAILED, ${passes} passed` : `ALL PASSED (${passes})`);
process.exit(fails ? 1 : 0);
