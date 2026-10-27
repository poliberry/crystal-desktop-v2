---
title: Splitting an extension into files
topic: extensions
kind: guide
section: Building
order: 125
summary: One file per action, imported by index.ts, so each stays small.
---

An extension is bundled into a single script, so there's no folder for the SDK to scan at run time the way a bot's handlers are found. What you do instead is ordinary: put each action in its own file, and import them.

~~~
src/
  index.ts          creates the extension and lists what it does
  open.ts           what happens when the panel opens
  actions/
    save.ts
    reset.ts
  view.ts           how the panel looks
~~~

## A file per action

`defineAction` names the action and says what it does. Export it as the file's default.

~~~ts extension
// src/actions/save.ts
import { defineAction, storage } from "@crystal/extension";

export default defineAction("save", async (ctx) => {
  await storage.set("name", String(ctx.values.name ?? ""));
});
~~~

Another file, for another action:

~~~ts extension
// src/actions/reset.ts
import { defineAction, storage } from "@crystal/extension";

export default defineAction("reset", async () => {
  await storage.delete("name");
});
~~~

## What happens on open

~~~ts extension
// src/open.ts
import { defineOpen, ui } from "@crystal/extension";

export default defineOpen(() => {
  ui.render(ui.card("Notes", [ui.input("name", "", { label: "Your name" }), ui.button("Save", "save"), ui.button("Reset", "reset", { variant: "secondary" })]));
});
~~~

## index.ts

~~~ts extension
// src/index.ts
import { Extension } from "@crystal/extension";

import open from "./open";
import save from "./actions/save";
import reset from "./actions/reset";

// One call lists everything the extension does.
new Extension().use(open, save, reset);
~~~

`use()` takes any number of handlers made with `defineAction` or `defineOpen`.

## Rules

- Each action name can be handled **once**. Two handlers for one name are an error, rather than the second quietly replacing the first. `onAction("*", …)` — or `defineAction("*", …)` — catches every action nothing else handles, and there can be only one.
- Import your own files with a relative path (`./open`). You can't import other packages: the sandbox runs one script, and the editor underlines the import.
- A handler file can import `ui`, `storage` and the rest from `@crystal/extension` like any other file. What the extension imports is what it can do, so the powers it asks for should match.
- You can mix `use()` with `ext.onOpen` and `ext.onAction`; use whichever reads better.

For sharing a panel's look between files, put the function that builds it in its own file (`view.ts` above) and import it where it's needed. [Building panels](doc:extensions/panels) lists every component.
