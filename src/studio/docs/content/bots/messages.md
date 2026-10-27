---
title: Messages, embeds and buttons
topic: bots
kind: guide
section: Building
order: 240
summary: Send, reply, edit and delete messages; rich embeds, buttons, files, reactions and pins.
---

Everything a bot says is posted by its own account, tagged **BOT**. Sending needs **Send messages** in that channel.

## Sending

~~~ts bot
import { Client, Events, userMention } from "@crystal/bot";

const client = new Client();

client.on(Events.MessageCreate, async (message) => {
  if (message.fromBot) return;
  if (message.content === "!hello") {
    // A reply quotes the message it answers.
    await message.reply("Hello, " + userMention(message.author.id) + "!");
    // Or post in the channel without a quote.
    await message.channel.send("Nice to see you.");
  }
});
~~~

`channel.send` and `message.reply` take a string, or an object: `content`, `embeds`, `components`, `files`, `replyTo`, and `pingReply: false` so a reply doesn't notify the author. Writing `<@id>` or using a `User` in a template string mentions them; `@everyone`, `@here` and role mentions need the **Mention everyone** permission.

## Embeds

An **embed** is a card with a coloured edge. Build it with `EmbedBuilder`; every setter returns the builder so they chain.

~~~ts bot
import { ActionRowBuilder, ButtonBuilder, Client, EmbedBuilder, Events } from "@crystal/bot";

const client = new Client();

client.on(Events.MessageCreate, async (message) => {
  if (message.fromBot || message.content !== "!status") return;

  const embed = new EmbedBuilder()
    .setTitle("Build status")
    .setURL("https://example.com/builds")
    .setDescription("Everything is **passing**.")
    .setColor("#22c55e")
    .setAuthor({ name: "CI" })
    .addFields({ name: "Branch", value: "main", inline: true }, { name: "Tests", value: "212 passed", inline: true })
    .setThumbnail("https://example.com/logo.png")
    .setFooter({ text: "Checked just now" })
    .setTimestamp();

  await message.reply({ embeds: [embed] });
});
~~~

Addresses in an embed (the title link, pictures, author and footer icons) must be **https**; Crystal checks and cleans every field, so nothing runs as HTML. Colours are `"#rrggbb"` or a number like `0x22c55e`. See [limits](doc:bots/limits) for sizes.

## Buttons

Buttons go in rows of up to five, up to five rows. A button either has a `customId`, which comes back to your bot when someone presses it, or is a **link** that opens an https address.

~~~ts bot
import { ActionRowBuilder, ButtonBuilder, Client } from "@crystal/bot";

const client = new Client();

const row = new ActionRowBuilder(
  new ButtonBuilder().setCustomId("approve").setLabel("Approve").setStyle("success"),
  new ButtonBuilder().setCustomId("reject").setLabel("Reject").setStyle("danger"),
  new ButtonBuilder().setURL("https://example.com/request/42").setLabel("Open"),
);

client.button("approve", async (interaction) => {
  // Change the message the button is on: here, remove the buttons and say what happened.
  await interaction.update({ content: interaction.user.name + " approved this.", components: [] });
});

client.command("request", async (interaction) => {
  await interaction.reply({ content: "A request needs a decision.", components: [row] });
});
~~~

Styles are `primary`, `secondary`, `success`, `danger` and (for links) `link`. A person can press about one button a second and a half. See [slash commands and buttons](doc:bots/commands).

## Files

~~~ts bot
import { Client } from "@crystal/bot";

const client = new Client();

client.command("report", async (interaction) => {
  await interaction.reply({
    content: "Here is the report.",
    files: ["./report.png", { name: "notes.txt", data: "Generated at " + new Date().toISOString() }],
  });
});
~~~

A file is a path on disk, or `{ name, data }`. A message can carry up to four, each up to 10 MB. The SDK uploads each to Crystal first, then sends the message. Types that a browser would run as a page or script (HTML, JavaScript, SVG) are refused.

## Editing, deleting, reactions and pins

~~~ts bot
import { Client, Events } from "@crystal/bot";

const client = new Client();

client.on(Events.MessageCreate, async (message) => {
  if (message.fromBot || message.content !== "!demo") return;
  const sent = await message.channel.send("Working…");
  await sent.edit({ content: "Done." }); // only the bot's own messages can be edited
  await sent.react("✅"); // or a custom emoji, by its `.mention`
  await sent.pin(); // needs Manage messages
  await message.delete(); // deleting someone else's message needs Manage messages
});
~~~

`message.unreact(emoji)` takes the bot's own reaction back, and `message.clearReactions()` removes everyone's (Manage messages). `channel.bulkDelete([...])` deletes up to 100 messages at once, all or none.

## Reading history

~~~ts bot
import { Client } from "@crystal/bot";

const client = new Client();

client.command("recent", async (interaction) => {
  const messages = await interaction.channel.fetchMessages({ limit: 20 }); // newest first
  const mine = messages.filter((m) => m.author.id === interaction.user.id);
  await interaction.reply("You wrote " + mine.size + " of the last 20 messages.");
});
~~~

Reading messages needs the **Read messages** access, as receiving them does. `channel.fetchPins()` lists pinned messages, and `message.fetch()` gets one as it is now.
