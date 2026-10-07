import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import {
  CAPABILITIES,
  EXTENSION_LIMITS,
  hasBlocking,
  normalizeManifest,
  scanSource,
  sourceHash,
  type Capability,
} from "./lib/extensionManifest";
import { assertPanelUrl } from "./lib/panelClient";
import { audit, getStaff, requireStaff } from "./lib/staff";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";

/**
 * Running other people's code inside Crystal — the server's half.
 *
 * See docs/EXTENSIONS.md for the whole model. What is here: who may publish, review,
 * install and revoke; an extension's private storage; and the one door it has to the
 * internet. The code itself runs on the person's own device, in a sandbox, and never
 * on a server of ours.
 *
 * Publishing is for staff until `EXTENSIONS_PUBLIC` is set on the deployment, which
 * is meant to happen only after the sandbox has been reviewed by people other than
 * its author.
 */

const MAX_PENDING_PER_EXTENSION = 3;
const HTTP_PER_MINUTE = 30;
const HTTP_TIMEOUT_MS = 8000;
const HTTP_MAX_BODY = 512 * 1024;
const HTTP_MAX_REQUEST_BODY = 64 * 1024;
const MAX_REDIRECTS = 3;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
/** Request headers an extension may set. Cookies and the like are never sent. */
const ALLOWED_HEADERS = new Set(["accept", "accept-language", "content-type", "authorization", "x-api-key"]);

const isCapability = (c: string): c is Capability => (CAPABILITIES as readonly string[]).includes(c);

// --- Who may publish ---------------------------------------------------------------------

async function canPublish(ctx: QueryCtx): Promise<boolean> {
  if (process.env.EXTENSIONS_PUBLIC === "1") return !!(await getCurrentUserOrNull(ctx));
  const staff = await getStaff(ctx);
  return !!staff && staff.roles.some((r) => r === "owner" || r === "admin");
}

export const publishingAllowed = query({
  args: {},
  handler: async (ctx) => ({ allowed: await canPublish(ctx), open: process.env.EXTENSIONS_PUBLIC === "1" }),
});

// --- Submitting --------------------------------------------------------------------------

/** Send a version for review. What is stored is rebuilt here from what was sent. */
export const submitVersion = mutation({
  args: { slug: v.string(), manifest: v.any(), source: v.string() },
  handler: async (ctx, { slug, manifest: rawManifest, source }): Promise<Id<"extensionVersions">> => {
    const me = await getCurrentUserOrThrow(ctx);
    if (!(await canPublish(ctx))) throw new Error("Publishing extensions isn't open yet.");
    if (!SLUG.test(slug) || slug.length > 40) throw new Error("The id can use lowercase letters, numbers and hyphens.");
    const manifest = normalizeManifest(rawManifest);

    // The same scan Studio ran while the author wrote: this is the one that counts.
    const findings = scanSource(source, manifest);
    if (hasBlocking(findings)) throw new Error(findings.find((f) => f.level === "error")!.message);

    let extension = await ctx.db.query("extensions").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
    const now = Date.now();
    if (extension && extension.publisherId !== me._id) throw new Error("That id belongs to someone else.");
    if (extension?.suspendedAt) throw new Error("This extension has been suspended.");
    if (!extension) {
      const id = await ctx.db.insert("extensions", { slug, publisherId: me._id, name: manifest.name, description: manifest.description, kind: manifest.kind, createdAt: now, updatedAt: now });
      extension = (await ctx.db.get(id))!;
    }

    const versions = await ctx.db.query("extensionVersions").withIndex("by_extension", (q) => q.eq("extensionId", extension!._id)).collect();
    if (versions.some((x) => x.version === manifest.version)) throw new Error(`Version ${manifest.version} already exists — a change is a new version.`);
    if (versions.filter((x) => x.status === "pending").length >= MAX_PENDING_PER_EXTENSION) throw new Error("Wait for the versions already waiting to be reviewed.");

    await ctx.db.patch(extension._id, { name: manifest.name, description: manifest.description, kind: manifest.kind, updatedAt: now });
    return ctx.db.insert("extensionVersions", {
      extensionId: extension._id,
      version: manifest.version,
      manifest,
      source,
      hash: await sourceHash(source),
      status: "pending",
      findings: findings.map((f) => ({ level: f.level, message: f.message })),
      createdAt: now,
    });
  },
});

