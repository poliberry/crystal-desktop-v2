/**
 * VENDORED from poliberry/axiom packages/axiom-bridge/src/index.ts — do not edit here.
 * Update it from the Axiom repo with `npm run bridge:install -- crystal <this convex dir>`.
 */
/**
 * Axiom Bridge — mounted inside each connected system's Convex deployment.
 *
 * It is the only door Axiom has into a system's data, and the system — not
 * Axiom — decides what goes through it:
 *
 * - Deny by default: only tables and fields listed in the policy leave.
 * - Sealing happens here, before a record leaves the deployment:
 *     e2ee    withheld outright. Axiom learns only that the field is present:
 *             no size, no digest, nothing derived from the ciphertext.
 *     secret  replaced by a keyed fingerprint (HMAC under AXIOM_SEAL_KEY, a
 *     pii     key Axiom never holds), so equal values can be correlated
 *             without being guessable — even a date of birth.
 *   A sealed table exposes only ids, timestamps and the reference fields its
 *   policy names.
 * - Writes need an approved change-request ref and the record version the
 *   request was approved against (no stale or lost updates).
 * - Transport (protocol.ts): AES-256-GCM encrypted bodies, HMAC-signed
 *   requests covering operator + change headers, ±60 s timestamps,
 *   single-use nonces, and secret rotation (current + previous).
 *
 * Environment (set on the system's deployment):
 *   AXIOM_BRIDGE_SECRET            shared with Axiom (≥ 32 chars). Unset = bridge off.
 *   AXIOM_BRIDGE_SECRET_PREVIOUS   optional, accepted during rotation.
 *   AXIOM_SEAL_KEY                 system-only (≥ 32 chars). Never give this to Axiom.
 *
 * See README.md for installation.
 */
import type { GenericId } from "convex/values";
import {
  type BridgeKeys,
  decryptJson,
  deriveKeys,
  type Envelope,
  encryptJson,
  hex,
  MAX_SKEW_MS,
  PROTOCOL_VERSION,
  requestContext,
  responseContext,
  verify,
} from "./protocol";

// ── policy ───────────────────────────────────────────────────────────────────

export type SealReason = "e2ee" | "secret" | "pii";

export interface TablePolicy {
  /**
   * Plain fields Axiom may read. Anything not listed here or in `sealed` is
   * dropped before the record leaves (so a field added to the schema later
   * stays private until someone exposes it on purpose).
   */
  fields?: string[];
  /** Fields that never leave the deployment in readable form, and why. */
  sealed?: Record<string, SealReason>;
  /** Seal the whole table: only `_id`, `_creationTime` and `visible` fields are returned. */
  sealTable?: boolean;
  /** For sealed tables: reference fields that stay visible (e.g. `userId`). */
  visible?: string[];
  /** Fields a change request may set. Anything else is refused. */
  writable?: string[];
  insert?: boolean;
  delete?: boolean;
}

export interface BridgePolicy {
  /** Shown in Axiom's System Monitor. */
  version: string;
  tables: Record<string, TablePolicy>;
  /**
   * Optional: mirror Axiom changes into the system's own audit log
   * (e.g. Crystal's staffAuditLog). Runs inside the write mutation.
   */
  onWrite?: (ctx: any, entry: { op: "update" | "insert" | "delete"; table: string; id: string; changeRef: string; operatorSub: string; fields: string[] }) => Promise<void>;
}

/** What a sealed value looks like to Axiom. */
export type Sealed =
  | { $sealed: true; reason: "e2ee"; withheld: true }
  | { $sealed: true; reason: "secret" | "pii" | "table"; fingerprint: string };

// ── helpers ──────────────────────────────────────────────────────────────────

const enc = new TextEncoder();

/** JSON with sorted keys, so a document fingerprints the same however it was built. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object" && !(value instanceof ArrayBuffer)) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  if (value instanceof ArrayBuffer) return JSON.stringify({ $bytes: value.byteLength });
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  return JSON.stringify(value ?? null);
}

/** Convex exposes deployment env vars on the global `process`; read it without needing Node typings. */
function env(name: string): string | undefined {
  return (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
}

let sealKeyCache: { raw: string; key: CryptoKey } | null = null;
async function sealKey(): Promise<CryptoKey> {
  const raw = env("AXIOM_SEAL_KEY") ?? "";
  if (raw.length < 32) throw new BridgeRefusal(503, "Bridge disabled: AXIOM_SEAL_KEY unset or shorter than 32 characters.");
  const cached = sealKeyCache;
  if (cached && cached.raw === raw) return cached.key;
  const key = await crypto.subtle.importKey("raw", enc.encode(raw), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  sealKeyCache = { raw, key };
  return key;
}

/** Keyed digest. Axiom can compare two of these but can't invert or brute-force them. */
async function keyed(domain: string, value: unknown): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await sealKey(), enc.encode(`${domain}\n${canonical(value)}`));
  return hex(sig).slice(0, 32);
}

