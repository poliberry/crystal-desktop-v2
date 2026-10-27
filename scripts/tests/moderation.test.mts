import { ABILITIES, normalizeAbilities } from "../../convex/lib/abilities";
import { hashIp, ipProtectionConfigured, isPublicIp, normalizeIp, sealIp } from "../../convex/lib/ip";
import {
  activeBan,
  activeLimits,
  activeSuspension,
  effectiveCommunityStatus,
  INDEFINITE,
  requireAbility,
} from "../../convex/lib/moderation";
import { ROLE_PERMISSIONS } from "../../convex/lib/staffPermissions";
import { decryptSecret } from "../../convex/lib/secrets";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };
const throws = (n: string, fn: () => unknown, re: RegExp) => { try { fn(); ok(n, false, "did not throw"); } catch (e) { ok(n, re.test((e as Error).message), (e as Error).message); } };
const DAY = 24 * 60 * 60 * 1000;

// --- normalising addresses -----------------------------------------------------------------------
{
  ok("an IPv4 address is itself", normalizeIp("203.0.113.7") === "203.0.113.7");
  ok("whitespace is trimmed", normalizeIp("  203.0.113.7 ") === "203.0.113.7");
  ok("an IPv4-mapped IPv6 address is the IPv4 one", normalizeIp("::ffff:203.0.113.7") === "203.0.113.7");
  ok("leading zeros in IPv4 are dropped", normalizeIp("203.000.113.007") === "203.0.113.7");
  for (const bad of ["", "   ", "not an ip", "256.1.1.1", "1.2.3", "1.2.3.4.5", "::g", "1:2:3:4:5:6:7:8:9", "1::2::3", null, undefined]) {
    ok(`${JSON.stringify(bad)} isn't an address`, normalizeIp(bad as string | null | undefined) === null, normalizeIp(bad as string));
  }
  // IPv6 collapses to its /64, however it is written.
  const a = normalizeIp("2001:db8:abcd:12::1");
  const b = normalizeIp("2001:0DB8:ABCD:0012:ffff:ffff:ffff:ffff");
  const c = normalizeIp("[2001:db8:abcd:12::7]");
  const d = normalizeIp("2001:db8:abcd:13::1");
  ok("IPv6 normalises to a /64", a === "2001:db8:abcd:12::/64", a);
  ok("two spellings of one /64 agree", a === b && b === c, [a, b, c]);
  ok("a different /64 differs", a !== d, [a, d]);
  ok("a zone id is ignored", normalizeIp("fe80::1%en0") === normalizeIp("fe80::1"));
}

// --- which addresses can be banned ---------------------------------------------------------------
{
  for (const priv of ["10.1.2.3", "127.0.0.1", "192.168.1.1", "172.16.0.1", "172.31.255.255", "169.254.1.1", "100.64.0.1", "0.0.0.0"]) {
    ok(`${priv} is not public`, !isPublicIp(priv));
  }
  for (const pub of ["203.0.113.7", "8.8.8.8", "172.32.0.1", "172.15.0.1", "100.63.0.1"]) ok(`${pub} is public`, isPublicIp(pub));
  ok("an IPv6 loopback isn't public", !isPublicIp(normalizeIp("::1")!));
  ok("a unique-local IPv6 address isn't public", !isPublicIp(normalizeIp("fd00::1")!));
  ok("a link-local IPv6 address isn't public", !isPublicIp(normalizeIp("fe80::1")!));
  ok("a global IPv6 address is public", isPublicIp(normalizeIp("2001:db8::1")!));
}

