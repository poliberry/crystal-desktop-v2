---
title: Updating something that is live
topic: general
kind: guide
section: Shipping
order: 30
summary: Change a cosmetic, bot or extension that is already in the store, and send the change for review without making a second page.
---

When you change something that is already live, you don't make a new store page. You send the change for review, and when it is approved it **updates the page you already have**. Until then the live page is exactly as it was.

## Cosmetics, lounge scenes, theme packs and packs

Open the project, make the change, save, and use the **Submit** panel. Studio remembers what the project was last sent as, so it knows:

| The project's state | The button says | What it does |
| --- | --- | --- |
| Never sent | Submit for review | Makes a new listing, once approved |
| Sent, waiting | Replace what is waiting for review | Takes the place of the one in the queue, so nothing is queued twice |
| Live | Send update for review | Asks to change the live listing |
| An update is waiting | Replace the update waiting for review | Same, for the update |
| Turned down | Submit for review / Send update for review | Staff's note is shown; the live listing is untouched |

What approving an update does:

- **The listing is replaced in place.** Its name, description, artwork and store picture become the new ones. Its address, category, place in the shop, sales history and what you earn from it stay as they were.
- **The price stays what it is** unless staff change it when approving. If you asked for a different price, the Submit panel shows the difference and staff see it beside the update. A new price is something to agree, not something an update does by itself.
- **People who already own it get the new artwork.** What they have *equipped* is their own copy, which they may have moved or resized, so that stays as it is until they equip it again.
- **It has to be the same kind of thing.** A decoration can be updated with a decoration, a pack with a pack of the same kinds of item. To change what something is, submit it as a new listing; Studio offers "A new listing instead" for that.
- **A listing you stopped selling can't be updated.** Submit it as a new one.
- **One update waits at a time.** Sending again replaces it.

Under **Submissions** (the activity bar) an update is marked *Update*, and says the store page is unchanged until it is approved or turned down.

You can also pick another of your listings of the same kind from the Submit panel ("Send this as…"), for example after starting a project from a duplicate.

## Extensions

Every change is a new **version**, reviewed like the first. See [sending it for review](doc:extensions/publishing): the live version keeps running until the new one is approved, the number has to be newer than any you've sent, and sending again replaces a version still in the queue.

## Bots

A bot has no store page of its own until you make it public; the public list and the install page show its **name, description and picture**. These are reviewed:

- **Making a bot public** sends its listing for review. Until it is approved the bot is private: only you can add it, by its ID.
- **Changing a public bot's name, description or picture** sends the change for review. The listing people see stays as it is until it is approved. Studio's bot settings say so when you save, and show what staff said if they turn a change down.
- **Making it private again** happens at once and takes it out of the public list; making it public again is reviewed again.
- **Everything else changes straight away**: the endpoint, slash commands, redirect addresses, token and signing secret, and what the bot *asks for*. Asking for more changes nothing in any community until a manager chooses to grant it, so there is nothing to wait for. Your bot's code runs on your own computer, which is not something staff review.

## What stays live while you wait

In every case the answer is the same: **what people see and use doesn't change until staff approve the change.** If it is turned down, nothing has happened to the live page, and you can fix it and send it again.
