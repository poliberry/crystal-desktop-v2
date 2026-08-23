"use client";

import { useMutation, useQuery } from "convex/react";
import { AtSign, Paperclip, Send, Smile } from "lucide-react";
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
import { encodeCustomEmojiShortcodes } from "@/lib/custom-emoji";
import { formatCustomEmoji, matchInProgressShortcode } from "@/lib/custom-emoji";
import { searchSystemEmoji } from "@/lib/system-emoji";
import { matchInProgressMention, mentionToken } from "@/lib/mentions";
import { useMentionNames, useMentionSuggestions } from "@/hooks/use-mentions";

interface ChannelMessageComposerProps {
  channelId: Id<"channels">;
  communityId: Id<"communities">;
}

interface AutocompleteState {
  start: number;
  end: number;
  query: string;
  /** Which sigil opened it — `:` for emoji, `@` for mentions. They can't be
   * open at once, and each has its own source of suggestions. */
  kind: "emoji" | "mention";
}

interface Suggestion {
  key: string;
  label: string;
  preview: React.ReactNode;
  insert: string;
}

/** Minimum bar per spec — a working click-driven dropdown, not fully
 * polished virtualized/fuzzy autocomplete. Server emojis are matched first,
 * then system emoji — same ordering as the reaction picker. */
export function ChannelMessageComposer({ channelId, communityId }: ChannelMessageComposerProps) {
  const [text, setText] = useState("");
  // The composer holds readable `:name:` shortcodes; the message has to carry
  // `<:name:id>` so any reader can resolve the emoji without guessing which
  // server it came from.
  const { byName: customEmojiByName, byId: customEmojiById } = useAccessibleEmojis();
  const [sending, setSending] = useState(false);
  const [autocomplete, setAutocomplete] = useState<AutocompleteState | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const textareaRef = useRef<EmojiTextInputHandle>(null);

  const generateUploadUrl = useMutation(api.channelMessages.generateUploadUrl);
  const sendMessage = useMutation(api.channelMessages.send);
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
    attachmentsPayload,
  } = useComposerAttachments(generateUploadUrl);
  const startTyping = useMutation(api.typing.start);
  const stopTyping = useMutation(api.typing.stop);
  const typingDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const serverEmojis = useQuery(api.communityEmojis.list, { communityId });
  const mentionNames = useMentionNames(communityId);

  useEffect(() => {
    return () => {
      if (typingDebounce.current) clearTimeout(typingDebounce.current);
      void stopTyping({ channelId });
    };
  }, [channelId, stopTyping]);

  const mentionMatches = useMentionSuggestions(
    communityId,
    autocomplete?.kind === "mention" ? autocomplete.query : null
  );

  const mentionSuggestions: Suggestion[] = mentionMatches.map((match) => ({
    key: match.key,
    label: match.hint ? `@${match.label} · ${match.hint}` : `@${match.label}`,
    preview: match.imageUrl ? (
      <img src={match.imageUrl} alt="" className="size-4 rounded-full object-cover" />
    ) : match.target.kind === "role" ? (
      <span
        className="size-2.5 rounded-full"
        style={{ backgroundColor: match.color ?? "currentColor" }}
      />
    ) : (
      <AtSign className="size-3.5" />
    ),
    // A trailing space so the next word isn't swallowed into the token, and
    // so typing straight on doesn't reopen the picker against the id.
    insert: `${mentionToken(match.target)} `,
  }));

  const emojiSuggestions: Suggestion[] =
    autocomplete?.kind === "emoji" && autocomplete.query.length >= 2
      ? (() => {
          const needle = autocomplete.query.toLowerCase();
          const customMatches = (serverEmojis ?? [])
            .filter((e) => e.name.toLowerCase().startsWith(needle))
            .slice(0, 8)
            .map((e) => ({
              key: e.id,
              label: `:${e.name}:`,
              preview: <img src={e.imageUrl} alt={e.name} className="size-4 object-contain" />,
              insert: formatCustomEmoji(e),
            }));
          const remaining = 8 - customMatches.length;
          const systemMatches =
            remaining > 0
              ? searchSystemEmoji(autocomplete.query, remaining).map((s) => ({
                  key: s.slug,
                  label: `:${s.slug}:`,
                  preview: s.emoji,
                  insert: s.emoji,
                }))
              : [];
          return [...customMatches, ...systemMatches];
        })()
      : [];

  const suggestions: Suggestion[] =
    autocomplete?.kind === "mention" ? mentionSuggestions : emojiSuggestions;

  useEffect(() => {
    setActiveIndex(0);
  }, [autocomplete?.query]);

  const handleTyping = () => {
    void startTyping({ channelId });
    if (typingDebounce.current) clearTimeout(typingDebounce.current);
    typingDebounce.current = setTimeout(() => {
      void stopTyping({ channelId });
    }, 3000);
  };

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed && pending.length === 0) return;
    if (typingDebounce.current) clearTimeout(typingDebounce.current);
    void stopTyping({ channelId });
    setSending(true);
    setAutocomplete(null);
    try {
      await sendMessage({
        channelId,
        text: trimmed ? encodeCustomEmojiShortcodes(trimmed, (name) => customEmojiByName.get(name)) : undefined,
        attachments: pending.length ? attachmentsPayload() : undefined,
      });
      setText("");
      clearAttachments();
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
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleTextChange = (value: string, caret: number) => {
    setText(value);
    handleTyping();
    // A `:` shortcode wins if both somehow match — it's the narrower pattern
    // (it needs a colon already typed) so it's the more deliberate one.
    const shortcode = matchInProgressShortcode(value, caret);
    if (shortcode) {
      setAutocomplete({ ...shortcode, kind: "emoji" });
      return;
    }
    const mention = matchInProgressMention(value, caret);
    setAutocomplete(mention ? { ...mention, kind: "mention" } : null);
  };

  const insertEmoji = (emoji: string) => {
    setText((prev) => prev + emoji);
    textareaRef.current?.focus();
  };

  return (
    <div ref={dropZoneRef} className="relative shrink-0 pt-2 bg-background">
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
              <span className="flex size-4 items-center justify-center">{s.preview}</span>
              <span className="text-muted-foreground">{s.label}</span>
            </button>
          ))}
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
          mentionNames={mentionNames}
          placeholder="Message…"
        />

        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0">
              <Smile className="size-4" />
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
    </div>
  );
}
