/**
 * The server's escrow key (docs/E2EE.md, "Escrow"). Only code that runs in the Node runtime
 * (`"use node"` actions) may call the functions that touch the private half.
 *
 * `E2EE_ESCROW_PUBLIC`  SPKI, base64url. Needed anywhere a room key is wrapped to escrow.
 * `E2EE_ESCROW_PRIVATE` PKCS8, base64url. Needed only to open an escrowed key (migration and onboarding).
 * Generate both with `node scripts/generate-e2ee-escrow.mjs`, then `npx convex env set` each.
 */
import { generateRoomKey, unwrapRoomKey, wrapRoomKey } from "./e2eeCrypto";

export function escrowPublicKey(): string {
  const key = process.env.E2EE_ESCROW_PUBLIC;
  if (!key) throw new Error("E2EE_ESCROW_PUBLIC is not set. Run scripts/generate-e2ee-escrow.mjs.");
  return key;
}

/** Wrap a room key to the escrow public key. Safe in any runtime that has WebCrypto. */
export async function wrapToEscrow(roomKey: Uint8Array<ArrayBuffer>): Promise<string> {
  return wrapRoomKey(roomKey, escrowPublicKey());
}

/** Open a room key the server holds an escrow wrap of. Node actions only. */
export async function unwrapFromEscrow(wrapped: string): Promise<Uint8Array<ArrayBuffer>> {
  const privateKey = process.env.E2EE_ESCROW_PRIVATE;
  if (!privateKey) throw new Error("E2EE_ESCROW_PRIVATE is not set.");
  return unwrapRoomKey(wrapped, privateKey, escrowPublicKey());
}

/** A fresh room key plus its escrow wrap, for a room being migrated. */
export async function newEscrowedRoomKey(): Promise<{ roomKey: Uint8Array<ArrayBuffer>; escrowWrap: string }> {
  const roomKey = generateRoomKey();
  return { roomKey, escrowWrap: await wrapToEscrow(roomKey) };
}
