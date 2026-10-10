---
title: Hosting your bot
topic: bots
kind: guide
section: Start here
order: 220
summary: Where to run it, the three settings it reads, and how to check an event is really from Crystal.
---

A bot is a normal Node program. Run it anywhere that stays on and has internet: your own computer, a small server, a container, a service like Fly or Railway. **It needs no public address**: the SDK asks Crystal for events. Everything below about the endpoint is for the other way round, where you want Crystal to call your server.

## Settings

The SDK reads these environment variables, so no secret lives in your code:

| Variable | What it is |
| --- | --- |
| `CRYSTAL_BOT_TOKEN` | The bot's token, shown once when you register it. |
| `CRYSTAL_SIGNING_SECRET` | Verifies that events come from Crystal. |
| `CRYSTAL_API_URL` | Optional. Crystal's Bot API address; it defaults to `https://api.usecrystal.app/bot/v1`, so you only set it to point at somewhere else. |

`PORT` sets which port `client.listen()` uses (default 3000). Everything can also be passed in code: `new Client({ token, signingSecret, apiUrl, port })`.

Never commit `.env`. The starter's `.gitignore` leaves it out.

## The endpoint (optional)

In the project settings, **Endpoint** is the https address Crystal sends events to, for example `https://bot.example.org/crystal`. Rules:

- It must be **https**. Plain http, and addresses that point inside a network (`localhost`, private ranges), are refused.
- Crystal **doesn't follow redirects** and **doesn't read your reply**, only its status. Answer `200` quickly.
- If you set `path` in `new Client({ path: "/crystal" })`, only requests to that path are treated as events. `GET /health` always answers `200 ok`.

{{bot-limits}}

## Using your own web framework

`client.listen()` is a small ready-made server. If your bot already has one, hand it the raw body and the signature header instead:

~~~ts bot
import { createServer } from "node:http";
import { Client } from "@crystal/bot";

const client = new Client();
await client.login();

createServer(async (req, res) => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) chunks.push(chunk as Uint8Array);
  const body = Buffer.concat(chunks).toString("utf8"); // the exact bytes, not a re-serialised copy
  const status = client.handleWebhook(body, req.headers["x-crystal-signature"] as string | undefined);
  res.writeHead(status).end();
}).listen(3000);
~~~

`handleWebhook` verifies the signature, answers straight away, and handles the event afterwards, so Crystal isn't kept waiting. It returns `401` for a bad signature, `400` for a body that isn't JSON, and `200` once accepted.

## Checking a signature yourself

Every event has an `X-Crystal-Signature` header: `t=<unix seconds>,v1=<hex>`. The `v1` value is an HMAC-SHA256, keyed with your signing secret, of the text `<t>.<raw body>`. The time is *inside* what is signed, so a captured request can't be replayed later, and it can't be edited; refuse anything more than five minutes old. The SDK does all of this:

~~~ts bot
import { verifySignature } from "@crystal/bot";

export function isFromCrystal(rawBody: string, signatureHeader: string | undefined): boolean {
  return verifySignature(process.env.CRYSTAL_SIGNING_SECRET!, signatureHeader, rawBody);
}
~~~

Other headers: `X-Crystal-Event` (the type, like `message.created`) and `X-Crystal-Delivery` (a unique id). The same event can arrive more than once if a delivery is retried; the SDK ignores repeats of an id it has just seen. If you handle events yourself, do the same.

## Staying online

A bot has no app open to show it online, so the SDK tells Crystal it's alive every 30 seconds (`keepAlive`, on by default) once you `login()`. Stop the program and the bot shows as offline shortly after. Call `await client.destroy()` on the way out for a clean goodbye:

~~~ts bot
import { Client } from "@crystal/bot";

const client = new Client();
await client.login();

process.on("SIGINT", () => {
  void client.destroy().then(() => process.exit(0));
});
~~~
