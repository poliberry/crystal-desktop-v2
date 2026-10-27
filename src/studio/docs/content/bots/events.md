---
title: Events and interactions
topic: bots
kind: guide
section: Building
order: 230
summary: What Crystal tells your bot about, which access each event needs, and how to listen.
---

You listen with `client.on(Events.Name, handler)`. A handler can be `async`; if it throws, the error goes to the `Events.Error` listener (or is logged), and your other listeners still run.

~~~ts bot
import { Client, Events } from "@crystal/bot";

const client = new Client();

client.on(Events.Ready, (c) => console.log("Online as " + c.user?.name));
client.on(Events.Error, (error) => console.error("Something went wrong:", error));
client.on(Events.MessageCreate, async (message) => {
  if (message.fromBot) return;
  console.log(message.author.name + " in " + message.channel + ": " + message.content);
});

await client.login();
~~~

## The events

| Event (`Events.…`) | You get | Needs |
| --- | --- | --- |
| `Ready` | the `Client`, after `login()` | nothing |
| `CommunityCreate` | a `Community`, when the bot is added to one | nothing |
| `MessageCreate` | a `Message` | **Read messages** access, and to be able to see the channel |
| `MessageUpdate` | the `Message` as it is now | **Read messages** |
| `MessageDelete` | `{ id, channelId, communityId }` | **Read messages** |
| `ReactionAdd`, `ReactionRemove` | a `Reaction` (`emoji`, `user`, `messageId`, `channel`) | **Read messages** |
| `MemberAdd`, `MemberRemove` | a `Member` | **See the member list** access |
| `ChannelCreate`, `ChannelUpdate`, `ChannelDelete` | a `Channel` | being able to see the channel |
| `VoiceStateUpdate` | `{ channel, user, action: "joined" \| "left" }` | being able to see the channel |
| `InteractionCreate` | a `CommandInteraction` or `ButtonInteraction` | nothing: they are sent to the bot they are for |
| `Error`, `Debug` | the problem, or a message | nothing |

Access is what the person adding the bot chooses to give; see [permissions](doc:bots/permissions). A bot that wasn't given **Read messages** simply never hears about messages, though it can still answer slash commands and buttons, which are addressed to it directly.

A bot **doesn't hear about its own messages, reactions or voice joins**, which stops the most common loop. Other bots' messages do arrive; check `message.fromBot` before answering, or two bots will talk forever. (Channel changes are different: a channel your bot creates is reported to it like any other.)

## Interactions

Slash commands and button presses arrive as `InteractionCreate`, but it's usually easier to register a handler for one by name. See [slash commands and buttons](doc:bots/commands).

## How events reach you

**By default the SDK collects them.** After `login()` it asks Crystal for events, waiting up to 25 seconds for each answer, so a bot needs no public address. Events wait up to five minutes for a bot that is briefly offline's next ask, at most 500 of them; a bot that has not asked for a minute isn't "listening", and nothing is saved for it. Delivery is in order, each event once. This is `GET /bot/v1/events?after=<cursor>&wait=25` if you're not using the SDK.

**Or Crystal calls you.** If the bot has an endpoint, Crystal sends each event as a signed POST to your endpoint and waits at most **five seconds** for a `2xx` answer. The SDK answers immediately and handles the event afterwards, so slow handlers never cause a retry. If your endpoint is down, Crystal retries after 5 seconds, 30 seconds, 2 minutes and 10 minutes (button presses and commands are tried three times, since a person is waiting). The same event may arrive twice; the SDK ignores an id it has just seen.

If you use an endpoint, to check it is working, press **Send a test event** in the project settings. It sends one `ping` and tells you what your endpoint answered.

## Events as data

If you are not using the SDK, each event is a JSON object with `id`, `type` and `createdAt`, plus fields for that type:

| `type` | Fields |
| --- | --- |
| `ping` | none |
| `bot.installed` | `communityId`, `communityName`, `authorisedBy` |
| `message.created` | `communityId`, `channelId`, `message` |
| `message.updated` | `communityId`, `channelId`, `message` |
| `message.deleted` | `communityId`, `channelId`, `messageId` |
| `reaction.added`, `reaction.removed` | `communityId`, `channelId`, `messageId`, `emoji`, `user` |
| `member.joined`, `member.left` | `communityId`, `member` |
| `channel.created`, `channel.updated`, `channel.deleted` | `communityId`, `channel` |
| `voice.state` | `communityId`, `channelId`, `action`, `user` |
| `interaction.command` | `communityId`, `channelId`, `command`, `args`, `user` |
| `interaction.button` | `communityId`, `channelId`, `messageId`, `customId`, `user` |

A `message` is `{ id, text, createdAt, replyToId, author, attachments, embeds?, components? }`. The types are all exported from `@crystal/bot` (`APIMessage`, `CrystalEvent`, …).
