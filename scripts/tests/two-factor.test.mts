import {
  afterFailure,
  base32Decode,
  base32Encode,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  lockedOut,
  looksLikeBackupCode,
  MAX_FAILED_ATTEMPTS,
  normalizeBackupCode,
  totpCode,
  totpStep,
  totpUri,
  verifyTotp,
  ATTEMPT_WINDOW_MS,
  LOCKOUT_MS,
  type AttemptState,
} from "../../convex/lib/twoFactor";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };

// --- base32 --------------------------------------------------------------------------------------
{
  const enc = (s: string) => base32Encode(new TextEncoder().encode(s));
  // RFC 4648 section 10 test vectors.
  ok("base32 of 'foobar'", enc("foobar") === "MZXW6YTBOI", enc("foobar"));
  ok("base32 of 'fooba'", enc("fooba") === "MZXW6YTB", enc("fooba"));
  ok("base32 of 'f'", enc("f") === "MY", enc("f"));
  ok("base32 decodes back", new TextDecoder().decode(base32Decode("MZXW6YTBOI")) === "foobar");
  ok("base32 ignores case, spaces, dashes and padding", new TextDecoder().decode(base32Decode("mzxw 6ytb-oi===")) === "foobar");
  let threw = false;
  try { base32Decode("not*valid"); } catch { threw = true; }
  ok("base32 refuses characters outside the alphabet", threw);
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  ok("base32 round-trips random bytes", base32Decode(base32Encode(bytes)).every((b, i) => b === bytes[i]));
}

// --- TOTP: RFC 6238 appendix B (SHA-1, secret "12345678901234567890", 8 digits there, so compare the last 6) ---
{
  const secret = base32Encode(new TextEncoder().encode("12345678901234567890"));
  const vectors: [number, string][] = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ];
  for (const [seconds, expected] of vectors) {
    const got = await totpCode(secret, totpStep(seconds * 1000));
    ok(`RFC 6238 vector at t=${seconds}`, got === expected, { got, expected });
  }
}

// --- verifying a code ----------------------------------------------------------------------------
{
  const secret = generateTotpSecret();
  ok("a secret is 32 base32 characters (160 bits)", /^[A-Z2-7]{32}$/.test(secret), secret);
  const now = 1_700_000_000_000;
  const step = totpStep(now);
  const code = await totpCode(secret, step);

  ok("the current code verifies, and reports its step", (await verifyTotp(secret, code, now)) === step);
  ok("a code with a space in it verifies", (await verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, now)) === step);
  ok("the previous step is still accepted (clock drift)", (await verifyTotp(secret, await totpCode(secret, step - 1), now)) === step - 1);
  ok("the next step is still accepted (clock drift)", (await verifyTotp(secret, await totpCode(secret, step + 1), now)) === step + 1);
  ok("two steps away is not", (await verifyTotp(secret, await totpCode(secret, step + 2), now)) === null);
  ok("a wrong code is not", (await verifyTotp(secret, code === "000000" ? "000001" : "000000", now)) === null);
  for (const bad of ["", "12345", "1234567", "abcdef", "12 34 5"]) {
    ok(`${JSON.stringify(bad)} is not a code`, (await verifyTotp(secret, bad, now)) === null);
  }
  ok("a code from another secret is not", (await verifyTotp(generateTotpSecret(), code, now)) === null);

  // Replay: a step that has been used (or any earlier one) can't be used again.
  ok("the step just used can't be replayed", (await verifyTotp(secret, code, now, step)) === null);
  ok("an earlier step can't be used after a later one", (await verifyTotp(secret, await totpCode(secret, step - 1), now, step)) === null);
  ok("a later step still works after an earlier one", (await verifyTotp(secret, await totpCode(secret, step + 1), now, step)) === step + 1);
}

// --- the address an authenticator app reads --------------------------------------------------------
{
  const uri = totpUri("ABCDEFGH", "sam@example.com", "Crystal");
  const url = new URL(uri);
  ok("otpauth scheme and type", url.protocol === "otpauth:" && url.hostname === "totp", uri);
  ok("label carries issuer and account", decodeURIComponent(url.pathname) === "/Crystal:sam@example.com", url.pathname);
  ok("secret and issuer are parameters", url.searchParams.get("secret") === "ABCDEFGH" && url.searchParams.get("issuer") === "Crystal");
  ok("digits and period are stated", url.searchParams.get("digits") === "6" && url.searchParams.get("period") === "30");
}

// --- backup codes --------------------------------------------------------------------------------
{
  const codes = generateBackupCodes();
  ok("ten codes by default", codes.length === 10, codes.length);
  ok("each is XXXXX-XXXXX from the unambiguous alphabet", codes.every((c) => /^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/.test(c)), codes);
  ok("no repeats", new Set(codes).size === codes.length);
  ok("a code looks like a backup code", looksLikeBackupCode(codes[0]));
  ok("typed lowercase and without the dash it still looks like one", looksLikeBackupCode(codes[0].toLowerCase().replace("-", " ")));
  ok("a TOTP code does not", !looksLikeBackupCode("123456"));
  ok("normalising drops case, dash and space", normalizeBackupCode("ab cde-fg2hj") === "ABCDEFG2HJ");

  const key = "test-key-material";
  const h = await hashBackupCode(codes[0], key);
  ok("the hash is 64 hex characters", /^[0-9a-f]{64}$/.test(h), h);
  ok("the hash doesn't depend on how it was typed", h === (await hashBackupCode(codes[0].toLowerCase().replace("-", " "), key)));
  ok("a different code hashes differently", h !== (await hashBackupCode(codes[1], key)));
  ok("a different key hashes differently", h !== (await hashBackupCode(codes[0], "another-key")));
  ok("the hash isn't the code", !h.includes(normalizeBackupCode(codes[0]).toLowerCase()));
}

// --- guessing is limited -------------------------------------------------------------------------
{
  const t0 = 1_000_000;
  let state: AttemptState | null = null;
  for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) {
    state = afterFailure(state, t0 + i);
    ok(`failure ${i} doesn't lock`, lockedOut(state, t0 + i) === null, state);
  }
  state = afterFailure(state, t0 + MAX_FAILED_ATTEMPTS);
  ok(`failure ${MAX_FAILED_ATTEMPTS} locks`, lockedOut(state, t0 + MAX_FAILED_ATTEMPTS) === t0 + MAX_FAILED_ATTEMPTS + LOCKOUT_MS, state);
  ok("still locked just before it ends", lockedOut(state, t0 + MAX_FAILED_ATTEMPTS + LOCKOUT_MS - 1) !== null);
  ok("unlocked once it ends", lockedOut(state, t0 + MAX_FAILED_ATTEMPTS + LOCKOUT_MS) === null);

  // Slow guessing outside the window starts the count over.
  const slow = afterFailure({ failures: 4, windowStart: t0 }, t0 + ATTEMPT_WINDOW_MS + 1);
  ok("an old window starts again at one", slow.failures === 1 && lockedOut(slow, t0 + ATTEMPT_WINDOW_MS + 1) === null, slow);
  ok("no state means not locked", lockedOut(null, t0) === null);
}

console.log(f ? `${f} FAILED, ${p} passed` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