/** The caller's own extensions and where each version stands. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const rows = await ctx.db.query("extensions").withIndex("by_publisher", (q) => q.eq("publisherId", me._id)).collect();
    return Promise.all(
      rows.map(async (e) => ({
        id: e._id,
        slug: e.slug,
        name: e.name,
        suspended: e.suspendedAt !== undefined,
        versions: (await ctx.db.query("extensionVersions").withIndex("by_extension", (q) => q.eq("extensionId", e._id)).order("desc").take(20)).map((x) => ({
          id: x._id,
          version: x.version,
          status: x.status,
          reviewNote: x.reviewNote,
          createdAt: x.createdAt,
        })),
      })),
    );
  },
});

// --- Review ------------------------------------------------------------------------------

export const adminList = query({
  args: { status: v.optional(v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected"), v.literal("revoked"))) },
  handler: async (ctx, { status }) => {
    await requireStaff(ctx, "system.manage");
    const rows = status
      ? await ctx.db.query("extensionVersions").withIndex("by_status", (q) => q.eq("status", status)).order("desc").take(100)
      : await ctx.db.query("extensionVersions").order("desc").take(100);
    return Promise.all(
      rows.map(async (x) => {
        const e = await ctx.db.get(x.extensionId);
        const p = e ? await ctx.db.get(e.publisherId) : null;
        return {
          id: x._id,
          extensionId: x.extensionId,
          name: x.manifest.name,
          slug: e?.slug ?? "?",
          version: x.version,
          status: x.status,
          publisher: p?.username ?? "unknown",
          capabilities: x.manifest.capabilities,
          errors: x.findings.filter((f) => f.level === "error").length,
          warnings: x.findings.filter((f) => f.level === "warning").length,
          createdAt: x.createdAt,
          suspended: e?.suspendedAt !== undefined,
        };
      }),
    );
  },
});

/** Everything a reviewer reads: the code, character for character, and what was found. */
export const adminVersion = query({
  args: { versionId: v.id("extensionVersions") },
  handler: async (ctx, { versionId }) => {
    await requireStaff(ctx, "system.manage");
    const x = await ctx.db.get(versionId);
    if (!x) return null;
    const e = await ctx.db.get(x.extensionId);
    const p = e ? await ctx.db.get(e.publisherId) : null;
    const installs = await ctx.db.query("extensionInstalls").withIndex("by_extension", (q) => q.eq("extensionId", x.extensionId)).take(500);
    return {
      id: x._id,
      extensionId: x.extensionId,
      slug: e?.slug ?? "?",
      suspended: e?.suspendedAt !== undefined,
      suspendedReason: e?.suspendedReason,
      publisher: p ? { id: p._id, username: p.username, name: p.name } : null,
      version: x.version,
      manifest: x.manifest,
      source: x.source,
      hash: x.hash,
      status: x.status,
      findings: x.findings,
      reviewNote: x.reviewNote,
      createdAt: x.createdAt,
      installs: installs.filter((i) => i.versionId === x._id).length,
    };
  },
});

