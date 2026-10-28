/**
 * The brand every Crystal email wears, taken from the marketing site
 * (see `src/components/marketing/marketing-ui.tsx`: `SiteHeader`/`SiteFooter`).
 *
 * Near-black page, dark card, emerald call-to-action, the logo mark beside the
 * wordmark, and a footer that says who made it and where to write to. Kept here
 * so the support/report emails and the sign-in codes render the same chrome
 * without either importing the other (they would import each other in a circle).
 */

/** The brand mark, as hosted on the public site: white on transparent, drawn for dark surfaces. */
export const LOGO_URL = "https://usecrystal.app/logo.svg";

/** Where a reader writes back to a person. */
export const SUPPORT_EMAIL = "support@usecrystal.app";

export const OUTER_BG = "#0b0d12";
export const CARD_BG = "#121419";
export const CARD_BORDER = "#23262e";
export const HEADING = "#ffffff";
export const BODY_TEXT = "#b9bdc7";
export const MUTED_TEXT = "#8a8f9e";
export const FAINT_TEXT = "#5c6170";
export const ACCENT = "#6ee7b7";
export const ACCENT_INK = "#06110c";
export const CALLOUT_BG = "#152019";

/** The logo mark on its own, as the app's loading screens draw it — no wordmark beside it. */
export function brandHeaderHtml(): string {
  return `<p style="margin:0 0 24px"><img src="${LOGO_URL}" alt="Crystal" width="32" height="32" style="display:block;border:0" /></p>`;
}

/** Who made it, where to write, and the copyright — the site footer, condensed. */
export function brandFooterHtml(year: number): string {
  return `<div style="margin:22px 0 0;border-top:1px solid ${CARD_BORDER};padding-top:14px">`
    + `<p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:${MUTED_TEXT}">A home for your group chat. Made by Poliberry in Australia.</p>`
    + `<p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:${MUTED_TEXT}">You are getting this because of your Crystal account. You can turn these emails off in Settings. Need a person? Write to <a href="mailto:${SUPPORT_EMAIL}" style="color:${ACCENT};text-decoration:underline">${SUPPORT_EMAIL}</a>.</p>`
    + `<p style="margin:0;font-size:12px;line-height:1.6;color:${FAINT_TEXT}">&copy; ${year} Poliberry. Crystal is in beta, so things here will keep changing.</p>`
    + `</div>`;
}

/** The same footer for plain-text parts. */
export function brandFooterText(year: number): string[] {
  return [
    "— Crystal",
    "A home for your group chat. Made by Poliberry in Australia.",
    `Need a person? Write to ${SUPPORT_EMAIL}.`,
    `© ${year} Poliberry. Crystal is in beta, so things here will keep changing.`,
  ];
}

/** The name an email opens with ("Hey Maya!"): the first word of a display name, if there is one.
 * A handle, not a name ("dillon.veit", "maya_chen"), is made into one ("Dillon", "Maya"). */
export function firstNameOf(name: string | null | undefined): string | undefined {
  const first = name?.trim().split(/\s+/)[0]?.slice(0, 40);
  if (!first) return undefined;
  const lead = first.split(/[.@_-]/)[0];
  if (lead && lead !== first) return lead.charAt(0).toUpperCase() + lead.slice(1);
  return first;
}

/** The marketing site's display face, with fallbacks for readers that block web fonts. */
export const FONT_STACK = "'Google Sans Flex',system-ui,-apple-system,'Segoe UI',sans-serif";

const escapeTitle = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A whole email document: the display face loaded where the reader allows it. */
export function brandDocumentHtml(title: string, inner: string, width = 560): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeTitle(title)}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Google+Sans+Flex:opsz,wght@6..144,400..700&display=swap" rel="stylesheet"></head>`
    + `<body style="margin:0;padding:0;background:${OUTER_BG}"><div style="background:${OUTER_BG};padding:32px 16px;font-family:${FONT_STACK}"><div style="max-width:${width}px;margin:0 auto">${inner}</div></div></body></html>`;
}
