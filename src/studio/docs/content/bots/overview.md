---
title: What a bot is
topic: bots
kind: guide
section: Start here
order: 200
summary: A program you run that acts in communities like a member, with exactly the authority it is given.
---

A **bot** is a program that you run, on your computer or a server, that takes part in a community the way a member does: it reads messages, answers commands, posts rich messages with buttons, moderates, manages roles and channels, and joins voice channels to speak and play soundboard clips. Whatever a person can do in Crystal, a bot can be allowed to do, with the limits below.

## How it works

1. **You** write the bot with the SDK (`@crystal/bot`) in Studio, and register it. You get a **token** and a **signing secret**, shown once.
2. **Your bot hears events** (a message, a button press, a slash command): the SDK collects them from Crystal as long as it is running, or, if you give an *endpoint*, Crystal sends them there as signed web requests.
3. **Your bot acts** by calling Crystal's Bot API with its token, which the SDK does for you: `message.reply("hi")`, `member.ban()`, `channel.join()`.
4. **A community manager adds the bot** from an [invite link](doc:bots/invite-links) you share (or by its id), sees what it asks for, and chooses what to give.

The default needs no hosting at all: run the program anywhere that has internet (your own computer is fine) and it works, needing nothing but Node 18 or newer. A server with an https address can be called by Crystal instead if you prefer.

## Who is in charge

Bots are built to be safe to add.

- **Adding a bot needs the *Manage Integrations* permission.** Nobody can add a bot who couldn't manage them.
- **A manager can only give what they hold.** The consent screen disables anything they lack.
- **A bot acts with its authoriser's authority.** What it can do right now is what it was granted *and* what the person who added it can still do. If they are demoted, the bot shrinks at once; if they leave, it stops until someone authorises it again.
- **A bot can't make something stronger than itself.** A role or channel setting it creates can't hold a permission the bot doesn't.
- **Some things are never grantable**, to anyone, the owner included: Administrator, managing the community's own settings, managing integrations, managing game servers and managing events.
- **Voice is audio only.** A bot can speak and use the soundboard. It cannot share a screen, a camera or a stream; the server refuses, whatever the code tries.

See [permissions and authority](doc:bots/permissions) for the full list.

## Where next

1. [Your first bot](doc:bots/first-bot)
2. [Hosting your bot](doc:bots/hosting) and [invite links](doc:bots/invite-links)
3. [Events and interactions](doc:bots/events)
4. [Messages, embeds and buttons](doc:bots/messages)
5. [Slash commands and buttons](doc:bots/commands)
6. [Moderation, roles and channels](doc:bots/moderation)
7. [Voice, soundboard and presence](doc:bots/voice)
8. [Permissions and authority](doc:bots/permissions)
9. [Limits](doc:bots/limits)
10. [The Bot API](doc:bots/api) and the [SDK reference](doc:bots/sdk-reference)
