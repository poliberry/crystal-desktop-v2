/**
 * Invite links.
 *
 * An invite is one short code. What changed is how it's *shared*: it used to
 * be handed out as `joincrystal:<code>`, a bare string that meant nothing to
 * anyone who wasn't already running Crystal — pasted into a browser, a phone,
 * or any other chat app, it did nothing at all. The link is now an ordinary
 * https URL, which every one of those places knows how to open.
 *
 * Three forms, all carrying the same code:
 *
 *   https://usecrystal.app/invite/<code>          what's shared
 *   crystal://invite/<code>                       what the web page hands the
 *                                                 desktop app, over the
 *                                                 protocol it already owns
 *   joincrystal:<code>                            the old form, still parsed
 *                                                 so links already posted in
 *                                                 channels keep working
 *
 * Parsing lives here, once, because it's needed by the composer (to render a
 * join embed), the community rail (to accept a pasted link), the deep-link
 * handler and the landing page.
 */

import { APP_ORIGIN, APP_PROTOCOL } from "@/lib/deeplinks";

/** Where invite links point: our own site, which is also what the app treats as its own links (see
 * lib/deeplinks.ts). Overridable so a preview deployment mints links to itself rather than to
 * production. Invites minted before this was our domain (`crystal.poliberry.com`) still open. */
export const INVITE_ORIGIN = process.env.NEXT_PUBLIC_INVITE_ORIGIN ?? APP_ORIGIN;

export { APP_PROTOCOL };

/** Codes are what `communities.getOrCreateInviteCode` mints: short and
 * alphanumeric. The bound is here so a stray word in a message isn't mistaken
 * for an invite. */
const CODE = "[a-zA-Z0-9]{4,32}";

/** The shareable link for a code. */
export function inviteUrl(code: string): string {
  return `${INVITE_ORIGIN}/invite/${code}`;
}

/** The link that opens the desktop app straight onto the invite. */
export function inviteDeepLink(code: string): string {
  return `${APP_PROTOCOL}://invite/${code}`;
}

/**
 * The code in a string, if there is one.
 *
 * Accepts all three forms above and a bare code, so whatever somebody pastes
 * into "join a server" works. Returns null rather than throwing: the caller is
 * usually validating input as it's typed.
 */
export function parseInviteCode(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const patterns = [
    // Any host, not just ours: a link that came through a URL shortener, a
    // preview deployment or a proxy still ends in /invite/<code>.
    new RegExp(`^https?://[^/]+/invite/(${CODE})/?$`, "i"),
    new RegExp(`^${APP_PROTOCOL}://invite/(${CODE})/?$`, "i"),
    new RegExp(`^joincrystal:(${CODE})$`, "i"),
    new RegExp(`^(${CODE})$`),
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(trimmed);
    if (match) return match[1];
  }
  return null;
}

/**
 * Every invite code mentioned in a message, so each can be drawn as a join
 * embed instead of as a link.
 *
 * Deliberately does not match a bare code: a message is prose, and "abc123"
 * in the middle of a sentence is not an invitation.
 */
export function extractInviteCodes(text: string): string[] {
  const pattern = new RegExp(
    `(?:https?://[^\\s/]+/invite/|${APP_PROTOCOL}://invite/|joincrystal:)(${CODE})`,
    "gi",
  );
  const codes = Array.from(text.matchAll(pattern)).map((m) => m[1]);
  return Array.from(new Set(codes));
}
