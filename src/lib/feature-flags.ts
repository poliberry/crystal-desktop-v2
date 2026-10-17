/**
 * Switches for things that are temporarily off.
 *
 * `CREATOR_CONNECTIONS_PAUSED`: while Google reviews our OAuth app (YouTube scopes), nobody can start a
 * new creator community or connect a YouTube, Twitch or TikTok account. This only hides the way in:
 * existing creator communities keep working, accounts already connected stay connected (and can still
 * be disconnected), and members who are already connected can still pass a members-only check.
 * Set it back to `false` to turn everything on again.
 */
export const CREATOR_CONNECTIONS_PAUSED = true;

export const CREATOR_PAUSED_MESSAGE = "Connecting YouTube, Twitch and TikTok accounts is paused for a little while. Check back soon.";
