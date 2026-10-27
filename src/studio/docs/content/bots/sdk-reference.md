---
title: SDK reference
topic: bots
kind: reference
section: Reference
order: 330
summary: The classes and functions in @crystal/bot, at a glance. Press F12 on any of them in the editor for the full, documented source.
---

This page is a summary. **The Reference tab in Studio lists every class, method, property and type with its signature and documentation**, searchable, and it is generated from the SDK itself, so it's always the version your project has.

Everything is imported from `@crystal/bot`. Its source is in your project at `.crystal/sdk/bot`, so hovering anything in the editor shows its documentation.

## Client

| | |
| --- | --- |
| `new Client(options?)` | `token`, `signingSecret`, `apiUrl`, `port`, `host`, `path`, `presence`, `keepAlive`, `events` (`"poll"`, the default, or `"webhook"`). Whatever you leave out is read from the environment. |
| `client.login()` | Checks the token, loads the communities, shows the bot online, emits `ready`. |
| `client.listen(port?)` | Starts the web server events arrive on. Only needed if the bot has an endpoint; otherwise the SDK collects events itself after `login()`. |
| `client.handleWebhook(rawBody, signature)` | For your own server: verifies and handles one event, and returns the status to answer with. |
| `client.on(Events.X, fn)`, `.once`, `.off` | Listen. |
| `client.command(name, fn)`, `client.button(customId, fn)` | Handle a slash command or button. |
| `client.inviteUrl(options?)` | The link that adds this bot to a community (after `login()`). |
| `client.registerCommands([...])` | Tell Crystal which slash commands exist. With no argument, the ones `loadHandlers` found. |
| `client.loadHandlers(dir)` | Find handlers in `events/`, `commands/` and `buttons/` files under `dir` and wire them up. See [handlers in separate files](doc:bots/file-handlers). |
| `client.setPresence({...})` | Status, activities, custom status. |
| `client.user`, `client.botId` | The bot's account; the id the API knows it by. |
| `client.communities`, `client.channels`, `client.voice` | What the bot knows about. Each is a `Collection` (a `Map` with `find`, `filter`, `map`, `first`, `toArray`). |
| `client.rest` | The raw API: `get`, `post`, `put`, `patch`, `delete`, `upload`. |
| `client.destroy()` | Leave voice, stop the server and heartbeat, show the bot offline. |

## What you get back

| Class | Notable members |
| --- | --- |
| `Message` | `content`, `author`, `channel`, `embeds`, `components`, `attachments`, `fromBot`, `editable`. `reply()`, `edit()`, `delete()`, `react()`, `unreact()`, `clearReactions()`, `pin()`, `unpin()`, `fetch()`. |
| `Channel` | `name`, `type`, `topic`, `isText`, `isVoice`. `send()`, `fetchMessages()`, `fetchMessage()`, `fetchPins()`, `bulkDelete()`, `sendTyping()`, `edit()`, `setName()`, `setTopic()`, `delete()`, `fetchOverwrites()`, `setOverwrite()`, `deleteOverwrite()`, `fetchVoiceParticipants()`, `join()`. |
| `Community` | `name`, `granted`, `permissions`, `scopes`, `active`. `channels.fetch/create`, `members.fetch/get`, `roles.fetch/create`, `emojis.fetch/create`, `sounds.fetch/create`, `ban()`, `unban()`, `kick()`, `timeout()`, `setNickname()`, `fetchBans()`, `fetchInvite()`. |
| `User` | `id`, `username`, `name`, `isBot`. `send()` (a direct message), `fetchPresence()`. |
| `Member` | A `User`, plus `nickname`, `roleIds`, `roles`, `joinedAt`, `isOwner`, `displayName`. `kick()`, `ban()`, `timeout()`, `setNickname()`, `addRole()`, `removeRole()`. |
| `Role` | `name`, `color`, `permissions`, `position`, `hoist`, `isEveryone`, `managed`. `edit()`, `delete()`. |
| `Emoji`, `Sound` | `id`, `name`, and for an emoji `mention`, for a sound `url`. `delete()`. |
| `CommandInteraction` | `commandName`, `args`, `argv`, `user`, `channel`, `community`. `reply()`. |
| `ButtonInteraction` | `customId`, `messageId`, `user`, `channel`, `community`. `reply()`, `update()`. |
| `VoiceConnection` | `play()`, `stop()`, `playSound()`, `setState()`, `disconnect()`, `connected`. |

## Builders and helpers

| | |
| --- | --- |
| `EmbedBuilder` | `setTitle`, `setDescription`, `setURL`, `setColor`, `setTimestamp`, `setAuthor`, `setFooter`, `setImage`, `setThumbnail`, `addFields`, `setFields`. |
| `ButtonBuilder` | `setCustomId`, `setLabel`, `setEmoji`, `setStyle`, `setURL`, `setDisabled`. |
| `ActionRowBuilder` | `new ActionRowBuilder(...buttons)`, `addComponents`. |
| `defineEvent`, `defineCommand`, `defineButton` | Declare a handler in its own file; `client.loadHandlers` finds it. |
| `PermissionFlags`, `Permissions` | The permission numbers by name; `has`, `missing`, `toArray`, `Permissions.resolve(...names)`. |
| `ActivityType`, `BuiltinSounds` | Constants. |
| `userMention(id)`, `roleMention(id)`, `everyone` | Mention text. |
| `readWav(bytes)`, `toMono48k(audio)` | Turn a WAV file into audio to play. |
| `inviteUrl(botId, options?)`, `CRYSTAL_ORIGIN` | Build an invite link from just an id; the address Crystal's links start with. |
| `verifySignature(secret, header, body)` | Check an event yourself. |
| `CrystalAPIError`, `CrystalError` | A failed call (`status`, `isForbidden`, `isNotFound`, `isRateLimited`); a mistake in how the SDK was used. |

## Requirements

Node 18 or newer. No other dependencies; voice also needs `@livekit/rtc-node`. The SDK is TypeScript source that `tsx` (or any bundler) runs directly, and fully typed: every event, option and result has a type, exported from the package.
