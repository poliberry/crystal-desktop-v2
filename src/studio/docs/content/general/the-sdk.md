---
title: The SDK in your project
topic: general
kind: guide
section: Code projects
order: 10
summary: Where the Crystal SDK lives, why it's a copy in your folder, and how it stays up to date.
---

Extensions and bots are written against Crystal's SDK: classes, functions and types you import, like `discord.js` for Discord. There are two:

| For | Import | Lives in |
| --- | --- | --- |
| [Extensions](doc:extensions/overview) | `@crystal/extension` | `.crystal/sdk/extension` |
| [Bots](doc:bots/overview) | `@crystal/bot` | `.crystal/sdk/bot` |

## It's a copy, in your folder

When you create a code project, Studio copies the SDK's TypeScript source into `.crystal/sdk/`. Nothing is downloaded: it ships inside the app, so it works offline. The point of a copy is that you can **read it**. Hover anything in the editor for its documentation; press F12 on `Client` or `ui.button` and you land in the source, comments and all.

`tsconfig.json` maps the package name to that folder (`"paths"`), so the same project also opens cleanly in VS Code or builds in CI, with nothing Crystal-specific installed.

## Keeping it current

Studio checks every time you open the project. If the SDK that ships with Studio is **newer** than your copy, or a file is missing, it replaces the copy; if yours is the same or newer, it's left alone. So:

- **Don't edit files in `.crystal/sdk`.** Changes are overwritten by the next update. (If you need something the SDK doesn't offer, a bot can call the API directly with `client.rest`, and see [the Bot API](doc:bots/api).)
- **Commit it, or don't.** Committing `.crystal/sdk` makes the project build exactly as it did when you last committed; the starter's `.gitignore` leaves it in so that's the default.
- **Everything else is yours.** Studio only ever adds missing starter files; it never rewrites `src/` or anything you've changed.

## What each SDK is

- **`@crystal/extension`** has `Extension` and `Panel`, the `ui` component builders, and `storage`, `http` and `notify` for the powers an extension can ask for. It has no dependencies and runs in the sandbox. Only what you import ends up in the built script.
- **`@crystal/bot`** has `Client`, the classes it hands you (`Message`, `Channel`, `Community`, `Member`, `Role`…), the builders (`EmbedBuilder`, `ButtonBuilder`, `ActionRowBuilder`), permissions, presence and voice. It needs Node 18 or newer and nothing else; voice also uses the optional `@livekit/rtc-node`.

## The code editor

Both kinds open in the same code editor: file tree, Monaco editor, Problems, Output and a terminal. See the Code editor guides in Explore for the layout and shortcuts, and [what the editor checks as you type](doc:extensions/editor-checks) for the extra checks on extensions.

For a bot, **`npm install`** in the terminal fetches the few development tools its `package.json` lists (`typescript`, `tsx`, `@types/node`); until you do, the editor uses a small built-in stand-in for Node's types so nothing is underlined for no reason.
