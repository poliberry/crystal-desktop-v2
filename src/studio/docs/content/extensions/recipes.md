---
title: Recipes
topic: extensions
kind: article
section: Examples
order: 160
summary: Small complete extensions to copy: a to-do list, a refreshing panel, and settings that stick.
---

Each recipe is a whole `src/index.ts`. Paste it over the starter, tick the powers it lists, and press Run.

## A to-do list

Needs **Show a panel** and **Keep some data**.

~~~ts extension
import { Extension, Panel, storage, ui } from "@crystal/extension";

interface Todo {
  id: string;
  text: string;
  done: boolean;
}

const ext = new Extension();

const panel = new Panel(
  (s: { todos: Todo[]; draft: string }) =>
    ui.column([
      ui.heading("To do"),
      ui.row([ui.input("draft", s.draft, { placeholder: "Add something…" }), ui.button("Add", "add")]),
      ui.list(s.todos.map((t) => ({ id: t.id, title: t.text, badge: t.done ? "done" : undefined, action: "toggle" }))),
    ]),
  { todos: [] as Todo[], draft: "" },
);

ext.onOpen(async () => {
  panel.setState({ todos: (await storage.get<Todo[]>("todos")) ?? [] });
});

ext.onAction("add", async (ctx) => {
  const text = String(ctx.values.draft ?? "").trim();
  if (!text) return;
  panel.setState({ todos: [...panel.state.todos, { id: String(Date.now()), text, done: false }], draft: "" });
  await storage.set("todos", panel.state.todos);
});

ext.onAction("toggle", async (ctx) => {
  panel.setState({ todos: panel.state.todos.map((t) => (t.id === ctx.id ? { ...t, done: !t.done } : t)) });
  await storage.set("todos", panel.state.todos);
});
~~~

## A panel that refreshes itself

Needs **Show a panel** and **Talk to the internet**, with `https://api.example.org` under *Sites it may talk to*.

~~~ts extension
import { Extension, Panel, http, ui } from "@crystal/extension";

// Sites it may talk to: https://api.example.org

const ext = new Extension();

const panel = new Panel(
  (s: { value: string; updated: string }) => ui.column([ui.title(s.value), ui.muted(s.updated ? "Updated " + s.updated : "Loading…")]),
  { value: "—", updated: "" },
);

async function refresh() {
  try {
    const res = await http.fetch("https://api.example.org/price");
    if (!res.ok) throw new Error("status " + res.status);
    panel.setState({ value: res.json<{ price: string }>().price, updated: new Date().toLocaleTimeString() });
  } catch (e) {
    console.warn("refresh failed", e);
  }
}

ext.onOpen(() => {
  panel.render();
  void refresh();
  // Every minute while the panel is open. At most five timers at once.
  setInterval(() => void refresh(), 60_000);
});
~~~

## Settings that stick

Needs **Show a panel**, **Keep some data** and **Show notices**.

~~~ts extension
import { Extension, Panel, notify, storage, ui } from "@crystal/extension";

interface Settings {
  nickname: string;
  theme: string;
  sounds: boolean;
}

const ext = new Extension();

const panel = new Panel(
  (s: Settings) =>
    ui.card("Settings", [
      ui.input("nickname", s.nickname, { label: "Nickname" }),
      ui.select("theme", s.theme, [{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }], { label: "Look" }),
      ui.toggle("sounds", s.sounds, "Play sounds"),
      ui.button("Save", "save", { variant: "primary" }),
    ]),
  { nickname: "", theme: "dark", sounds: true } as Settings,
);

ext.onOpen(async () => {
  panel.setState((await storage.get<Settings>("settings")) ?? {});
});

ext.onAction("save", async (ctx) => {
  const next: Settings = { nickname: String(ctx.values.nickname ?? ""), theme: String(ctx.values.theme ?? "dark"), sounds: ctx.values.sounds === true };
  await storage.set("settings", next);
  panel.setState(next);
  await notify("Saved");
});
~~~
