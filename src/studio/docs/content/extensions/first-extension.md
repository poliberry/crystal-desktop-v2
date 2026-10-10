---
title: Your first extension
topic: extensions
kind: guide
section: Start here
order: 110
summary: Make a counter panel that remembers its count, and try it.
---

You need the desktop app: a project is a folder on your computer, and the code editor and sandbox live there.

## Make the project

1. In Studio choose **New project** and pick **Extension**. Give it a name.
2. The code editor opens on `src/index.ts`. Studio has already put the SDK in `.crystal/sdk/extension` and written a working starter.
3. In the project settings, write a sentence about what it does. People read this before they install it.

## The starter, line by line

~~~ts extension
import { Extension, Panel, storage, ui } from "@crystal/extension";

const ext = new Extension();

const panel = new Panel(
  (s: { count: number }) =>
    ui.column([
      ui.heading("Hello from my extension"),
      ui.text("Clicked " + s.count + " times"),
      ui.row([ui.button("Click me", "click"), ui.button("Reset", "reset", { variant: "secondary" })]),
    ]),
  { count: 0 },
);

ext.onOpen(async () => {
  panel.setState({ count: (await storage.get<number>("count")) ?? 0 });
});

ext.onAction("click", async () => {
  const count = panel.state.count + 1;
  await storage.set("count", count);
  panel.setState({ count });
});
~~~

- A **`Panel`** is a function from *state* to *what to show*, plus a starting state. `panel.setState({ count })` changes part of the state and redraws.
- **`ext.onOpen`** runs when somebody opens your panel. Draw it, and load what it needs.
- **`ext.onAction("click", …)`** runs when the control whose action is `"click"` is used. The button's second argument is its action name.
- **`storage`** keeps a value between sessions. It needs the *Keep some data* power.

## Try it

- **Run** (in the Run menu) builds the project and runs it in the real sandbox. The panel appears beside the editor, and buttons really reach your code.
- **Build** writes `dist/extension.js`.
- Problems, from TypeScript and from Crystal's own checks, appear underlined in the editor and in the Problems list.

## Say what it needs

The starter uses a panel and storage, so the project settings, under **What it asks for**, have *Show a panel* and *Keep some data* ticked. If you use something you haven't ticked, the editor underlines it. See [powers](doc:extensions/powers).
