import { ui, type UiNode } from "./ui";

/** What an `onAction` handler is told when something in the panel is used. */
export class ActionContext {
  /** The `action` name of the button, input, toggle, select or list row. */
  readonly action: string;
  /** A list row's id. */
  readonly id?: string;
  /** For an input, toggle or select: its name, and its new value. */
  readonly name?: string;
  /** For an input, toggle or select: its new value. */
  readonly value?: unknown;
  /** Every input, toggle and select in the panel, by name, as they are right now. Sent with a button press. */
  readonly values: Record<string, string | boolean>;
  constructor(action: string, payload: unknown) {
    this.action = action;
    const p = (payload ?? {}) as { id?: string; name?: string; value?: unknown; values?: Record<string, string | boolean> };
    this.id = p.id;
    this.name = p.name;
    this.value = p.value;
    this.values = p.values ?? {};
  }
}

type Handler<T> = (arg: T) => void | Promise<void>;

/**
 * What a file exports when it handles one action: `export default defineAction("save", (ctx) => …)`.
 * An extension is bundled into one script, so there is nothing to scan for: `index.ts` imports each
 * file and passes them to `ext.use(...)`.
 */
export interface ActionHandler {
  /** Tells `use()` what this is. */
  kind: "action";
  /** The `action` name of the button, input, toggle, select or list row it handles. */
  action: string;
  /** What to do when the action happens. */
  run: Handler<ActionContext>;
}

/** What a file exports when it draws the panel as it opens: `export default defineOpen(() => …)`. */
export interface OpenHandler {
  /** Tells `use()` what this is. */
  kind: "open";
  /** What to do when the panel opens. */
  run: () => void | Promise<void>;
}

/** Declare the handler for one action, to put in a file's default export and pass to `ext.use()`. */
export function defineAction(action: string, run: Handler<ActionContext>): ActionHandler {
  return { kind: "action", action, run };
}

/** Declare what happens when the panel is opened, to put in a file's default export and pass to `ext.use()`. */
export function defineOpen(run: () => void | Promise<void>): OpenHandler {
  return { kind: "open", run };
}

/**
 * Your extension. Create one, say what it does when its panel is opened and when something in it
 * is used, and Crystal runs it in a sandbox.
 *
 * ```ts
 * const ext = new Extension();
 * ext.onOpen(() => ui.render(ui.card("Hi", [ui.button("Click", "click")])));
 * ext.onAction("click", () => notify("Clicked!"));
 * ```
 */
export class Extension {
  private actions = new Map<string, Handler<ActionContext>>();
  private fallback: Handler<ActionContext> | null = null;

  constructor() {
    // One listener for every action, so `onAction("name", …)` can be written per action.
    crystal.on("action", async (e: { action: string; value?: unknown }) => {
      const ctx = new ActionContext(e.action, e.value);
      const h = this.actions.get(e.action) ?? this.fallback;
      if (h) await h(ctx);
    });
  }

  /**
   * Add handlers that live in their own files (see `defineAction` and `defineOpen`). Two handlers
   * for one action are an error rather than one quietly replacing the other.
   */
  use(...handlers: (ActionHandler | OpenHandler)[]): this {
    for (const h of handlers) {
      if (h.kind === "open") this.onOpen(h.run);
      else if (h.kind === "action") {
        if (h.action !== "*" && this.actions.has(h.action)) throw new Error(`The action “${h.action}” is handled twice.`);
        if (h.action === "*" && this.fallback) throw new Error("There is more than one catch-all (\"*\") action handler.");
        this.onAction(h.action, h.run);
      } else throw new Error("ext.use() takes handlers made with defineAction() or defineOpen().");
    }
    return this;
  }

  /** Runs when the person opens your panel. Draw it here. */
  onOpen(handler: () => void | Promise<void>): this {
    crystal.on("open", handler);
    return this;
  }

  /** Runs when the control with this `action` name is used. Pass `"*"` to catch every action nothing else handles. */
  onAction(action: string, handler: Handler<ActionContext>): this {
    if (action === "*") this.fallback = handler;
    else this.actions.set(action, handler);
    return this;
  }
}

/**
 * A panel that redraws itself when its state changes: give it a starting state and a function from
 * state to what to show, and call `setState`.
 */
export class Panel<S extends object> {
  private current: S;
  constructor(
    private readonly view: (state: S) => UiNode,
    initial: S,
  ) {
    this.current = initial;
  }
  /** The state as it is now. */
  get state(): Readonly<S> {
    return this.current;
  }
  /** Change some of the state and redraw. */
  setState(patch: Partial<S>): void {
    this.current = { ...this.current, ...patch };
    this.render();
  }
  /** Draw the panel again from the current state. */
  render(): void {
    ui.render(this.view(this.current));
  }
}
