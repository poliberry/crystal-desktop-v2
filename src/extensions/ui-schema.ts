/**
 * What an extension may put on screen.
 *
 * An extension never draws anything itself. It describes what it wants as a tree of a
 * few kinds of node — text, a button, a list — and Crystal draws that tree with its
 * own components, in its own theme, inside a frame the extension can't alter or
 * remove. There is no HTML here, no CSS, no script, and no way to place something
 * outside the box: that is what stops an extension drawing a fake Crystal login, or
 * covering the real one.
 *
 * `sanitizeTree` is the only way a tree reaches the renderer. It is given whatever the
 * extension sent and returns a new tree built only from what it recognises, with every
 * string and number inside limits; anything else is dropped and reported, not repaired.
 */

export const UI_LIMITS = {
  depth: 8,
  nodes: 300,
  text: 2000,
  label: 80,
  items: 100,
  options: 50,
  action: 64,
  name: 40,
} as const;

export type Tone = "neutral" | "good" | "warn" | "bad" | "info";
export type TextVariant = "body" | "muted" | "title" | "heading" | "mono";

export type UiNode =
  | { type: "stack"; direction: "row" | "column"; gap: number; align: "start" | "center" | "end" | "stretch"; children: UiNode[] }
  | { type: "card"; title?: string; children: UiNode[] }
  | { type: "divider" }
  | { type: "text"; text: string; variant: TextVariant; tone?: Tone }
  | { type: "badge"; text: string; tone: Tone }
  | { type: "image"; src: string; alt: string; size: "sm" | "md" | "lg" }
  | { type: "progress"; value: number; label?: string }
  | { type: "list"; items: { id: string; title: string; subtitle?: string; badge?: string; action?: string }[] }
  | { type: "button"; label: string; action: string; variant: "primary" | "secondary" | "danger"; disabled?: boolean }
  | { type: "input"; name: string; value: string; placeholder?: string; action?: string; label?: string }
  | { type: "toggle"; name: string; checked: boolean; label: string; action?: string }
  | { type: "select"; name: string; value: string; label?: string; options: { value: string; label: string }[]; action?: string };

export interface SanitizeContext {
  /** Origins the extension may talk to: the only places an image may come from, so a
   * picture can't be used as a tracking pixel for somewhere nobody agreed to. */
  origins: string[];
}

export interface SanitizeResult {
  tree: UiNode | null;
  problems: string[];
}

