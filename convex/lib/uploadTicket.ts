/**
 * Signed tickets for the `/r2/upload` proxy.
 *
 * That route writes into the bucket with the server's own credentials, and used
 * to take whatever `key` it was given from whoever asked — anyone who knew the
 * URL could put anything anywhere in the bucket, including over somebody's
 * avatar. A ticket is issued by `cdn.createUploadUrl`, which has already checked
 * that the caller is signed in, and says exactly one thing: *this* key, with
 * *this* content type, until *this* time. The route refuses anything that does
 * not carry a matching signature.
 *
 * Signed with the R2 secret rather than a new one, since anything that can sign
 * a ticket could already write to the bucket directly.
 */

const TICKET_LIFETIME_MS = 10 * 60 * 1000;

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** The query parameters that make an upload URL valid. */
export async function signUploadTicket(
  secret: string,
  key: string,
  contentType: string
): Promise<{ exp: string; sig: string }> {
  const exp = String(Date.now() + TICKET_LIFETIME_MS);
  return { exp, sig: await hmac(secret, `${key}\n${contentType}\n${exp}`) };
}

/** Whether a request's key, content type, expiry and signature agree. */
export async function verifyUploadTicket(
  secret: string,
  key: string,
  contentType: string,
  exp: string | null,
  sig: string | null
): Promise<boolean> {
  if (!exp || !sig) return false;
  if (!(Number(exp) > Date.now())) return false;
  const expected = await hmac(secret, `${key}\n${contentType}\n${exp}`);
  if (expected.length !== sig.length) return false;
  // Compared without stopping at the first difference.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
