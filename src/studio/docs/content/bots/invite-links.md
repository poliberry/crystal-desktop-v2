---
title: Invite links
topic: bots
kind: guide
section: Start here
order: 225
summary: Share one link that adds your bot to a community, and optionally sends people back to your site.
---

You don't have to give anyone a Bot ID. Share an **invite link** and they get a screen that asks which community and what to allow.

~~~
https://usecrystal.app/oauth/authorize?client_id=<your bot's id>&scope=bot&permissions=2
~~~

Opened in a browser it's a web page (sign in if needed); opened with Crystal installed it opens **in the app** instead. See [links that open in the app](doc:general/links).

## What the person sees

1. **Which community.** Only communities where they hold **Manage Integrations** are offered; one that already has your bot is greyed out. If they manage none, they're told to send the link to someone who does.
2. **What to allow.** The same screen as adding by hand: everything the bot asks for, each in plain words. Anything they don't hold themselves is switched off. The link's `permissions` only decides what starts ticked.
3. **Add.** The bot is added with exactly what they ticked, and its authority is theirs, as always (see [permissions and authority](doc:bots/permissions)).

**A link grants nothing.** It is a request, and the server applies every rule when the person confirms. A link that has been edited to ask for more is cut down to what the bot is registered for and what the person holds, and never-grantable permissions (Administrator, Manage Integrations…) are dropped from the link before it is even shown.

## The parameters

| Parameter | |
| --- | --- |
| `client_id` | Your bot's id. Required. |
| `scope` | `bot`. (Extensions use `extension`; see below.) |
| `permissions` | A number: the permissions to start ticked. Build it with `Permissions.resolve("SendMessages", …)`. |
| `scopes` | Access to start ticked: `messages.read`, `members.read`, `dm.send`, comma-separated. |
| `community_id` | Pre-selects a community the person manages. |
| `redirect_uri` | Where to send the browser afterwards. Only used if you registered it; see below. |
| `state` | Up to 200 characters, handed back to you untouched. |

The link can **narrow** what the bot asks for in its project settings, never widen it: ask for the most in the settings and make links that ask for less.

## Making the link

In Studio, the bot's **Setup** shows the link, built from what you've ticked. In code:

~~~ts bot
import { Client, Permissions, inviteUrl } from "@crystal/bot";

const client = new Client();
await client.login();

// From the client, once logged in:
console.log(client.inviteUrl({ permissions: ["ViewChannels", "SendMessages"], scopes: ["messages.read"] }));

// Or from just an id, anywhere (a website, a script):
const link = inviteUrl("YOUR_BOT_ID", { permissions: Permissions.resolve("ViewChannels", "SendMessages") });
console.log(link);
~~~

A private bot's link only works for you. Set it to public in the project settings to share it; a public bot's listing is reviewed first (see [updating something that is live](doc:general/updating)), and until it is approved the bot stays available only to you.

## Sending people back to your site

Register one or more **redirect addresses** in the bot's settings (up to five, https, or `http://localhost` while you build). Put one in the link as `redirect_uri`, and after the person adds the bot their browser goes there with:

| Parameter | |
| --- | --- |
| `community_id` | Where it was added. |
| `permissions` | The number they actually granted. |
| `scopes` | The access they granted. |
| `state` | What you put in the link. |

Only an **exact match** of a registered address is followed. Anything else in the link (a different path, a different host, extra query text) is ignored and the person simply stays in Crystal. If they cancel, nothing is sent.

~~~ts bot
import { Client, inviteUrl } from "@crystal/bot";
import { randomUUID } from "node:crypto";

const client = new Client();

// Your own site makes the link, remembering `state` so it can recognise the return.
const pending = new Map<string, string>(); // state → which of your users asked
export function linkFor(userId: string): string {
  const state = randomUUID();
  pending.set(state, userId);
  return inviteUrl(process.env.CRYSTAL_BOT_ID!, { permissions: ["ViewChannels", "SendMessages"], redirectUri: "https://my-bot.example.com/crystal/added", state });
}

// …and when Crystal's *signed* event says it really was added, you know for certain.
client.on("communityCreate", (community) => {
  console.log("Added to " + community.name);
});
~~~

**Don't treat the redirect as proof.** It is only the person's browser landing on your page, and anyone can type that address. Check `state` is one you issued, and learn that the bot was really added from the signed `bot.installed` event (`Events.CommunityCreate`) or by asking the API (`GET /me` lists the communities with their permissions).

## Extensions

A published extension has a link too, which adds it to **someone's own account**: `…/oauth/authorize?client_id=<its id>&scope=extension`. They see the powers it asks for and can untick any before adding. Studio shows it once a version is approved.
