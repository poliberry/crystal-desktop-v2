---
title: The Bot API
topic: bots
kind: reference
section: Reference
order: 320
summary: Every endpoint, for using Crystal from any language, or when the SDK doesn't cover something.
---

The SDK is a thin layer over a plain HTTP API, so a bot can be written in any language. Everything below is what the SDK calls.

## Basics

- **Base address:** `https://api.usecrystal.app/bot/v1`.
- **Authentication:** `Authorization: Bot <your token>` on every request.
- **Bodies:** JSON objects. Send `Content-Type: application/json`.
- **Answers:** JSON. A failure is `{ "error": { "status": 403, "message": "…" } }` with the same HTTP status; see [errors](doc:bots/limits).
- **Rate limit:** a `429` carries `Retry-After` in seconds.

~~~sh
# Who am I, and where am I?
curl "https://api.usecrystal.app/bot/v1/me" -H "Authorization: Bot $CRYSTAL_BOT_TOKEN"

# Say something
curl -X POST "https://api.usecrystal.app/bot/v1/channels/$CHANNEL_ID/messages" \
  -H "Authorization: Bot $CRYSTAL_BOT_TOKEN" -H "Content-Type: application/json" \
  -d '{"content":"Hello from curl"}'
~~~

`GET /me` answers with the bot's `id`, `userId`, `username`, `name`, and a `communities` list: for each, the `granted` and `effective` permission numbers, the `scopes`, whether the bot is `active` there and, if not, a `reason`.

## Sending a message

`POST /channels/:channelId/messages` takes any of:

| Field | |
| --- | --- |
| `content` | Text. |
| `embeds` | A list of embeds: `title`, `description`, `url`, `color` (a number), `timestamp`, `author`, `footer`, `image`, `thumbnail`, `fields`. |
| `components` | A list of rows: `{ "buttons": [{ "customId", "label", "style", "url", "emoji", "disabled" }] }`. |
| `files` | A list of `{ "storageId", "fileName" }`, from an upload. |
| `replyToId` | A message id to reply to. |

At least one of `content`, `embeds`, `components` or `files` is required.

## Uploading files

Files are uploaded first, then referred to by id:

1. `POST /uploads` answers `{ "uploadUrl": "…" }`, an address that works once and expires after 10 minutes.
2. `POST` the file's bytes to that address with its `Content-Type`. It answers `{ "storageId": "…" }`.
3. Use the `storageId` within 30 minutes: in `files` when sending a message, as `avatarStorageId` in `PATCH /me` (a picture up to 2 MB, along with `bio`), or as `storageId` when creating an emoji (up to 256 KB) or a soundboard clip.

## Slash commands

`PUT /commands` with `{ "commands": [{ "name", "description" }] }` replaces the bot's list. Commands and button presses come back as events to your endpoint; see [events](doc:bots/events).

## All endpoints

{{bot-routes}}

Anything that needs a permission or access says so in the guide for it; the answer to a refused call names what was missing.
