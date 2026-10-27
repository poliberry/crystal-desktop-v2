---
title: Moderation, roles and channels
topic: bots
kind: guide
section: Building
order: 260
summary: Ban, kick, time out, rename, manage roles and channels, emojis and sounds, within the bot's own authority.
---

Anything a moderator can do, a bot can be given. Each action needs the matching permission, granted when the bot was added, and the rules in [permissions and authority](doc:bots/permissions) always apply on top.

## Who a bot can act on

A bot can act only on members **below its own role**. It can never act on the community's owner, or on another bot. A bot's role is created when it is added, sits just above `@everyone`, and can't be edited by hand. A manager moves it up the list to let it act on more people, and the role editor already stops them moving it above themselves.

When a bot tries something it isn't allowed, the API answers `403` with the reason and the SDK throws a `CrystalAPIError`; `error.isForbidden` is `true`. Every action, and every refusal, is recorded in the audit log shown to the community's managers on the **Bots** tab.

## Members

~~~ts bot
import { Client, Events } from "@crystal/bot";

const client = new Client();

client.command("timeout", async (interaction) => {
  const community = interaction.community;
  if (!community) return;
  const [who, minutes = "10"] = interaction.argv;
  const id = who?.match(/<@(\w+)>/)?.[1];
  if (!id) return void (await interaction.reply("Mention who: /timeout @someone 10"));

  try {
    await community.timeout(id, Number(minutes) * 60); // 0 ends a timeout; the longest is 28 days
    await interaction.reply("Timed them out for " + minutes + " minutes.");
  } catch (e) {
    // Most likely: they are above the bot, the bot lacks "Time members out", or its authoriser does.
    await interaction.reply("I couldn't do that: " + (e as Error).message);
  }
});

client.on(Events.MemberAdd, async (member) => {
  // Needs "See the member list". Say hello in the first text channel.
  const channels = await member.community.channels.fetch();
  const general = channels.find((c) => c.isText);
  await general?.send("Welcome, " + member + "!");
});
~~~

| To do this | Call | Needs |
| --- | --- | --- |
| Remove a member | `community.kick(user)` or `member.kick()` | Remove members |
| Ban, unban | `community.ban(user, reason?)`, `community.unban(user)` | Ban members |
| List bans | `community.fetchBans()` | Ban members |
| Time out | `community.timeout(user, seconds)` | Time members out |
| Change a nickname | `community.setNickname(user, "Name")` | Change nicknames |
| Give or take a role | `member.addRole(role)`, `member.removeRole(role)` | Manage roles |
| List members | `community.members.fetch({ limit })`, `.get(id)` | See the member list |

`user` is a `User`, a `Member`, or just an id string.

## Roles

~~~ts bot
import { Client, Permissions } from "@crystal/bot";

const client = new Client();

client.command("makerole", async (interaction) => {
  const community = interaction.community;
  if (!community) return;
  // A new role sits just below the bot's own, and can carry only permissions the bot holds itself.
  const role = await community.roles.create({
    name: "Helper",
    color: "#38bdf8",
    hoist: true,
    permissions: Permissions.resolve("ViewChannels", "SendMessages"),
  });
  await interaction.reply("Created " + role);

  const member = await community.members.get(interaction.user.id);
  await member.addRole(role);
});
~~~

`role.edit({ name, color, hoist, permissions })` and `role.delete()` work on roles below the bot's. **A bot can never give a role, or a channel, a permission it doesn't hold itself**, so no chain of actions ends with more authority than someone could use directly. Roles that came from adding a bot (`role.managed`) can't be changed this way.

## Channels

~~~ts bot
import { Client, Permissions } from "@crystal/bot";

const client = new Client();

client.command("private", async (interaction) => {
  const community = interaction.community;
  if (!community) return;

  const channel = await community.channels.create({ name: "private-room", type: "text", topic: "Made by a bot" });

  // Hide it from everyone, then let the person who asked in. A bot can deny anything, but only allow what it holds.
  const roles = await community.roles.fetch();
  const everyone = roles.find((r) => r.isEveryone);
  if (everyone) await channel.setOverwrite(everyone, { deny: Permissions.resolve("ViewChannels") });
  await channel.setOverwrite({ kind: "member", id: interaction.user.id }, { allow: Permissions.resolve("ViewChannels", "SendMessages") });

  await interaction.reply("Made " + channel + " — only you can see it.");
});
~~~

Also: `channel.edit({ name, topic })`, `channel.setName()`, `channel.setTopic()`, `channel.delete()`, `channel.fetchOverwrites()`, `channel.deleteOverwrite(target)`, and `community.fetchInvite()` for the community's invite code (Create invites). All of the channel ones need **Manage channels**.

## Emojis and sounds

~~~ts bot
import { Client } from "@crystal/bot";

const client = new Client();

client.command("addemoji", async (interaction) => {
  const community = interaction.community;
  if (!community) return;
  // A PNG, JPEG, WebP or GIF up to 256 KB. A community can have 50.
  const emoji = await community.emojis.create({ name: "party", image: "./party.png" });
  await interaction.reply("Added " + emoji.mention);
});

client.command("addsound", async (interaction) => {
  const community = interaction.community;
  if (!community) return;
  // Audio up to 8 seconds; say how long it is so the soundboard can show it.
  await community.sounds.create({ name: "airhorn", audio: "./airhorn.wav", emoji: "📣", durationMs: 1800 });
  await interaction.reply("Added to the soundboard.");
});
~~~

Both need **Manage emojis and sounds**. Remove one with `emoji.delete()` or `sound.delete()`.

## Being careful

- **Say no first.** Check who is asking: your command will run for anyone who types it. Compare `interaction.user` with a list of allowed ids, or look up their roles with `community.members.get(id)` and `member.roles`.
- **Log what you do.** Crystal keeps an audit trail of the bot's actions, but a message in a mod-log channel is kinder to your moderators.
- **Ask for the least.** Each permission you ask for is something a manager has to be comfortable giving. High-care ones are marked in [the list](doc:bots/permissions).