async function seal(value: unknown, reason: SealReason | "table", field: string): Promise<Sealed> {
  if (reason === "e2ee") return { $sealed: true, reason, withheld: true };
  return { $sealed: true, reason, fingerprint: await keyed(`field:${field}`, value) };
}

/**
 * Version token of a whole stored document, for optimistic concurrency.
 * Keyed, so it reveals nothing about sealed or dropped fields.
 */
export async function versionOf(doc: Record<string, unknown>): Promise<string> {
  return keyed("version", doc);
}

/** What Axiom is allowed to see of a document. */
export async function redact(doc: Record<string, unknown>, policy: TablePolicy) {
  const sealedFields: string[] = [];
  const out: Record<string, unknown> = { _id: doc._id, _creationTime: doc._creationTime };
  if (policy.sealTable) {
    for (const key of policy.visible ?? []) if (key in doc) out[key] = doc[key];
    const rest = Object.fromEntries(Object.entries(doc).filter(([k]) => !(k in out)));
    out.$record = { $sealed: true, reason: "table", fingerprint: await keyed("record", rest) } satisfies Sealed;
    return { record: out, sealedFields: ["*"] };
  }
  const allowed = policy.fields ? new Set(policy.fields) : null;
  for (const [key, value] of Object.entries(doc)) {
    if (key === "_id" || key === "_creationTime") continue;
    const reason = policy.sealed?.[key];
    if (reason) {
      if (value === undefined || value === null) continue;
      out[key] = await seal(value, reason, key);
      sealedFields.push(key);
    } else if (!allowed || allowed.has(key)) {
      out[key] = value;
    }
  }
  return { record: out, sealedFields };
}

function policyFor(policy: BridgePolicy, table: string): TablePolicy {
  const t = policy.tables[table];
  if (!t) throw new BridgeRefusal(403, `Table ${table} is not exposed to Axiom.`);
  return t;
}

function checkPatch(t: TablePolicy, patch: Record<string, unknown>) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new BridgeRefusal(400, "Patch must be an object.");
  const keys = Object.keys(patch);
  if (!keys.length) throw new BridgeRefusal(400, "Empty patch.");
  if (t.sealTable) throw new BridgeRefusal(403, "Sealed table.");
  for (const k of keys) {
    if (k.startsWith("_")) throw new BridgeRefusal(403, `System field ${k} can't be written.`);
    if (t.sealed?.[k]) throw new BridgeRefusal(403, `Field ${k} is sealed.`);
    if (!t.writable?.includes(k)) throw new BridgeRefusal(403, `Field ${k} is not writable.`);
  }
}

export class BridgeRefusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// ── Convex functions ─────────────────────────────────────────────────────────

/** Table to spread into the system's schema: `...axiomBridgeTables(defineTable, v)`. */
export function axiomBridgeTables(defineTable: any, v: typeof import("convex/values").v) {
  return {
    axiomBridgeNonces: defineTable({ nonce: v.string(), at: v.number() }).index("by_nonce", ["nonce"]).index("by_at", ["at"]),
  };
}

/**
 * Definitions of the internal functions the HTTP handler calls. Register each with the system's
 * own builders in `convex/axiom.ts`, exported exactly under these names:
 *
 *   const d = axiomBridgeDefinitions(policy, v);
 *   export const describe = internalQuery(d.describe);
 *   export const list = internalQuery(d.list);
 *   export const get = internalQuery(d.get);
 *   export const consumeNonce = internalMutation(d.consumeNonce);
 *   export const update = internalMutation(d.update);
 *   export const insert = internalMutation(d.insert);
 *   export const remove = internalMutation(d.remove);
 */
