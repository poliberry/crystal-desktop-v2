const STORAGE_KEY = "crystal.deviceId";

/**
 * A stable id for this install, so the backend can tell one of a user's
 * devices from another (see `convex/presence.ts`).
 *
 * Persisted rather than generated per launch: a fresh id every time would
 * leave a trail of sessions behind, and each one would keep the user "online"
 * until it aged out. Persisted rather than derived from anything about the
 * machine, too — this only has to be unique, and hardware fingerprints are a
 * privacy cost with no benefit here.
 */
export function getDeviceId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    window.localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // Private mode, or storage disabled. A per-launch id still beats sharing
    // one row with every other device on the account.
    return `ephemeral-${crypto.randomUUID()}`;
  }
}
