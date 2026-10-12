import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  COMMUNITY_CREATION_KINDS, MAX_CREATION_CENTS, MAX_PACK_ITEMS, authorLabel, checkCreationShape, slugFromName, uniqueSlug,
} from "../../convex/lib/creationRules";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };
const eq = (n: string, got: unknown, want: unknown) => ok(n, JSON.stringify(got) === JSON.stringify(want), { got, want });
const throws = (fn: () => unknown, mention?: string) => { try { fn(); return false; } catch (e) { return !mention || (e as Error).message.toLowerCase().includes(mention.toLowerCase()); } };

const base = { name: "Neon Pack", priceCents: 199, currencyOk: true, kinds: ["nameplate"] };

// ---- The shape of a listing: the rules a creator and staff publishing share -------------------------------------------------
eq("a normal listing passes, trimmed", checkCreationShape({ ...base, name: "  Neon Pack ", description: "  Glow.  " }), { name: "Neon Pack", description: "Glow." });
eq("no description is empty, not undefined", checkCreationShape(base).description, "");
ok("a one-letter name is refused", throws(() => checkCreationShape({ ...base, name: "A" }), "name"));
ok("a 61-character name is refused", throws(() => checkCreationShape({ ...base, name: "x".repeat(61) }), "name"));
ok("a 60-character name is fine", !throws(() => checkCreationShape({ ...base, name: "x".repeat(60) })));
ok("a 401-character description is refused", throws(() => checkCreationShape({ ...base, description: "x".repeat(401) }), "description"));
ok("free is fine", !throws(() => checkCreationShape({ ...base, priceCents: 0 })));
ok("49 cents is refused (the minimum is 50)", throws(() => checkCreationShape({ ...base, priceCents: 49 }), "price"));
ok("50 cents is fine", !throws(() => checkCreationShape({ ...base, priceCents: 50 })));
ok("the most is fine", !throws(() => checkCreationShape({ ...base, priceCents: MAX_CREATION_CENTS })));
ok("one cent over the most is refused", throws(() => checkCreationShape({ ...base, priceCents: MAX_CREATION_CENTS + 1 }), "price"));
ok("a fractional price is refused", throws(() => checkCreationShape({ ...base, priceCents: 99.5 }), "price"));
ok("a negative price is refused", throws(() => checkCreationShape({ ...base, priceCents: -1 }), "price"));
ok("NaN is refused", throws(() => checkCreationShape({ ...base, priceCents: NaN }), "price"));
ok("a currency the store doesn't sell in is refused", throws(() => checkCreationShape({ ...base, currencyOk: false }), "currency"));
ok("nothing in it is refused", throws(() => checkCreationShape({ ...base, kinds: [] }), "between"));
ok("too many things in a pack is refused", throws(() => checkCreationShape({ ...base, kinds: Array.from({ length: MAX_PACK_ITEMS + 1 }, (_, i) => `k${i}`) }), "between"));
ok("two of one kind is refused", throws(() => checkCreationShape({ ...base, kinds: ["nameplate", "nameplate"] }), "one of each"));
ok("a pack of different kinds is fine", !throws(() => checkCreationShape({ ...base, kinds: ["nameplate", "profileEffect", "avatarDecoration"] })));
for (const k of COMMUNITY_CREATION_KINDS) {
  ok(`${k} alone is fine`, !throws(() => checkCreationShape({ ...base, kinds: [k] })));
  ok(`${k} in a pack is refused`, throws(() => checkCreationShape({ ...base, kinds: [k, "nameplate"] }), "on their own"));
}

