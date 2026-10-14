import { Scrypt } from "lucia";

/**
 * Password hashing: scrypt with a random salt per password, the same construction the auth
 * library's own Password provider uses (Lucia's implementation, pure JavaScript, so it runs in
 * Convex's default runtime). The stored text carries its salt and cost, so the cost can be raised
 * later without invalidating anything.
 *
 * Slow on purpose, which is also why it only ever runs in an action: a mutation has far less CPU
 * to spend.
 */
const scrypt = new Scrypt();

export function hashPassword(password: string): Promise<string> {
  return scrypt.hash(password);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await scrypt.verify(hash, password);
  } catch {
    // A malformed stored value is a failed check, not a crash that tells the caller something.
    return false;
  }
}