// --- sealing -------------------------------------------------------------------------------------
{
  const saved = { hash: process.env.IP_HASH_KEY, enc: process.env.CREDENTIALS_ENCRYPTION_KEY };
  delete process.env.IP_HASH_KEY;
  delete process.env.CREDENTIALS_ENCRYPTION_KEY;
  ok("not configured without the keys", !ipProtectionConfigured());
  ok("nothing is sealed when unconfigured", (await sealIp("203.0.113.7")) === null);

  process.env.IP_HASH_KEY = "test-hash-key-0123456789abcdef";
  process.env.CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  ok("configured with both keys", ipProtectionConfigured());

  const one = await sealIp("203.0.113.7");
  const two = await sealIp("203.0.113.7");
  const other = await sealIp("203.0.113.8");
  ok("a public address seals", !!one && !!two && !!other);
  ok("the same address always hashes the same", one!.ipHash === two!.ipHash);
  ok("a different address hashes differently", one!.ipHash !== other!.ipHash);
  ok("the ciphertext is random each time", one!.ipCipher !== two!.ipCipher);
  ok("the address isn't in the hash or the ciphertext", ![one!.ipHash, one!.ipCipher].some((s) => s.includes("203.0.113.7")));
  ok("the ciphertext decrypts to the normalised address", (await decryptSecret(one!.ipCipher)) === "203.0.113.7");
  ok("a mapped address seals as the plain one", (await sealIp("::ffff:203.0.113.7"))!.ipHash === one!.ipHash);
  ok("a private address isn't sealed", (await sealIp("192.168.1.20")) === null);
  ok("garbage isn't sealed", (await sealIp("hello")) === null);
  ok("null isn't sealed", (await sealIp(null)) === null);

  // The hash is keyed: the same address under another key doesn't match, so a leaked table can't be tested against a guess.
  const before = await hashIp("203.0.113.7");
  process.env.IP_HASH_KEY = "a-different-key";
  ok("the hash depends on the key", (await hashIp("203.0.113.7")) !== before);

  for (const [k, v] of [["IP_HASH_KEY", saved.hash], ["CREDENTIALS_ENCRYPTION_KEY", saved.enc]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

// --- limits --------------------------------------------------------------------------------------
{
  const now = Date.now();
  ok("no limits by default", activeLimits({}) === null);
  ok("an empty list is no limit", activeLimits({ platformLimits: [] }) === null);
  ok("unknown abilities are dropped", activeLimits({ platformLimits: ["fly"] }) === null);
  const indefinite = activeLimits({ platformLimits: ["upload_media", "send_messages", "send_messages"], platformLimitReason: "spam" }, now)!;
  ok("limits come out canonical and unique", indefinite.abilities.join() === "send_messages,upload_media", indefinite.abilities);
  ok("no end date means until lifted", indefinite.until === null && indefinite.reason === "spam");
  ok("a future end date is in force", activeLimits({ platformLimits: ["send_messages"], platformLimitedUntil: now + DAY }, now)?.until === now + DAY);
  ok("a past end date is over", activeLimits({ platformLimits: ["send_messages"], platformLimitedUntil: now - 1 }, now) === null);

  const limited = { platformLimits: ["send_messages", "friend_requests"], platformLimitedUntil: Date.now() + DAY };
  throws("a limited ability is refused", () => requireAbility(limited, "send_messages"), /can't send messages/);
  throws("the refusal names the other abilities properly", () => requireAbility(limited, "friend_requests"), /can't send friend requests/);
  ok("an ability that isn't limited is allowed", (requireAbility(limited, "upload_media"), true));
  ok("an expired limit allows everything", (requireAbility({ platformLimits: ["send_messages"], platformLimitedUntil: Date.now() - 1 }, "send_messages"), true));
  ok("an unlimited account allows everything", ABILITIES.every((a) => (requireAbility({}, a), true)));
  ok("normalizeAbilities keeps canonical order", normalizeAbilities(["voice_calls", "send_messages", "nope"]).join() === "send_messages,voice_calls");
}

// --- bans and suspensions ------------------------------------------------------------------------
{
  ok("not banned by default", activeBan({}) === null);
  const ban = activeBan({ platformBannedAt: 123, platformBanReason: "evasion" });
  ok("a ban reports when and why", ban?.at === 123 && ban.reason === "evasion", ban);
  ok("a ban at time zero still counts", activeBan({ platformBannedAt: 0 }) !== null);
  ok("an indefinite suspension is in force", activeSuspension({ platformSuspendedUntil: INDEFINITE })?.indefinite === true);
  ok("an ended suspension isn't", activeSuspension({ platformSuspendedUntil: Date.now() - 1 }) === null);
}

// --- community status ----------------------------------------------------------------------------
{
  const now = Date.now();
  ok("no row is active", effectiveCommunityStatus(null) === "active");
  ok("restricted stays restricted", effectiveCommunityStatus({ status: "restricted", until: undefined }, now) === "restricted");
  ok("a running suspension is suspended", effectiveCommunityStatus({ status: "suspended", until: now + DAY }, now) === "suspended");
  ok("a suspension with no end is suspended", effectiveCommunityStatus({ status: "suspended", until: undefined }, now) === "suspended");
  ok("an ended suspension is active again", effectiveCommunityStatus({ status: "suspended", until: now - 1 }, now) === "active");
  ok("a ban never expires", effectiveCommunityStatus({ status: "banned", until: now - DAY }, now) === "banned");
}

// --- who may ban ---------------------------------------------------------------------------------
{
  ok("owners may ban", ROLE_PERMISSIONS.owner.includes("users.ban"));
  ok("admins may ban", ROLE_PERMISSIONS.admin.includes("users.ban"));
  for (const role of ["moderator", "support", "finance"] as const) ok(`${role}s may not ban`, !ROLE_PERMISSIONS[role].includes("users.ban"));
  ok("moderators may still suspend and limit", ROLE_PERMISSIONS.moderator.includes("users.moderate"));
}

console.log(f ? `${f} FAILED, ${p} passed` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
