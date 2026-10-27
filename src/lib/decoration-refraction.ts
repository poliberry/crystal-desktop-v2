/**
 * Refraction for avatar decorations that are made of glass or ice.
 *
 * A decoration is a picture drawn over an avatar, and a picture cannot see what is under it, so it cannot bend it. Refraction has
 * to be done to the avatar's pixels, by the browser, which is what `backdrop-filter` is for: it filters whatever is painted behind
 * an element. So a decoration that wants to bend the picture behind it says so, and the app draws a **lens** over the avatar
 * (`RefractionLens`, in `components/ui/avatar.tsx`) that distorts it, underneath the decoration's own artwork.
 *
 * ## How a decoration asks
 *
 * In the layer's address, as a fragment: `https://cdn…/ice-cube.svg#refract=ice`. A fragment is never sent to a server and is
 * ignored by an `<img>`, so an app that doesn't know about it draws the artwork as an ordinary picture (the artwork is made to
 * look right on its own) and nothing else changes. It also needs no change to what is stored: a layer's address is already a string.
 *
 * ## What the lens does
 *
 * Near the edge of the avatar the picture is displaced towards the middle, and not at all in the middle, the way a bevelled slab
 * of glass bends what is seen through its edges. Red, green and blue are displaced by slightly different amounts, which is what
 * makes the edge of real ice and glass throw a faint rainbow. That is all done by one SVG filter (`feDisplacementMap`) fed by two
 * generated gradients, applied with `backdrop-filter: url(#…)`, which Chromium (so Electron, and so the desktop app) supports.
 *
 * Everything here is constant strings: nothing from a decoration's address reaches the markup except which kind it names, and a
 * kind that isn't one of ours is ignored.
 */

export type RefractionKind = "ice";

export const REFRACTION_KINDS: readonly RefractionKind[] = ["ice"];

const TAG = "#refract=";

/** The kind of refraction a decoration's address asks for, if it asks for one this build knows. */
export function refractionOf(url: string | null | undefined): RefractionKind | undefined {
  if (!url) return undefined;
  const at = url.indexOf(TAG);
  if (at < 0) return undefined;
  const kind = url.slice(at + TAG.length).split(/[&#]/)[0];
  return (REFRACTION_KINDS as readonly string[]).includes(kind) ? (kind as RefractionKind) : undefined;
}

/** Per kind: how far, in pixels of the filter's own space, each colour channel is pushed at the very edge. Blue is bent most. */
const STRENGTH: Record<RefractionKind, { r: number; g: number; b: number }> = {
  ice: { r: 13, g: 16, b: 19 },
};

/** A grey ramp along one axis: white at the near edge, mid-grey through the middle, black at the far edge. Mid-grey is "no push". */
function ramp(axis: "x" | "y"): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256' viewBox='0 0 1 1' preserveAspectRatio='none'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='${axis === "x" ? 1 : 0}' y2='${axis === "x" ? 0 : 1}'>` +
    `<stop offset='0' stop-color='#fff'/><stop offset='.05' stop-color='#e6e6e6'/><stop offset='.16' stop-color='#808080'/>` +
    `<stop offset='.84' stop-color='#808080'/><stop offset='.95' stop-color='#1a1a1a'/><stop offset='1' stop-color='#000'/>` +
    `</linearGradient></defs><rect width='1' height='1' fill='url(#g)'/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** The id of the filter for a kind. */
export const refractionFilterId = (kind: RefractionKind) => `crystal-refract-${kind}`;

/** The SVG that defines the filter for a kind. A constant: it is the same for every avatar that wears the decoration. */
export function refractionFilterSvg(kind: RefractionKind): string {
  const s = STRENGTH[kind];
  // Keep one colour channel of the displaced picture (and its alpha), drop the others.
  const only = (channel: "r" | "g" | "b") =>
    `${channel === "r" ? "1 0 0 0 0" : "0 0 0 0 0"} ${channel === "g" ? "0 1 0 0 0" : "0 0 0 0 0"} ${channel === "b" ? "0 0 1 0 0" : "0 0 0 0 0"} 0 0 0 1 0`;
  const displace = (id: string, scale: number, channel: "r" | "g" | "b") =>
    `<feDisplacementMap in="SourceGraphic" in2="map" scale="${scale}" xChannelSelector="R" yChannelSelector="G" result="d${id}"/>` +
    `<feColorMatrix in="d${id}" type="matrix" values="${only(channel)}" result="c${id}"/>`;
  return (
    `<svg width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute;pointer-events:none" xmlns="http://www.w3.org/2000/svg">` +
    `<filter id="${refractionFilterId(kind)}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">` +
    `<feImage href="${ramp("x")}" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="mx"/>` +
    `<feImage href="${ramp("y")}" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="my"/>` +
    // Horizontal push in the red channel, vertical in the green: a displacement map reads them as the two axes.
    `<feColorMatrix in="mx" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1" result="mxr"/>` +
    `<feColorMatrix in="my" type="matrix" values="0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 0 0 1" result="myg"/>` +
    `<feBlend in="mxr" in2="myg" mode="screen" result="map"/>` +
    displace("r", s.r, "r") + displace("g", s.g, "g") + displace("b", s.b, "b") +
    `<feComposite in="cr" in2="cg" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="rg"/>` +
    `<feComposite in="rg" in2="cb" operator="arithmetic" k1="0" k2="1" k3="1" k4="0"/>` +
    `</filter></svg>`
  );
}

/** The CSS the lens is drawn with: it filters what is behind it, lifts it slightly and keeps the avatar's own corner shape. */
export function refractionLensStyle(kind: RefractionKind): Record<string, string> {
  const filter = `url(#${refractionFilterId(kind)}) saturate(1.22) brightness(1.07) contrast(1.04)`;
  return {
    position: "absolute",
    inset: "0",
    borderRadius: "inherit",
    pointerEvents: "none",
    backdropFilter: filter,
    WebkitBackdropFilter: filter,
  };
}
