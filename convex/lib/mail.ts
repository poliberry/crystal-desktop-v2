/**
 * Sending the one kind of email sign-in needs: a code.
 *
 * Goes through Resend's HTTP API with `fetch`, so there's no SDK to bundle. Needs two settings on
 * the deployment:
 *
 *   RESEND_API_KEY     an API key with permission to send
 *   AUTH_EMAIL_FROM    the sender, e.g. `Crystal <no-reply@usecrystal.app>` (a domain verified in Resend)
 *
 * Without them nothing is sent and the sign-in screen says so, rather than pretending a code is
 * on its way.
 */

import {
  BODY_TEXT,
  HEADING,
  MUTED_TEXT,
  brandDocumentHtml,
  brandFooterHtml,
  brandFooterText,
  brandHeaderHtml,
  firstNameOf,
} from "./emailBrand";

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export type CodePurpose = "verify" | "reset";

export function mailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.AUTH_EMAIL_FROM;
}

const SUBJECTS: Record<CodePurpose, string> = {
  verify: "Your Crystal verification code",
  reset: "Reset your Crystal password",
};

const INTRO: Record<CodePurpose, string> = {
  verify: "Use this code to finish signing in to Crystal.",
  reset: "Use this code to choose a new Crystal password.",
};

/** `1234 5678`, because eight digits are easier to read in two halves. */
const spaced = (code: string) => `${code.slice(0, 4)} ${code.slice(4)}`;

export async function sendCodeEmail(
  to: string,
  code: string,
  purpose: CodePurpose,
  ttlMinutes: number,
  firstName?: string,
): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM;
  if (!key || !from) throw new Error("Email isn't set up on this deployment, so a code can't be sent.");

  const year = new Date().getFullYear();
  const greeting = firstNameOf(firstName);
  const finePrint = `It works for ${ttlMinutes} minutes. If you didn't ask for it, you can ignore this email: nothing happens unless the code is used. Crystal staff never ask for this code.`;

  const text = [
    greeting ? `Hey ${greeting}!` : undefined,
    greeting ? "" : undefined,
    INTRO[purpose],
    "",
    `    ${spaced(code)}`,
    "",
    finePrint,
    "",
    ...brandFooterText(year),
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");

  const html = brandDocumentHtml(
    SUBJECTS[purpose],
    brandHeaderHtml()
      + (greeting
        ? `<p style="margin:0 0 10px;font-size:17px;font-weight:700;color:${HEADING}">Hey ${escapeHtml(greeting)}!</p>`
        : "")
      + `<p style="margin:0 0 6px;font-size:15px;line-height:1.65;color:${BODY_TEXT}">${INTRO[purpose]}</p>`
      + `<p style="margin:18px 0;font-size:34px;letter-spacing:.16em;font-weight:700;color:${HEADING};font-variant-numeric:tabular-nums">${spaced(code)}</p>`
      + `<p style="margin:0;font-size:13px;line-height:1.6;color:${MUTED_TEXT}">${finePrint}</p>`
      + brandFooterHtml(year),
    480,
  );

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: SUBJECTS[purpose], text, html }),
  });
  if (!response.ok) {
    // The provider's message can carry the address and the key's name; it goes to the log, not the caller.
    console.error("Sending a sign-in email failed:", response.status, (await response.text()).slice(0, 300));
    throw new Error("We couldn't send the email. Try again in a moment.");
  }
}
