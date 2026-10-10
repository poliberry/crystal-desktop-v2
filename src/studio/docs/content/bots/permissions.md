---
title: Permissions and authority
topic: bots
kind: reference
section: Reference
order: 300
summary: What a bot can ask for, what it ends up with, and the rules that stop a bot becoming more powerful than its authoriser.
---

## What a bot can be given

A bot asks for permissions in its project settings; a community manager decides which to grant when they add it.

{{bot-permissions}}

On top of permissions, three kinds of **access** are granted separately, because they let a bot read or reach people rather than act:

{{bot-scopes}}

**Never grantable**, to any bot, by anyone, the owner included: *Administrator*, *Manage community* (the community's own settings and deletion), *Manage integrations* (a bot adding bots would be a ladder), *Manage game servers* and *Manage events*. They aren't in the list above and the server refuses them if asked.

## The rules

1. **Adding a bot needs Manage Integrations**, whether by id or from an [invite link](doc:bots/invite-links).
2. **You can only give what you hold.** On the consent screen, anything the manager lacks is disabled, and the server refuses it again if someone tries to get round the screen. Nothing is trimmed silently: what was approved is what is granted.
3. **A bot's authority is its authoriser's.** What it can do right now is *what it was granted* ∩ *what the member who authorised it can still do* ∩ *what the channel allows*. If that person is demoted, the bot shrinks immediately. If they leave or are banned, it's refused until a manager authorises it again ("Authorise as me"). Giving a bot more makes the giver its new authoriser.
4. **A bot can't build something stronger than itself.** Roles it creates or edits, and channel permissions it sets, can't hold a permission the bot doesn't have, and it can only act on members below its own role. It can't act on the owner or on other bots.
5. **A bot's role is its grant.** It's created when the bot is added, can't be edited, deleted or handed out by hand, and sits just above `@everyone` until a manager moves it.
6. **Everything is recorded.** Each action, refusal and change of grant goes in the audit log for 30 days, visible to managers on the **Bots** tab.

## Checking from your bot

`client.communities` holds one `Community` for each place the bot is. On each:

| Property | Meaning |
| --- | --- |
| `community.granted` | What the bot was granted. |
| `community.permissions` | What it can do **right now**: the grant cut down to its authoriser's current permissions. |
| `community.scopes` | The access granted: `messages.read`, `members.read`, `dm.send`. |
| `community.active`, `community.inactiveReason` | Whether it can act here, and if not, why (for example, its authoriser left). |

~~~ts bot
import { Client, Events, Permissions } from "@crystal/bot";

const client = new Client();

client.on(Events.Ready, (c) => {
  for (const community of c.communities.values()) {
    if (!community.active) {
      console.log(community.name + ": can't act (" + community.inactiveReason + ")");
      continue;
    }
    const missing = community.permissions.missing("SendMessages", "ManageMessages");
    if (missing.length) console.log(community.name + ": missing " + missing.join(", "));
  }
});

// What to ask for in the project settings: the numbers behind the names.
console.log(Permissions.resolve("ViewChannels", "SendMessages", "ManageMessages"));
~~~

A permission being listed doesn't mean it works everywhere: channels can deny things to a bot like anyone. If an action is refused with `403`, the message says which permission or rule was missing.
