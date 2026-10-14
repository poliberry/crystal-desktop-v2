import { usernameProblem } from "../../convex/lib/authPolicy";
import { GUEST_BLOCKED, GUEST_TTL_MS, guestExpired, isGuest, requireNotGuestFor } from "../../convex/lib/guests";
import { ABILITIES } from "../../convex/lib/abilities";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };
const throws = (n: string, fn: () => unknown, re: RegExp) => { try { fn(); ok(n, false, "did not throw"); } catch (e) { ok(n, re.test((e as Error).message), (e as Error).message); } };

// --- usernames -----------------------------------------------------------------------------------
{
  for (const good of ["sam", "sam_jones", "sam.jones", "a1b", "x".repeat(32), "user_123"]) ok(`${good.slice(0, 12)} is fine`, usernameProblem(good) === null, usernameProblem(good));
  for (const bad of ["", "ab", "x".repeat(33), "Sam", "sam jones", "sam-jones", "sam!", "ünï"]) ok(`${JSON.stringify(bad.slice(0, 12))} is refused by shape`, usernameProblem(bad) !== null);
  ok("a leading dot is refused", usernameProblem(".sam") !== null);
  ok("a trailing underscore is refused", usernameProblem("sam_") !== null);
  ok("doubled separators are refused", usernameProblem("sam..jones") !== null && usernameProblem("sam._jones") !== null);
  for (const reserved of ["crystal", "admin", "staff", "support", "system", "everyone"]) ok(`${reserved} is reserved`, /reserved/.test(usernameProblem(reserved) ?? ""));
}

// --- who is a guest, and when it ends ------------------------------------------------------------
{
  const now = 1_700_000_000_000;
  ok("a day is 24 hours", GUEST_TTL_MS === 24 * 60 * 60 * 1000);
  ok("a normal account is not a guest", !isGuest({}) && !guestExpired({}, now));
  ok("a guest is a guest", isGuest({ isGuest: true, guestExpiresAt: now + 1 }));
  ok("a guest inside its day hasn't expired", !guestExpired({ isGuest: true, guestExpiresAt: now + 1 }, now));
  ok("a guest at its deadline has", guestExpired({ isGuest: true, guestExpiresAt: now }, now));
  ok("a guest past its deadline has", guestExpired({ isGuest: true, guestExpiresAt: now - 1 }, now));
  // The sweep clears the deadline; that must not read as "never expires".
  ok("a guest with no deadline is treated as expired", guestExpired({ isGuest: true }, now));
  ok("a deadline on a non-guest is ignored", !guestExpired({ guestExpiresAt: now - 1 }, now));
}

// --- what a guest can't do ---------------------------------------------------------------------------
{
  const guest = { isGuest: true, guestExpiresAt: Date.now() + 1000 };
  for (const ability of GUEST_BLOCKED) throws(`a guest can't ${ability}`, () => requireNotGuestFor(guest, ability), /Guest accounts can't .*Create a free account/);
  for (const ability of ABILITIES.filter((a) => !GUEST_BLOCKED.includes(a))) ok(`a guest may ${ability}`, (requireNotGuestFor(guest, ability), true));
  for (const ability of ABILITIES) ok(`a full account may ${ability}`, (requireNotGuestFor({}, ability), true));
  ok("the blocked set is only real abilities", GUEST_BLOCKED.every((a) => ABILITIES.includes(a)));
}

console.log(f ? `${f} FAILED, ${p} passed` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
