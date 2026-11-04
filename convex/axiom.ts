/**
 * Axiom Bridge: how Poliberry's Axiom platform reads and changes Crystal records.
 *
 * Axiom calls `/axiom/v1/*` (see http.ts) over protocol v2: AES-256-GCM encrypted bodies, HMAC-signed
 * requests, single-use nonces (axiomBridge/protocol.ts). What it can see and change is decided here,
 * not in Axiom: axiomBridge/policy.ts lists the exposed tables and fields. Message bodies (DMs and
 * channel messages) are withheld outright — Axiom learns only that a message exists, never its
 * content, size or a digest of it. Key material, 2FA, passkeys, OAuth tokens and IP ciphertext are
 * sealed too. Writes only run for a change request independently approved in Axiom, and only if
 * the record is unchanged since approval.
 *
 * Environment: AXIOM_BRIDGE_SECRET (shared with Axiom), AXIOM_SEAL_KEY (Crystal only — never share),
 * optional AXIOM_BRIDGE_SECRET_PREVIOUS during rotation. Unset AXIOM_BRIDGE_SECRET to turn it off.
 */
import { v } from "convex/values";

import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { axiomBridgeDefinitions, type BridgePolicy } from "./axiomBridge/bridge";
import { policy } from "./axiomBridge/policy";
import { audit } from "./lib/staff";

/** The Crystal system account (see systemAccount.ts). Axiom changes are logged under it. */
const SYSTEM_CLERK_ID = "system:crystal";

const crystalPolicy: BridgePolicy = {
  ...policy,
  // Mirror every Axiom change into Crystal's own staff audit log, so the Admin Console shows it
  // next to staff actions. Axiom keeps the full record (who requested, who approved) in its ledger.
  onWrite: async (ctx: MutationCtx, e) => {
    const system = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", SYSTEM_CLERK_ID))
      .unique();
    if (!system) {
      console.warn("[axiom] Crystal system account not provisioned; change not mirrored to staffAuditLog");
      return;
    }
    const what = e.op === "delete" ? "record removed" : `fields: ${e.fields.join(", ")}`;
    await audit(ctx, system._id, `axiom.${e.op}`, { type: e.table, id: e.id }, `${e.changeRef} by ${e.operatorSub} (${what})`);
  },
};

const d = axiomBridgeDefinitions(crystalPolicy, v);
export const describe = internalQuery(d.describe);
export const list = internalQuery(d.list);
export const get = internalQuery(d.get);
export const consumeNonce = internalMutation(d.consumeNonce);
export const update = internalMutation(d.update);
export const insert = internalMutation(d.insert);
export const remove = internalMutation(d.remove);
// The Crystal Moderation app: named Admin Console functions (lib/axiomAdmin.ts).
export { adminRead, adminWrite } from "./lib/axiomAdmin";
