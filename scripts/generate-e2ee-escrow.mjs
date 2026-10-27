#!/usr/bin/env node
/**
 * Prints the two env vars for the server's E2EE escrow key (docs/E2EE.md). Nothing is written to
 * disk or sent anywhere. Set them on the deployment you intend to migrate:
 *
 *   node scripts/generate-e2ee-escrow.mjs
 *   npx convex env set E2EE_ESCROW_PUBLIC  <value>
 *   npx convex env set E2EE_ESCROW_PRIVATE <value>
 *
 * Use a different key per deployment. Whoever holds E2EE_ESCROW_PRIVATE can read every room that is
 * still escrowed, so treat it like CREDENTIALS_ENCRYPTION_KEY.
 */
import { webcrypto } from "node:crypto";

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const pair = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
console.log(`E2EE_ESCROW_PUBLIC=${b64u(await webcrypto.subtle.exportKey("spki", pair.publicKey))}`);
console.log(`E2EE_ESCROW_PRIVATE=${b64u(await webcrypto.subtle.exportKey("pkcs8", pair.privateKey))}`);
