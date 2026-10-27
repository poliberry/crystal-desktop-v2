import { draftGrants, blankDraft, grantToDraft, blankGrant } from "../../src/components/admin/records/sku-form";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };

const roundTrip = (kind: Parameters<typeof grantToDraft>[0]["kind"], payload?: string) => {
  const draft = { ...blankDraft("c"), slug: "x", grants: [grantToDraft({ kind, payload, label: "L" })] };
  return draftGrants(draft)[0];
};

// Every kind comes back from the form with the payload it was loaded with: saving without a change must not alter it.
const pack = JSON.stringify({ v: 1, theme: { isDark: true, colors: { background: "#101014" } }, background: { url: "https://cdn.test/a.png", dim: 35, blur: 0, panels: 70 } });
ok("a theme pack keeps its payload", roundTrip("themePack", pack).payload === pack);
const scene = JSON.stringify({ v: 1, backgroundUrl: "https://cdn.test/s.png", screen: { x: 1, y: 1, w: 30, h: 20 } });
ok("a lounge scene keeps its payload", roundTrip("loungeScene", scene).payload === scene);
ok("the label survives", roundTrip("themePack", pack).label === "L");
ok("a nameplate keeps its address", roundTrip("nameplate", "https://cdn.test/n.png").payload === "https://cdn.test/n.png");
ok("a profile effect keeps its address", roundTrip("profileEffect", "https://cdn.test/e.json").payload === "https://cdn.test/e.json");
const deco = JSON.stringify([{ id: "art", url: "https://cdn.test/d.png", anchor: "center", x: 50, y: 0, width: 100 }]);
ok("a one-picture decoration keeps its layer", roundTrip("avatarDecoration", deco).payload === deco);
const multi = JSON.stringify([{ id: "a", url: "https://cdn.test/1.png" }, { id: "b", url: "https://cdn.test/2.png" }]);
ok("a several-layer decoration is kept exactly", roundTrip("avatarDecoration", multi).payload === multi);
const theme = JSON.stringify({ start: "#aabbcc", end: "#112233" });
ok("a community theme keeps its colours", roundTrip("communityTheme", theme).payload === theme);

// A new grant of a raw kind shows an empty box to fill, not nothing.
ok("a new theme pack starts as empty raw text", blankGrant("themePack").raw === "" && blankGrant("loungeScene").raw === "");
ok("a new decoration doesn't", blankGrant("avatarDecoration").raw === null);

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
