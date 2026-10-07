"use client";

import { Pencil } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * A piece of text that is edited where it is drawn.
 *
 * On the profile editor's card the name, the status and the bio are the card's
 * own elements, and clicking one turns it into a field — in place, in the same
 * type, so the card doesn't rearrange itself around a form. Nothing here
 * saves: the value goes up to whoever owns the draft, and one bar for the whole
 * profile does the saving.
 *
 * Enter finishes a single-line field; Escape puts back what was there when the
 * edit began. Clicking away keeps what was typed, since the draft is the safety
 * net and a field that silently threw away an edit on blur would be worse than
 * one that holds it.
 */
export function InlineText({
  value,
  onChange,
  placeholder,
  label,
  maxLength,
  multiline = false,
  className,
  displayClassName,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Shown, in italics, while there is nothing — and what says there is
   * something to click. */
  placeholder: string;
  /** For assistive technology: "Edit your name". */
  label: string;
  maxLength?: number;
  multiline?: boolean;
  /** The type — size, weight, colour — shared by the text and its field, so
   * one becomes the other without the layout shifting. */
  className?: string;
  /** Only while it is plain text: what a field can't wear, like the
   * `bg-clip-text` of a gradient name style, which would make typed letters
   * invisible. */
  displayClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const original = useRef(value);
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) return;
    field.current?.focus();
    field.current?.select();
  }, [editing]);

  // A textarea doesn't grow with what's in it by itself.
  useLayoutEffect(() => {
    const node = field.current;
    if (!editing || !multiline || !node) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, [editing, multiline, value]);

  if (!editing) {
    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={() => {
          original.current = value;
          setEditing(true);
        }}
        className={cn(
          // `flex w-fit max-w-full`, not `inline-flex`: this sits inside parents that
          // clip with `truncate`, and an inline box with a percentage max-width
          // there is sized from its *minimum* content, which collapsed "asink"
          // to "asi…" and "Add a status" to "Add a sta…".
          "group/inline -mx-1 flex w-fit max-w-full cursor-text items-baseline rounded-md px-1 text-left outline-none transition-colors",
          "hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        <span
          className={cn(
            "min-w-0",
            multiline ? "whitespace-pre-wrap" : "truncate",
            !value && "font-normal italic text-muted-foreground",
            value && displayClassName,
          )}
        >
          {value || placeholder}
        </span>
        <Pencil
          aria-hidden
          className="ml-1.5 size-3 shrink-0 self-center opacity-0 transition-opacity group-hover/inline:opacity-60"
        />
      </button>
    );
  }

  const shared = {
    ref: field,
    value,
    placeholder,
    maxLength,
    "aria-label": label,
    onChange: (event: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) =>
      onChange(event.target.value),
    onBlur: () => setEditing(false),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onChange(original.current);
        setEditing(false);
      } else if (event.key === "Enter" && (!multiline || event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setEditing(false);
      }
    },
    className: cn(
      "-mx-1 block w-full min-w-0 rounded-md bg-background/60 px-1 outline-none ring-2 ring-primary/60 placeholder:font-normal placeholder:italic placeholder:text-muted-foreground",
      className,
    ),
  };

  return multiline ? (
    <div className="w-full">
      <textarea {...shared} rows={1} className={cn(shared.className, "resize-none overflow-hidden")} />
      {maxLength !== undefined && (
        <p className="mt-0.5 text-right text-[10px] tabular-nums text-muted-foreground">
          {value.length}/{maxLength}
        </p>
      )}
    </div>
  ) : (
    <input {...shared} type="text" />
  );
}
