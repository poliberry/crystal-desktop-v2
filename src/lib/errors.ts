/**
 * The part of a Convex error a person should read.
 *
 * Errors thrown on the server arrive wrapped — `[CONVEX M(x)] Uncaught Error: …`
 * with a request id in front — and the wrapper is noise in a toast.
 */
export function errorMessage(error: unknown, fallback = "Something went wrong."): string {
  if (!(error instanceof Error)) return fallback;
  const message = error.message
    .replace(/^\[CONVEX [^\]]*\]\s*/, "")
    .replace(/^\[Request ID: [^\]]*\]\s*/, "")
    .replace(/^Server Error\s*/, "")
    .replace(/^Uncaught Error:\s*/, "")
    .split("\n")[0]
    .replace(/\s+at (async )?[\w.<>]+ \(.*$/, "")
    .trim();
  return message || fallback;
}
