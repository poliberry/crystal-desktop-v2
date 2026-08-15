"use client";

import { useMutation } from "convex/react";
import { EmojiPicker } from "frimousse";
import { Paperclip, Send, Smile, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";

interface PendingAttachment {
  storageId: Id<"_storage">;
  fileName: string;
  fileType: string;
  fileSize: number;
}

interface ChannelMessageComposerProps {
  channelId: Id<"channels">;
}

export function ChannelMessageComposer({ channelId }: ChannelMessageComposerProps) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const generateUploadUrl = useMutation(api.channelMessages.generateUploadUrl);
  const sendMessage = useMutation(api.channelMessages.send);
  const startTyping = useMutation(api.typing.start);
  const stopTyping = useMutation(api.typing.stop);
  const typingDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (typingDebounce.current) clearTimeout(typingDebounce.current);
      void stopTyping({ channelId });
    };
  }, [channelId, stopTyping]);

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
    try {
      await sendMessage({
        channelId,
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const insertEmoji = (emoji: string) => {
    setText((prev) => prev + emoji);
    textareaRef.current?.focus();
  };

  return (
    <div className="shrink-0 p-3">
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
          onChange={(e) => { setText(e.target.value); handleTyping(); }}
          onKeyDown={handleKeyDown}
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
            <EmojiPicker.Root
              className="isolate flex h-80 w-72 flex-col bg-popover"
              onEmojiSelect={({ emoji }) => insertEmoji(emoji)}
            >
              <EmojiPicker.Search className="z-10 mx-2 mt-2 rounded-md border bg-background px-2 py-1 text-sm outline-none" />
              <EmojiPicker.Viewport className="relative flex-1 outline-none">
                <EmojiPicker.Loading className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                  Loading…
                </EmojiPicker.Loading>
                <EmojiPicker.Empty className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                  No emoji found.
                </EmojiPicker.Empty>
                <EmojiPicker.List className="pb-2" />
              </EmojiPicker.Viewport>
            </EmojiPicker.Root>
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
