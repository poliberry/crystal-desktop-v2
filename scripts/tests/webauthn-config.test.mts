import { allowedOrigins, fromBase64Url, readClientData, rpIdFor, toBase64Url } from "../../convex/lib/webauthn";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };

const saved = { o: process.env.WEBAUTHN_ORIGINS, a: process.env.APP_URL, n: process.env.NEXT_PUBLIC_APP_URL };
delete process.env.WEBAUTHN_ORIGINS; delete process.env.APP_URL; delete process.env.NEXT_PUBLIC_APP_URL;

// --- defaults ------------------------------------------------------------------------------------
{
  const origins = allowedOrigins();
  ok("the website, the desktop app and local dev by default", ["https://usecrystal.app", "http://crystal.localhost", "http://localhost:3000"].every((o) => origins.includes(o)), origins);
  ok("the website's host is its rp id", rpIdFor("https://usecrystal.app") === "usecrystal.app");
  ok("the desktop app's host is its rp id", rpIdFor("http://crystal.localhost") === "crystal.localhost");
  ok("local dev keeps its port out of the rp id", rpIdFor("http://localhost:3000") === "localhost");
}

// --- refusing origins ----------------------------------------------------------------------------
{
  ok("an origin that isn't listed is refused", rpIdFor("https://evil.example") === null);
  ok("a lookalike subdomain is refused", rpIdFor("https://usecrystal.app.evil.example") === null);
  ok("a different port of a listed origin is refused", rpIdFor("http://localhost:4000") === null);
  ok("plain http on a real host is refused", rpIdFor("http://usecrystal.app") === null);
  ok("garbage is refused", rpIdFor("not a url") === null && rpIdFor("") === null);
  ok("a path on a listed origin is still that origin", rpIdFor("https://usecrystal.app/some/page") === "usecrystal.app");
}

// --- configuring ---------------------------------------------------------------------------------
{
  process.env.WEBAUTHN_ORIGINS = "https://app.example.com, http://localhost:5173 ,ftp://nope.example,http://insecure.example.com,   ";
  const origins = allowedOrigins();
  ok("the configured list replaces the defaults", !origins.includes("https://usecrystal.app"), origins);
  ok("https and loopback http are kept", origins.includes("https://app.example.com") && origins.includes("http://localhost:5173"), origins);
  ok("other schemes and insecure hosts are dropped", origins.length === 2, origins);
  process.env.WEBAUTHN_ORIGINS = "http://nope.example, junk";
  ok("a list with nothing usable falls back to the defaults", allowedOrigins().includes("https://usecrystal.app"));
  delete process.env.WEBAUTHN_ORIGINS;
}

// --- reading what the browser signed ---------------------------------------------------------------
{
  const encode = (o: unknown) => toBase64Url(new TextEncoder().encode(JSON.stringify(o)));
  const data = readClientData(encode({ type: "webauthn.get", challenge: "abc123", origin: "https://usecrystal.app", crossOrigin: false }));
  ok("origin, challenge and type are read", data?.origin === "https://usecrystal.app" && data.challenge === "abc123" && data.type === "webauthn.get", data);
  ok("missing fields are refused", readClientData(encode({ type: "webauthn.get" })) === null);
  ok("not base64 json is refused", readClientData("%%%") === null && readClientData(toBase64Url(new TextEncoder().encode("nope"))) === null);

  const bytes = crypto.getRandomValues(new Uint8Array(37));
  ok("base64url round-trips", fromBase64Url(toBase64Url(bytes)).every((b, i) => b === bytes[i]));
}

for (const [k, v] of [["WEBAUTHN_ORIGINS", saved.o], ["APP_URL", saved.a], ["NEXT_PUBLIC_APP_URL", saved.n]] as const) {
  if (v === undefined) delete process.env[k]; else process.env[k] = v;
}
console.log(f ? `${f} FAILED, ${p} passed` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