export function axiomBridgeDefinitions(policy: BridgePolicy, v: typeof import("convex/values").v) {
  const tableArg = { table: v.string() };

  const describe = {
    args: {},
    handler: async () => {
      await sealKey(); // fail closed if the seal key is missing
      return { version: policy.version, protocol: PROTOCOL_VERSION, tables: Object.keys(policy.tables) };
    },
  };

  const list = {
    args: { ...tableArg, cursor: v.union(v.string(), v.null()), limit: v.number() },
    handler: async (ctx: any, { table, cursor, limit }: { table: string; cursor: string | null; limit: number }) => {
      const t = policyFor(policy, table);
      const res = await ctx.db.query(table).order("desc").paginate({ cursor, numItems: Math.min(Math.max(limit, 1), 200) });
      const page = await Promise.all(res.page.map(async (d: Record<string, unknown>) => (await redact(d, t)).record));
      return { page, continueCursor: res.isDone ? null : res.continueCursor, isDone: res.isDone };
    },
  };

  const get = {
    args: { ...tableArg, id: v.string() },
    handler: async (ctx: any, { table, id }: { table: string; id: string }) => {
      const t = policyFor(policy, table);
      const normalized = ctx.db.normalizeId(table, id);
      if (!normalized) return { record: null, hash: null, sealedFields: [] };
      const doc = await ctx.db.get(normalized);
      if (!doc) return { record: null, hash: null, sealedFields: [] };
      const { record, sealedFields } = await redact(doc, t);
      return { record, hash: await versionOf(doc), sealedFields };
    },
  };

  const consumeNonce = {
    args: { nonce: v.string() },
    handler: async (ctx: any, { nonce }: { nonce: string }) => {
      const seen = await ctx.db
        .query("axiomBridgeNonces")
        .withIndex("by_nonce", (q: any) => q.eq("nonce", nonce))
        .first();
      if (seen) return false;
      const now = Date.now();
      await ctx.db.insert("axiomBridgeNonces", { nonce, at: now });
      // Nonces older than the timestamp window can't be replayed anyway.
      const old = await ctx.db
        .query("axiomBridgeNonces")
        .withIndex("by_at", (q: any) => q.lt("at", now - 5 * MAX_SKEW_MS))
        .take(50);
      for (const row of old) await ctx.db.delete(row._id);
      return true;
    },
  };

  const writeArgs = { ...tableArg, changeRef: v.string(), operatorSub: v.string() };

  const update = {
    args: { ...writeArgs, id: v.string(), patch: v.any(), expectHash: v.optional(v.string()) },
    handler: async (ctx: any, a: { table: string; id: string; patch: Record<string, unknown>; expectHash?: string; changeRef: string; operatorSub: string }) => {
      const t = policyFor(policy, a.table);
      checkPatch(t, a.patch);
      const id = ctx.db.normalizeId(a.table, a.id) as GenericId<string> | null;
      const doc = id && (await ctx.db.get(id));
      if (!doc) throw new BridgeRefusal(404, "Record not found.");
      if (!a.expectHash) throw new BridgeRefusal(400, "Updates must carry the approved record version.");
      if ((await versionOf(doc)) !== a.expectHash) {
        throw new BridgeRefusal(409, "STALE: the record changed after this request was approved. Raise a new request.");
      }
      // `null` in a patch clears an optional field.
      const patch = Object.fromEntries(Object.entries(a.patch).map(([k, val]) => [k, val === null ? undefined : val]));
      await ctx.db.patch(id, patch);
      await policy.onWrite?.(ctx, { op: "update", table: a.table, id: a.id, changeRef: a.changeRef, operatorSub: a.operatorSub, fields: Object.keys(patch) });
      return { id: a.id, hash: await versionOf(await ctx.db.get(id)) };
    },
  };

  const insert = {
    args: { ...writeArgs, doc: v.any() },
    handler: async (ctx: any, a: { table: string; doc: Record<string, unknown>; changeRef: string; operatorSub: string }) => {
      const t = policyFor(policy, a.table);
      if (!t.insert) throw new BridgeRefusal(403, `Inserts into ${a.table} are not allowed.`);
      checkPatch(t, a.doc);
      const id = await ctx.db.insert(a.table, a.doc);
      await policy.onWrite?.(ctx, { op: "insert", table: a.table, id, changeRef: a.changeRef, operatorSub: a.operatorSub, fields: Object.keys(a.doc) });
      return { id, hash: await versionOf(await ctx.db.get(id)) };
    },
  };

  const remove = {
    args: { ...writeArgs, id: v.string(), expectHash: v.optional(v.string()) },
    handler: async (ctx: any, a: { table: string; id: string; expectHash?: string; changeRef: string; operatorSub: string }) => {
      const t = policyFor(policy, a.table);
      if (!t.delete) throw new BridgeRefusal(403, `Deletes from ${a.table} are not allowed.`);
      const id = ctx.db.normalizeId(a.table, a.id);
      const doc = id && (await ctx.db.get(id));
      if (!doc) throw new BridgeRefusal(404, "Record not found.");
      if (!a.expectHash) throw new BridgeRefusal(400, "Deletes must carry the approved record version.");
      if ((await versionOf(doc)) !== a.expectHash) throw new BridgeRefusal(409, "STALE: the record changed after approval.");
      await ctx.db.delete(id);
      await policy.onWrite?.(ctx, { op: "delete", table: a.table, id: a.id, changeRef: a.changeRef, operatorSub: a.operatorSub, fields: [] });
      return { id: a.id };
    },
  };

  return { describe, list, get, consumeNonce, update, insert, remove };
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

const keyCache = new Map<string, Promise<BridgeKeys>>();
function keysFor(secret: string) {
  let k = keyCache.get(secret);
  if (!k) keyCache.set(secret, (k = deriveKeys(secret)));
  return k;
}

const OPS = new Set(["describe", "list", "get", "update", "insert", "delete"]);

/** Unencrypted only before a key is established (bad signature, bridge off). Never contains data. */
const plain = (status: number, error: string) => new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } });

