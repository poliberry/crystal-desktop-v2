---
title: Recipes
topic: bots
kind: article
section: Examples
order: 290
summary: Complete small bots to copy: a moderator, a role picker, a welcome message, and a soundboard bot.
---

Each recipe is a whole `src/index.ts`. Add the permissions and access it lists to the bot's project settings.

## A tiny moderator

Needs **Send messages**, **Manage messages** and **Time members out**, and **Read messages** access. It deletes messages with a banned word, and times the author out after three strikes.

~~~ts bot
import { Client, Events } from "@crystal/bot";

const BANNED = ["spamword", "scamlink"];
const strikes = new Map<string, number>(); // in memory: resets when the bot restarts

const client = new Client();

client.on(Events.MessageCreate, async (message) => {
  if (message.fromBot) return;
  const text = message.content.toLowerCase();
  if (!BANNED.some((w) => text.includes(w))) return;

  await message.delete();
  const count = (strikes.get(message.author.id) ?? 0) + 1;
  strikes.set(message.author.id, count);

  if (count >= 3 && message.channel.community) {
    // Moderators and the owner are above the bot, so this quietly fails for them.
    await message.channel.community.timeout(message.author, 10 * 60).catch(() => undefined);
    strikes.delete(message.author.id);
    await message.channel.send(message.author + " has been timed out for 10 minutes.");
  } else {
    await message.channel.send(message.author + ", please don't post that here. (" + count + "/3)");
  }
});

await client.login();
~~~

## A role picker

Needs **Send messages** and **Manage roles**. The roles must already exist and be **below the bot's role**, and carry no permission the bot lacks.

~~~ts bot
import { ActionRowBuilder, ButtonBuilder, Client, EmbedBuilder } from "@crystal/bot";

const client = new Client();
const ROLES: Record<string, string> = { gamer: "Gamer", artist: "Artist", musician: "Musician" };

client.command("roles", async (interaction) => {
  await interaction.reply({
    embeds: [new EmbedBuilder().setTitle("Pick your roles").setDescription("Press a button to add or remove a role.")],
    components: [new ActionRowBuilder(...Object.entries(ROLES).map(([id, label]) => new ButtonBuilder().setCustomId("role:" + id).setLabel(label)))],
  });
});

for (const id of Object.keys(ROLES)) {
  client.button("role:" + id, async (interaction) => {
    const community = interaction.community;
    if (!community) return;
    const roles = await community.roles.fetch();
    const role = roles.find((r) => r.name === ROLES[id]);
    if (!role) return void (await interaction.reply("I can't find the " + ROLES[id] + " role."));

    const member = await community.members.get(interaction.user.id);
    const had = member.roleIds.includes(role.id); // read before changing: the Member object isn't updated by addRole
    if (had) await member.removeRole(role);
    else await member.addRole(role);
    await interaction.reply(interaction.user + (had ? " left " : " joined ") + role);
  });
}

await client.login();
await client.registerCommands([{ name: "roles", description: "Choose roles" }]);
~~~

## A welcome message

Needs **Send messages** and the **See the member list** access, so it hears about new members.

~~~ts bot
import { Client, EmbedBuilder, Events } from "@crystal/bot";

const client = new Client();

client.on(Events.MemberAdd, async (member) => {
  const channels = await member.community.channels.fetch();
  const channel = channels.find((c) => c.isText && c.name === "welcome") ?? channels.find((c) => c.isText);
  await channel?.send({
    content: "Welcome, " + member + "!",
    embeds: [new EmbedBuilder().setTitle("Glad you're here").setDescription("Say hello, and read the rules in #rules.").setColor("#38bdf8")],
  });
});

await client.login();
~~~

## A soundboard bot

Needs **Join voice channels**, and `npm install @livekit/rtc-node`.

~~~ts bot
import { BuiltinSounds, Client } from "@crystal/bot";

const client = new Client();

client.command("sound", async (interaction) => {
  const name = interaction.argv[0] ?? "";
  if (!(BuiltinSounds as readonly string[]).includes(name)) {
    return void (await interaction.reply("Try one of: " + BuiltinSounds.join(", ")));
  }
  const channels = await (interaction.community?.channels.fetch() ?? Promise.resolve(undefined));
  const voiceChannel = channels?.find((c) => c.isVoice);
  if (!voiceChannel) return void (await interaction.reply("There's no voice channel."));

  const voice = client.voice.get(voiceChannel.id) ?? (await voiceChannel.join());
  await voice.playSound(name as (typeof BuiltinSounds)[number]);
  await interaction.reply("🔊 " + name);
});

await client.login();
await client.registerCommands([{ name: "sound", description: "Play a sound in voice" }]);
~~~
