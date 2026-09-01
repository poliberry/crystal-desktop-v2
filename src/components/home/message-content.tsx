"use client";

import { memo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";

import { CustomEmojiChip } from "@/components/home/custom-emoji-card";
import { InviteEmbedCard } from "@/components/home/invite-embed-card";
import { LinkEmbedCard } from "@/components/home/link-embed-card";
import {
  useAccessibleEmojis,
  type AccessibleEmojis,
} from "@/hooks/use-accessible-emojis";
import {
  CUSTOM_EMOJI_IMAGE_SCHEME,
  substituteEmojiShortcodes,
} from "@/lib/custom-emoji";
import { classifyUrl, extractInviteCodes, extractUrls } from "@/lib/message-links";
import {
  MENTION_LINK_SCHEME,
  parseMentionLink,
  substituteMentions,
  type MentionNames,
} from "@/lib/mentions";
import { useMentionNames } from "@/hooks/use-mentions";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { findSystemEmojiBySlug } from "@/lib/system-emoji";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { ProfilePopoverContent } from "@/components/profile/profile-popover";
import { UserProfileContent } from "@/components/community/member-profile-card";

interface MessageContentProps {
  text: string;
  /** Whether to trail an "(edited)" tag on the last paragraph, on the same
   * line as the text rather than dropping below the (block-level) paragraph.
   * A plain boolean, not a node, so it stays referentially stable across the
   * frequent re-renders of the message lists — see `MessageMarkdown`. */
  edited?: boolean;
  /** Which community's members and roles to resolve mentions against. Absent
   * in a DM, where a `<@id>` can still name a person but there are no roles
   * and no `@everyone` to speak of. */
  communityId?: Id<"communities">;
}

function MediaEmbed({ url }: { url: string }) {
  const kind = classifyUrl(url);
  if (kind === "image") {
    return <img src={url} alt="" className="max-h-96 max-w-full rounded-md border" />;
  }
  if (kind === "video") {
    return <video src={url} controls className="max-h-96 max-w-full rounded-md border" />;
  }
  return null;
}

/**
 * A `<@user>` mention, rendered as a pill that opens the author's profile
 * popover on click — the same card as clicking their name on a message.
 *
 * Outside a community (a DM) there's no member directory to resolve against
 * and no per-server profile to show, so it stays a static pill.
 */
function UserMentionPill({
  userId,
  communityId,
  member,
  className,
  children,
}: {
  userId: string;
  communityId?: Id<"communities">;
  member?: { name: string; username: string; imageUrl?: string };
  className?: string;
  children: React.ReactNode;
}) {
  const pill = (
    <button type="button" className={className}>
      {children}
    </button>
  );
  if (!communityId) return <span className={className}>{children}</span>;
  return (
    <Popover>
      <PopoverTrigger asChild>{pill}</PopoverTrigger>
      <ProfilePopoverContent
        userId={userId as Id<"users">}
        communityId={communityId}
        side="top"
      >
        <UserProfileContent
          userId={userId as Id<"users">}
          communityId={communityId}
          name={member?.name ?? ""}
          username={member?.username ?? ""}
          imageUrl={member?.imageUrl}
        />
      </ProfilePopoverContent>
    </Popover>
  );
}

/** Custom emoji, once `substituteEmojiShortcodes` has turned it into a
 * fake-scheme markdown image. */
const CUSTOM_EMOJI_IMAGE_MD_RE = /!\[[^\]]*\]\(customemoji:[^)]*\)/g;

/** Unicode emoji and the bits that glue them together — ZWJ, variation
 * selectors, skin-tone modifiers, regional-indicator (flag) halves. */
const UNICODE_EMOJI_RE =
  /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji_Modifier}\u200D\uFE0F\u{1F1E6}-\u{1F1FF}]/gu;

/**
 * Whether a message is nothing but emoji — the cue to render them large, the
 * way every other chat app does. Runs on the already-substituted text, so a
 * `:shortcode:` only counts if it actually resolved to an emoji.
 */
function isEmojiOnly(processed: string): boolean {
  const withoutCustom = processed.replace(CUSTOM_EMOJI_IMAGE_MD_RE, " ");
  const hadCustomEmoji = withoutCustom !== processed;
  const leftover = withoutCustom.replace(UNICODE_EMOJI_RE, "").trim();
  if (leftover.length > 0) return false;
  return hadCustomEmoji || withoutCustom.trim().length > 0;
}

