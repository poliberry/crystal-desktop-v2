import {
  AUTH_ERROR,
  base64url,
  constantTimeEqual,
  displayNameFromEmail,
  generateEmailCode,
  hmacHex,
  isValidEmail,
  normalizeEmail,
  normalizeEmailCode,
  passwordProblem,
  PASSWORD_MAX,
  PASSWORD_MIN,
  randomToken,
  sha256Hex,
  usernameFromEmail,
} from "../../convex/lib/authPolicy";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };

// --- addresses -----------------------------------------------------------------------------------
{
  ok("an address is trimmed and lowercased", normalizeEmail("  Sam@Example.COM ") === "sam@example.com");
  for (const good of ["sam@example.com", "a.b+tag@sub.example.co.uk", "x@y.io"]) ok(`${good} is valid`, isValidEmail(good));
  for (const bad of ["", "sam", "sam@", "@example.com", "sam@example", "sam@@example.com", "s am@example.com", "sam@example..com", `${"a".repeat(250)}@x.io`]) {
    ok(`${JSON.stringify(bad.slice(0, 30))} is not valid`, !isValidEmail(bad));
  }
}

// --- passwords -----------------------------------------------------------------------------------
{
  ok("a decent password passes", passwordProblem("correct horse battery staple", "sam@example.com") === null);
  ok("too short is refused", /at least/.test(passwordProblem("short1!") ?? ""));
  ok(`exactly ${PASSWORD_MIN} passes`, passwordProblem("a1b2c3d4e5") === null);
  ok(`one under ${PASSWORD_MIN} is refused`, passwordProblem("a1b2c3d4e") !== null);
  ok("too long is refused", /at most/.test(passwordProblem("x1".repeat(PASSWORD_MAX)) ?? ""));
  ok("the address itself is refused", passwordProblem("samuel.jones@example.com", "Samuel.Jones@example.com") !== null);
  ok("the part before the @ is refused", passwordProblem("samuel.jones", "samuel.jones@example.com") !== null);
  ok("a repeated character is refused", passwordProblem("aaaaaaaaaaaa") !== null);
  ok("a common password is refused, however it is cased", passwordProblem("Password123") !== null);
  ok("a passphrase with spaces is fine", passwordProblem("my dog likes long walks") === null);
}

// --- usernames -----------------------------------------------------------------------------------
{
  ok("username comes from before the @", usernameFromEmail("Sam.Jones+news@example.com") === "sam.jonesnews");
  ok("characters outside a-z0-9_. are dropped", usernameFromEmail("a-b_c@x.io") === "ab_c");
  ok("it is capped at 28 so a suffix fits", usernameFromEmail(`${"a".repeat(60)}@x.io`).length === 28);
  ok("one too short is replaced", /^user\d{4}$/.test(usernameFromEmail("ab@x.io")));
  ok("one with nothing usable is replaced", /^user\d{4}$/.test(usernameFromEmail("---@x.io")));
  ok("every result passes the app's username rule", ["sam@x.io", "a@x.io", "ß@x.io", `${"z".repeat(80)}@x.io`].every((e) => /^[a-z0-9_.]{3,32}$/.test(usernameFromEmail(e))));
  ok("display name is the part before the @", displayNameFromEmail("Sam.Jones@example.com") === "Sam.Jones");
}

// --- codes ---------------------------------------------------------------------------------------
{
  const codes = Array.from({ length: 2000 }, () => generateEmailCode());
  ok("an email code is 8 digits", codes.every((c) => /^\d{8}$/.test(c)));
  ok("they aren't all the same", new Set(codes).size > 1990, new Set(codes).size);
  ok("leading zeros are kept", codes.some((c) => c.startsWith("0")));
  ok("typed with a space or dash it still reads", normalizeEmailCode("1234 5678") === "12345678" && normalizeEmailCode("1234-5678") === "12345678");

}

// --- tokens and hashing --------------------------------------------------------------------------
{
  const a = randomToken(), b = randomToken();
  ok("tokens are 43 URL-safe characters (256 bits)", /^[A-Za-z0-9_-]{43}$/.test(a), a);
  ok("tokens differ", a !== b);
  ok("base64url has no padding or + /", base64url(new Uint8Array([251, 255, 254])) === "-__-");
  ok("sha256 of 'abc'", (await sha256Hex("abc")) === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  // RFC 4231 test case 2.
  ok("hmac-sha256 test vector", (await hmacHex("Jefe", "what do ya want for nothing?")) === "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  ok("a different key gives a different hmac", (await hmacHex("a", "m")) !== (await hmacHex("b", "m")));
  ok("equal strings compare equal", constantTimeEqual("abcdef", "abcdef"));
  ok("different strings don't", !constantTimeEqual("abcdef", "abcdeg"));
  ok("different lengths don't", !constantTimeEqual("abc", "abcd"));
}

// --- the codes the sign-in screen switches on ----------------------------------------------------
{
  const codes = Object.values(AUTH_ERROR);
  ok("every error code is distinct", new Set(codes).size === codes.length);
  ok("they are SCREAMING_SNAKE", codes.every((c) => /^[A-Z_]+$/.test(c)));
}

console.log(f ? `${f} FAILED, ${p} passed` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
