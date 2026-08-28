"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FolderOpen, Loader2, RotateCcw } from "lucide-react";

import { useCustomCss } from "@/components/custom-css-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * The custom-CSS editor.
 *
 * A real editor rather than a bare `<textarea>`, built the way editors were
 * before anyone shipped a megabyte of one: a transparent textarea sits exactly
 * on top of a highlighted `<pre>`, and the two are kept in perfect alignment by
 * using the same font metrics, padding and scroll offset. The textarea is what
 * has focus, a caret and a selection — all the parts that are miserable to
 * reimplement — while the `<pre>` underneath supplies the colour.
 *
 * That buys syntax highlighting, line numbers, bracket-aware indentation and
 * live preview without adding an editor dependency to a desktop app that is
 * already shipping a browser.
 */

const CustomCssContext = createContext<(() => void) | null>(null);

/* -------------------------------------------------------------------------- */
/* Highlighting                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Tokenise CSS well enough to colour it.
 *
 * Deliberately not a parser: it never has to *understand* the stylesheet, only
 * to say which run of characters is a comment, a string, a selector, a
 * property, a value or a number. A real parser would also have to be correct
 * about broken input, and broken input is most of what an editor contains
 * while it's being typed into.
 */
type Token = { text: string; kind: string };

const TOKEN_CLASS: Record<string, string> = {
  comment: "text-muted-foreground/60 italic",
  string: "text-amber-300",
  atrule: "text-fuchsia-400",
  selector: "text-sky-300",
  property: "text-emerald-300",
  number: "text-orange-300",
  punct: "text-muted-foreground",
  plain: "text-foreground/90",
};

function tokenise(source: string): Token[] {
  const tokens: Token[] = [];
  // Whether we're between `{` and `}` — the same word is a property inside a
  // block and part of a selector outside one, and nothing else distinguishes
  // them.
  let depth = 0;
  let i = 0;

  const push = (text: string, kind: string) => {
    if (!text) return;
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind) last.text += text;
    else tokens.push({ text, kind });
  };

  while (i < source.length) {
    const rest = source.slice(i);

    const comment = /^\/\*[\s\S]*?(\*\/|$)/.exec(rest);
    if (comment) {
      push(comment[0], "comment");
      i += comment[0].length;
      continue;
    }

    const string = /^(["'])(?:\\.|(?!\1)[^\\\n])*\1?/.exec(rest);
    if (string) {
      push(string[0], "string");
      i += string[0].length;
      continue;
    }

    const atRule = /^@[\w-]+/.exec(rest);
    if (atRule) {
      push(atRule[0], "atrule");
      i += atRule[0].length;
      continue;
    }

    const char = source[i];
    if (char === "{") {
      depth++;
      push(char, "punct");
      i++;
      continue;
    }
    if (char === "}") {
      depth = Math.max(0, depth - 1);
      push(char, "punct");
      i++;
      continue;
    }
    if (char === ";" || char === ":" || char === "," || char === "(" || char === ")") {
      push(char, "punct");
      i++;
      continue;
    }

    const number = /^-?\d*\.?\d+(px|rem|em|%|vh|vw|s|ms|deg|fr)?|^#[0-9a-fA-F]{3,8}\b/.exec(
      rest,
    );
    if (number) {
      push(number[0], "number");
      i += number[0].length;
      continue;
    }

    const word = /^[^\s{};:,()"'@]+/.exec(rest);
    if (word) {
      // Inside a block, a word followed (eventually) by a colon is a property;
      // anything after the colon is a value. Outside, it's part of a selector.
      const after = source.slice(i + word[0].length);
      const isProperty = depth > 0 && /^\s*:/.test(after);
      push(word[0], depth > 0 ? (isProperty ? "property" : "plain") : "selector");
      i += word[0].length;
      continue;
    }

    push(char, "plain");
    i++;
  }

  return tokens;
}

/* -------------------------------------------------------------------------- */
/* Editor                                                                     */
/* -------------------------------------------------------------------------- */

/** Shared by the textarea and the highlight layer. Any difference here — a
 * font, a letter-spacing, a padding — shows up as the caret drifting away from
 * the text, so it lives in one constant. */
const EDITOR_TYPE =
  "font-mono text-[13px] leading-[1.6] tracking-normal whitespace-pre-wrap break-words";

function CssEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  /** Keep the two layers and the gutter on the same scroll offset. Done on the
   * event rather than with `scroll-behavior`, because any lag is visible as the
   * text sliding out from under the caret. */
  const syncScroll = useCallback(() => {
    const source = textareaRef.current;
    if (!source) return;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = source.scrollTop;
      highlightRef.current.scrollLeft = source.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = source.scrollTop;
  }, []);

  // Re-sync after the text changes: a line added above the viewport moves
  // everything without firing a scroll event.
  useLayoutEffect(syncScroll, [value, syncScroll]);

  const lineCount = useMemo(() => value.split("\n").length, [value]);
  const tokens = useMemo(() => tokenise(value), [value]);

  /**
   * Tab indents instead of leaving the field, and Enter after `{` indents the
   * new line — the two things that make writing CSS in a plain textarea
   * unpleasant enough to give up on.
   *
   * Escape still has to leave, or the dialog becomes a trap for keyboard users.
   */
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const { selectionStart, selectionEnd } = el;

    if (e.key === "Tab") {
      e.preventDefault();
      const next =
        value.slice(0, selectionStart) + "  " + value.slice(selectionEnd);
      onChange(next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = selectionStart + 2;
      });
      return;
    }

    if (e.key === "Enter") {
      const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
      const line = value.slice(lineStart, selectionStart);
      const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
      const opensBlock = /\{\s*$/.test(line);
      if (!indent && !opensBlock) return;

      e.preventDefault();
      const added = indent + (opensBlock ? "  " : "");
      // A closing brace is written too, but only when the next thing isn't
      // already one — otherwise every Enter after `{` would double them up.
      const closing =
        opensBlock && !/^\s*\}/.test(value.slice(selectionEnd))
          ? `\n${indent}}`
          : "";
      const next =
        value.slice(0, selectionStart) +
        "\n" +
        added +
        closing +
        value.slice(selectionEnd);
      onChange(next);
      const caret = selectionStart + 1 + added.length;
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = caret;
      });
    }
  };

  return (
    <div className="relative flex h-full min-h-0 overflow-hidden rounded-md border border-border/50 bg-[#0b0b0f]">
      <div
        ref={gutterRef}
        aria-hidden
        className={cn(
          "shrink-0 select-none overflow-hidden border-r border-border/40 bg-black/30 px-2 py-3 text-right text-muted-foreground/50",
          EDITOR_TYPE,
        )}
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>

      <div className="relative min-w-0 flex-1">
        <pre
          ref={highlightRef}
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 overflow-auto px-3 py-3",
            EDITOR_TYPE,
          )}
        >
          {tokens.map((token, index) => (
            <span key={index} className={TOKEN_CLASS[token.kind] ?? TOKEN_CLASS.plain}>
              {token.text}
            </span>
          ))}
          {/* A trailing newline is collapsed by `pre`, which would let the
              highlight layer end one line short of the textarea. */}
          {"\n"}
        </pre>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={"/* Anything you write here is applied to the whole app. */"}
          className={cn(
            "absolute inset-0 resize-none overflow-auto bg-transparent px-3 py-3 caret-white outline-none",
            // Transparent text, visible caret: the colour comes from the layer
            // underneath, which is the whole trick.
            "text-transparent placeholder:text-muted-foreground/40",
            EDITOR_TYPE,
          )}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const STARTER = `/* Crystal — custom styles
 *
 * These rules are applied last, so they win ties against the app's own.
 * Inspect an element to find something to target.
 */

/* Example: soften every card
.bg-card {
  backdrop-filter: blur(6px);
}
*/
`;

