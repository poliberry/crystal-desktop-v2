#!/usr/bin/env bun
/**
 * Mint a short-lived LiveKit join token from the CLI.
 *
 * Reads LIVEKIT_API_KEY / LIVEKIT_API_SECRET / LIVEKIT_URL from the
 * environment (or a .env / .env.local file in the project root).
 *
 * Usage:
 *   bun run token -- --room my-room --identity alice
 *   bun run token -- --room my-room --identity alice --url wss://host
 *
 * Prints the JWT to stdout. Paste it into the connect form in the app.
 */
import "dotenv/config";
import { AccessToken } from "livekit-server-sdk";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "") ?? "";
    args[key] = argv[i + 1] ?? "";
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

const apiKey = args["api-key"] ?? process.env.LIVEKIT_API_KEY;
const apiSecret = args["api-secret"] ?? process.env.LIVEKIT_API_SECRET;
const url = args["url"] ?? process.env.LIVEKIT_URL;
const room = args["room"];
const identity = args["identity"];

if (!apiKey || !apiSecret || !room || !identity) {
  console.error(
    [
      "Missing arguments.",
      "Required: --room <name> --identity <name>",
      "Optional: --url <wss://...> --api-key --api-secret",
      "Also reads LIVEKIT_API_KEY / LIVEKIT_API_SECRET / LIVEKIT_URL from env.",
    ].join("\n")
  );
  process.exit(1);
}

const at = new AccessToken(apiKey, apiSecret, {
  identity,
  name: identity,
  ttl: "2h",
});
at.addGrant({
  room,
  roomJoin: true,
  canPublish: true,
  canSubscribe: true,
  canPublishData: true,
});

const jwt = await at.toJwt();

console.log(jwt);
if (url) {
  console.error(`\nServer URL: ${url}\nRoom: ${room}\nIdentity: ${identity}`);
}
