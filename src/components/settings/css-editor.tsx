"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";

import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { CssSnippetGroup, CssSelectorGroup } from "@/lib/css-snippets";
import { cn } from "@/lib/utils";

/**
 * A CSS editor, and the reference panel beside it.
 *
 * Shared by the app-wide stylesheet and the one a user writes for their own
 * profile card. The two differ only in what they can reach — and therefore in
 * which snippets and selectors are worth offering — so the editor itself, the
 * highlighter and the side panel are all one component parameterised by those
 * two lists.
 *
 * The editor is built the way editors were before anyone shipped a megabyte of
 * one: a transparent textarea sits exactly on top of a highlighted `pre`, and
 * the two are kept in alignment by using the same font metrics, padding and
 * scroll offset. The textarea is what has focus, a caret and a selection — all
 * the parts that are miserable to reimplement — while the `pre` underneath
 * supplies the colour. That buys syntax highlighting, line numbers and
 * bracket-aware indentation without an editor dependency in an app that is
 * already shipping a browser.
 */

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

/** What a snippet insertion needs to know about the editor. */
export interface EditorHandle {
  /** Insert text at the caret (or replace the selection), and put the caret
   * after it. */
  insert: (text: string) => void;
}

export function CssEditor({
  value,
  onChange,
  handleRef,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Filled in with an `insert` function, so the snippet list next door can
   * put text at the caret rather than appending blindly to the end. */
  handleRef?: React.MutableRefObject<EditorHandle | null>;
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
   * Insertion, exposed to the snippet list.
   *
   * At the caret rather than at the end, and padded with blank lines only
   * where there isn't one already — pasting a rule into the middle of another
   * rule's braces is the one thing that would make the snippets worse than
   * useless.
   */
  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      insert: (text) => {
        const el = textareaRef.current;
        const at = el ? el.selectionStart : value.length;
        const end = el ? el.selectionEnd : value.length;
        const before = value.slice(0, at);
        const after = value.slice(end);
        const lead = !before || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
        const trail = !after || after.startsWith("\n") ? "\n" : "\n\n";
        const next = before + lead + text + trail + after;
        onChange(next);
        const caret = (before + lead + text).length;
        requestAnimationFrame(() => {
          el?.focus();
          if (el) el.selectionStart = el.selectionEnd = caret;
        });
      },
    };
  }, [handleRef, value, onChange]);

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
/* Reference panel                                                            */
/* -------------------------------------------------------------------------- */

type PanelTab = "templates" | "classes";

/**
 * The panel beside the editor: ready-made rules, and the full list of names.
 *
 * Two tabs because they answer two different questions. "Templates" is for
 * somebody who knows what they want the app to look like and not how to say
 * it — each one drops in a rule that already targets the right thing.
 * "Classes" is for somebody who knows CSS perfectly well and only needs to be
 * told what this app calls its parts; it's a plain index of every selector
 * that's safe to rely on, and clicking one types just the selector and an
 * empty block.
 *
 * Neither is a substitute for inspecting an element, but between them they
 * cover the case where you can't — the styles you want to change belong to
 * something that only appears on hover, or inside a menu that closes when you
 * open the inspector.
 */
export function CssReferencePanel({
  snippetGroups,
  selectorGroups,
  onInsert,
}: {
  snippetGroups: CssSnippetGroup[];
  selectorGroups: CssSelectorGroup[];
  onInsert: (code: string) => void;
}) {
  const [tab, setTab] = useState<PanelTab>("templates");
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  const snippets = useMemo(() => {
    if (!needle) return snippetGroups;
    return snippetGroups
      .map((group) => ({
        ...group,
        snippets: group.snippets.filter(
          (snippet) =>
            snippet.label.toLowerCase().includes(needle) ||
            snippet.hint.toLowerCase().includes(needle) ||
            // The selector text is searchable too, for anyone who already
            // knows what they're after and just wants it typed out.
            snippet.code.toLowerCase().includes(needle),
        ),
      }))
      .filter((group) => group.snippets.length > 0);
  }, [snippetGroups, needle]);

  const selectors = useMemo(() => {
    if (!needle) return selectorGroups;
    return selectorGroups
      .map((group) => ({
        ...group,
        selectors: group.selectors.filter(
          (entry) =>
            entry.label.toLowerCase().includes(needle) ||
            entry.selector.toLowerCase().includes(needle) ||
            entry.description.toLowerCase().includes(needle),
        ),
      }))
      .filter((group) => group.selectors.length > 0);
  }, [selectorGroups, needle]);

  const empty =
    tab === "templates" ? snippets.length === 0 : selectors.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center gap-3 border-b border-border/40">
        {(["templates", "classes"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              "border-b-2 pb-1.5 text-xs font-semibold capitalize transition-colors",
              tab === value
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {value}
          </button>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground">
        {tab === "templates"
          ? "Click one to drop it in at the cursor."
          : "Every part you can target. Click to start a rule."}
      </p>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={tab === "templates" ? "Search parts…" : "Search selectors…"}
        className="h-8"
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 pr-2 pb-2">
          {empty && (
            <p className="py-6 text-center text-xs text-muted-foreground">
              Nothing matches that.
            </p>
          )}

          {tab === "templates" &&
            snippets.map((group) => (
              <div key={group.label} className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </p>
                {group.snippets.map((snippet) => (
                  <button
                    key={snippet.key}
                    type="button"
                    onClick={() => onInsert(snippet.code)}
                    className="w-full rounded-md border border-border/50 px-2 py-1.5 text-left transition-colors hover:border-primary/60 hover:bg-accent/40"
                  >
                    <span className="flex items-center gap-1 text-xs font-medium">
                      <Plus className="size-3" />
                      {snippet.label}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                      {snippet.hint}
                    </span>
                  </button>
                ))}
              </div>
            ))}

          {tab === "classes" &&
            selectors.map((group) => (
              <div key={group.label} className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </p>
                {group.selectors.map((entry) => (
                  <button
                    key={entry.selector}
                    type="button"
                    // An empty block rather than the bare selector: what you
                    // want next is to type a property, and this puts the
                    // braces there for you.
                    onClick={() => onInsert(`${entry.selector} {\n  \n}`)}
                    className="w-full rounded-md border border-border/50 px-2 py-1.5 text-left transition-colors hover:border-primary/60 hover:bg-accent/40"
                  >
                    <span className="block text-xs font-medium">{entry.label}</span>
                    <code className="mt-0.5 block break-all font-mono text-[10px] text-sky-300">
                      {entry.selector}
                    </code>
                    <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                      {entry.description}
                    </span>
                  </button>
                ))}
              </div>
            ))}
        </div>
      </ScrollArea>
    </div>
  );
}
