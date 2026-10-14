import { ConvexError } from "convex/values";

import { AUTH_ERROR } from "../../convex/lib/authPolicy";

/** The `code` the server put on a `ConvexError`, if this is one of ours. */
export function errorCode(error: unknown): string | null {
  if (error instanceof ConvexError && typeof error.data === "object" && error.data !== null && "code" in error.data) {
    return String((error.data as { code: unknown }).code);
  }
  return null;
}

/** What to show for a failed call: the server's own words when it chose some, otherwise `fallback`. */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ConvexError) {
    const data = error.data as unknown;
    if (typeof data === "string") return data;
    if (typeof data === "object" && data !== null && "message" in data && typeof (data as { message: unknown }).message === "string") {
      return (data as { message: string }).message;
    }
  }
  // Plain errors thrown by our own functions arrive as "[Request ID: …] Server Error" in production
  // and as the real message in development; only the latter is worth showing.
  if (error instanceof Error && !/Server Error|Request ID/i.test(error.message)) {
    return error.message.replace(/^Uncaught Error:\s*/, "").split("\n")[0] ?? fallback;
  }
  return fallback;
}

export { AUTH_ERROR };
