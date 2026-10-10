---
title: "Powers: storage, the internet and notices"
topic: extensions
kind: guide
section: Building
order: 130
summary: What an extension has to ask for before it can keep data, reach a website or show a notice.
---

An extension starts with **no powers**. Each thing it can do that touches anything outside itself is a *power*. You tick the ones you need in the project settings under **What it asks for**; the person installing it sees the list and agrees to it; and the sandbox refuses anything that wasn't agreed, whatever the code says.

{{extension-powers}}

Ask only for what you use. The checks warn when you ask for something you never use, and an update that adds a power is read again by a reviewer.

## Keep some data

`storage` is a small private store for each person who installs your extension. Nobody else, including other extensions, can read it, and it is deleted when the extension is removed. Values are anything JSON can hold.

~~~ts extension
import { Extension, Panel, storage, ui } from "@crystal/extension";

const ext = new Extension();
const panel = new Panel((s: { visits: number }) => ui.text("Opened " + s.visits + " times"), { visits: 0 });

ext.onOpen(async () => {
  const visits = ((await storage.get<number>("visits")) ?? 0) + 1;
  await storage.set("visits", visits);
  panel.setState({ visits });
});
~~~

`storage.get(key)`, `storage.set(key, value)`, `storage.delete(key)` and `storage.list()` are all asynchronous.

## Talk to the internet

`http.fetch` makes a request for you. The request is made by Crystal's servers, not from the person's computer, so your extension never learns anything about the device it runs on. It reaches **only the sites you list** under *Sites it may talk to*, each written as just the address, like `https://api.example.org`. Everything else is refused.

{{extension-http}}

~~~ts extension
import { Extension, Panel, http, ui } from "@crystal/extension";

// Sites it may talk to: https://api.example.org

const ext = new Extension();
const panel = new Panel((s: { line: string }) => ui.column([ui.text(s.line), ui.button("Again", "again")]), { line: "…" });

async function load() {
  const res = await http.fetch("https://api.example.org/quote");
  panel.setState({ line: res.ok ? res.json<{ text: string }>().text : "That didn't work (" + res.status + ")." });
}

ext.onOpen(load);
ext.onAction("again", load);
~~~

`res` has `status`, `ok`, `contentType`, `text` and `json()`. To send data, pass `{ method: "POST", headers, body }`; a body that is an object is sent as JSON, and a string is sent as it is. Set `"content-type"` to say which.

## Show notices

`await notify("Saved")` pops up a short notice (up to 200 characters, five a minute) inside Crystal.

~~~ts extension
import { Extension, notify } from "@crystal/extension";

const ext = new Extension();
ext.onAction("save", async () => {
  await notify("Saved");
});
~~~

## What no power gives you

Timers (`setTimeout`, `setInterval`) and `console.log` need nothing. Reading the person's messages, account, files or other extensions is not a power that exists.
