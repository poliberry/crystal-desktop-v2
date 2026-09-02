"use client";

import { useConvex, useMutation } from "convex/react";
import { AtSign, Paperclip, Reply, Send, Smile, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  ComposerAttachments,
  ComposerDropOverlay,
} from "@/components/home/composer-attachments";
import { ReactionPickerContent } from "@/components/home/reaction-picker-content";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  EmojiTextInput,
  type EmojiTextInputHandle,
} from "@/components/home/emoji-text-input";
import { useAccessibleEmojis } from "@/hooks/use-accessible-emojis";
import { useComposerAttachments } from "@/hooks/use-composer-attachments";
import { useOutboxMutation } from "@/hooks/use-outbox-mutation";
import { encodeCustomEmojiShortcodes } from "@/lib/custom-emoji";
import { matchInProgressShortcode } from "@/lib/custom-emoji";
import type { ReplyDraft } from "@/lib/reply";
import { cn } from "@/lib/utils";
import { randomSmiley, searchSystemEmoji } from "@/lib/system-emoji";

interface MessageComposerProps {
  conversationId: Id<"conversations">;
  /** Who in this conversation is having a birthday today, if anyone — the
   * prompt above the input is about them. Empty or omitted the rest of the
   * year, which is when the prompt isn't there at all. */
  birthdayMembers?: { name: string }[];
  /** The message being replied to, or null. */
  replyingTo?: ReplyDraft | null;
  onCancelReply?: () => void;
}

/** "Ana", "Ana and Bo", "Ana, Bo and Cy". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** What the prompt puts in the box. A starting point rather than the message:
 * it's left editable and unsent, because a wish somebody typed over is worth
 * more than one they only pressed a button for. */
function defaultWish(names: string[]): string {
  return `🎂 Happy birthday, ${joinNames(names)}! Hope you have a great one.`;
}

interface AutocompleteState {
  start: number;
  end: number;
  query: string;
}

/** Minimum bar per spec — a working click-driven dropdown, not fully
 * polished virtualized/fuzzy autocomplete. DMs have no community, so this
 * only ever surfaces system-emoji `:slug:` matches (no `communityId` here). */
