import { LOCAL_FONT_FAMILY } from "../../convex/lib/creationSpecs";

/**
 * Whether a font by this name is installed on this computer.
 *
 * A page can't ask for the list of installed fonts (and shouldn't be able to), but it can tell whether a name
 * resolves to something: text set in `"Name", <generic>` is measured, and if it comes out a different width than
 * the generic alone, a real font answered. It is checked against three generics, because a font that happens to be
 * exactly as wide as one of them is still different from the other two.
 *
 * It is a hint for the person typing the name, not a guarantee: a font whose letters are all the same width as a
 * generic's, in every test string, reads as "not installed".
 */

const GENERICS = ["monospace", "serif", "sans-serif"] as const;
/** Wide, narrow and mixed letters, so two different fonts rarely add up to the same width. */
const SAMPLE = "mmmmmmmmmmlliWQ@#0123456789 abcdefghijklmnopqrstuvwxyz";

let context: CanvasRenderingContext2D | null | undefined;
const baseline = new Map<string, number>();

function measure(font: string): number | null {
  if (context === undefined) context = document.createElement("canvas").getContext("2d");
  if (!context) return null;
  context.font = font;
  return context.measureText(SAMPLE).width;
}

export function isFontInstalled(name: string): boolean {
  const family = name.trim();
  // The name goes into a font shorthand: only a name the stylesheet would also accept is measured.
  if (typeof document === "undefined" || !LOCAL_FONT_FAMILY.test(family)) return false;
  // Not cached: a measurement is a few microseconds, and a font installed while Studio is open should be found.
  return GENERICS.some((generic) => {
    let base = baseline.get(generic);
    if (base === undefined) {
      const w = measure(`72px ${generic}`);
      if (w === null) return false;
      baseline.set(generic, w);
      base = w;
    }
    const withName = measure(`72px "${family}", ${generic}`);
    return withName !== null && withName !== base;
  });
}

/**
 * Families that ship with most Windows, macOS or Linux installs, offered as one-click suggestions (only the ones
 * actually found on this computer are shown). Not a limit: any name can be typed.
 */
export const COMMON_LOCAL_FONTS = [
  "Segoe UI",
  "Helvetica Neue",
  "Helvetica",
  "Arial",
  "Verdana",
  "Tahoma",
  "Trebuchet MS",
  "Georgia",
  "Times New Roman",
  "Palatino",
  "Courier New",
  "Menlo",
  "Consolas",
  "Comic Sans MS",
  "Optima",
  "Futura",
  "Gill Sans",
  "Avenir Next",
  "Ubuntu",
  "Cantarell",
  "DejaVu Sans",
  "Noto Sans",
] as const;