export const adminReview = mutation({
  args: { versionId: v.id("extensionVersions"), approve: v.boolean(), note: v.string() },
  handler: async (ctx, { versionId, approve, note }) => {
    const staff = await requireStaff(ctx, "system.manage");
    const x = await ctx.db.get(versionId);
    if (!x || x.status !== "pending") throw new Error("That version isn't waiting for review.");
    const e = (await ctx.db.get(x.extensionId))!;
    const reason = note.trim().slice(0, 500);
    if (!approve && reason.length < 3) throw new Error("Tell the author why, so they can fix it.");
    // Whoever wrote it shouldn't be the only one who read it. Off by default only
    // because a deployment can have one staff member; turn it on as soon as it has two.
    if (approve && process.env.EXTENSIONS_REQUIRE_SECOND_REVIEWER === "1" && e.publisherId === staff.user._id) {
      throw new Error("Someone other than the author has to approve this.");
    }
    if (approve && hasBlocking(x.findings.map((f) => ({ level: f.level as "error", message: f.message })))) {
      throw new Error("This has blocking findings and can't be approved.");
    }
    // Checked again: what is about to be approved is what is stored, hash and all.
    if ((await sourceHash(x.source)) !== x.hash) throw new Error("The stored code doesn't match its hash. Don't approve this.");
    await ctx.db.patch(versionId, { status: approve ? "approved" : "rejected", reviewNote: reason || undefined, reviewedBy: staff.user._id, reviewedAt: Date.now() });
    await audit(ctx, staff.user._id, approve ? "extension.approve" : "extension.reject", { type: "extensionVersion", id: versionId }, `${e.slug}@${x.version} (${x.hash.slice(0, 12)})${reason ? ` — ${reason}` : ""}`);
  },
});

/** Stop one version for everyone who has it, from now. Their client stops it as soon as it hears. */
export const adminRevokeVersion = mutation({
  args: { versionId: v.id("extensionVersions"), reason: v.string() },
  handler: async (ctx, { versionId, reason }) => {
    const staff = await requireStaff(ctx, "system.manage");
    const x = await ctx.db.get(versionId);
    if (!x) throw new Error("That version doesn't exist.");
    const why = reason.trim().slice(0, 500);
    if (why.length < 3) throw new Error("Say why — it goes in the audit log.");
    await ctx.db.patch(versionId, { status: "revoked", reviewNote: why, reviewedBy: staff.user._id, reviewedAt: Date.now() });
    const e = await ctx.db.get(x.extensionId);
    await audit(ctx, staff.user._id, "extension.revoke", { type: "extensionVersion", id: versionId }, `${e?.slug}@${x.version} — ${why}`);
  },
});

/** Stop an extension entirely, every version, and keep it stopped. */
export const adminSetSuspended = mutation({
  args: { extensionId: v.id("extensions"), suspended: v.boolean(), reason: v.optional(v.string()) },
  handler: async (ctx, { extensionId, suspended, reason }) => {
    const staff = await requireStaff(ctx, "system.manage");
    const e = await ctx.db.get(extensionId);
    if (!e) throw new Error("That extension doesn't exist.");
    if (suspended && (reason?.trim().length ?? 0) < 3) throw new Error("Say why — it goes in the audit log.");
    await ctx.db.patch(extensionId, { suspendedAt: suspended ? Date.now() : undefined, suspendedReason: suspended ? reason!.trim().slice(0, 500) : undefined });
    await audit(ctx, staff.user._id, suspended ? "extension.suspend" : "extension.unsuspend", { type: "extension", id: extensionId }, `${e.slug}${reason ? ` — ${reason}` : ""}`);
  },
});

// --- Finding and installing ----------------------------------------------------------------

async function latestApproved(ctx: QueryCtx, extensionId: Id<"extensions">): Promise<Doc<"extensionVersions"> | null> {
  const rows = await ctx.db.query("extensionVersions").withIndex("by_extension", (q) => q.eq("extensionId", extensionId)).order("desc").take(30);
  return rows.find((r) => r.status === "approved") ?? null;
}

