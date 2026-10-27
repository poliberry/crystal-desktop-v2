---
title: Building panels
topic: extensions
kind: guide
section: Building
order: 120
summary: Every component a panel is made of, and how a button press reaches your code.
---

A panel is a tree of components built with `ui`. Needs the **Show a panel** power. Crystal sends the tree to the screen and draws it itself; anything it doesn't recognise is dropped.

## Components

| Builder | What it draws |
| --- | --- |
| `ui.column(children, { gap, align })` / `ui.row(children, …)` | Lay children out down or across. `ui.stack` takes a `direction`. |
| `ui.card(title, children)` | A titled box. |
| `ui.divider()` | A line. |
| `ui.text(text, { variant, tone })` | Text. Variants: `body`, `muted`, `title`, `heading`, `mono`. Tones: `neutral`, `good`, `warn`, `bad`, `info`. |
| `ui.heading(text)`, `ui.title(text)`, `ui.muted(text)`, `ui.mono(text)` | Shorthand for `ui.text` with that variant. |
| `ui.badge(text, tone)` | A small label. |
| `ui.image(src, alt, size)` | A picture (`sm`, `md`, `lg`). Only from a site you listed under *Sites it may talk to*, over https; any other is dropped. |
| `ui.progress(value, label)` | A bar; `value` is 0 to 100. |
| `ui.list(items)` | Rows with `id`, `title`, optional `subtitle`, `badge` and `action`. |
| `ui.button(label, action, { variant, disabled })` | A button: `primary`, `secondary` or `danger`. |
| `ui.input(name, value, { placeholder, label, action })` | A text box. |
| `ui.toggle(name, checked, label, { action })` | A switch. |
| `ui.select(name, value, options, { label, action })` | A drop-down. |

## Drawing

Use a `Panel` and `setState`, or call `ui.render(tree)` yourself. A panel can be redrawn many times a second, but Crystal limits how often; see [limits](doc:extensions/limits).

~~~ts extension
import { Extension, Panel, ui } from "@crystal/extension";

const ext = new Extension();

const panel = new Panel(
  (s: { name: string; loud: boolean }) =>
    ui.card("Greeter", [
      ui.input("name", s.name, { label: "Your name" }),
      ui.toggle("loud", s.loud, "Shout it"),
      ui.button("Say hello", "greet", { variant: "primary" }),
      ui.text(s.name ? (s.loud ? "HELLO, " + s.name.toUpperCase() : "Hello, " + s.name) : "Type a name", { tone: "good" }),
    ]),
  { name: "", loud: false },
);

ext.onOpen(() => panel.render());
~~~

## Handling use

`ext.onAction(name, handler)` runs when a control with that `action` is used. The handler is given a context:

| Field | What it is |
| --- | --- |
| `ctx.action` | The action name. |
| `ctx.id` | For a list row, the row's `id`. |
| `ctx.name`, `ctx.value` | For an input, toggle or select, its name and its new value. |
| `ctx.values` | **Every** input, toggle and select in the panel, by name, as they are now. Sent with a button press. |

~~~ts extension
import { Extension, notify } from "@crystal/extension";

const ext = new Extension();

ext.onAction("greet", async (ctx) => {
  const name = String(ctx.values.name ?? "");
  await notify(name ? "Hello, " + name + "!" : "Type a name first.");
});

// A catch-all for any action nothing else handles.
ext.onAction("*", (ctx) => console.log("unhandled action", ctx.action));
~~~

An input or toggle without an `action` just holds its value, ready for `ctx.values`. Give it an `action` to be told about each change.

## Good habits

- Keep the state small and plain: numbers, strings, booleans.
- Draw from state, don't build the tree in handlers; your view stays correct however you got to a state.
- Escape nothing: text is shown as text. There is no HTML to inject into.
