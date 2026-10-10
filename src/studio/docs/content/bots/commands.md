---
title: Slash commands and buttons
topic: bots
kind: guide
section: Building
order: 250
summary: Commands that appear when people type "/", and buttons that call back into your bot.
---

Slash commands and buttons are the way people talk to a bot on purpose. They work even for a bot that was never given **Read messages**, because Crystal addresses each one to the bot it is for.

## Slash commands

1. **Declare** the commands. In the project settings add each one under *Slash commands*, or call `client.registerCommands` when your bot starts. Names are 1 to 32 letters, numbers, `-` or `_`; a description (up to 100 characters) is required; a bot can have up to 25.
2. **Handle** each with `client.command(name, handler)`.

~~~ts bot
import { Client } from "@crystal/bot";

const client = new Client();

client.command("roll", async (interaction) => {
  // `/roll 20` → interaction.args is "20"; interaction.argv is ["20"]
  const sides = Math.min(1000, Math.max(2, Number(interaction.argv[0]) || 6));
  const result = 1 + Math.floor(Math.random() * sides);
  await interaction.reply(interaction.user.name + " rolled a " + result + " (d" + sides + ")");
});

client.command("say", async (interaction) => {
  // `/say "hello there" loud` → ["hello there", "loud"]; quotes keep words together
  const [text = "…", style] = interaction.argv;
  await interaction.reply(style === "loud" ? text.toUpperCase() : text);
});

await client.login();
await client.registerCommands([
  { name: "roll", description: "Roll a die, like /roll 20" },
  { name: "say", description: "Make me say something" },
]);
~~~

The popup that appears when someone types `/` in a channel lists the commands of every bot in the community. If two bots have the same command name, the person picks which one. A command into a channel the bot can't see is refused before it is sent. A person can run about ten commands in ten seconds.

Everything is one text line: `interaction.args` is whatever followed the command name, and `interaction.argv` splits it on spaces, keeping `"quoted phrases"` together. There are no typed options.

`interaction.reply(…)` posts a message in the channel for everyone to see: it takes everything `channel.send` does. There is no private reply; to reach just one person, see [direct messages](doc:bots/direct-messages).

## Buttons

~~~ts bot
import { ActionRowBuilder, ButtonBuilder, Client, EmbedBuilder } from "@crystal/bot";

const client = new Client();
const votes = new Map<string, "yes" | "no">(); // in memory: it resets when the bot restarts

const buttons = () =>
  new ActionRowBuilder(
    new ButtonBuilder().setCustomId("poll:yes").setLabel("Yes").setStyle("success"),
    new ButtonBuilder().setCustomId("poll:no").setLabel("No").setStyle("danger"),
  );

const results = () => {
  const yes = [...votes.values()].filter((v) => v === "yes").length;
  return new EmbedBuilder().setTitle("Pizza on Friday?").setDescription("Yes: " + yes + "\nNo: " + (votes.size - yes));
};

client.command("poll", async (interaction) => {
  await interaction.reply({ embeds: [results()], components: [buttons()] });
});

for (const answer of ["yes", "no"] as const) {
  client.button("poll:" + answer, async (interaction) => {
    votes.set(interaction.user.id, answer); // one vote each; pressing again changes it
    await interaction.update({ embeds: [results()] });
  });
}
~~~

`interaction.update({ content, embeds, components })` changes the message the button is on. It is always allowed, because the message is the bot's own. Pass `components: []` to remove the buttons, or a row with `.setDisabled()` buttons to keep them visible but off.

A button's `customId` is yours to design, up to 100 characters. It's the only thing sent back, along with who pressed it and which message, so put what you need to know in it: `"poll:yes"`, `"ban:" + userId`. Never trust it for permission: anyone who can see the message can press the button, so check `interaction.user` against what they're allowed to do.

## Anything else

Both interaction types are also emitted as `Events.InteractionCreate`, with `interaction.isCommand()` and `interaction.isButton()` to tell them apart, which is handy for logging every interaction in one place.
