---
title: Limits and errors
topic: bots
kind: reference
section: Reference
order: 310
summary: How much a bot can send and how often, and what its errors mean.
---

## Limits

{{bot-limits}}

## Errors

Every failed call throws a `CrystalAPIError`:

~~~ts bot
import { Client, CrystalAPIError } from "@crystal/bot";

const client = new Client();

client.command("purge", async (interaction) => {
  try {
    const recent = await interaction.channel.fetchMessages({ limit: 50 });
    const deleted = await interaction.channel.bulkDelete(recent.toArray());
    await interaction.reply("Deleted " + deleted + " messages.");
  } catch (e) {
    if (!(e instanceof CrystalAPIError)) throw e;
    if (e.isForbidden) await interaction.reply("I'm not allowed to do that here.");
    else if (e.isNotFound) await interaction.reply("Something I needed has gone.");
    else if (e.isRateLimited) await interaction.reply("Too fast; try again in a moment.");
    else await interaction.reply("That didn't work: " + e.message);
  }
});
~~~

| Status | Meaning | What to do |
| --- | --- | --- |
| `400` | The request was wrong: a missing field, too long, not https. The message says which. | Fix the request. |
| `401` | The token is missing, wrong, or was replaced. | Check `CRYSTAL_BOT_TOKEN`. |
| `403` | The bot isn't allowed: it lacks the permission or access, the target is above it, or its authoriser lost the permission. | See [permissions](doc:bots/permissions). |
| `404` | That thing doesn't exist, or the bot can't see it. | |
| `405` | Wrong method for that path. | |
| `413` | The request body was too large. | |
| `429` | Slow down. The `Retry-After` header says how long. | The SDK waits and retries up to twice for you. |
| `500` | Something went wrong on Crystal's side. | Try again. |

`error.status`, `error.method`, `error.path` and `error.message` tell you which call failed and why. The text in `message` is written for people, so it is safe to show in a reply.