/** What can be installed: extensions with an approved version that aren't suspended. */
export const directory = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const approved = await ctx.db.query("extensionVersions").withIndex("by_status", (q) => q.eq("status", "approved")).order("desc").take(200);
    const seen = new Set<string>();
    const out = [];
    for (const x of approved) {
      if (seen.has(x.extensionId)) continue;
      seen.add(x.extensionId);
      const e = await ctx.db.get(x.extensionId);
      if (!e || e.suspendedAt) continue;
      const p = await ctx.db.get(e.publisherId);
      const install = await ctx.db.query("extensionInstalls").withIndex("by_user_extension", (q) => q.eq("userId", me._id).eq("extensionId", e._id)).unique();
      out.push({
        extensionId: e._id,
        versionId: x._id,
        slug: e.slug,
        name: x.manifest.name,
        description: x.manifest.description,
        version: x.version,
        kind: x.manifest.kind,
        capabilities: x.manifest.capabilities,
        network: x.manifest.network,
        publisher: p?.name ?? "Unknown",
        installed: install ? { versionId: install.versionId, granted: install.granted, current: install.versionId === x._id } : null,
      });
    }
    return out;
  },
});

/** Turn an extension on, or move to its newest version, with the powers the person agreed to. */
export const install = mutation({
  args: { versionId: v.id("extensionVersions"), granted: v.array(v.string()) },
  handler: async (ctx, { versionId, granted }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const version = await ctx.db.get(versionId);
    if (!version || version.status !== "approved") throw new Error("That version isn't available.");
    const extension = await ctx.db.get(version.extensionId);
    if (!extension || extension.suspendedAt) throw new Error("That extension isn't available.");
    const latest = await latestApproved(ctx, extension._id);
    if (latest?._id !== versionId) throw new Error("There's a newer version — install that one.");
    // Only powers the extension asked for, and each only once.
    const clean = [...new Set(granted)].filter(isCapability).filter((c) => version.manifest.capabilities.includes(c));
    const existing = await ctx.db.query("extensionInstalls").withIndex("by_user_extension", (q) => q.eq("userId", me._id).eq("extensionId", extension._id)).unique();
    if (existing) await ctx.db.patch(existing._id, { versionId, granted: clean, installedAt: Date.now() });
    else {
      const count = (await ctx.db.query("extensionInstalls").withIndex("by_user", (q) => q.eq("userId", me._id)).collect()).length;
      if (count >= 20) throw new Error("That's a lot of extensions. Remove one first.");
      await ctx.db.insert("extensionInstalls", { userId: me._id, extensionId: extension._id, versionId, granted: clean, installedAt: Date.now() });
    }
  },
});

/** Turn it off, and forget everything it had saved. */
export const uninstall = mutation({
  args: { extensionId: v.id("extensions") },
  handler: async (ctx, { extensionId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const existing = await ctx.db.query("extensionInstalls").withIndex("by_user_extension", (q) => q.eq("userId", me._id).eq("extensionId", extensionId)).unique();
    if (existing) await ctx.db.delete(existing._id);
    for (const row of await ctx.db.query("extensionStorage").withIndex("by_user_extension", (q) => q.eq("userId", me._id).eq("extensionId", extensionId)).collect()) {
      await ctx.db.delete(row._id);
    }
  },
});

/**
 * What this client should be running: each install whose version is still approved
 * and whose extension isn't suspended, with the code and the hash to check it by.
 *
 * Live, so revoking something stops it on the next push rather than the next launch:
 * the row simply disappears from this list and the client tears the sandbox down.
 */
export const myInstalled = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const installs = await ctx.db.query("extensionInstalls").withIndex("by_user", (q) => q.eq("userId", me._id)).collect();
    const out = [];
    for (const i of installs) {
      const [version, extension] = await Promise.all([ctx.db.get(i.versionId), ctx.db.get(i.extensionId)]);
      if (!version || version.status !== "approved" || !extension || extension.suspendedAt) continue;
      const latest = await latestApproved(ctx, extension._id);
      out.push({
        extensionId: extension._id,
        slug: extension.slug,
        name: version.manifest.name,
        version: version.version,
        manifest: version.manifest,
        source: version.source,
        hash: version.hash,
        granted: i.granted,
        updateAvailable: latest && latest._id !== version._id ? latest.version : null,
      });
    }
    return out;
  },
});

