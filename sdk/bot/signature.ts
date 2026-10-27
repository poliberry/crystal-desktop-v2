import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Is this request really from Crystal? The signature covers the time and the exact body, so a
 * captured request can't be replayed later or edited. Anything older than `toleranceSeconds`
 * is refused. `Client` does this for you; use it directly if you receive events yourself.
 */
export function verifySignature(secret: string, header: string | undefined, body: string, toleranceSeconds = 300, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const t = /(?:^|,)t=(\d{1,12})(?:,|$)/.exec(header ?? "")?.[1];
  const v1 = /(?:^|,)v1=([a-f0-9]{64})(?:,|$)/.exec(header ?? "")?.[1];
  if (!t || !v1 || Math.abs(nowSeconds - Number(t)) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest();
  return timingSafeEqual(expected, Buffer.from(v1, "hex"));
}