function statusFor(message: string): number {
  if (/STALE/.test(message)) return 409;
  if (/AXIOM_SEAL_KEY/.test(message)) return 503;
  if (/not exposed|sealed|not writable|not allowed|System field|Sealed table/.test(message)) return 403;
  if (/not found/i.test(message)) return 404;
  return 400;
}

/**
 * The HTTP action. Mount it with
 * `http.route({ pathPrefix: "/axiom/v1/", method: "POST", handler: axiomBridgeHttp(httpAction, internal.axiom) })`.
 */
export function axiomBridgeHttp(httpAction: any, fns: Record<string, any>) {
  return httpAction(async (ctx: any, request: Request) => {
    const secrets = [env("AXIOM_BRIDGE_SECRET"), env("AXIOM_BRIDGE_SECRET_PREVIOUS")].filter((s): s is string => !!s && s.length >= 32);
    if (!env("AXIOM_BRIDGE_SECRET") || secrets.length === 0) return plain(503, "Bridge disabled (AXIOM_BRIDGE_SECRET unset or shorter than 32 characters).");

    const op = new URL(request.url).pathname.split("/").pop() ?? "";
    const h = (k: string) => request.headers.get(k) ?? "";
    const [version, ts, nonce, signature, operator, change] = ["x-axiom-version", "x-axiom-timestamp", "x-axiom-nonce", "x-axiom-signature", "x-axiom-operator", "x-axiom-change"].map(h);
    const body = await request.text();

    if (version !== PROTOCOL_VERSION) return plain(426, `Bridge protocol ${PROTOCOL_VERSION} required.`);
    if (!OPS.has(op)) return plain(404, "Unknown operation.");
    if (!ts || !/^[0-9a-f]{32}$/.test(nonce) || !signature || !operator) return plain(401, "Unsigned request.");
    if (Math.abs(Date.now() - Number(ts)) > MAX_SKEW_MS) return plain(401, "Request expired.");
    if (body.length > 1_000_000) return plain(413, "Request too large.");

    const context = requestContext(ts, nonce, op, operator, change);
    let keys: BridgeKeys | null = null;
    for (const s of secrets) {
      const k = await keysFor(s);
      if (await verify(k.macKey, context, body, signature)) {
        keys = k;
        break;
      }
    }
    if (!keys) return plain(401, "Bad signature.");
    if (!(await ctx.runMutation(fns.consumeNonce, { nonce }))) return plain(401, "Replayed request.");

    const reply = async (status: number, value: unknown) =>
      new Response(JSON.stringify(await encryptJson(keys!.encKey, value, responseContext(nonce, status))), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });

    let args: Record<string, unknown>;
    try {
      args = (await decryptJson<Record<string, unknown>>(keys.encKey, JSON.parse(body) as Envelope, context)) ?? {};
    } catch {
      return reply(400, { error: "Body could not be decrypted." });
    }
    const write = op === "update" || op === "insert" || op === "delete";
    if (write && !/^CR-\d{4}-\d+$/.test(change)) return reply(403, { error: "Writes need an approved change request." });

    try {
      const table = String(args.table ?? "");
      switch (op) {
        case "describe":
          return reply(200, await ctx.runQuery(fns.describe, {}));
        case "list":
          return reply(200, await ctx.runQuery(fns.list, { table, cursor: (args.cursor as string) ?? null, limit: Number(args.limit ?? 50) }));
        case "get":
          return reply(200, await ctx.runQuery(fns.get, { table, id: String(args.id) }));
        case "update":
          return reply(200, await ctx.runMutation(fns.update, { table, id: String(args.id), patch: args.patch, expectHash: (args.expectHash as string) ?? undefined, changeRef: change, operatorSub: operator }));
        case "insert":
          return reply(200, await ctx.runMutation(fns.insert, { table, doc: args.doc, changeRef: change, operatorSub: operator }));
        default:
          return reply(200, await ctx.runMutation(fns.remove, { table, id: String(args.id), expectHash: (args.expectHash as string) ?? undefined, changeRef: change, operatorSub: operator }));
      }
    } catch (e) {
      // Errors thrown in queries/mutations arrive as plain Errors; keep only the first line of the message.
      const message = ((e as Error).message ?? "Bridge error").replace(/^[\s\S]*?Uncaught (?:BridgeRefusal|Error): /, "").split("\n")[0];
      return reply(statusFor(message), { error: message });
    }
  });
}

export { PROTOCOL_VERSION };