// --- Private storage -----------------------------------------------------------------------

/** The install this call is for, or an error: the person has it, with this power, and it is still allowed to run. */
async function requireInstall(ctx: QueryCtx, extensionId: Id<"extensions">, power: Capability) {
  const me = await getCurrentUserOrThrow(ctx);
  const install = await ctx.db.query("extensionInstalls").withIndex("by_user_extension", (q) => q.eq("userId", me._id).eq("extensionId", extensionId)).unique();
  if (!install) throw new Error("That extension isn't installed.");
  const [version, extension] = await Promise.all([ctx.db.get(install.versionId), ctx.db.get(extensionId)]);
  if (!version || version.status !== "approved" || !extension || extension.suspendedAt) throw new Error("That extension has been stopped.");
  if (!install.granted.includes(power)) throw new Error(`That extension hasn't been given the power to do that.`);
  return { me, install, version, extension };
}

export const storageGet = query({
  args: { extensionId: v.id("extensions"), key: v.string() },
  handler: async (ctx, { extensionId, key }) => {
    const { me } = await requireInstall(ctx, extensionId, "storage");
    const row = await ctx.db.query("extensionStorage").withIndex("by_user_extension_key", (q) => q.eq("userId", me._id).eq("extensionId", extensionId).eq("key", key)).unique();
    return row?.value ?? null;
  },
});

export const storageList = query({
  args: { extensionId: v.id("extensions") },
  handler: async (ctx, { extensionId }) => {
    const { me } = await requireInstall(ctx, extensionId, "storage");
    return (await ctx.db.query("extensionStorage").withIndex("by_user_extension", (q) => q.eq("userId", me._id).eq("extensionId", extensionId)).take(EXTENSION_LIMITS.storageKeys)).map((r) => r.key);
  },
});

export const storageSet = mutation({
  args: { extensionId: v.id("extensions"), key: v.string(), value: v.string() },
  handler: async (ctx, { extensionId, key, value }) => {
    const { me } = await requireInstall(ctx, extensionId, "storage");
    if (!key || key.length > EXTENSION_LIMITS.storageKey) throw new Error(`A key is 1–${EXTENSION_LIMITS.storageKey} characters.`);
    const bytes = new TextEncoder().encode(value).length;
    if (bytes > EXTENSION_LIMITS.storageValue) throw new Error(`A value can be up to ${EXTENSION_LIMITS.storageValue / 1024} KB.`);
    const rows = await ctx.db.query("extensionStorage").withIndex("by_user_extension", (q) => q.eq("userId", me._id).eq("extensionId", extensionId)).collect();
    const existing = rows.find((r) => r.key === key);
    const total = rows.reduce((n, r) => n + (r.key === key ? 0 : r.key.length + r.value.length), 0) + key.length + value.length;
    if (!existing && rows.length >= EXTENSION_LIMITS.storageKeys) throw new Error("That's too many saved items.");
    if (total > EXTENSION_LIMITS.storageTotal) throw new Error("Out of storage room.");
    if (existing) await ctx.db.patch(existing._id, { value });
    else await ctx.db.insert("extensionStorage", { userId: me._id, extensionId, key, value });
  },
});

export const storageDelete = mutation({
  args: { extensionId: v.id("extensions"), key: v.string() },
  handler: async (ctx, { extensionId, key }) => {
    const { me } = await requireInstall(ctx, extensionId, "storage");
    const row = await ctx.db.query("extensionStorage").withIndex("by_user_extension_key", (q) => q.eq("userId", me._id).eq("extensionId", extensionId).eq("key", key)).unique();
    if (row) await ctx.db.delete(row._id);
  },
});

// --- The one door to the internet ------------------------------------------------------------

