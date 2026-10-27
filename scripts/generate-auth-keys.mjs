#!/usr/bin/env node
/**
 * Makes the signing key a Convex deployment needs for sign-in, and prints the `npx convex env set`
 * commands to install it. Run once per deployment (dev and production each need their own):
 *
 *   bun run auth:keys
 *   bun run auth:keys -- --prod
 *
 * Nothing is written anywhere: the private key is printed once, for you to put into the
 * deployment, and not kept. Making a new one signs everyone out (their sessions' tokens were signed
 * by the old key), so only do it again if the key leaks.
 */
import { randomBytes } from "node:crypto";
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

const prod = process.argv.includes("--prod");
const flag = prod ? " --prod" : "";

const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
const pkcs8 = (await exportPKCS8(privateKey)).trimEnd().replace(/\n/g, " ");
const jwks = JSON.stringify({ keys: [{ use: "sig", ...(await exportJWK(publicKey)) }] });
const codeSecret = randomBytes(32).toString("base64");

const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;

console.log(`# Run these against the ${prod ? "PRODUCTION" : "development"} deployment.\n`);
console.log(`npx convex env set${flag} JWT_PRIVATE_KEY -- ${q(pkcs8)}`);
console.log(`npx convex env set${flag} JWKS -- ${q(jwks)}`);
console.log(`npx convex env set${flag} AUTH_CODE_SECRET -- ${q(codeSecret)}`);
console.log(`
# Also needed (see docs/AUTH.md):
#   RESEND_API_KEY, AUTH_EMAIL_FROM        to email sign-in codes
#   WEBAUTHN_ORIGINS                       only if the app runs somewhere other than usecrystal.app / crystal.localhost / localhost:3000
#   CLERK_SECRET_KEY                       only for the one-off email backfill
#   CLERK_MIGRATION_TOKEN                  random one-time gate for that backfill (see docs/AUTH.md)`);
