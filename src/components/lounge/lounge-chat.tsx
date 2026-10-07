"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { AnimatePresence, motion } from "framer-motion";
import { ImagePlus, SendHorizontal, Smile, Sticker as StickerIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { LOUNGE_STICKERS } from "../../../convex/lib/loungeStickers";
import { CustomEmojiImage } from "@/components/custom-emoji-image";
import { ComposerEmojiPicker, EMOJI_TRIGGER_ATTRIBUTE } from "@/components/composer-emoji-picker";
import { EmojiToken } from "@/components/lounge/lounge-effects";
import { Sticker, StickerArt } from "@/components/lounge/sticker-art";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatCustomEmoji, type ServerEmoji } from "@/lib/custom-emoji";
import { cn } from "@/lib/utils";

export interface LoungeChatMessage {
  id: string;
  authorId: string;
  kind: "text" | "image" | "emoji" | "sticker";
  text?: string;
  emoji?: string;
  sticker?: { source: "builtin" | "emoji"; id: string; imageUrl?: string };
  imageUrl?: string;
  createdAt: number;
}

/** How long a message hangs in the floating list an audience member sees. */
const FLOAT_MS = 8000;
const FLOAT_MAX = 5;

/** Nothing but emoji: sent as one that floats up rather than as a line of text. */
const ONLY_EMOJI = /^(?:\p{Extended_Pictographic}|‍|️|[\u{1F3FB}-\u{1F3FF}])+$/u;

/** One line of the chat, as the window or the floating list shows it. */
function Line({ message, name, compact }: { message: LoungeChatMessage; name: string; compact?: boolean }) {
  return (
    <div className={cn("flex min-w-0 items-start gap-1.5 leading-snug", compact ? "text-xs" : "text-[13px]")}>
      <span className="shrink-0 font-semibold text-white/90">{name}</span>
      <span className="min-w-0 flex-1 break-words text-white/85">
        {message.kind === "text" && message.text}
        {message.kind === "emoji" && <EmojiToken value={message.emoji ?? ""} className="size-5 align-middle text-lg leading-none" />}
        {message.kind === "sticker" && message.sticker && (
          <Sticker sticker={message.sticker} className={cn("align-middle", compact ? "h-6 w-9" : "h-8 w-12")} />
        )}
        {message.kind === "image" && message.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={message.imageUrl}
            alt=""
            className={cn("mt-0.5 block rounded-md object-cover", compact ? "max-h-14" : "max-h-24")}
            draggable={false}
          />
        )}
      </span>
    </div>
  );
}

/**
 * The lounge's chat: a small scrolling window over a compact composer.
 *
 * It has two faces. Someone standing in the room reads the window — which fades
 * back while they aren't using it, so it sits over the scene without hiding it.
 * Someone in the audience, with no avatar to hang a bubble from, instead gets a
 * short list that floats up above the composer as people talk and fades out
 * again, until they hover or focus the chat and the full window takes its place.
 */