interface MessageMarkdownProps {
  text: string;
  edited?: boolean;
  communityId?: Id<"communities">;
  /** The reader's own id, so a mention pointing at them can be styled. */
  myUserId?: string;
  emojis: AccessibleEmojis;
  mentionNames: MentionNames;
}

/**
 * The rendered markdown body, split out and memoised on purpose.
 *
 * `ReactMarkdown` is given an inline `components` map, and a new function
 * identity for any of those renderers remounts the whole subtree — which
 * throws away the open state of the mention popover that lives inside the `a`
 * renderer. `MessageContent` re-renders whenever one of its several live
 * queries ticks, so keeping the markdown behind a `memo` boundary (its props
 * are all referentially stable) is what lets a mention popover stay open.
 */
const MessageMarkdown = memo(function MessageMarkdown({
  text,
  edited,
  communityId,
  myUserId,
  emojis,
  mentionNames,
}: MessageMarkdownProps) {
  const { byId: serverEmojiById, byName } = emojis;
  // Approximates remark's paragraph count so `suffix` (e.g. "(edited)") only
  // lands in the last one, instead of after every paragraph.
  const paragraphCount = text.split(/\n{2,}/).filter((s) => s.trim()).length || 1;
  let paragraphIndex = 0;

  // Converts `<:name:id>` and `:slug:` into markdown image syntax / literal
  // characters before handing off to ReactMarkdown — see substituteEmojiShortcodes'
  // doc comment for why this (rather than a raw-HTML/rehype-raw plugin) is
  // the renderer-side seam, and why it also covers messages sent by hand
  // without ever touching the composer's `:name:` autocomplete.
  // Mentions go through the same seam, after emoji: `<@id>` and `<:name:id>`
  // can't be confused for each other, and doing mentions second keeps their
  // display names out of reach of emoji substitution.
  const processedText = substituteMentions(
    substituteEmojiShortcodes(text, findSystemEmojiBySlug, (name) => byName.get(name)),
    mentionNames
  );

  // A message that's nothing but emoji gets them at double size, like every
  // other chat app. Custom emoji jump from `size-6` to `size-12`; Unicode
  // emoji ride the container font-size.
  const jumbo = isEmojiOnly(processedText);

  return (
    <div
      className={cn(
        "break-words",
        jumbo ? "text-3xl leading-tight" : "text-sm leading-relaxed"
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // react-markdown blanks any URL whose scheme isn't http/https/
        // mailto/…, which silently emptied the `customemoji:` src that
        // carries an emoji id — the image then rendered broken with its alt
        // text beside it. Let that one scheme through and defer to the
        // default sanitiser for everything else.
        urlTransform={(url) =>
          url.startsWith(CUSTOM_EMOJI_IMAGE_SCHEME) || url.startsWith(MENTION_LINK_SCHEME)
            ? url
            : defaultUrlTransform(url)
        }
        components={{
          a: ({ href, children }) => {
            // Mentions ride in as links because that's the only inline
            // markdown node carrying both a label and a payload — see
            // substituteMentions. They're pills, not links: there's nowhere
            // to navigate to.
            const mention = href ? parseMentionLink(href) : null;
            if (mention) {
              const isMe = mention.kind === "user" && mention.id === myUserId;
              const isMassPing =
                mention.kind === "everyone" || mention.kind === "here" || mention.kind === "role";
              const pillClass = cn(
                "rounded-[4px] px-1 py-px font-medium",
                isMe || isMassPing
                  ? "bg-primary/25 text-primary-foreground"
                  : "bg-primary/15 text-primary"
              );
              // A user mention opens that person's profile, the same card as
              // clicking their name on a message. Roles and @everyone/@here
              // point at the channel, not a person — left as static pills.
              if (mention.kind === "user") {
                return (
                  <UserMentionPill
                    userId={mention.id}
                    communityId={communityId}
                    member={mentionNames.member?.(mention.id)}
                    className={cn(pillClass, "cursor-pointer hover:underline")}
                  >
                    {children}
                  </UserMentionPill>
                );
              }
              return <span className={pillClass}>{children}</span>;
            }
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2"
              >
                {children}
              </a>
            );
          },
          img: ({ src, alt }) => {
            if (typeof src === "string" && src.startsWith(CUSTOM_EMOJI_IMAGE_SCHEME)) {
              const id = src.slice(CUSTOM_EMOJI_IMAGE_SCHEME.length);
              // Resolved (a shared server) shows the picture; unresolved (a
              // server the reader isn't in, or a deleted emoji) falls back to
              // `:name:` text — either way the card behind it can say where it
              // came from.
              const serverEmoji = serverEmojiById.get(id);
              return (
                <CustomEmojiChip
                  emojiId={id}
                  name={serverEmoji?.name ?? alt ?? "emoji"}
                  imageUrl={serverEmoji?.imageUrl}
                  jumbo={jumbo}
                />
              );
            }
            return (
              <img src={typeof src === "string" && src.length > 1 ? src : undefined} alt={alt ?? ""} className="max-h-80 max-w-full rounded-md" />
            );
          },
          p: ({ children }) => {
            paragraphIndex += 1;
            const isLast = paragraphIndex === paragraphCount;
            return (
              <p className="whitespace-pre-wrap">
                {children}
                {isLast && edited && (
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    (edited)
                  </span>
                )}
              </p>
            );
          },
          ul: ({ children }) => <ul className="list-disc pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5">{children}</ol>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-muted-foreground/40 pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          // Tailwind's preflight resets heading font-size/weight/margin to
          // inherit — without these, an <h1>-<h6> from markdown renders
          // visually identical to plain paragraph text.
          h1: ({ children }) => <h1 className="mt-1 mb-0.5 text-lg font-bold">{children}</h1>,
          h2: ({ children }) => <h2 className="mt-1 mb-0.5 text-base font-bold">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-1 mb-0.5 text-sm font-bold">{children}</h3>,
          h4: ({ children }) => <h4 className="mt-1 mb-0.5 text-sm font-semibold">{children}</h4>,
          h5: ({ children }) => <h5 className="mt-1 mb-0.5 text-sm font-semibold">{children}</h5>,
          h6: ({ children }) => (
            <h6 className="mt-1 mb-0.5 text-sm font-semibold text-muted-foreground">{children}</h6>
          ),
          hr: () => <hr className="my-2 border-border" />,
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="border-collapse text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="border-b border-border">{children}</thead>,
          th: ({ children }) => <th className="px-2 py-1 text-left font-semibold">{children}</th>,
          td: ({ children }) => <td className="border-t border-border/50 px-2 py-1">{children}</td>,
          // The <code> renderer below already returns the right container
          // (a syntax-highlighted <div> for fenced blocks, a plain inline
          // <code> otherwise) — the default <pre> ancestor markdown wraps
          // around code blocks just fights that styling, so drop it.
          pre: ({ children }) => children,
          code(props) {
            const { children, className } = props;
            const match = /language-(\w+)/.exec(className ?? "");
            if (!match) {
              return <code className="rounded bg-muted px-1 py-0.5 text-[0.85em]">{children}</code>;
            }
            return (
              <SyntaxHighlighter
                language={match[1]}
                style={oneDark}
                PreTag="div"
                className="rounded-md! text-xs!"
              >
                {String(children).replace(/\n$/, "")}
              </SyntaxHighlighter>
            );
          },
        }}
      >
        {processedText}
      </ReactMarkdown>
    </div>
  );
});

MessageMarkdown.displayName = "MessageMarkdown";

export function MessageContent({ text, edited, communityId }: MessageContentProps) {
  // Every community the reader belongs to, not just the one they're viewing:
  // a message can carry an emoji from any server they share with the author.
  const emojis = useAccessibleEmojis();
  const mentionNames = useMentionNames(communityId);
  const me = useQuery(api.users.getCurrentUser);
  const myUserId = me?._id as string | undefined;
  const urls = extractUrls(text);
  const mediaUrls = urls.filter((url) => classifyUrl(url) !== "link");
  const linkUrls = urls.filter((url) => classifyUrl(url) === "link");
  const inviteCodes = extractInviteCodes(text);

  return (
    <div className="flex flex-col gap-1.5">
      <MessageMarkdown
        text={text}
        edited={edited}
        communityId={communityId}
        myUserId={myUserId}
        emojis={emojis}
        mentionNames={mentionNames}
      />

      {mediaUrls.map((url) => (
        <MediaEmbed key={url} url={url} />
      ))}
      {linkUrls.map((url) => (
        <LinkEmbedCard key={url} url={url} />
      ))}
      {inviteCodes.map((code) => (
        <InviteEmbedCard key={code} code={code} />
      ))}
    </div>
  );
}
