"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, type Ref } from "react";

import { TAG_OR_SHORTCODE_RE, type ServerEmoji } from "@/lib/custom-emoji";
import { MENTION_REF_RE, type MentionNames } from "@/lib/mentions";
import { cn } from "@/lib/utils";

/**
 * A composer input that shows custom emoji as their actual image while still
 * behaving like a plain-text field to everything around it.
 *
 * A `<textarea>` can't render an image, so this is a `contenteditable` whose
 * DOM is kept as a flat list of text nodes and `<img>` chips. `value` /
 * `onChange` stay plain text with `:name:` shortcodes — callers (autocomplete,
 * send, typing indicators) never see the DOM, and caret positions are plain
 * character offsets into that text, with each chip counting as the length of
 * the shortcode it stands for.
 *
 * The DOM is only rebuilt when the incoming `value` differs from what's
 * already rendered, which keeps typing from fighting the caret.
 */

export interface EmojiTextInputHandle {
  focus(): void;
  /** Caret position as an offset into the plain-text value. */
  getCaret(): number;
  setCaret(offset: number): void;
}

/** Serialise the editable DOM back to plain text. */
function readText(root: HTMLElement): string {
  let out = "";
  for (const node of Array.from(root.childNodes)) {
    out += readNode(node);
  }
  return out;
}

function readNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? "";
  // Any chip — an emoji image or a mention pill — stands for the exact source
  // text it replaced. Checked before the generic element branch below, whose
  // recursion would otherwise return a mention's *display* name.
  if (node instanceof HTMLElement && node.dataset.shortcode !== undefined) {
    return node.dataset.shortcode;
  }
  if (node instanceof HTMLBRElement) return "\n";
  if (node instanceof HTMLElement) {
    // Browsers wrap lines in <div> on Enter; treat each as a line break.
    const inner = Array.from(node.childNodes).map(readNode).join("");
    return node.tagName === "DIV" ? `\n${inner}` : inner;
  }
  return "";
}

function makeChip(emoji: ServerEmoji, source: string): HTMLImageElement {
  const img = document.createElement("img");
  img.src = emoji.imageUrl;
  img.alt = `:${emoji.name}:`;
  img.title = `:${emoji.name}:`;
  // The exact text this chip stands for, so `readText` round-trips it
  // unchanged rather than normalising an encoded tag into a shortcode.
  img.dataset.shortcode = source;
  // `contenteditable=false` makes the chip behave as one atomic character:
  // arrow keys step over it and Backspace deletes the whole thing.
  img.contentEditable = "false";
  img.className = "inline-block size-5 align-text-bottom object-contain";
  return img;
}

/**
 * Rebuild the DOM from `text`, turning every resolvable emoji into a chip.
 *
 * Both forms become chips: the readable `:name:` a user types, and the
 * encoded `<:name:id>` that arrives from a paste or an older draft. A chip
 * remembers the exact source text it replaced, so serialising back out is
 * lossless and an encoded tag never gets encoded a second time.
 */
function renderText(
  root: HTMLElement,
  text: string,
  emojiByName: Map<string, ServerEmoji>,
  emojiById: Map<string, ServerEmoji>,
  mentionNames?: MentionNames
): void {
  root.replaceChildren();
  let lastIndex = 0;

  for (const match of text.matchAll(TAG_OR_SHORTCODE_RE)) {
    const [source, tagName, tagId, shortcodeName] = match;
    const emoji =
      shortcodeName !== undefined
        ? emojiByName.get(shortcodeName)
        : (emojiById.get(tagId!) ?? emojiByName.get(tagName!));
    if (!emoji) continue;

    const start = match.index!;
    if (start > lastIndex) {
      root.appendChild(document.createTextNode(text.slice(lastIndex, start)));
    }
    root.appendChild(makeChip(emoji, source));
    lastIndex = start + source.length;
  }

  if (lastIndex < text.length) {
    root.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  if (mentionNames) renderMentions(root, mentionNames);
}

function makeMentionChip(label: string, source: string): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.textContent = `@${label}`;
  chip.dataset.shortcode = source;
  chip.contentEditable = "false";
  chip.className =
    "rounded-[4px] bg-primary/15 px-1 py-px font-medium text-primary";
  return chip;
}

/**
 * Replace `<@id>` / `<@&id>` references with readable chips.
 *
 * A separate pass over the text nodes rather than another branch in
 * `renderText`: the two grammars are unrelated, and interleaving them into one
 * regex means juggling capture-group offsets for no benefit. References with
 * no name behind them (someone who left, a deleted role) are left as raw text,
 * which is at least honest about the message not resolving.
 */
function renderMentions(root: HTMLElement, names: MentionNames): void {
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType !== Node.TEXT_NODE) continue;
    const text = node.nodeValue ?? "";
    const matches = Array.from(text.matchAll(MENTION_REF_RE));
    if (matches.length === 0) continue;

    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    for (const match of matches) {
      const [source, roleId, userId] = match;
      const label = roleId ? names.role(roleId)?.name : userId ? names.user(userId) : undefined;
      if (!label) continue;
      if (match.index! > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index!)));
      }
      fragment.appendChild(makeMentionChip(label, source));
      lastIndex = match.index! + source.length;
    }
    if (lastIndex === 0) continue;
    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    node.replaceWith(fragment);
  }
}

