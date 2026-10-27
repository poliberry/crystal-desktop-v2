/**
 * Confining a stylesheet to one subtree.
 *
 * Profile CSS is written by one person and rendered in *everyone else's*
 * client. That makes it a different problem from the app-wide custom CSS in
 * `CustomCssProvider`, which only ever affects the person who wrote it: there,
 * reaching anything on screen is the whole feature, whereas here a rule that
 * escaped the card would let anybody restyle — or hide — the rest of your
 * client by putting a selector on their profile.
 *
 * So every rule is rewritten to sit under a scope selector before it reaches
 * the document, and the handful of things that can't be scoped are dropped.
 * This is a rewriter rather than a sanitiser of values: CSS values themselves
 * can't execute anything in a modern browser, and `url()` is no worse than the
 * images a profile can already carry. What matters is *reach*.
 */

/**
 * At-rules that can't be scoped, and are refused.
 *
 * `@import` would fetch a stylesheet whose contents this never sees.
 * `@font-face`, `@keyframes`, `@property` and `@counter-style` all register
 * names globally — a profile could redefine an animation the app itself uses.
 * Everything else (`@media`, `@supports`, `@container`) is a wrapper whose
 * inner rules get scoped normally.
 */
const UNSCOPABLE_AT_RULES = new Set([
  "import",
  "font-face",
  "keyframes",
  "-webkit-keyframes",
  "property",
  "counter-style",
  "namespace",
  "page",
  "charset",
]);

/** How much of a stylesheet to accept. Long enough for anything sensible,
 * short enough that a profile can't ship a megabyte of rules to everyone who
 * looks at it. */
export const MAX_PROFILE_CSS_LENGTH = 8_000;

/**
 * Rewrite one selector list so every selector in it is under `scope`.
 *
 * `:root`, `html` and `body` become the scope itself rather than being
 * dropped: they're what somebody reaches for to set variables, and inside a
 * scoped sheet "the root" sensibly means the card.
 *
 * `&` is supported as "the scope", the way nesting reads.
 */
function scopeSelectorList(selectorList: string, scope: string): string {
  return selectorList
    .split(",")
    .map((selector) => {
      const trimmed = selector.trim();
      if (!trimmed) return "";
      if (/^(:root|html|body)$/i.test(trimmed)) return scope;
      if (trimmed.startsWith("&")) return scope + trimmed.slice(1);
      // A descendant of the scope. Also catches `:hover` and friends written
      // bare, which land as `<scope> :hover` — harmless, if not what was meant.
      return `${scope} ${trimmed}`;
    })
    .filter(Boolean)
    .join(", ");
}

/**
 * Scope a whole stylesheet.
 *
 * A hand-rolled brace walk rather than a parser: what's needed is only to know
 * where a selector list ends and a block begins, and to recurse into the block
 * when the rule is a conditional group like `@media`. A real parser would also
 * have to be right about broken input, and broken input is most of what an
 * editor contains while it's being typed into — this leaves anything it can't
 * make sense of out rather than throwing.
 */
export function scopeCss(css: string, scope: string): string {
  const source = css.slice(0, MAX_PROFILE_CSS_LENGTH);
  const out: string[] = [];
  let at = 0;

  /** Read to the matching `}`, returning the block's inner text. */
  const readBlock = (from: number): { body: string; end: number } => {
    let depth = 0;
    for (let i = from; i < source.length; i++) {
      const ch = source[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return { body: source.slice(from + 1, i), end: i + 1 };
      }
    }
    // Unclosed — take what's there. Someone is mid-keystroke.
    return { body: source.slice(from + 1), end: source.length };
  };

  while (at < source.length) {
    // Comments are dropped wholesale: they can hold anything, and none of it
    // needs to reach the document.
    const commentStart = source.indexOf("/*", at);
    const braceIndex = source.indexOf("{", at);
    const semicolonIndex = source.indexOf(";", at);

    if (commentStart >= 0 && (braceIndex < 0 || commentStart < braceIndex)) {
      const commentEnd = source.indexOf("*/", commentStart + 2);
      // Splice the comment out and carry on from the same point.
      const before = source.slice(at, commentStart);
      if (before.trim()) {
        // Stray text before a comment with no block — ignore it.
      }
      at = commentEnd < 0 ? source.length : commentEnd + 2;
      continue;
    }

    if (braceIndex < 0) break;

    // A statement at-rule (`@import url(...);`) ends at a semicolon before the
    // next block, and is refused outright.
    if (semicolonIndex >= 0 && semicolonIndex < braceIndex) {
      at = semicolonIndex + 1;
      continue;
    }

    const prelude = source.slice(at, braceIndex).trim();
    const { body, end } = readBlock(braceIndex);
    at = end;
    if (!prelude) continue;

    if (prelude.startsWith("@")) {
      const name = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase() ?? "";
      if (UNSCOPABLE_AT_RULES.has(name)) continue;
      // A conditional group: keep the condition, scope what's inside it.
      const inner = scopeCss(body, scope);
      if (inner.trim()) out.push(`${prelude} { ${inner} }`);
      continue;
    }

    const selector = scopeSelectorList(prelude, scope);
    if (selector && body.trim()) out.push(`${selector} { ${body.trim()} }`);
  }

  return out.join("\n");
}

/**
 * The attribute that marks a scoped subtree, and the selector that matches it.
 *
 * An attribute rather than a class so a profile's own CSS can't accidentally
 * match it — `[data-profile-css="…"]` is not something anybody types by
 * mistake, and the id makes two profiles on screen at once (a popover over a
 * page) independent of each other.
 */
export const PROFILE_CSS_ATTRIBUTE = "data-profile-css";

export function profileCssScope(id: string): string {
  return `[${PROFILE_CSS_ATTRIBUTE}="${id}"]`;
}
