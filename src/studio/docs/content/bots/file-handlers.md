---
title: Handlers in separate files
topic: bots
kind: guide
section: Building
order: 235
summary: Keep each event, command and button in its own small file, and let the SDK find them.
---

One long `index.ts` is fine for a bot that does two things. Once it does ten, it's easier to read — and to change one without disturbing the rest — with a small file for each thing the bot does. The SDK can find those files for you.

A new bot from Studio starts this way:

~~~
src/
  index.ts          creates the client and logs in
  events/           what the bot does when something happens
    ready.ts
    messageCreate.ts
  commands/         one file per slash command
    hello.ts
  buttons/          one file per button
    thanks.ts
~~~

It's only a convenience. Everything a file does could be written with `client.on`, `client.command` and `client.button`, and the two styles can be mixed freely in one bot.

## index.ts

~~~ts bot
// src/index.ts
import { Client } from "@crystal/bot";

const client = new Client();

// Finds every handler in src/events, src/commands and src/buttons and wires it up.
// Call it before login(), so nothing is missed.
const loaded = await client.loadHandlers(new URL(".", import.meta.url));
console.log("Loaded " + loaded.files.length + " files.");

await client.login();
// Tells Crystal which commands exist, so they show up when someone types "/".
// With no argument it registers the ones that were found.
await client.registerCommands();
~~~

`new URL(".", import.meta.url)` is the folder `index.ts` is in. You can also pass a path as a string.

## An event

Say which event, and what to do. `run` is given what the event carries — here, the message — and then the client, as the last argument.

~~~ts bot
// src/events/messageCreate.ts
import { defineEvent, Events } from "@crystal/bot";

export default defineEvent({
  name: Events.MessageCreate,
  run: async (message, client) => {
    if (message.fromBot) return;
    if (message.content === "!who") await message.reply("I'm " + client.user?.name);
  },
});
~~~

Because `name` says which event this is, `message` is typed as a `Message` and your editor completes its members. Add `once: true` to handle only the first time it happens.

## A slash command

A command's file says everything about it: its name, the description people see when they type `/`, and what it does. Because `registerCommands()` reads these, you don't list the commands in a second place.

~~~ts bot
// src/commands/roll.ts
import { defineCommand } from "@crystal/bot";

export default defineCommand({
  name: "roll",
  description: "Roll a die",
  run: async (interaction) => {
    const sides = Math.min(1000, Math.max(2, Number(interaction.argv[0]) || 6));
    await interaction.reply("You rolled a " + (1 + Math.floor(Math.random() * sides)));
  },
});
~~~

The name is 1 to 32 lower-case letters, digits, `-` or `_`, and the description is 1 to 100 characters. The SDK checks both when it loads the file, and says which file is wrong.

## A button

A button handler is found by the `customId` the button was given. The button itself is made wherever you send the message.

~~~ts bot
// src/buttons/thanks.ts
import { defineButton } from "@crystal/bot";

export default defineButton({
  customId: "thanks",
  run: async (interaction) => {
    await interaction.update({ components: [] });
    await interaction.reply("You're welcome, " + interaction.user.name + "!");
  },
});
~~~

## What the loader does and doesn't do

- It looks in `events/`, `commands/` and `buttons/`, including folders inside them, so you can group files (`commands/fun/roll.ts`). A folder that isn't there is just empty.
- A file's **default export** is its handler. A file that has none, or exports something else, is an error that names the file.
- It skips files whose name starts with `_` or `.`, type files (`.d.ts`) and tests (`.test.ts`), so a helper can sit beside the handlers: `commands/_dice.ts` can be imported by `commands/roll.ts` and is never loaded as a command itself. (A new bot has `commands/_example.ts`, a working command you can copy.)
- Two commands with one name, or two buttons with one id, are an error naming both files, rather than one quietly winning.
- Loading is all or nothing: if one file is wrong, nothing from the folders is wired up, so the bot never runs half-configured.
- Files are loaded in a fixed, sorted order.

## Adding it to a bot you already have

Nothing changes in your existing bot. Make the folders, move a handler into a file one at a time, and add the `loadHandlers` line. A handler written with `client.command("roll", …)` and one in `commands/roll.ts` can't both exist for the same name — the file wins if both do — so move it rather than copying it.

The classes and options are in the [SDK reference](doc:bots/sdk-reference); [events](doc:bots/events) and [slash commands and buttons](doc:bots/commands) say what each handler receives.