export function MessageComposer({
  conversationId,
  birthdayMembers,
  replyingTo,
  onCancelReply,
}: MessageComposerProps) {
  const [text, setText] = useState("");
  /** Whether the reply pings its target — Discord's "@" toggle. Re-armed
   * whenever the reply target changes. */
  const [pingReply, setPingReply] = useState(true);
  useEffect(() => {
    if (replyingTo) setPingReply(true);
  }, [replyingTo?.id]);
  /** The prompt was used and hasn't been sent yet, so the next send is the
   * wish. Only a hint: the server checks somebody's birthday actually is today
   * before letting a message set cakes falling for everyone. */
  const [wishArmed, setWishArmed] = useState(false);
  /** Dismissed for this mounting of the composer — the prompt shouldn't be a
   * thing you have to keep closing, but it also shouldn't be gone for good
   * from a mis-click. */
  const [wishDismissed, setWishDismissed] = useState(false);
  const birthdayNames = (birthdayMembers ?? []).map((member) => member.name);
  // The composer holds readable `:name:` shortcodes; the message has to carry
  // `<:name:id>` so any reader can resolve the emoji without guessing which
  // server it came from.
  const { byName: customEmojiByName, byId: customEmojiById } = useAccessibleEmojis();
  const [sending, setSending] = useState(false);
  const [autocomplete, setAutocomplete] = useState<AutocompleteState | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  // A random greyscale emoji that replaces the Smile icon while the emoji
  // button is hovered — re-rolled on every pointer enter.
  const [hoverEmoji, setHoverEmoji] = useState<string | null>(null);
  const textareaRef = useRef<EmojiTextInputHandle>(null);

  const generateUploadUrl = useMutation(api.messages.generateUploadUrl);
  const convexClient = useConvex();
  const {
    pending,
    uploading,
    error: attachmentError,
    dismissError,
    isDraggingOver,
    fileInputRef,
    openFilePicker,
    addFiles,
    removeAt,
    clear: clearAttachments,
    handlePaste,
    dropZoneRef,
  } = useComposerAttachments(generateUploadUrl, { convex: convexClient as never, kind: "attachments" });
  // Durable: the send lands in the IndexedDB outbox first and is drawn by the
  // message list's overlay, then flushed to Convex (see src/lib/outbox.ts).
  const sendMessage = useOutboxMutation("send", "dm");
  const startTyping = useMutation(api.typing.start);
  const stopTyping = useMutation(api.typing.stop);
  const typingDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (typingDebounce.current) clearTimeout(typingDebounce.current);
      void stopTyping({ conversationId });
    };
  }, [conversationId, stopTyping]);

  const suggestions =
    autocomplete && autocomplete.query.length >= 2
      ? searchSystemEmoji(autocomplete.query, 8).map((s) => ({
          key: s.slug,
          label: `:${s.slug}:`,
          preview: s.emoji,
          insert: s.emoji,
        }))
      : [];

  useEffect(() => {
    setActiveIndex(0);
  }, [autocomplete?.query]);

  const handleTyping = () => {
    void startTyping({ conversationId });
    if (typingDebounce.current) clearTimeout(typingDebounce.current);
    typingDebounce.current = setTimeout(() => {
      void stopTyping({ conversationId });
    }, 3000);
  };

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed && pending.length === 0) return;
    if (typingDebounce.current) clearTimeout(typingDebounce.current);
    void stopTyping({ conversationId });
    setSending(true);
    setAutocomplete(null);
    try {
      await sendMessage({
        conversationId,
        text: trimmed
          ? encodeCustomEmojiShortcodes(trimmed, (name) => customEmojiByName.get(name))
          : undefined,
        attachments: pending.length ? pending : undefined,
        birthdayWish: wishArmed || undefined,
        replyToId: replyingTo?.id,
        pingReply: replyingTo ? pingReply : undefined,
        replyToPreview: replyingTo
          ? {
              authorName: replyingTo.authorName,
              authorImageUrl: replyingTo.authorImageUrl,
              text: replyingTo.text,
              hasAttachment: replyingTo.hasAttachment,
            }
          : undefined,
      });
      setText("");
      setWishArmed(false);
      clearAttachments();
      onCancelReply?.();
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const applyAutocomplete = (insert: string) => {
    if (!autocomplete) return;
    const newText = text.slice(0, autocomplete.start) + insert + text.slice(autocomplete.end);
    const cursor = autocomplete.start + insert.length;
    setText(newText);
    setAutocomplete(null);
    // After the value change has been rendered, so the offset lands in the
    // rebuilt DOM rather than the old one.
    requestAnimationFrame(() => textareaRef.current?.setCaret(cursor));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (autocomplete && suggestions.length > 0) {
      if (e.key === "Escape") {
        e.preventDefault();
        setAutocomplete(null);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applyAutocomplete(suggestions[activeIndex]!.insert);
        return;
      }
    }
    if (e.key === "Escape" && replyingTo) {
      e.preventDefault();
      onCancelReply?.();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleTextChange = (value: string, caret: number) => {
    setText(value);
    // Emptying the box takes the wish back: whatever gets sent next is a
    // different message, and shouldn't rain cakes on anyone.
    if (wishArmed && !value.trim()) setWishArmed(false);
    handleTyping();
    setAutocomplete(matchInProgressShortcode(value, caret));
  };

  const insertEmoji = (emoji: string) => {
    setText((prev) => prev + emoji);
    textareaRef.current?.focus();
  };

  return (
    <div ref={dropZoneRef} className="relative shrink-0 p-3">
      <ComposerDropOverlay active={isDraggingOver} />
      {autocomplete && suggestions.length > 0 && (
        <div className="absolute bottom-full left-3 mb-1 flex max-h-48 w-56 flex-col overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
          {suggestions.map((s, index) => (
            <button
              key={s.key}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyAutocomplete(s.insert)}
              className={`flex items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent ${
                index === activeIndex ? "bg-accent" : ""
              }`}
            >
              <span>{s.preview}</span>
              <span className="text-muted-foreground">{s.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Birthday prompt. Above the box rather than in it, so it reads as
          something the app noticed rather than as text you have to clear. */}
      {birthdayNames.length > 0 && !wishDismissed && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-amber-400/40 bg-amber-400/10 px-2.5 py-1.5">
          <span aria-hidden className="text-base leading-none">
            🎂
          </span>
          <p className="min-w-0 flex-1 truncate text-xs">
            It&apos;s <span className="font-semibold">{joinNames(birthdayNames)}</span>
            &apos;s {birthdayNames.length > 1 ? "birthdays" : "birthday"} today.
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 shrink-0 text-xs"
            onClick={() => {
              setText(defaultWish(birthdayNames));
              setWishArmed(true);
              textareaRef.current?.focus();
            }}
          >
            Wish them happy birthday
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Dismiss"
            className="size-7 shrink-0"
            onClick={() => setWishDismissed(true)}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      )}

      {replyingTo && (
        <div className="mb-1.5 flex items-center gap-2 rounded-md border border-b-0 bg-muted/40 px-2.5 py-1 text-xs">
          <Reply className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            Replying to <span className="font-medium text-foreground">{replyingTo.authorName}</span>
          </span>
          <button
            type="button"
            onClick={() => setPingReply((v) => !v)}
            title={pingReply ? "Reply will notify them — click to mute" : "Reply won't notify them"}
            className={cn(
              "flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-medium transition-colors",
              pingReply
                ? "bg-primary/15 text-primary hover:bg-primary/25"
                : "text-muted-foreground hover:bg-accent"
            )}
          >
            <AtSign className="size-3" />
            {pingReply ? "ON" : "OFF"}
          </button>
          <button
            type="button"
            aria-label="Cancel reply"
            onClick={() => onCancelReply?.()}
            className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-accent"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <ComposerAttachments pending={pending} uploading={uploading} onRemove={removeAt} />

      {attachmentError && (
        <button
          type="button"
          onClick={dismissError}
          className="mb-2 block w-full truncate rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-left text-xs text-destructive"
        >
          {attachmentError}
        </button>
      )}

      <div className="flex items-end gap-1 rounded-md border border-input bg-transparent px-1.5 py-1 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => void addFiles(e.target.files)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          disabled={uploading}
          onClick={openFilePicker}
        >
          <Paperclip className="size-4" />
        </Button>

        <EmojiTextInput
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onBlur={() => setAutocomplete(null)}
          emojiByName={customEmojiByName}
          emojiById={customEmojiById}
          placeholder="Message…"
        />

        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="relative size-8 shrink-0 overflow-hidden"
              onMouseEnter={() => setHoverEmoji(randomSmiley())}
              onMouseLeave={() => setHoverEmoji(null)}
            >
              {/* The Smile icon stays mounted; the random emoji is an overlay.
                  Swapping the hovered node out instead makes React fire a
                  spurious mouseleave and the emoji never appears. */}
              <Smile className="size-4" />
              {hoverEmoji && (
                <span
                  aria-hidden
                  className="absolute inset-0 flex items-center justify-center bg-accent text-sm leading-none grayscale"
                >
                  {hoverEmoji}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-auto p-0">
            <ReactionPickerContent onSelect={(text) => insertEmoji(text)} />
          </PopoverContent>
        </Popover>

        <Button
          type="button"
          size="icon"
          className="size-8 shrink-0"
          disabled={sending || uploading}
          onClick={() => void handleSend()}
        >
          <Send className="size-4" />
        </Button>
      </div>

      <p className="mt-1.5 text-[11px] text-muted-foreground">Stickers coming soon.</p>
    </div>
  );
}
