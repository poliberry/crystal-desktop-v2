"use client";

import { useState } from "react";

/** The shape `convex/lib/embeds.ts` stores. Already validated on the server; still drawn defensively. */
export interface MessageEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  timestamp?: number;
  author?: { name: string; url?: string; iconUrl?: string };
  footer?: { text: string; iconUrl?: string };
  image?: { url: string };
  thumbnail?: { url: string };
  fields?: { name: string; value: string; inline?: boolean }[];
}

/** Only web addresses, so a stored value can never be a `javascript:` link. */
function safeHref(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A picture from the open web, which is the one thing here that makes a request to a site the
 * bot's author chose. So: no referrer is sent, it loads lazily, it's never given a way to run
 * anything, and if it fails the card just does without it.
 */
function Picture({ src, className, alt = "" }: { src: string; className: string; alt?: string }) {
  const [failed, setFailed] = useState(false);
  const url = safeHref(src);
  if (!url || failed) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} loading="lazy" referrerPolicy="no-referrer" decoding="async" onError={() => setFailed(true)} className={className} />;
}

function Wrap({ href, children, className }: { href?: string; children: React.ReactNode; className?: string }) {
  const url = safeHref(href);
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer nofollow" className={className ?? "hover:underline"}>
      {children}
    </a>
  ) : (
    <span className={className}>{children}</span>
  );
}

/**
 * Cards a bot attached to a message. Text is plain text (never markup), `white-space: pre-wrap` so
 * line breaks survive, and addresses are https only. Layout follows Discord's: a coloured bar,
 * author, title, description, fields (inline ones side by side), a picture, and a footer.
 */
export function MessageEmbeds({ embeds }: { embeds?: MessageEmbed[] }) {
  if (!embeds?.length) return null;
  return (
    <div className="mt-1 flex max-w-[520px] flex-col gap-1.5">
      {embeds.map((e, i) => {
        const bar = typeof e.color === "number" ? `#${e.color.toString(16).padStart(6, "0")}` : undefined;
        return (
          <div key={i} className="flex overflow-hidden rounded-md border bg-muted/30" data-embed>
            <div className="w-1 shrink-0" style={{ background: bar ?? "var(--border)" }} />
            <div className="grid min-w-0 flex-1 gap-1 p-3">
              <div className="flex gap-3">
                <div className="grid min-w-0 flex-1 gap-1">
                  {e.author && (
                    <div className="flex items-center gap-1.5 text-xs font-medium">
                      {e.author.iconUrl && <Picture src={e.author.iconUrl} className="size-5 rounded-full object-cover" />}
                      <Wrap href={e.author.url}>{e.author.name}</Wrap>
                    </div>
                  )}
                  {e.title && (
                    <div className="text-sm font-semibold">
                      <Wrap href={e.url} className="text-primary hover:underline">
                        {e.title}
                      </Wrap>
                    </div>
                  )}
                  {e.description && <p className="whitespace-pre-wrap break-words text-sm">{e.description}</p>}
                  {e.fields && e.fields.length > 0 && (
                    <div className="mt-1 grid gap-x-3 gap-y-2" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                      {e.fields.map((f, j) => (
                        <div key={j} className="min-w-0" style={{ gridColumn: f.inline ? "span 1" : "1 / -1" }}>
                          <p className="text-xs font-semibold">{f.name}</p>
                          <p className="whitespace-pre-wrap break-words text-sm">{f.value}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {e.thumbnail && <Picture src={e.thumbnail.url} className="size-16 shrink-0 rounded object-cover" />}
              </div>
              {e.image && <Picture src={e.image.url} className="mt-1 max-h-72 max-w-full rounded object-contain" />}
              {(e.footer || e.timestamp) && (
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  {e.footer?.iconUrl && <Picture src={e.footer.iconUrl} className="size-4 rounded-full object-cover" />}
                  {e.footer && <span className="break-words">{e.footer.text}</span>}
                  {e.footer && e.timestamp && <span>•</span>}
                  {e.timestamp && <time dateTime={new Date(e.timestamp).toISOString()}>{new Date(e.timestamp).toLocaleString()}</time>}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export interface MessageButton {
  customId?: string;
  label: string;
  style: "primary" | "secondary" | "success" | "danger" | "link";
  url?: string;
  emoji?: string;
  disabled?: boolean;
}

const BUTTON_STYLE: Record<MessageButton["style"], string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  success: "bg-emerald-600 text-white hover:bg-emerald-600/90",
  danger: "bg-destructive text-white hover:bg-destructive/90",
  link: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
};

/**
 * Rows of buttons a bot attached. A link opens in the browser; any other button tells the bot it
 * was pressed (the bot decides what happens) and is disabled for a moment so it can't be hammered.
 */
export function MessageComponents({ rows, onPress }: { rows?: { buttons: MessageButton[] }[]; onPress: (customId: string) => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  if (!rows?.length) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {rows.map((row, i) => (
        <div key={i} className="flex flex-wrap gap-1.5">
          {row.buttons.map((b, j) => {
            const cls = `inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_STYLE[b.style]}`;
            const content = (
              <>
                {b.emoji && <span aria-hidden>{b.emoji}</span>}
                {b.label}
              </>
            );
            const href = b.style === "link" ? safeHref(b.url) : undefined;
            if (b.style === "link") {
              return href && !b.disabled ? (
                <a key={j} href={href} target="_blank" rel="noopener noreferrer nofollow" className={cls}>
                  {content}
                </a>
              ) : (
                <button key={j} type="button" disabled className={cls}>
                  {content}
                </button>
              );
            }
            return (
              <button
                key={j}
                type="button"
                disabled={b.disabled || busy !== null}
                className={cls}
                onClick={async () => {
                  setBusy(b.customId ?? "");
                  setNote(null);
                  try {
                    await onPress(b.customId!);
                  } catch (e) {
                    setNote(e instanceof Error ? e.message.replace(/^.*Uncaught Error:\s*/s, "").split("\n")[0] : "That didn't work.");
                  } finally {
                    setTimeout(() => setBusy(null), 1200);
                  }
                }}
              >
                {content}
              </button>
            );
          })}
        </div>
      ))}
      {note && <p className="text-xs text-destructive">{note}</p>}
    </div>
  );
}