/** Checked and counted before a request is made: the person has it, with the network power, to this site, and not too often. */
export const httpGate = internalMutation({
  args: { extensionId: v.id("extensions") },
  handler: async (ctx: MutationCtx, { extensionId }): Promise<{ origins: string[] }> => {
    const { me, version } = await requireInstall(ctx, extensionId, "network");
    const since = Date.now() - 60_000;
    const recent = await ctx.db.query("extensionHttpLog").withIndex("by_user_extension_at", (q) => q.eq("userId", me._id).eq("extensionId", extensionId).gt("at", since)).collect();
    if (recent.length >= HTTP_PER_MINUTE) throw new Error("That extension is making requests too quickly.");
    await ctx.db.insert("extensionHttpLog", { userId: me._id, extensionId, at: Date.now() });
    // Old rows are swept as they are noticed, so the log stays the size of a minute.
    for (const old of await ctx.db.query("extensionHttpLog").withIndex("by_user_extension_at", (q) => q.eq("userId", me._id).eq("extensionId", extensionId).lt("at", since)).take(50)) {
      await ctx.db.delete(old._id);
    }
    return { origins: version.manifest.network };
  },
});

async function readCapped(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new Error("The response was too large.");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/**
 * A request on an extension's behalf — only to the sites its manifest lists, which the
 * person was shown and agreed to.
 *
 * Made from here, not from the person's device, for two reasons: so the extension
 * never learns anything about the device it runs on, and so that every request passes
 * through checks the extension can't edit. Redirects are followed only while they stay
 * on the list, nothing but a handful of headers is sent (no cookies, ever), and the
 * response is read up to a limit and no further.
 */
export const http = action({
  args: {
    extensionId: v.id("extensions"),
    url: v.string(),
    method: v.optional(v.string()),
    headers: v.optional(v.record(v.string(), v.string())),
    body: v.optional(v.string()),
  },
  handler: async (ctx, { extensionId, url, method, headers, body }): Promise<{ status: number; contentType: string; body: string }> => {
    const gate: { origins: string[] } = await ctx.runMutation(internal.extensions.httpGate, { extensionId });
    const allowed = new Set(gate.origins);
    const verb = (method ?? "GET").toUpperCase();
    if (!METHODS.includes(verb)) throw new Error("That isn't a request method.");
    if (body !== undefined && new TextEncoder().encode(body).length > HTTP_MAX_REQUEST_BODY) throw new Error("The request is too large.");
    if (body !== undefined && (verb === "GET" || verb === "DELETE")) throw new Error(`${verb} requests have no body.`);

    const outHeaders: Record<string, string> = { "User-Agent": "Crystal-Extension/1.0 (+https://usecrystal.app)" };
    const entries = Object.entries(headers ?? {});
    if (entries.length > 10) throw new Error("Too many headers.");
    for (const [k, val] of entries) {
      const name = k.toLowerCase();
      if (!ALLOWED_HEADERS.has(name)) throw new Error(`The “${k}” header can't be set.`);
      if (val.length > 1000 || /[\r\n]/.test(val)) throw new Error("A header value is invalid.");
      outHeaders[name] = val;
    }

    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const origin = assertPanelUrl(current);
      if (!allowed.has(origin)) throw new Error(`This extension isn't allowed to talk to ${new URL(origin).hostname}.`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
      try {
        const res = await fetch(current, { method: hop === 0 ? verb : "GET", headers: outHeaders, body: hop === 0 ? body : undefined, redirect: "manual", signal: controller.signal });
        if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
          current = new URL(res.headers.get("location")!, current).href;
          // A redirect to somewhere else on the list is fine; anywhere else is caught at the top of the loop.
          continue;
        }
        const text = await readCapped(res, HTTP_MAX_BODY);
        return { status: res.status, contentType: (res.headers.get("content-type") ?? "").slice(0, 100), body: text };
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") throw new Error("The site took too long to answer.");
        throw e instanceof Error && !/fetch failed/i.test(e.message) ? e : new Error("Couldn't reach the site.");
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error("Too many redirects.");
  },
});
