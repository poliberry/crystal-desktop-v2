/**
 * Email that is about a person's requests rather than their sign-in: replies to a support ticket,
 * updates on a report, and anything staff write to someone by hand.
 *
 * Sent through Resend's HTTP API with `fetch`, the same way sign-in codes are (see `lib/mail.ts`,
 * which has the two settings it needs: RESEND_API_KEY and AUTH_EMAIL_FROM). Optionally
 * SUPPORT_EMAIL_REPLY_TO sets where a reply to one of these goes.
 *
 * Nothing in here touches the database. `emailOutbox.ts` decides whether and to whom; this only
 * turns words into a message and hands it to the provider.
 */
import { mailConfigured } from "./mail";
import {
  ACCENT,
  ACCENT_INK,
  BODY_TEXT,
  CALLOUT_BG,
  HEADING,
  brandFooterHtml,
  brandDocumentHtml,
  brandFooterText,
  brandHeaderHtml,
  firstNameOf,
} from "./emailBrand";

export { mailConfigured as emailConfigured };

/** What an email says. Paragraphs are plain text; a blank line in the source starts a new one. */
export interface EmailContent {
  /** Large line at the top of the message body, under the Crystal wordmark. */
  heading?: string;
  paragraphs: string[];
  /** Why something ended, in words written for the person reading it — a closure
   * reason on a report or ticket. Rendered as its own block, never just prose. */
  note?: string;
  /** A button under the text. Both or neither. */
  ctaLabel?: string;
  ctaUrl?: string;
  /** The reader's first name, opening the email with "Hey <name>!". Absent when unknown. */
  firstName?: string;
  /** The email subject, used for the document title only. */
  subject?: string;
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** A web address that is safe to put in an `href`: https or http, nothing else. */
function safeHref(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** The public address of the app, for the links in these emails. */
export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://usecrystal.app").replace(/\/$/, "");
}

/**
 * The plain-text and HTML forms of a message. Everything a person or a staff member typed goes
 * through `escapeHtml`; line breaks inside a paragraph are kept.
 */
export function renderEmail(content: EmailContent): { text: string; html: string } {
  const href = safeHref(content.ctaUrl);
  const cta = href && content.ctaLabel ? { label: content.ctaLabel, href } : null;
  const year = new Date().getFullYear();
  const note = content.note?.trim() || undefined;
  const greeting = firstNameOf(content.firstName);

  const text = [
    greeting ? `Hey ${greeting}!` : undefined,
    greeting ? "" : undefined,
    content.heading,
    content.heading ? "" : undefined,
    ...content.paragraphs.flatMap((p) => [p, ""]),
    ...(note ? [`Why this happened:\n${note}`, ""] : []),
    cta ? `${cta.label}: ${cta.href}` : undefined,
    cta ? "" : undefined,
    ...brandFooterText(year),
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");

  const paragraphs = content.paragraphs
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:${BODY_TEXT}">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");

  const inner = brandHeaderHtml()
    + (greeting ? `<p style="margin:0 0 10px;font-size:17px;font-weight:700;color:${HEADING}">Hey ${escapeHtml(greeting)}!</p>` : "")
    + (content.heading ? `<h1 style="margin:0 0 14px;font-size:24px;line-height:1.25;font-weight:700;color:${HEADING}">${escapeHtml(content.heading)}</h1>` : "")
    + paragraphs
    + (note
      ? `<div style="margin:8px 0 14px;background:${CALLOUT_BG};border-left:3px solid ${ACCENT};border-radius:0 10px 10px 0;padding:12px 14px"><p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${ACCENT}">Why this happened</p><p style="margin:0;font-size:14px;line-height:1.6;color:${HEADING}">${escapeHtml(note).replace(/\n/g, "<br>")}</p></div>`
      : "")
    + (cta ? `<p style="margin:22px 0 6px"><a href="${escapeHtml(cta.href)}" style="display:inline-block;background:${ACCENT};color:${ACCENT_INK};text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:12px">${escapeHtml(cta.label)}</a></p>` : "")
    + brandFooterHtml(year);

  return { text, html: brandDocumentHtml(content.subject ?? "Crystal", inner) };
}

/** Send one message. Throws with a short, safe message on failure; the provider's reply goes to the log. */
export async function sendEmail(args: { to: string; subject: string; text: string; html: string }): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM;
  if (!key || !from) throw new Error("Email isn't set up on this deployment.");

  const replyTo = process.env.SUPPORT_EMAIL_REPLY_TO;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [args.to],
      subject: args.subject,
      text: args.text,
      html: args.html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  if (!response.ok) {
    // The provider's message can carry the address and the key's name; it goes to the log, not the record.
    console.error("Sending an email failed:", response.status, (await response.text()).slice(0, 300));
    throw new Error(`The email provider refused it (${response.status}).`);
  }
}
