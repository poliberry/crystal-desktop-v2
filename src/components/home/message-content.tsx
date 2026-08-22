"use client";

import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";

import { InviteEmbedCard } from "@/components/home/invite-embed-card";
import { LinkEmbedCard } from "@/components/home/link-embed-card";
import { useAccessibleEmojis } from "@/hooks/use-accessible-emojis";
import {
  CUSTOM_EMOJI_IMAGE_SCHEME,
  substituteEmojiShortcodes,
} from "@/lib/custom-emoji";
import { classifyUrl, extractInviteCodes, extractUrls } from "@/lib/message-links";
import { findSystemEmojiBySlug } from "@/lib/system-emoji";

interface MessageContentProps {
  text: string;
  /** Rendered inside the last paragraph, right after the text — e.g. an
   * "(edited)" tag — so it flows on the same line instead of dropping below
   * the (block-level) paragraph. */
  suffix?: React.ReactNode;
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

export function MessageContent({ text, suffix }: MessageContentProps) {
  // Every community the reader belongs to, not just the one they're viewing:
  // a message can carry an emoji from any server they share with the author.
  const { byId: serverEmojiById, byName } = useAccessibleEmojis();
  const urls = extractUrls(text);
  const mediaUrls = urls.filter((url) => classifyUrl(url) !== "link");
  const linkUrls = urls.filter((url) => classifyUrl(url) === "link");
  const inviteCodes = extractInviteCodes(text);
  // Approximates remark's paragraph count so `suffix` (e.g. "(edited)") only
  // lands in the last one, instead of after every paragraph.
  const paragraphCount = text.split(/\n{2,}/).filter((s) => s.trim()).length || 1;
  let paragraphIndex = 0;

  // Converts `<:name:id>` and `:slug:` into markdown image syntax / literal
  // characters before handing off to ReactMarkdown — see substituteEmojiShortcodes'
  // doc comment for why this (rather than a raw-HTML/rehype-raw plugin) is
  // the renderer-side seam, and why it also covers messages sent by hand
  // without ever touching the composer's `:name:` autocomplete.
  const processedText = substituteEmojiShortcodes(text, findSystemEmojiBySlug, (name) =>
    byName.get(name)
  );

  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-sm leading-relaxed break-words">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          // react-markdown blanks any URL whose scheme isn't http/https/
          // mailto/…, which silently emptied the `customemoji:` src that
          // carries an emoji id — the image then rendered broken with its alt
          // text beside it. Let that one scheme through and defer to the
          // default sanitiser for everything else.
          urlTransform={(url) =>
            url.startsWith(CUSTOM_EMOJI_IMAGE_SCHEME) ? url : defaultUrlTransform(url)
          }
          components={{
            a: ({ href, children }) => (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2"
              >
                {children}
              </a>
            ),
            img: ({ src, alt }) => {
              if (typeof src === "string" && src.startsWith(CUSTOM_EMOJI_IMAGE_SCHEME)) {
                const id = src.slice(CUSTOM_EMOJI_IMAGE_SCHEME.length);
                const serverEmoji = serverEmojiById.get(id);
                if (serverEmoji) {
                  return (
                    <img
                      src={serverEmoji.imageUrl}
                      alt={`:${serverEmoji.name}:`}
                      title={`:${serverEmoji.name}:`}
                      // `align-middle` with a matched line-height keeps the
                      // image sitting on the text baseline instead of pushing
                      // the line box around.
                      className="inline-block size-6 align-middle object-contain"
                    />
                  );
                }
                // Deleted, or from a server this reader isn't in.
                return (
                  <span title={alt} className="opacity-60">
                    {alt ? `:${alt}:` : "🏷️"}
                  </span>
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
                  {isLast && suffix}
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
