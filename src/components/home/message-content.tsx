"use client";

import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";

import { LinkEmbedCard } from "@/components/home/link-embed-card";
import { classifyUrl, extractUrls } from "@/lib/message-links";

interface MessageContentProps {
  text: string;
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

export function MessageContent({ text }: MessageContentProps) {
  const urls = extractUrls(text);
  const mediaUrls = urls.filter((url) => classifyUrl(url) !== "link");
  const linkUrls = urls.filter((url) => classifyUrl(url) === "link");

  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-sm leading-relaxed break-words">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
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
            img: ({ src, alt }) => (
              <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} className="max-h-80 max-w-full rounded-md" />
            ),
            p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
            ul: ({ children }) => <ul className="list-disc pl-5">{children}</ul>,
            ol: ({ children }) => <ol className="list-decimal pl-5">{children}</ol>,
            blockquote: ({ children }) => (
              <blockquote className="border-l-2 border-muted-foreground/40 pl-3 text-muted-foreground">
                {children}
              </blockquote>
            ),
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
          {text}
        </ReactMarkdown>
      </div>

      {mediaUrls.map((url) => (
        <MediaEmbed key={url} url={url} />
      ))}
      {linkUrls.map((url) => (
        <LinkEmbedCard key={url} url={url} />
      ))}
    </div>
  );
}
