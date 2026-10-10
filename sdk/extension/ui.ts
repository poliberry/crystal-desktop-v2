/**
 * Everything an extension may put on screen. You describe a panel as a tree of these nodes and
 * Crystal draws it with its own components in its own theme, inside a frame you can't change: there
 * is no HTML, CSS or script here, which is what stops a panel passing itself off as part of Crystal.
 */

export type Tone = "neutral" | "good" | "warn" | "bad" | "info";
/** How things line up across a row or column. */
export type Align = "start" | "center" | "end" | "stretch";
/** The style of a piece of text. */
export type TextVariant = "body" | "muted" | "title" | "heading" | "mono";

/** Anything that can be drawn in a panel. */
export type UiNode =
  | { type: "stack"; direction: "row" | "column"; gap?: number; align?: Align; children: UiNode[] }
  | { type: "card"; title?: string; children: UiNode[] }
  | { type: "divider" }
  | { type: "text"; text: string; variant?: TextVariant; tone?: Tone }
  | { type: "badge"; text: string; tone?: Tone }
  | { type: "image"; src: string; alt?: string; size?: "sm" | "md" | "lg" }
  | { type: "progress"; value: number; label?: string }
  | { type: "list"; items: ListItem[] }
  | { type: "button"; label: string; action: string; variant?: "primary" | "secondary" | "danger"; disabled?: boolean }
  | { type: "input"; name: string; value: string; placeholder?: string; label?: string; action?: string }
  | { type: "toggle"; name: string; checked: boolean; label: string; action?: string }
  | { type: "select"; name: string; value: string; label?: string; options: { value: string; label: string }[]; action?: string };

/** One row of a list. */
export interface ListItem {
  /** Sent with the action as `ctx.id`. */
  id: string;
  /** The row's main text. */
  title: string;
  /** A smaller second line. */
  subtitle?: string;
  /** A small label at the end of the row. */
  badge?: string;
  /** Sent to your `onAction` handler, with `{ id }`, when the row is pressed. */
  action?: string;
}

interface Layout {
  gap?: number;
  align?: Align;
}

/**
 * Builders for the nodes above. Needs the "Show a panel" power.
 *
 * `ui.render(tree)` replaces what the panel shows. Crystal limits how often a panel can redraw and
 * how big a tree can be, and quietly drops anything it doesn't recognise.
 */
export const ui = {
  /** Replace what the panel shows. */
  render(tree: UiNode): void {
    crystal.ui.render(tree);
  },
  /** Lay children out in a row or a column. */
  stack: (children: UiNode[], o: Layout & { direction?: "row" | "column" } = {}): UiNode => ({ type: "stack", direction: o.direction ?? "column", gap: o.gap, align: o.align, children }),
  /** Lay children out side by side. */
  row: (children: UiNode[], o: Layout = {}): UiNode => ({ type: "stack", direction: "row", gap: o.gap, align: o.align, children }),
  /** Lay children out one under another. */
  column: (children: UiNode[], o: Layout = {}): UiNode => ({ type: "stack", direction: "column", gap: o.gap, align: o.align, children }),
  /** A titled box around children. */
  card: (title: string, children: UiNode[]): UiNode => ({ type: "card", title, children }),
  /** A thin line between things. */
  divider: (): UiNode => ({ type: "divider" }),
  /** A piece of text, in a variant and tone. */
  text: (text: string, o: { variant?: TextVariant; tone?: Tone } = {}): UiNode => ({ type: "text", text: String(text), ...o }),
  /** A section heading. */
  heading: (text: string): UiNode => ({ type: "text", text: String(text), variant: "heading" }),
  /** A large title. */
  title: (text: string): UiNode => ({ type: "text", text: String(text), variant: "title" }),
  /** Quiet, smaller text. */
  muted: (text: string): UiNode => ({ type: "text", text: String(text), variant: "muted" }),
  /** Text in a monospace font. */
  mono: (text: string): UiNode => ({ type: "text", text: String(text), variant: "mono" }),
  /** A small coloured label. */
  badge: (text: string, tone: Tone = "neutral"): UiNode => ({ type: "badge", text: String(text), tone }),
  /** Only from a site listed in the project's "Sites it may talk to". */
  image: (src: string, alt = "", size: "sm" | "md" | "lg" = "md"): UiNode => ({ type: "image", src, alt, size }),
  /** A progress bar from 0 to 1. */
  progress: (value: number, label?: string): UiNode => ({ type: "progress", value, label }),
  /** A list of rows. Pressing a row sends its `action` with `{ id }`. */
  list: (items: ListItem[]): UiNode => ({ type: "list", items }),
  /** `action` comes back to `onAction` when it is pressed, with all the panel's current input values as `values`. */
  button: (label: string, action: string, o: { variant?: "primary" | "secondary" | "danger"; disabled?: boolean } = {}): UiNode => ({ type: "button", label: String(label), action, ...o }),
  /** A text box. Its value arrives in `ctx.values[name]`. */
  input: (name: string, value = "", o: { placeholder?: string; label?: string; action?: string } = {}): UiNode => ({ type: "input", name, value, ...o }),
  /** A switch. Its state arrives in `ctx.values[name]`. */
  toggle: (name: string, checked: boolean, label: string, o: { action?: string } = {}): UiNode => ({ type: "toggle", name, checked, label, ...o }),
  /** A drop-down. Its choice arrives in `ctx.values[name]`. */
  select: (name: string, value: string, options: { value: string; label: string }[], o: { label?: string; action?: string } = {}): UiNode => ({ type: "select", name, value, options, ...o }),
};
