"use client";

import { Check, Copy } from "lucide-react";
import { Children, isValidElement, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { safeHref } from "../../../convex/lib/studioDocs";
import { cn } from "@/lib/utils";

/**
 * A page of Studio's guides, drawn.
 *
 * The text can be written by staff in the Admin Console, so it is treated as untrusted even though
 * staff wrote it: this renderer never runs HTML (there is no raw-HTML plugin, so a `<script>` or an
 * `<iframe>` in the text is shown as text), follows only links `safeHref` allows — `https:`, an
 * anchor on the page, or `doc:some/page` for another guide — and shows a picture only from an https
 * address. Colours come from the theme tokens, so a guide looks right in any theme and in the
 * Admin Console's preview as in Studio.
 */

const text = (node: ReactNode): string =>
  Children.toArray(node)
    .map((c) => (typeof c === "string" || typeof c === "number" ? String(c) : isValidElement(c) ? text((c.props as { children?: ReactNode }).children) : ""))
    .join("");

const anchorOf = (node: ReactNode) =>
  text(node)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative my-3 overflow-hidden rounded-md border border-border bg-muted/60">
      <div className="flex items-center justify-between border-b border-border/70 px-3 py-1 text-[10px] tracking-wide text-muted-foreground uppercase">
        <span>{language || "text"}</span>
        <button
          type="button"
          aria-label="Copy code"
          onClick={() => {
            void navigator.clipboard?.writeText(code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="flex items-center gap-1 rounded px-1 py-0.5 normal-case hover:bg-foreground/10 hover:text-foreground"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed text-foreground">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function Markdown({ text: source, onDoc, className }: { text: string; onDoc?: (slug: string) => void; className?: string }) {
  return (
    <div className={cn("space-y-3 text-[13px] leading-relaxed text-foreground/90 [&>*:first-child]:mt-0", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // Our own rule, not the default: `doc:` has to survive, and anything not on the list is dropped.
        urlTransform={(url) => safeHref(url) ?? ""}
        components={{
          h1: ({ children }) => <h2 id={anchorOf(children)} className="mt-6 text-lg font-semibold tracking-tight text-foreground">{children}</h2>,
          h2: ({ children }) => <h2 id={anchorOf(children)} className="mt-6 border-b border-border/60 pb-1 text-[15px] font-semibold text-foreground">{children}</h2>,
          h3: ({ children }) => <h3 id={anchorOf(children)} className="mt-5 text-[13px] font-semibold text-foreground">{children}</h3>,
          h4: ({ children }) => <h4 className="mt-4 text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">{children}</h4>,
          p: ({ children }) => <p>{children}</p>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5 marker:text-muted-foreground">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5 marker:text-muted-foreground">{children}</ol>,
          blockquote: ({ children }) => <blockquote className="border-l-2 border-primary/50 bg-muted/40 py-1 pr-3 pl-3 text-foreground/80 [&>p]:my-1">{children}</blockquote>,
          hr: () => <hr className="my-5 border-border" />,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-md border border-border">
              <table className="w-full border-collapse text-[12px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-muted/60 text-left text-muted-foreground">{children}</thead>,
          th: ({ children }) => <th className="px-3 py-1.5 font-medium">{children}</th>,
          td: ({ children }) => <td className="border-t border-border/60 px-3 py-1.5 align-top">{children}</td>,
          // A fenced block arrives as <pre><code class="language-ts">…</code></pre>.
          pre: ({ children }) => {
            const child = Children.toArray(children)[0];
            const props = isValidElement(child) ? (child.props as { className?: string; children?: ReactNode }) : {};
            return <CodeBlock code={text(props.children).replace(/\n$/, "")} language={/language-([\w-]+)/.exec(props.className ?? "")?.[1] ?? ""} />;
          },
          code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.92em] text-foreground">{children}</code>,
          a: ({ href, children }) => {
            if (!href) return <span>{children}</span>;
            if (href.startsWith("doc:")) {
              const slug = href.slice(4).split("#")[0];
              return (
                <button type="button" onClick={() => onDoc?.(slug)} className="text-primary underline underline-offset-2 hover:opacity-80">
                  {children}
                </button>
              );
            }
            if (href.startsWith("#")) {
              return (
                <a
                  href={href}
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById(href.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  className="text-primary underline underline-offset-2"
                >
                  {children}
                </a>
              );
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
                {children}
              </a>
            );
          },
          // https only: an address another site can see, so no picture is fetched from anywhere surprising.
          img: ({ src, alt }) => {
            const ok = typeof src === "string" && src.startsWith("https://");
            // eslint-disable-next-line @next/next/no-img-element
            return ok ? <img src={src} alt={alt ?? ""} loading="lazy" referrerPolicy="no-referrer" className="my-2 max-w-full rounded-md border border-border" /> : <span className="text-muted-foreground">[{alt || "picture"}]</span>;
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
