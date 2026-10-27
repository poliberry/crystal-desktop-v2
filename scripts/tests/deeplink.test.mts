import { appLinkFor, isAppLink, parseDeepLink, parseStudioLink, webLink } from "../../electron/deeplink";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };
const is = (raw: string, want: unknown) => { const got = parseDeepLink(raw); ok(`${raw.slice(0, 70)} → ${JSON.stringify(want)}`, JSON.stringify(got) === JSON.stringify(want), got); };

// Invites, in every spelling.
is("https://usecrystal.app/invite/abc123", { kind: "invite", code: "abc123" });
is("https://usecrystal.app/invite/abc123/", { kind: "invite", code: "abc123" });
is("https://www.usecrystal.app/invite/AbC123xyz", { kind: "invite", code: "AbC123xyz" });
is("https://USECRYSTAL.APP/invite/abc123", { kind: "invite", code: "abc123" });
is("crystal://invite/abc123", { kind: "invite", code: "abc123" });
is("https://crystal.poliberry.com/invite/abc123", { kind: "invite", code: "abc123" }); // links already posted
is("  https://usecrystal.app/invite/abc123  ", { kind: "invite", code: "abc123" });

// Installing a bot or an extension.
is("https://usecrystal.app/oauth/authorize?client_id=x&scope=bot&permissions=2", { kind: "authorize", search: "?client_id=x&scope=bot&permissions=2" });
is("crystal://oauth/authorize?client_id=x&scope=bot", { kind: "authorize", search: "?client_id=x&scope=bot" });
is("https://usecrystal.app/oauth/authorize/", { kind: "authorize", search: "" });

// Sign-in only comes in over the scheme.
is("crystal://auth/callback?code=1", { kind: "auth", url: "crystal://auth/callback?code=1" });
is("https://usecrystal.app/auth/callback?code=1", null);
is("https://evil.test/auth/callback", null);

// Anything else isn't ours.
for (const raw of [
  "https://example.com/invite/abc123",
  "https://usecrystal.app.evil.test/invite/abc123",
  "https://evil.test/usecrystal.app/invite/abc123",
  "https://notusecrystal.app/invite/abc123",
  "http://usecrystal.app/invite/abc123",
  "https://user:pw@usecrystal.app/invite/abc123",
  "https://usecrystal.app:8443/invite/abc123",
  "https://usecrystal.app/invite/ab", // too short
  "https://usecrystal.app/invite/abc123/extra",
  "https://usecrystal.app/invite/ab%2Fcd12",
  "https://usecrystal.app/invite/../oauth",
  "https://usecrystal.app/",
  "https://usecrystal.app/settings",
  "javascript:alert(1)",
  "file:///etc/passwd",
  "crystal://evil/thing",
  "crystal://invite/",
  "not a url",
  "",
]) is(raw, null);
ok("an over-long query is refused", parseDeepLink("https://usecrystal.app/oauth/authorize?x=" + "a".repeat(2100)) === null);
ok("an over-long input is refused", parseDeepLink("https://usecrystal.app/invite/abc123?" + "a".repeat(5000)) === null);

// isAppLink: only https links we own.
ok("https invite is an app link", isAppLink("https://usecrystal.app/invite/abc123"));
ok("the scheme form isn't an 'https app link'", !isAppLink("crystal://invite/abc123"));
ok("other sites aren't", !isAppLink("https://example.com/invite/abc123") && !isAppLink("nope"));

// The link a landing page hands to the installed app.
ok("invite page → scheme", appLinkFor("/invite/abc123/", "") === "crystal://invite/abc123");
ok("authorize page keeps its query", appLinkFor("/oauth/authorize/", "?client_id=x&scope=bot") === "crystal://oauth/authorize?client_id=x&scope=bot");
ok("the ?code= form of the invite page works too", appLinkFor("/invite/", "?code=abc123") === "crystal://invite/abc123" && appLinkFor("/invite", "?code=ab") === null && appLinkFor("/invite/", "?code=../x") === null && appLinkFor("/invite/", "") === null);
ok("other pages have none", appLinkFor("/settings", "") === null && appLinkFor("/invite/ab", "") === null);
ok("what appLinkFor makes, parseDeepLink reads back", JSON.stringify(parseDeepLink(appLinkFor("/oauth/authorize", "?client_id=x")!)) === JSON.stringify({ kind: "authorize", search: "?client_id=x" }));

ok("webLink joins", webLink("/invite/abc123") === "https://usecrystal.app/invite/abc123" && webLink("invite/x", "https://preview.example/") === "https://preview.example/invite/x");

// "Open the other app": Studio asks Crystal to come forward, and Crystal asks Studio. Only ever through the scheme.
is("crystal://open", { kind: "open" });
is("crystal://open/", { kind: "open" });
is("https://usecrystal.app/open", null);
ok("an https link is never an open request", !isAppLink("https://usecrystal.app/open"));
const studio = (raw: string, want: unknown) => { const got = parseStudioLink(raw); ok(`studio: ${raw.slice(0, 60)} → ${JSON.stringify(want)}`, JSON.stringify(got) === JSON.stringify(want), got); };
studio("crystal-studio://open", { kind: "open" });
studio("crystal-studio://open/", { kind: "open" });
studio("crystal-studio://", { kind: "open" });
studio("crystal-studio://auth/callback?code=1", { kind: "auth", url: "crystal-studio://auth/callback?code=1" });
studio("crystal://open", null);                      // Crystal's scheme is not Studio's
studio("crystal-studio://invite/abc123", null);      // Studio takes no invites or bot installs
studio("crystal-studio://oauth/authorize?client_id=x", null);
studio("https://usecrystal.app/open", null);
studio("not a url", null);
ok("Crystal does not read Studio's scheme", parseDeepLink("crystal-studio://open") === null);

// After sign-in the person only ever goes to a path on our own site.
import { safeReturnTo } from "../../src/lib/return-to";
ok("a path is kept, with its query", safeReturnTo("/oauth/authorize?client_id=x&scope=bot") === "/oauth/authorize?client_id=x&scope=bot" && safeReturnTo("/invite/abc123") === "/invite/abc123");
for (const bad of ["//evil.test", "/\\evil.test", "https://evil.test", "http://evil.test/x", "javascript:alert(1)", "evil.test", "", "/a\nb", "/a\\b", "/" + "a".repeat(2300)]) ok(`return-to refused: ${bad.slice(0, 30) || "(empty)"}`, safeReturnTo(bad) === "/", safeReturnTo(bad));
ok("nothing → home", safeReturnTo(undefined) === "/" && safeReturnTo(null) === "/");

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
