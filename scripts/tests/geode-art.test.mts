import { spawnSync } from "node:child_process";
import { GEODE_TIERS } from "../../convex/lib/geode";
import { allGeodeArt, geodeGemSrc, geodeGemSvg } from "../../src/lib/geode-art";

let f = 0, p = 0;
const eq = (n: string, got: unknown, want: unknown) => {
  JSON.stringify(got) === JSON.stringify(want) ? p++ : (f++, console.log("FAIL", n, { got, want }));
};

const art = allGeodeArt();

eq("one picture per gem", art.length, GEODE_TIERS.length);
eq("every tier has artwork", GEODE_TIERS.every((t) => !!geodeGemSvg(t.key)), true);
eq("an unknown gem draws nothing", geodeGemSvg("not-a-gem"), undefined);
eq("an unknown gem has no source", geodeGemSrc("not-a-gem"), undefined);

for (const { name, svg } of art) {
  eq(`${name}: is an svg`, svg.startsWith("<svg ") && svg.endsWith("</svg>"), true);
  eq(`${name}: square viewBox`, svg.includes('viewBox="0 0 64 64"'), true);
  eq(`${name}: no NaN from the geometry`, /NaN|undefined|Infinity/.test(svg), false);
  eq(`${name}: no external references`, /https?:\/\/(?!www\.w3\.org)/.test(svg) || /<image|xlink:href|<script/.test(svg), false);
  eq(`${name}: light enough to send in a badge`, svg.length < 9000, true);
  eq(`${name}: has facets or fills`, /<polygon|<path|<ellipse|<rect/.test(svg), true);
}

eq("every picture is different", new Set(art.map((a) => a.svg)).size, art.length);
eq("a gem's source decodes back to its markup", decodeURIComponent((geodeGemSrc("ruby") as string).slice("data:image/svg+xml,".length)), geodeGemSvg("ruby"));

// Every id a picture defines is one it uses, and nothing is used that isn't defined.
for (const { name, svg } of art) {
  const defined = [...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const used = [...svg.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
  eq(`${name}: every url(#id) is defined`, used.every((id) => defined.includes(id)), true);
  eq(`${name}: no unused defs`, defined.every((id) => used.includes(id)), true);
}

// Well-formed XML, when a parser is on this machine (it is on macOS and most CI images).
const probe = spawnSync("xmllint", ["--version"]);
if (probe.status === 0 || probe.stderr?.toString().includes("libxml")) {
  for (const { name, svg } of art) {
    const out = spawnSync("xmllint", ["--noout", "-"], { input: svg });
    eq(`${name}: parses as XML`, out.status, 0);
    if (out.status !== 0) console.log(out.stderr.toString());
  }
} else {
  console.log("(xmllint not found — skipped the XML parse checks)");
}

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
