---
title: Direct messages
topic: bots
kind: guide
section: Building
order: 280
summary: A bot can message someone privately, but only to answer them, never to start a conversation.
---

A bot can send a person a private message, but only **to answer them**. Bots that could message anyone would be a spam machine, so the rules are strict, and the server enforces all of them.

## The rules

- The person must have **used one of the bot's slash commands or buttons in the last 15 minutes**.
- That must have happened in a community that gave the bot the **Send direct messages** access when it was added.
- At most **three** messages to one person in that window.
- Up to 2,000 characters, plain text.
- Not to other bots.

Outside that, the API answers `403` and the SDK throws. Every message is recorded in the audit log.

~~~ts bot
import { Client, CrystalAPIError } from "@crystal/bot";

const client = new Client();

client.command("secret", async (interaction) => {
  try {
    await interaction.user.send("Here's the thing you asked for: …");
    await interaction.reply("I've sent it to you privately.");
  } catch (e) {
    if (e instanceof CrystalAPIError && e.isForbidden) {
      await interaction.reply("I can't message you privately here. Ask a community manager to give me the direct messages access.");
    } else {
      throw e;
    }
  }
});
~~~

## What the person sees

A message from the bot in their normal direct messages, from the bot's own account, with a notification that names the bot.

## When not to use it

Anything the whole channel may as well see, say in the channel. Use direct messages for what is only for one person: a one-off code, a private result, a confirmation. Never as a way to market to people who used a command once.
