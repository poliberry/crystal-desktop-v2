---
title: Your first bot
topic: bots
kind: guide
section: Start here
order: 210
summary: Make a bot in Studio, register it, run it, and add it to a community.
---

You need the desktop app, and [Node](https://nodejs.org) 18 or newer to run the bot.

## 1. Make the project

1. In Studio choose **New project** and pick **Bot**. Give it a name.
2. Studio creates a folder with `src/index.ts` (plus `src/events`, `src/commands` and `src/buttons`, one small file for each thing the bot does), `package.json`, `tsconfig.json` and `.env.example`, and copies the SDK into `.crystal/sdk/bot`. It's an ordinary TypeScript project: you could open the folder in VS Code and nothing would be different.
3. In the project settings, say **what it does** (people read this before they add it), choose **who can add it**, and tick **what it asks for**. Ask only for what the bot needs.

## 2. Register it

Press **Register bot**. Crystal gives you two secrets, **shown once**:

- the **bot token**, `CRYSTAL_BOT_TOKEN`: what the bot proves who it is with;
- the **signing secret**, `CRYSTAL_SIGNING_SECRET`: how the bot knows an event really came from Crystal.

Copy both into a file named `.env` next to `package.json` (copy `.env.example` and fill it in). Neither is ever written into the `.crysproj` file. If you lose one, make a new one: **New token** and **New signing secret** are in the project settings.

You also get a **Bot ID**. It's how a community manager finds your bot.

## 3. Run it

In the terminal at the bottom of the editor (Ctrl+\` opens it):

~~~sh
npm install
npm start
~~~

The starter logs in, answers `!ping`, handles a button, and hears events. Here it is in one file, so you can see all of it at once. (The project itself keeps each handler in its own file; [handlers in separate files](doc:bots/file-handlers) shows how, and it's worth switching to as soon as the bot does more than a couple of things.)

~~~ts bot
import { Client, Events } from "@crystal/bot";

const client = new Client(); // reads CRYSTAL_BOT_TOKEN and CRYSTAL_SIGNING_SECRET

client.on(Events.Ready, (c) => {
  console.log("Online as " + c.user?.name + " in " + c.communities.size + " communities.");
});

client.on(Events.MessageCreate, async (message) => {
  if (message.fromBot) return; // never answer bots, or two bots will talk forever
  if (message.content === "!ping") await message.reply("pong");
});

await client.login(); // checks the token, loads the communities, shows the bot online
~~~

## 4. Events

Nothing to set up. After `login()` the SDK **asks Crystal for events** (it waits up to 25 seconds for each answer), so the bot works from your own computer with no public address and no tunnel. It is "online" while it is running and asking, and offline shortly after you stop it.

If you'd rather Crystal *call your server*, set an **Endpoint** in the project settings and use `client.listen()`; see [hosting](doc:bots/hosting). A bot with an endpoint set is called, and its SDK stops asking.

## 5. Add it to a community

The easiest way is the **invite link** shown in the bot's Setup: send it to someone with **Manage Integrations**, and they choose a community, see what the bot asks for, and choose what to give. (See [invite links](doc:bots/invite-links).)

Or, from the community's settings: **Bots**, then **Add a bot**, and paste the Bot ID (or pick it from the public list if you made it public and staff have approved it).

Then say `!ping`. The bot answers with its own account, tagged **BOT**.

## When it doesn't work

| What you see | Usually |
| --- | --- |
| `No bot token` when starting | `.env` isn't being read. `npm start` uses `--env-file=.env`; check the file is next to `package.json`. |
| `401` from the API | The token is wrong or was replaced by **New token**. |
| It logs in but never hears messages | **Read messages** wasn't given when it was added (commands and buttons still work without it). If you set an Endpoint, check it is reachable: **Send a test event** tells you. |
| A `403` when it acts | The bot wasn't given that permission here, or the person who added it no longer holds it. |
| Events stopped arriving | After ten events in a row that couldn't be delivered, Crystal switches delivery off. Fix the endpoint and press **Turn back on**. |