const ACTION = /^[A-Za-z0-9_.:-]{1,64}$/;
const NAME = /^[A-Za-z0-9_.-]{1,40}$/;
const TONES: Tone[] = ["neutral", "good", "warn", "bad", "info"];
const VARIANTS: TextVariant[] = ["body", "muted", "title", "heading", "mono"];

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f‪-‮⁦-⁩]/g, "").slice(0, max) : "");
const num = (v: unknown, min: number, max: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const action = (v: unknown): string | undefined => (typeof v === "string" && ACTION.test(v) ? v : undefined);

export function sanitizeTree(input: unknown, ctx: SanitizeContext): SanitizeResult {
  const problems: string[] = [];
  let count = 0;
  const note = (m: string) => {
    if (problems.length < 20) problems.push(m);
  };

  const node = (raw: unknown, depth: number): UiNode | null => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      note("A node wasn't an object.");
      return null;
    }
    if (depth > UI_LIMITS.depth) {
      note(`Nested more than ${UI_LIMITS.depth} levels deep.`);
      return null;
    }
    if (++count > UI_LIMITS.nodes) {
      if (count === UI_LIMITS.nodes + 1) note(`More than ${UI_LIMITS.nodes} nodes.`);
      return null;
    }
    const n = raw as Record<string, unknown>;
    const kids = (): UiNode[] => (Array.isArray(n.children) ? n.children.map((c) => node(c, depth + 1)).filter((c): c is UiNode => c !== null) : []);

    switch (n.type) {
      case "stack":
        return { type: "stack", direction: oneOf(n.direction, ["row", "column"] as const, "column"), gap: Math.round(num(n.gap, 0, 6, 2)), align: oneOf(n.align, ["start", "center", "end", "stretch"] as const, "stretch"), children: kids() };
      case "card":
        return { type: "card", title: str(n.title, UI_LIMITS.label) || undefined, children: kids() };
      case "divider":
        return { type: "divider" };
      case "text":
        return { type: "text", text: str(n.text, UI_LIMITS.text), variant: oneOf(n.variant, VARIANTS, "body"), tone: n.tone === undefined ? undefined : oneOf(n.tone, TONES, "neutral") };
      case "badge":
        return { type: "badge", text: str(n.text, UI_LIMITS.label), tone: oneOf(n.tone, TONES, "neutral") };
      case "image": {
        let src = "";
        try {
          const u = new URL(String(n.src));
          if (u.protocol === "https:" && ctx.origins.includes(u.origin)) src = u.href;
          else note(`An image from ${u.hostname} was dropped: images may only come from the sites the extension was allowed to talk to.`);
        } catch {
          note("An image had an address that isn't valid.");
        }
        return src ? { type: "image", src, alt: str(n.alt, UI_LIMITS.label), size: oneOf(n.size, ["sm", "md", "lg"] as const, "md") } : null;
      }
      case "progress":
        return { type: "progress", value: num(n.value, 0, 100, 0), label: str(n.label, UI_LIMITS.label) || undefined };
      case "list": {
        const items = (Array.isArray(n.items) ? n.items : []).slice(0, UI_LIMITS.items).map((it, i) => {
          const r = (it ?? {}) as Record<string, unknown>;
          return { id: str(r.id, UI_LIMITS.name) || String(i), title: str(r.title, UI_LIMITS.label), subtitle: str(r.subtitle, UI_LIMITS.text) || undefined, badge: str(r.badge, UI_LIMITS.label) || undefined, action: action(r.action) };
        });
        return { type: "list", items };
      }
      case "button": {
        const a = action(n.action);
        if (!a) {
          note("A button had no valid action id (letters, numbers and _ . : -, up to 64).");
          return null;
        }
        return { type: "button", label: str(n.label, UI_LIMITS.label), action: a, variant: oneOf(n.variant, ["primary", "secondary", "danger"] as const, "secondary"), disabled: n.disabled === true || undefined };
      }
      case "input": {
        if (typeof n.name !== "string" || !NAME.test(n.name)) {
          note("An input needs a name (letters, numbers and _ . -).");
          return null;
        }
        return { type: "input", name: n.name, value: str(n.value, UI_LIMITS.text), placeholder: str(n.placeholder, UI_LIMITS.label) || undefined, action: action(n.action), label: str(n.label, UI_LIMITS.label) || undefined };
      }
      case "toggle": {
        if (typeof n.name !== "string" || !NAME.test(n.name)) {
          note("A toggle needs a name.");
          return null;
        }
        return { type: "toggle", name: n.name, checked: n.checked === true, label: str(n.label, UI_LIMITS.label), action: action(n.action) };
      }
      case "select": {
        if (typeof n.name !== "string" || !NAME.test(n.name)) {
          note("A select needs a name.");
          return null;
        }
        const options = (Array.isArray(n.options) ? n.options : []).slice(0, UI_LIMITS.options).map((o) => {
          const r = (o ?? {}) as Record<string, unknown>;
          return { value: str(r.value, UI_LIMITS.name), label: str(r.label, UI_LIMITS.label) };
        });
        return { type: "select", name: n.name, value: str(n.value, UI_LIMITS.name), label: str(n.label, UI_LIMITS.label) || undefined, options, action: action(n.action) };
      }
      default:
        note(`“${String(n.type).slice(0, 20)}” isn't something that can be drawn.`);
        return null;
    }
  };

  return { tree: node(input, 0), problems };
}
