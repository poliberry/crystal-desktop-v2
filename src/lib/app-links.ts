/**
 * Where the loading screen sends somebody who can't get in.
 *
 * WIP: neither of these is confirmed. They are the addresses the project's own
 * domain (usecrystal.app) would most naturally have; replace them with the real
 * X profile and status page once those exist. Everything that links to them
 * reads from here, so that is the only edit.
 */
export const APP_LINKS = {
  /** The project's page on X. */
  x: "https://x.com/usecrystalapp",
  /** Live system status. */
  status: "https://status.usecrystal.app",
} as const;