function CustomCssBody({ onClose }: { onClose: () => void }) {
  const { css, enabled, filePath, save, preview, setEnabled, reveal } = useCustomCss();
  const [draft, setDraft] = useState(css);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Seeded once per open. The provider's `css` also changes as we preview, so
  // following it here would fight the user's typing.
  useEffect(() => {
    setDraft(css || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Applied as you type, debounced.
   *
   * Live preview is the point — CSS is written by trying things — but applying
   * on every keystroke means the app restyles mid-selector, which flashes.
   * A short delay lands after a pause without ever feeling like a wait.
   */
  useEffect(() => {
    const timer = setTimeout(() => preview(draft), 250);
    return () => clearTimeout(timer);
  }, [draft, preview]);

  const dirty = draft !== css;

  return (
    <>
      <DialogHeader className="border-b border-border/40 px-5 py-4">
        <DialogTitle>Custom CSS</DialogTitle>
        <DialogDescription>
          Applied to the whole app, live as you type.{" "}
          {filePath
            ? "Saved to a file on this machine, so you can also edit it outside Crystal."
            : "Saved in this browser."}
        </DialogDescription>
      </DialogHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch id="css-enabled" checked={enabled} onCheckedChange={setEnabled} />
            <Label htmlFor="css-enabled" className="font-normal">
              Apply my styles
            </Label>
          </div>
          {!enabled && (
            <span className="text-xs text-muted-foreground">
              Turned off — the editor still works, nothing is applied.
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            {!draft.trim() && (
              <Button size="sm" variant="ghost" onClick={() => setDraft(STARTER)}>
                Insert starter
              </Button>
            )}
            {filePath && (
              <Button size="sm" variant="ghost" onClick={reveal} title={filePath}>
                <FolderOpen className="size-4" />
                Show file
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={!dirty}
              onClick={() => {
                setDraft(css);
                preview(css);
              }}
            >
              <RotateCcw className="size-4" />
              Revert
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1">
          <CssEditor value={draft} onChange={(next) => { setDraft(next); setSaved(false); }} />
        </div>

        <div className="flex items-center gap-2">
          <Button
            disabled={!dirty || saving}
            onClick={async () => {
              setSaving(true);
              try {
                await save(draft);
                setSaved(true);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : "Save"}
          </Button>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {saved && !dirty && (
            <span className="text-xs text-muted-foreground">Saved.</span>
          )}
          {dirty && (
            <span className="text-xs text-muted-foreground">
              Previewing unsaved changes.
            </span>
          )}
        </div>
      </div>
    </>
  );
}

export function CustomCssProviderDialog({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const openEditor = useCallback(() => setOpen(true), []);

  return (
    <CustomCssContext.Provider value={openEditor}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[min(88vh,760px)] w-[min(94vw,980px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
          <CustomCssBody onClose={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </CustomCssContext.Provider>
  );
}

/** Opens the custom-CSS editor. */
export function useOpenCustomCss(): () => void {
  const open = useContext(CustomCssContext);
  return useMemo(() => open ?? (() => {}), [open]);
}
