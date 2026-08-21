"use client";

import { useMutation } from "convex/react";
import { Paperclip, Send, Smile, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ReactionPickerContent } from "@/components/home/reaction-picker-content";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { matchInProgressShortcode } from "@/lib/custom-emoji";
import { searchSystemEmoji } from "@/lib/system-emoji";

interface PendingAttachment {
  storageId: Id<"_storage">;
  fileName: string;
  fileType: string;
  fileSize: number;
}

interface MessageComposerProps {
  conversationId: Id<"conversations">;
}

interface AutocompleteState {
  start: number;
  end: number;
  query: string;
}

/** Minimum bar per spec — a working click-driven dropdown, not fully
 * polished virtualized/fuzzy autocomplete. DMs have no community, so this
 * only ever surfaces system-emoji `:slug:` matches (no `communityId` here). */
export function MessageComposer({ conversationId }: MessageComposerProps) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [autocomplete, setAutocomplete] = useState<AutocompleteState | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const generateUploadUrl = useMutation(api.messages.generateUploadUrl);
  const sendMessage = useMutation(api.messages.send);
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

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const uploadUrl = await generateUploadUrl();
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        setPending((prev) => [
          ...prev,
          {
            storageId,
            fileName: file.name,
            fileType: file.type || "application/octet-stream",
            fileSize: file.size,
          },
        ]);
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

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
        text: trimmed || undefined,
        attachments: pending.length ? pending : undefined,
      });
      setText("");
      setPending([]);
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
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(cursor, cursor);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setText(value);
    handleTyping();
    const cursorPos = e.target.selectionStart;
    setAutocomplete(matchInProgressShortcode(value, cursorPos));
  };

  const insertEmoji = (emoji: string) => {
    setText((prev) => prev + emoji);
    textareaRef.current?.focus();
  };

  return (
    <div className="relative shrink-0 p-3">
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

      {pending.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {pending.map((attachment, index) => (
            <div
              key={index}
              className="flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs"
            >
              <span className="max-w-32 truncate">{attachment.fileName}</span>
              <button
                type="button"
                onClick={() => setPending((prev) => prev.filter((_, i) => i !== index))}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-1 rounded-md border border-input bg-transparent px-1.5 py-1 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="size-4" />
        </Button>

        <Textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          onBlur={() => setAutocomplete(null)}
          placeholder="Message…"
          className="max-h-40 min-h-8 flex-1 resize-none border-0 bg-transparent! px-1 py-1.5 shadow-none focus-visible:ring-0"
          rows={1}
        />

        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0">
              <Smile className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-auto p-0">
            <ReactionPickerContent onSelect={insertEmoji} />
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