export function LoungeChat({
  channelId,
  communityId,
  messages,
  nameOf,
  audience,
  onTyping,
}: {
  channelId: Id<"channels">;
  communityId: Id<"communities">;
  messages: LoungeChatMessage[];
  nameOf: (authorId: string) => string;
  audience: boolean;
  onTyping: (on: boolean) => void;
}) {
  const send = useMutation(api.lounge.send);
  const generateUploadUrl = useMutation(api.lounge.generateUploadUrl);
  const customEmojis = useQuery(api.communityEmojis.list, { communityId });

  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [stickersOpen, setStickersOpen] = useState(false);
  // The pointer is on the window itself — only possible while it is open, so
  // reading and scrolling it back never closes it from under the reader.
  const [overWindow, setOverWindow] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const typingSent = useRef(0);
  const errorTimer = useRef<number | undefined>(undefined);

  // The window is there while the chat is in use, and gone otherwise.
  const focused = inputFocused || emojiOpen || stickersOpen || overWindow;

  const fail = useCallback((message: string) => {
    setError(message);
    window.clearTimeout(errorTimer.current);
    errorTimer.current = window.setTimeout(() => setError(null), 3500);
  }, []);
  useEffect(() => () => window.clearTimeout(errorTimer.current), []);

  const deliver = useCallback(
    async (args: Omit<FunctionArgs<typeof api.lounge.send>, "channelId">) => {
      try {
        await send({ channelId, ...args });
      } catch (e) {
        fail(e instanceof Error ? e.message.replace(/^.*Uncaught Error:\s*/s, "").split("\n")[0] : "That didn't send.");
      }
    },
    [send, channelId, fail],
  );

  const stopTyping = useCallback(() => {
    if (typingSent.current) {
      typingSent.current = 0;
      onTyping(false);
    }
  }, [onTyping]);

  const submit = useCallback(async () => {
    const value = text.trim();
    if (!value) return;
    setText("");
    stopTyping();
    if (value.length <= 24 && ONLY_EMOJI.test(value)) await deliver({ kind: "emoji", emoji: value });
    else await deliver({ kind: "text", text: value });
    inputRef.current?.focus();
  }, [text, deliver, stopTyping]);

  const uploadImage = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/") || file.type === "image/svg+xml") return fail("Only pictures can be sent here.");
      try {
        const url = await generateUploadUrl({ channelId });
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
        if (!res.ok) throw new Error("The upload failed.");
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        await deliver({
          kind: "image",
          image: { storageId, fileName: file.name, fileType: file.type, fileSize: file.size },
        });
      } catch (e) {
        fail(e instanceof Error ? e.message : "The upload failed.");
      }
    },
    [generateUploadUrl, channelId, deliver, fail],
  );

  const onChange = (value: string) => {
    setText(value);
    if (!value.trim()) return stopTyping();
    const t = Date.now();
    if (t - typingSent.current > 2500) {
      typingSent.current = t;
      onTyping(true);
    }
  };
  useEffect(() => stopTyping, [stopTyping]);

  // Keep the window on the newest line, unless the reader has scrolled up to read.
  useEffect(() => {
    const el = windowRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, focused, audience]);

  // The floating list needs a clock only while there is something in it.
  const floating = messages.filter((m) => now - m.createdAt < FLOAT_MS).slice(-FLOAT_MAX);
  useEffect(() => {
    if (!audience || focused || floating.length === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 600);
    return () => window.clearInterval(timer);
  }, [audience, focused, floating.length]);
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last) setNow(Date.now());
  }, [messages]);

  const showFloating = audience && !focused;

  return (
    <div className="relative ml-auto w-full max-w-sm">
      {/* Above the composer and out of the layout: the room underneath never
          changes size, however long the conversation gets. */}
      <div className="pointer-events-none absolute right-0 bottom-full left-0 z-10 mb-1.5 flex flex-col gap-1">
        {showFloating ? (
          <div className="flex flex-col justify-end gap-1 overflow-hidden">
            <AnimatePresence initial={false}>
              {floating.map((m, i) => (
                <motion.div
                  key={m.id}
                  layout
                  initial={{ opacity: 0, y: 24, scale: 0.96 }}
                  animate={{ opacity: 0.55 + (i / Math.max(1, floating.length)) * 0.45, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -16, transition: { duration: 0.5 } }}
                  transition={{ type: "spring", stiffness: 420, damping: 32 }}
                  className="w-fit max-w-full rounded-full border border-white/10 bg-neutral-900/80 px-3 py-1"
                >
                  <Line message={m} name={nameOf(m.authorId)} compact />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        ) : focused ? (
          <motion.div
            key="window"
            ref={windowRef}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8, transition: { duration: 0.18 } }}
            onPointerEnter={() => setOverWindow(true)}
            onPointerLeave={() => setOverWindow(false)}
            onScroll={(e) => {
              const el = e.currentTarget;
              stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
            }}
            className={cn(
              "pointer-events-auto max-h-44 min-h-0 space-y-1 overflow-y-auto rounded-2xl border border-white/10 bg-neutral-900/80 px-3 py-2",
              messages.length === 0 && "hidden",
            )}
          >
            {messages.map((m) => (
              <Line key={m.id} message={m} name={nameOf(m.authorId)} />
            ))}
          </motion.div>
        ) : null}

        {error && <p className="px-2 text-xs text-red-300">{error}</p>}
      </div>

      <div className="relative">
        <ComposerEmojiPicker
          open={emojiOpen}
          onClose={() => setEmojiOpen(false)}
          onSelect={(value, custom?: ServerEmoji) =>
            void deliver({ kind: "emoji", emoji: custom ? formatCustomEmoji(custom) : value })
          }
        />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className={cn(
            "flex items-center gap-1 rounded-full border border-white/12 bg-neutral-900/80 py-1 pr-1 pl-2 transition-colors",
            inputFocused && "border-white/25 bg-neutral-900/85",
            emojiOpen && "rounded-t-none",
          )}
        >
          <button
            type="button"
            {...{ [EMOJI_TRIGGER_ATTRIBUTE]: "" }}
            onClick={() => setEmojiOpen((o) => !o)}
            aria-label="Emoji"
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Smile className="size-4" />
          </button>

          <Popover open={stickersOpen} onOpenChange={setStickersOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Stickers"
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              >
                <StickerIcon className="size-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="w-72 rounded-2xl border-white/10 bg-neutral-900/95 p-2.5 text-white">
              <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto">
                {LOUNGE_STICKERS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setStickersOpen(false);
                      void deliver({ kind: "sticker", sticker: { source: "builtin", id: s.id } });
                    }}
                    className="rounded-xl p-1 transition-transform hover:scale-110 hover:bg-white/10 active:scale-95"
                  >
                    <StickerArt id={s.id} className="w-full" />
                  </button>
                ))}
              </div>
              {customEmojis && customEmojis.length > 0 && (
                <>
                  <p className="mt-2 mb-1 px-1 text-[11px] font-semibold tracking-wide text-white/50 uppercase">This server</p>
                  <div className="grid max-h-28 grid-cols-6 gap-1 overflow-y-auto">
                    {customEmojis.map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        title={`:${e.name}:`}
                        onClick={() => {
                          setStickersOpen(false);
                          void deliver({ kind: "sticker", sticker: { source: "emoji", id: e.id } });
                        }}
                        className="rounded-lg p-1 transition-transform hover:scale-110 hover:bg-white/10"
                      >
                        <CustomEmojiImage src={e.imageUrl} name={e.name} className="size-7 object-contain" />
                      </button>
                    ))}
                  </div>
                </>
              )}
            </PopoverContent>
          </Popover>

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label="Send a picture"
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <ImagePlus className="size-4" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void uploadImage(file);
            }}
          />

          <input
            ref={inputRef}
            value={text}
            maxLength={300}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setInputFocused(true)}
            onBlur={() => {
              setInputFocused(false);
              stopTyping();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") inputRef.current?.blur();
            }}
            onPaste={(e) => {
              const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
              if (file) {
                e.preventDefault();
                void uploadImage(file);
              }
            }}
            placeholder="Say something…"
            aria-label="Message the lounge"
            className="min-w-0 flex-1 bg-transparent px-1.5 text-sm text-white outline-none placeholder:text-white/40"
          />

          <button
            type="submit"
            disabled={!text.trim()}
            aria-label="Send"
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/15 text-white transition-colors enabled:hover:bg-white/25 disabled:opacity-35"
          >
            <SendHorizontal className="size-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
}
