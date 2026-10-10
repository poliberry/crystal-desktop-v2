"use client";

import { useQuery } from "convex/react";
import { useEffect } from "react";

import { api } from "../../convex/_generated/api";
import { PACK_SCHEME_ATTR, useTheme } from "@/components/theme-provider";
import { setSoundOverrides } from "@/lib/ui-sounds";
import { pickThemeVariant } from "../../convex/lib/creationSpecs";

const STYLE_ID = "crystal-theme-pack";

/** An address that is safe to put in a stylesheet: https, parsed, and written back
 * from the parser so nothing in it can end the string it's quoted in. */
function safeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

const FORMAT: Record<string, string> = { woff2: "woff2", woff: "woff", truetype: "truetype", opentype: "opentype", ttf: "truetype", otf: "opentype" };

/**
 * Wears the theme pack the signed-in person has chosen: its font, colours, sounds
 * and icons.
 *
 * A pack is data, and everything in it has been through the same checks twice —
 * when it was submitted and again when the server read it back for this query —
 * so what arrives here is a list of known colour tokens with plain colours, file
 * addresses on our own CDN, and names that can only be a-z, 0-9 and hyphens. Even
 * so, nothing is trusted to be safe to concatenate: addresses are re-parsed, and
 * a value is only written if it still looks like what it is.
 *
 * It writes one style element and one sound table and removes both when the pack
 * is taken off, so nothing a pack did outlives it.
 */
export function ThemePackProvider({ children }: { children: React.ReactNode }) {
  const pack = useQuery(api.marketplace.activeThemePack);
  const { theme } = useTheme();
  const isDarkBase = theme?.isDark ?? true;

  useEffect(() => {
    const spec = pack?.spec;
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!spec) {
      style?.remove();
      setSoundOverrides({});
      document.documentElement.removeAttribute(PACK_SCHEME_ATTR);
      return;
    }
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      // Straight after the app's own theme, so an equal rule from the pack wins — and before
      // the person's own stylesheet, which always has the last word. The theme's element is
      // created by ThemeProvider after this effect has first run (a parent's effects follow
      // its children's), and it puts itself before this one when it is made, so whichever is
      // there first, the order comes out the same.
      const themeVars = document.getElementById("crystal-theme-vars");
      const custom = document.getElementById("crystal-custom-css");
      if (themeVars) themeVars.after(style);
      else if (custom) document.head.insertBefore(style, custom);
      else document.head.appendChild(style);
    }

    const rules: string[] = [];
    const root: string[] = [];

    if (spec.font) {
      // Every file of the family under one name, each with its weight and style, so the
      // app's own bold and italic pick the right file rather than a faked one.
      let any = false;
      for (const face of spec.font.faces) {
        const href = safeUrl(face.url);
        const weight = Number.isInteger(face.weight) && face.weight >= 100 && face.weight <= 900 ? face.weight : 400;
        const max = face.weightMax !== undefined && Number.isInteger(face.weightMax) && face.weightMax > weight && face.weightMax <= 900 ? face.weightMax : null;
        if (!href) continue;
        any = true;
        rules.push(
          `@font-face{font-family:"crystal-pack-font";src:url("${href}") format("${FORMAT[face.format] ?? "woff2"}");font-weight:${max ? `${weight} ${max}` : weight};font-style:${face.style === "italic" ? "italic" : "normal"};font-display:swap;}`,
        );
      }
      if (any) root.push(`--font-sans:"crystal-pack-font","Blu Sans",system-ui,sans-serif;`);
    }
    // A pack with a palette for each scheme wears the one that matches the app's own light/dark setting (the theme the
    // person picked, or the system's); a pack with one palette wears it and forces its scheme.
    const variant = spec.theme ? pickThemeVariant(spec.theme, isDarkBase) : null;
    for (const [token, value] of Object.entries(variant?.colors ?? {})) {
      if (/^[a-z-]+$/.test(token) && !/[;{}\\"]|url\(/i.test(value)) root.push(`--${token}:${value};`);
    }
    if (root.length) rules.push(`:root,.dark{${root.join("")}}`);

    for (const [name, raw] of Object.entries(spec.icons ?? {})) {
      const href = safeUrl(raw);
      if (!href || !/^[a-z0-9-]+$/.test(name)) continue;
      // The icon's own strokes are hidden and the box is painted in the text colour
      // through the artwork, so the replacement takes the colour and size of the
      // icon it stands in for.
      rules.push(
        `svg.lucide-${name}>*{display:none!important}svg.lucide-${name}{background-color:currentColor;-webkit-mask:url("${href}") center/contain no-repeat;mask:url("${href}") center/contain no-repeat}`,
      );
    }
    style.textContent = rules.join("\n");

    setSoundOverrides(spec.sounds ?? {});
    // A pack that says it is light or dark decides which, for as long as it is on. It is also written where
    // ThemeProvider can see it: picking another theme underneath would otherwise set the class straight back.
    const html = document.documentElement;
    if (variant?.forced) {
      html.setAttribute(PACK_SCHEME_ATTR, variant.isDark ? "dark" : "light");
      html.classList.toggle("dark", variant.isDark);
    } else {
      // No palette, or one for each scheme: the scheme is the app's own, and the palette above already matches it.
      html.removeAttribute(PACK_SCHEME_ATTR);
      html.classList.toggle("dark", isDarkBase);
    }

    return () => {
      document.getElementById(STYLE_ID)?.remove();
      setSoundOverrides({});
      html.removeAttribute(PACK_SCHEME_ATTR);
      html.classList.toggle("dark", isDarkBase);
    };
  }, [pack, isDarkBase]);

  return <>{children}</>;
}
