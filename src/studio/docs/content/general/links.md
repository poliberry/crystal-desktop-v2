---
title: Links that open in the app
topic: general
kind: guide
section: Code projects
order: 20
summary: How usecrystal.app links work for invites, bots and extensions, in a browser and in the app.
---

Everything you share is an ordinary `https://usecrystal.app/…` link, so it works in any chat, email or browser:

| Link | What it does |
| --- | --- |
| `https://usecrystal.app/invite/<code>` | Join a community. |
| `https://usecrystal.app/oauth/authorize?client_id=…&scope=bot` | Add a bot to a community you manage ([invite links](doc:bots/invite-links)). |
| `https://usecrystal.app/oauth/authorize?client_id=…&scope=extension` | Add an extension to your account. |

## In the app

- **Clicking one inside Crystal** (in a message, say) opens it right there, without a browser.
- **Opening one in a browser** tries to open it in the app: the page asks your browser to hand it to Crystal, which asks "Open Crystal?" once. If you'd rather stay on the web, choose to continue there. Phones don't try, since there's no app to open.
- The page always has an **Open in the Crystal app** button as well, for when the automatic attempt was blocked or dismissed.
- **If you're signed out** the link waits: Crystal shows it as soon as you've signed in.

A link only ever *asks*. Joining, or adding a bot or extension, always shows what is about to happen and waits for you.

## For developers

The same links work in their `crystal://` form (`crystal://invite/<code>`, `crystal://oauth/authorize?…`), which is how a web page hands over to an installed app. Only Crystal's own addresses count: a link to any other site is opened in the browser as usual.
