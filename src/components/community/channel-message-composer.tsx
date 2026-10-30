"use client";

import { useConvex, useMutation, useQuery } from "convex/react";
import { AtSign, BarChart3, Mic, Paperclip, Reply, Send, Smile, Sticker, Volume2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { CustomEmojiImage } from "@/components/custom-emoji-image";
import {
  ComposerAttachments,
  ComposerDropOverlay,
} from "@/components/home/composer-attachments";
import { ComposerEmojiPicker, EMOJI_TRIGGER_ATTRIBUTE } from "@/components/composer-emoji-picker";
import { ComposerMediaPicker, MEDIA_TRIGGER_ATTRIBUTE } from "@/components/composer-media-picker";
import { GifIcon } from "@/components/icons/gif-icon";
import { ComposerStickerPicker, STICKER_TRIGGER_ATTRIBUTE } from "@/components/composer-sticker-picker";
import { PollComposerDialog, type NewPoll } from "@/components/community/poll-composer-dialog";
import { VoiceMessageRecorder } from "@/components/community/voice-message-recorder";
import { keyring } from "@/lib/e2ee";
import { tryUploadViaR2 } from "@/lib/r2-client";
import { uploadToStorage } from "@/lib/storage-upload";
import { describeWait } from "../../../convex/lib/slowmodePure";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_LABEL } from "@/lib/upload-limits";
import { shareKlipyItem } from "@/lib/klipy";
import { klipyAttachment, type KlipyItem } from "../../../convex/lib/klipy";
import { Button } from "@/components/ui/button";
import {
  EmojiTextInput,
  type EmojiTextInputHandle,
} from "@/components/home/emoji-text-input";
import { useAccessibleEmojis } from "@/hooks/use-accessible-emojis";
import { useComposerAttachments } from "@/hooks/use-composer-attachments";
import { useOutboxMutation } from "@/hooks/use-outbox-mutation";
import { encodeCustomEmojiShortcodes } from "@/lib/custom-emoji";
import { formatCustomEmoji, matchInProgressShortcode } from "@/lib/custom-emoji";
import { searchSystemEmoji, useSystemEmojiReady } from "@/lib/system-emoji";
import { matchInProgressMention, mentionToken } from "@/lib/mentions";
import { useMentionNames, useMentionSuggestions } from "@/hooks/use-mentions";
import type { ReplyDraft } from "@/lib/reply";
import { GLASS_BASE, GLASS_DARK, GLASS_SOFT } from "@/components/sidebar/glass";
import { cn } from "@/lib/utils";