/** Plain-text offset of the caret, or null if it isn't inside `root`. */
function getCaretOffset(root: HTMLElement): number | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;

  const measured = range.cloneRange();
  measured.selectNodeContents(root);
  measured.setEnd(range.startContainer, range.startOffset);

  // Serialising the cloned fragment reuses the same rules as `readText`, so
  // chips count as their shortcode length on both sides.
  const fragment = measured.cloneContents();
  let out = "";
  for (const node of Array.from(fragment.childNodes)) out += readNode(node);
  return out.length;
}

/** Place the caret at a plain-text offset. */
function setCaretOffset(root: HTMLElement, offset: number): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  let remaining = offset;

  for (const node of Array.from(root.childNodes)) {
    const length = readNode(node).length;
    if (remaining <= length && node.nodeType === Node.TEXT_NODE) {
      range.setStart(node, Math.max(0, Math.min(remaining, node.nodeValue?.length ?? 0)));
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    if (remaining <= length) {
      // Landing on a chip — put the caret just after it.
      range.setStartAfter(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    remaining -= length;
  }

  range.selectNodeContents(root);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function EmojiTextInput({
  ref,
  value,
  onChange,
  emojiByName,
  emojiById,
  mentionNames,
  placeholder,
  className,
  onKeyDown,
  onPaste,
  onBlur,
}: {
  ref?: Ref<EmojiTextInputHandle>;
  value: string;
  /** Receives the plain-text value and the caret offset within it. */
  onChange: (value: string, caret: number) => void;
  emojiByName: Map<string, ServerEmoji>;
  emojiById: Map<string, ServerEmoji>;
  /** Resolves `<@id>` references so a mention reads as a name rather than
   * the id the message actually carries. Omitted where there's nothing to
   * resolve against (a DM). */
  mentionNames?: MentionNames;
  placeholder?: string;
  className?: string;
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onPaste?: (event: React.ClipboardEvent<HTMLDivElement>) => void;
  onBlur?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  // What we last rendered, so an echo of our own `onChange` doesn't trigger a
  // rebuild (and a caret jump) on every keystroke.
  const renderedRef = useRef<string>("");

  useImperativeHandle(ref, () => ({
    focus: () => rootRef.current?.focus(),
    getCaret: () => (rootRef.current ? (getCaretOffset(rootRef.current) ?? 0) : 0),
    setCaret: (offset: number) => {
      const root = rootRef.current;
      if (!root) return;
      root.focus();
      setCaretOffset(root, offset);
    },
  }));

  // External changes only: a value we didn't just render (the picker inserted
  // something, the message was sent and cleared it, a shortcode completed).
  useEffect(() => {
    const root = rootRef.current;
    if (!root || value === renderedRef.current) return;
    const hadFocus = root.contains(document.activeElement) || document.activeElement === root;
    renderText(root, value, emojiByName, emojiById, mentionNames);
    renderedRef.current = value;
    if (hadFocus) setCaretOffset(root, value.length);
  }, [value, emojiByName, emojiById, mentionNames]);

  const handleInput = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const text = readText(root);
    const caret = getCaretOffset(root) ?? text.length;
    renderedRef.current = text;

    // Turn a shortcode into a chip the moment it's completed, rather than
    // waiting for send — that's the whole point of this input. Only the one
    // just finished before the caret is considered, so nothing further along
    // the line moves under the user.
    const before = text.slice(0, caret);
    const completed = /<:([a-zA-Z0-9_]+):([a-zA-Z0-9]+)>$|:([a-zA-Z0-9_]{2,64}):$/.exec(before);
    const completedName = completed?.[3] ?? completed?.[1];
    if (completedName && emojiByName.has(completedName)) {
      renderText(root, text, emojiByName, emojiById, mentionNames);
      renderedRef.current = text;
      setCaretOffset(root, caret);
    }

    onChange(text, caret);
  }, [emojiByName, emojiById, mentionNames, onChange]);

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      onPaste?.(event);
      if (event.defaultPrevented) return;
      // Paste as plain text — otherwise arbitrary markup lands in the editor
      // and `readText` has to make sense of it.
      const text = event.clipboardData.getData("text/plain");
      if (!text) return;
      event.preventDefault();
      document.execCommand("insertText", false, text);
    },
    [onPaste]
  );

  return (
    <div
      ref={rootRef}
      role="textbox"
      aria-multiline="true"
      aria-label={placeholder}
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onInput={handleInput}
      onKeyDown={onKeyDown}
      onPaste={handlePaste}
      onBlur={onBlur}
      className={cn(
        "max-h-40 min-h-8 flex-1 overflow-y-auto px-1 py-1.5 text-sm outline-none",
        "whitespace-pre-wrap break-words",
        // Placeholder — contenteditable has no native one.
        "empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]",
        className
      )}
    />
  );
}
