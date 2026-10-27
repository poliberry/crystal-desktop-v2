/**
 * Where to go after signing in. Only a path on this site: a `returnTo` that came from a link must
 * never be able to send a freshly signed-in person somewhere else (`//evil.test`, `/\evil.test` and
 * `https://…` are all read by browsers as other sites).
 */
export function safeReturnTo(raw: string | undefined | null): string {
  if (!raw || raw.length > 2200) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\") || /[\u0000-\u001f\\]/.test(raw)) return "/";
  return raw;
}