// ---- Store addresses ---------------------------------------------------------------------------------------------------------------
eq("a name becomes an address", slugFromName("Neon Sparkle Pack!"), "neon-sparkle-pack");
eq("accents are dropped", slugFromName("Café Crème"), "cafe-creme");
eq("runs of symbols are one hyphen", slugFromName("a  --  b__c"), "a-b-c");
eq("no leading or trailing hyphens", slugFromName("--hi--"), "hi");
eq("a name with nothing usable still has an address", slugFromName("★★★"), "item");
eq("emoji-only names too", slugFromName("🔥"), "item");
ok("long names are cut to 40 without a trailing hyphen", (() => { const s = slugFromName("word ".repeat(30)); return s.length <= 40 && !s.endsWith("-"); })());
ok("every address is one the store accepts", ["Neon!", "x".repeat(100), "A B", "ñ", "123", "-"].every((n) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slugFromName(n)) && slugFromName(n).length <= 40));
eq("a free address is used as it is", await uniqueSlug("neon", async () => false), "neon");
eq("a taken one gets -2", await uniqueSlug("neon", async (s) => s === "neon"), "neon-2");
eq("and -3 when that is taken too", await uniqueSlug("neon", async (s) => ["neon", "neon-2"].includes(s)), "neon-3");
ok("a long taken name still fits the address limit", (await uniqueSlug("x".repeat(40), async (s) => s === "x".repeat(40))).length <= 40);
ok("it gives up rather than loop forever", await uniqueSlug("a", async () => true).then(() => false, (e) => /free address/.test(e.message)));

// ---- Who a listing is "by" ---------------------------------------------------------------------------------------------------------------
eq("published as Crystal", authorLabel({ byCrystal: true, creator: null }), { kind: "crystal" });
eq("Crystal wins even if something set a creator", authorLabel({ byCrystal: true, creator: { username: "x" } }), { kind: "crystal" });
eq("a creator's", authorLabel({ creator: { username: "maya" } }), { kind: "creator", username: "maya" });
eq("an old creator-less listing (a plan) is not claimed as 'By Crystal'", authorLabel({ creator: null }), { kind: "none" });
eq("byCrystal false is the same as absent", authorLabel({ byCrystal: false, creator: null }), { kind: "none" });

// ---- Nothing can mark something as Crystal's without a staff check ------------------------------------------------------------------------
{
  const dir = join(import.meta.dir, "../../convex");
  const files = readdirSync(dir).filter((n) => n.endsWith(".ts") && !n.startsWith("_"));
  let setters = 0;
  for (const file of files) {
    const text = readFileSync(join(dir, file), "utf8");
    // Each top-level `export const x = mutation(...)` / internalMutation / action, up to the next one.
    const blocks = text.split(/^export (?:const|async function|function) /m);
    for (const block of blocks) {
      if (!/byCrystal:\s*true/.test(block)) continue;
      setters++;
      const name = /^(\w+)/.exec(block)?.[1] ?? "?";
      ok(`${file}: ${name} sets byCrystal only after requireStaff`, /requireStaff\(ctx,/.test(block) && block.indexOf("requireStaff(ctx,") < block.search(/byCrystal:\s*true/), name);
    }
  }
  ok("the guard found all three places that set it (listings, extensions, bots)", setters === 3, setters);

  const market = readFileSync(join(dir, "marketplace.ts"), "utf8");
  const publish = market.slice(market.indexOf("export const staffPublishCreation"));
  const handler = publish.slice(publish.indexOf("handler:"), publish.indexOf("handler:") + 400);
  ok("direct publishing asks for the catalogue permission first", /requireStaff\(ctx, "catalog\.write"\)/.test(handler), handler);
  ok("and checks the same shape as a creator", /checkCreationShape\(/.test(publish.slice(0, 3000)));
  ok("and runs the artwork through the same builders", /buildCreationItem\(/.test(publish.slice(0, 3000)));
  ok("it writes to the audit log", /audit\(ctx, staff\.user\._id, "catalog\.sku\.publish_as_crystal"/.test(publish));
  ok("and never sets a creator, so nothing is owed", !/creatorId:/.test(publish.slice(0, publish.indexOf("export const", 20))));

  const ext = readFileSync(join(dir, "extensions.ts"), "utf8");
  const pv = ext.slice(ext.indexOf("export const staffPublishVersion"), ext.indexOf("/** The caller's own extensions"));
  ok("direct extension publishing needs the review permission", /requireStaff\(ctx, "system\.manage"\)/.test(pv));
  ok("it still scans the code and refuses blocking findings", /scanSource\(/.test(pv) && /hasBlocking\(/.test(pv));
  ok("it still stores and hashes the code that will run", /sourceHash\(source\)/.test(pv));
  ok("it honours the two-reviewer setting", /EXTENSIONS_REQUIRE_SECOND_REVIEWER/.test(pv));
  ok("it keeps version numbers moving forward", /versionBlocker\(/.test(pv));
  ok("it writes to the audit log", /extension\.publish_as_crystal/.test(pv));
}

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