interface ChannelMessageComposerProps {
  channelId: Id<"channels">;
  communityId: Id<"communities">;
  /** The message being replied to, or null. */
  replyingTo?: ReplyDraft | null;
  onCancelReply?: () => void;
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
export function ChannelMessageComposer({
  channelId,
  communityId,
  replyingTo,
  onCancelReply,
}: ChannelMessageComposerProps) {
  const [text, setText] = useState("");
  const [pingReply, setPingReply] = useState(true);
  useEffect(() => {
    if (replyingTo) setPingReply(true);
  }, [replyingTo?.id]);
  // The composer holds readable `:name:` shortcodes; the message has to carry
  // `<:name:id>` so any reader can resolve the emoji without guessing which
  // server it came from.
  const { byName: allEmojiByName, byId: customEmojiById, communityOf: emojiCommunityOf } = useAccessibleEmojis();
  // Another community's emoji only goes into a message where Use External Emojis allows it; left
  // out of the lookup, a typed `:name:` stays the plain text it was typed as.
  const channelDetails = useQuery(api.channels.get, { channelId });
  const externalEmojis = channelDetails?.canUseExternalEmojis ?? true;
  // What this member may do here. Each of these hides or disables a control; the server checks every one again.
  const canAttach = channelDetails?.canAttachFiles ?? true;
  const canSendTts = channelDetails?.canSendTts ?? false;
  const canPoll = channelDetails?.canCreatePolls ?? false;
  const canVoice = channelDetails?.canSendVoiceMessages ?? false;
  const canExternalStickers = channelDetails?.canUseExternalStickers ?? false;
  const me = useQuery(api.users.getCurrentUser);
  const [tts, setTts] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [denied, setDenied] = useState<string | null>(null);

  // Slowmode: the server says when this member may next send; this counts down to it. A send also
  // starts the clock here at once, since the server's word arrives a moment after the click.
  const slowSeconds = channelDetails?.slowmodeSeconds ?? 0;
  const slowExempt = channelDetails?.slowmodeExempt ?? false;
  const [localUntil, setLocalUntil] = useState(0);
  const slowUntil = Math.max(channelDetails?.slowmodeUntil ?? 0, localUntil);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (slowUntil <= Date.now()) return;
    setClock(Date.now());
    const timer = setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now >= slowUntil) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [slowUntil]);
  const slowRemaining = slowSeconds > 0 && !slowExempt ? Math.max(0, slowUntil - clock) : 0;
  const slowed = slowRemaining > 0;
  const startSlowmode = () => {
    if (slowSeconds > 0 && !slowExempt) setLocalUntil(Date.now() + slowSeconds * 1000);
  };
  const customEmojiByName = useMemo(() => {
    if (externalEmojis || !channelDetails) return allEmojiByName;
    return new Map([...allEmojiByName].filter(([, e]) => emojiCommunityOf.get(e.id) === channelDetails.communityId));
  }, [allEmojiByName, emojiCommunityOf, externalEmojis, channelDetails]);
  const [sending, setSending] = useState(false);
  const [autocomplete, setAutocomplete] = useState<AutocompleteState | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const textareaRef = useRef<EmojiTextInputHandle>(null);

  const generateUploadUrl = useMutation(api.channelMessages.generateUploadUrl);
  const convexClient = useConvex();
  // Durable: the send lands in the IndexedDB outbox first and is drawn by the
  // channel list's overlay, then flushed to Convex (see src/lib/outbox.ts).
  const sendMessage = useOutboxMutation("send", "channel");
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
  // Without Attach Files the picker, paste and drop all do nothing, and say why.
  const noAttach = () => setDenied("You don't have permission to attach files in this channel.");
  const guardedAddFiles: typeof addFiles = (files) => (canAttach ? addFiles(files) : Promise.resolve(noAttach()));
  const guardedPaste: typeof handlePaste = (event) => {
    if (!canAttach && Array.from(event.clipboardData?.files ?? []).length > 0) {
      event.preventDefault();
      noAttach();
      return;
    }
    handlePaste(event);
  };
  const sendDirect = useMutation(api.channelMessages.send);
  const startTyping = useMutation(api.typing.start);
  const stopTyping = useMutation(api.typing.stop);
  const typingDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const serverEmojis = useQuery(api.communityEmojis.list, { communityId });
  // What the bots in this community offer. A command is run only when the text is exactly one of
  // these; anything else — a `/shrug` nobody handles — is sent as the ordinary message it is.
  const allBotCommands = useQuery(api.bots.commandsFor, { communityId }) ?? [];
  const botCommands = channelDetails?.canUseCommands === false ? [] : allBotCommands;
  const invokeCommand = useMutation(api.bots.invokeCommand);
  const [commandError, setCommandError] = useState<string | null>(null);
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

  // The Unicode emoji data is a separate chunk (see system-emoji.ts). Subscribing is also what makes suggestions that were
  // asked for before it arrived appear when it does.
  useSystemEmojiReady();
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
              preview: (
                <CustomEmojiImage src={e.imageUrl} name={e.name} className="size-4 object-contain" />
              ),
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

  /** The commands that fit what has been typed so far, while it is still just `/word`. */
  const commandMatches = (() => {
    const m = text.match(/^\/([a-z0-9_-]*)$/i);
    if (!m || botCommands.length === 0) return [];
    return botCommands.filter((c) => c.name.startsWith(m[1].toLowerCase())).slice(0, 8);
  })();

  const handleSend = async () => {
    if (slowed) return;
    setDenied(null);
    let trimmed = text.trim();
    // `/tts words` reads the words aloud to people with the channel open — only offered to people who may.
    let speakAloud = tts;
    const ttsCommand = canSendTts ? trimmed.match(/^\/tts(?:\s+([\s\S]*))?$/i) : null;
    if (ttsCommand) {
      trimmed = (ttsCommand[1] ?? "").trim();
      speakAloud = true;
    }
    if (!trimmed && pending.length === 0) return;
    const cmd = pending.length === 0 ? trimmed.match(/^\/([a-z0-9_-]{1,32})(?:\s+([\s\S]*))?$/i) : null;
    const known = cmd ? botCommands.filter((c) => c.name === cmd[1].toLowerCase()) : [];
    if (cmd && known.length > 0) {
      setCommandError(null);
      setSending(true);
      try {
        await invokeCommand({ channelId, command: cmd[1], args: cmd[2], botId: known.length === 1 ? known[0].botId : undefined });
        setText("");
      } catch (e) {
        setCommandError(e instanceof Error ? e.message.replace(/^.*Uncaught Error:\s*/s, "").split("\n")[0] : "That command didn't work.");
      } finally {
        setSending(false);
        textareaRef.current?.focus();
      }
      return;
    }
    if (typingDebounce.current) clearTimeout(typingDebounce.current);
    void stopTyping({ channelId });
    setSending(true);
    setAutocomplete(null);
    try {
      await sendMessage({
        channelId,
        text: trimmed ? encodeCustomEmojiShortcodes(trimmed, (name) => customEmojiByName.get(name)) : undefined,
        attachments: pending.length ? pending : undefined,
        tts: speakAloud && !!trimmed ? true : undefined,
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
      startSlowmode();
      setText("");
      setTts(false);
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

  const [emojiOpen, setEmojiOpen] = useState(false);
  // The GIF picker and the emoji picker both grow out of the same corner, so only one is open at a time.
  const [mediaOpen, setMediaOpen] = useState(false);

  const insertEmoji = (emoji: string) => {
    setText((prev) => prev + emoji);
    textareaRef.current?.focus();
  };

  /**
   * A GIF, clip or sticker is its own message: an attachment that points at KLIPY's file, sent at once. Whatever is
   * typed in the box stays there, to be sent on its own.
   */
  const sendKlipy = async (item: KlipyItem, query: string) => {
    setMediaOpen(false);
    if (slowed) return;
    if (!canAttach) return noAttach();
    await sendMessage({
      channelId,
      attachments: [klipyAttachment(item)],
      replyToId: replyingTo?.id,
      pingReply: replyingTo ? pingReply : undefined,
      replyToPreview: replyingTo
        ? { authorName: replyingTo.authorName, authorImageUrl: replyingTo.authorImageUrl, text: replyingTo.text, hasAttachment: replyingTo.hasAttachment }
        : undefined,
    });
    startSlowmode();
    shareKlipyItem(item, query);
    onCancelReply?.();
    textareaRef.current?.focus();
  };

  /** What a thrown Convex error says to a person: the first line, without the "Uncaught Error:" wrapper. */
  const readable = (e: unknown, fallback: string) =>
    e instanceof Error ? e.message.replace(/^.*Uncaught Error:\s*/s, "").split("\n")[0] : fallback;

  /** A community sticker is its own message, sent at once; the server checks it may be used here. */
  const sendSticker = async (stickerId: Id<"communityStickers">) => {
    setStickerOpen(false);
    if (slowed) return;
    try {
      await sendDirect({ channelId, stickerId, replyToId: replyingTo?.id as Id<"channelMessages"> | undefined, pingReply: replyingTo ? pingReply : undefined });
      startSlowmode();
      onCancelReply?.();
    } catch (e) {
      setDenied(readable(e, "That sticker couldn't be sent."));
    }
    textareaRef.current?.focus();
  };

  /** A poll. In an encrypted channel its words are sealed in the message and the server only learns how many options there are. */
  const createPoll = async (poll: NewPoll) => {
    if (slowed) throw new Error(`Slowmode is on. You can send again in ${describeWait(slowRemaining)}.`);
    try {
      if (channelDetails?.isAnnouncement) {
        await sendDirect({ channelId, poll: { question: poll.question, options: poll.options, multi: poll.multi, durationMs: poll.durationMs } });
      } else {
        if (!me) throw new Error("Still loading your account. Try again in a moment.");
        const sealed = await keyring.encrypt({ scope: "channel", channelId }, me._id, { poll: { question: poll.question, options: poll.options } });
        await sendDirect({ channelId, enc: sealed.enc, poll: { optionCount: poll.options.length, multi: poll.multi, durationMs: poll.durationMs } });
      }
    } catch (e) {
      throw new Error(readable(e, "The poll couldn't be sent."));
    }
    startSlowmode();
  };

  /** A recording goes up like any attachment, then is sent flagged as a voice message (which is what the server checks Send Voice Messages on). */
  const sendVoice = async (recording: { blob: Blob; mimeType: string; durationMs: number; waveform: number[] }) => {
    if (slowed) throw new Error(`Slowmode is on. You can send again in ${describeWait(slowRemaining)}.`);
    const extension = recording.mimeType.includes("ogg") ? "ogg" : recording.mimeType.includes("mp4") ? "m4a" : "webm";
    const file = new File([recording.blob], `Voice message.${extension}`, { type: recording.mimeType });
    if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`That recording is over ${MAX_ATTACHMENT_LABEL}.`);
    try {
      const r2 = await tryUploadViaR2(convexClient as never, file, "attachments");
      const uploaded = r2
        ? { cdnKey: r2.cdnKey, cdnUrl: r2.cdnUrl }
        : { storageId: (await uploadToStorage(await generateUploadUrl(), file)) as Id<"_storage"> };
      await sendDirect({
        channelId,
        attachments: [{ ...uploaded, fileName: file.name, fileType: recording.mimeType, fileSize: file.size }],
        voiceMessage: { durationMs: recording.durationMs, waveform: recording.waveform },
        replyToId: replyingTo?.id as Id<"channelMessages"> | undefined,
        pingReply: replyingTo ? pingReply : undefined,
      });
    } catch (e) {
      throw new Error(readable(e, "The voice message couldn't be sent."));
    }
    startSlowmode();
    setRecording(false);
    onCancelReply?.();
  };

  // 17px under the box, not 8: the user card is 8px (the sidebar's padding) +
  // 1px (its border) + 8px (the dock's padding) off the bottom of the window,
  // and the box is the same 58px tall (the card's 56px row plus its two 1px
  // border edges), so the two share a top and a bottom edge.
  return (
    <div ref={dropZoneRef} data-pack-panel="clear" className="relative shrink-0 bg-background p-2 pb-[17px] max-md:pb-2">
      <ComposerDropOverlay active={isDraggingOver} />
      {commandMatches.length > 0 && (
        <div className="absolute bottom-full left-3 mb-1 flex max-h-56 w-72 flex-col overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
          {commandMatches.map((c) => (
            <button
              key={`${c.botId}-${c.name}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setText(`/${c.name} `)}
              className="flex flex-col rounded px-2 py-1 text-left text-sm hover:bg-accent"
            >
              <span>
                <span className="font-medium">/{c.name}</span> <span className="text-xs text-muted-foreground">{c.botName}</span>
              </span>
              <span className="text-xs text-muted-foreground">{c.description}</span>
            </button>
          ))}
        </div>
      )}
      {commandError && (
        <button type="button" onClick={() => setCommandError(null)} className="mb-2 block w-full truncate rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-left text-xs text-destructive">
          {commandError}
        </button>
      )}
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

      {replyingTo && (
        <div className="mb-1.5 flex items-center gap-2 rounded-xl border bg-muted/40 px-2.5 py-1 text-xs">
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
      {denied && (
        <button
          type="button"
          onClick={() => setDenied(null)}
          className="mb-2 block w-full truncate rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-left text-xs text-destructive"
        >
          {denied}
        </button>
      )}

      {/* The call card's surface — see `GLASS_DARK`. The focus ring is the
          border lighting up rather than a ring outside it, which the card's
          rounded, clipped edge would cut. */}
      {/* The picker is a child of the box's own frame, so it sits flush on
          its top edge, and the box squares off the corner they share while it
          is open — one shape, not a card resting on another. */}
      <div className="relative">
        <ComposerEmojiPicker
          open={emojiOpen}
          onClose={() => setEmojiOpen(false)}
          onSelect={insertEmoji}
        />
        <ComposerMediaPicker open={mediaOpen} onClose={() => setMediaOpen(false)} onSelect={(item, query) => void sendKlipy(item, query)} />
        <ComposerStickerPicker
          open={stickerOpen}
          onClose={() => setStickerOpen(false)}
          onSelect={(sticker) => void sendSticker(sticker.id)}
          communityId={communityId}
          canUseExternal={canExternalStickers}
        />
        <div
          className={cn(
            GLASS_BASE,
            GLASS_DARK,
            GLASS_SOFT,
            (emojiOpen || mediaOpen || stickerOpen) && "rounded-tr-none",
            "flex h-[58px] items-center gap-1 px-2 py-1 transition-[border-color,box-shadow,border-radius] duration-200 focus-within:border-ring/70 focus-within:ring-ring/40",
          )}
        >
          {recording ? (
            <div className="min-w-0 flex-1">
              <VoiceMessageRecorder disabled={slowed} onCancel={() => setRecording(false)} onSend={sendVoice} />
            </div>
          ) : (
            <>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void guardedAddFiles(e.target.files)}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            disabled={uploading || !canAttach}
            aria-label="Attach files"
            title={canAttach ? "Attach files" : "You don't have permission to attach files here"}
            onClick={openFilePicker}
          >
            <Paperclip className="size-4" />
          </Button>

          <EmojiTextInput
            ref={textareaRef}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            onPaste={guardedPaste}
            onBlur={() => setAutocomplete(null)}
            emojiByName={customEmojiByName}
            emojiById={customEmojiById}
            mentionNames={mentionNames}
            placeholder={slowed ? `Slowmode is on — you can send again in ${describeWait(slowRemaining)}` : "Message…"}
          />

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-expanded={emojiOpen}
            {...{ [EMOJI_TRIGGER_ATTRIBUTE]: "" }}
            onClick={() => {
              setMediaOpen(false);
              setStickerOpen(false);
              setEmojiOpen((open) => !open);
            }}
          >
            <Smile className="size-4" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label="GIFs, clips and stickers"
            title="GIFs, clips and stickers"
            aria-expanded={mediaOpen}
            {...{ [MEDIA_TRIGGER_ATTRIBUTE]: "" }}
            onClick={() => {
              setEmojiOpen(false);
              setStickerOpen(false);
              setMediaOpen((open) => !open);
            }}
          >
            <GifIcon className="size-5" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label="Server stickers"
            title="Server stickers"
            aria-expanded={stickerOpen}
            {...{ [STICKER_TRIGGER_ATTRIBUTE]: "" }}
            onClick={() => {
              setEmojiOpen(false);
              setMediaOpen(false);
              setStickerOpen((open) => !open);
            }}
          >
            <Sticker className="size-4" />
          </Button>

          {/* Only offered to people who hold the permission behind each; the server decides all the same. */}
          {canPoll && (
            <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Create a poll" title="Create a poll" onClick={() => setPollOpen(true)}>
              <BarChart3 className="size-4" />
            </Button>
          )}
          {canSendTts && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn("size-8 shrink-0", tts && "bg-primary/15 text-primary hover:bg-primary/25")}
              aria-pressed={tts}
              aria-label="Send as text-to-speech"
              title={tts ? "This message will be read aloud — click to turn off" : "Read the next message aloud (or start it with /tts)"}
              onClick={() => setTts((on) => !on)}
            >
              <Volume2 className="size-4" />
            </Button>
          )}
          {canVoice && (
            <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Record a voice message" title="Record a voice message" onClick={() => setRecording(true)}>
              <Mic className="size-4" />
            </Button>
          )}

          <Button
            type="button"
            size="icon"
            className="size-8 shrink-0"
            disabled={sending || uploading || slowed}
            aria-label={slowed ? `Slowmode: ${describeWait(slowRemaining)} left` : "Send"}
            title={slowed ? `Slowmode: you can send again in ${describeWait(slowRemaining)}` : "Send"}
            onClick={() => void handleSend()}
          >
            {slowed ? <span className="text-[11px] font-semibold tabular-nums">{Math.ceil(slowRemaining / 1000)}</span> : <Send className="size-4" />}
          </Button>
            </>
          )}
        </div>
      </div>
      {canPoll && <PollComposerDialog open={pollOpen} onOpenChange={setPollOpen} onCreate={createPoll} />}
    </div>
  );
}
