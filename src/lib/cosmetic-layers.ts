/**
 * Placed artwork — the model behind both the profile frame and the avatar
 * decoration, and behind the canvas editor that arranges them.
 *
 * Both used to be one image with a handful of knobs. They are lists now,
 * because one picture around a card is a decoration and people want three: a
 * border, a badge in the corner, and a shine over the top, each placed
 * differently.
 *
 * ## The unit
 *
 * Every measurement is a percentage of the target box's *width*, on both axes.
 * A profile card has no fixed height — a long bio or a rich presence card can
 * make it half again as tall — so anything measured against its height would
 * stretch and slide the moment somebody wrote a longer status. Width is the
 * stable dimension, so width is the ruler, and artwork keeps the shape it was
 * drawn in at every card height.
 *
 * ## Growing cards
 *
 * That leaves what happens to a layer when the card grows underneath it, which
 * is what `anchor` decides: the layer is pinned to the card's top, centre or
 * bottom and `y` is measured from there. A border along the top edge stays on
 * the top edge, a badge in the bottom corner rides the bottom edge down, and
 * the card grows between them. `stretchY` is the fourth answer — grow with it —
 * for the one kind of artwork that has to: a border drawn to the card's whole
 * shape.
 *
 * The CSS falls out of that: the stack these are drawn in is a *container*, so
 * `cqw` is one percent of the card's width and the numbers here are written
 * into styles almost unchanged.
 */

export type LayerAnchor = "top" | "center" | "bottom";

export interface CosmeticLayer {
  id: string;
  url: string;
  /** Absent for a built-in preset, which owns no uploaded file. */
  storageId?: string;
  anchor: LayerAnchor;
  /** Centre of the layer, in percent of the target box's width. `y` runs
   * downwards from the anchor line, so a negative `y` on a top-anchored layer
   * lifts the artwork above the card — which is how a frame overhangs. */
  x: number;
  y: number;
  width: number;
  /** Absent keeps the artwork's own proportions. */
  height?: number;
  /** Height follows the card's, from the anchor down. Ignored when `height`
   * is set. */
  stretchY?: boolean;
  rotation?: number;
  /** 0–1. */
  opacity?: number;
}

/** What the editor will let a layer be. Wide enough to hang a frame well off
 * the card, narrow enough that a fumbled drag can't lose the artwork. */
export const LAYER_LIMITS = {
  position: { min: -150, max: 250 },
  size: { min: 2, max: 400 },
  rotation: { min: -180, max: 180 },
} as const;

/** Layers per cosmetic. Enough to build something out of, few enough that a
 * card stays a card — and every one of them is a file every viewer downloads. */
export const MAX_LAYERS = 8;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

/** Round to a tenth. Sub-pixel precision on a percentage is noise, and it
 * makes stored documents and diffs unreadable. */
const round = (value: number) => Math.round(value * 10) / 10;

/**
 * A layer with every number brought inside the limits.
 *
 * Applied on the way in *and* on the way out: the editor produces sane values,
 * but a document written by another build (or by hand) shouldn't be able to
 * park somebody's artwork three screens from their card.
 */
export function normalizeLayer(layer: CosmeticLayer): CosmeticLayer {
  return {
    ...layer,
    anchor:
      layer.anchor === "center" || layer.anchor === "bottom" ? layer.anchor : "top",
    x: round(clamp(layer.x, LAYER_LIMITS.position.min, LAYER_LIMITS.position.max)),
    y: round(clamp(layer.y, LAYER_LIMITS.position.min, LAYER_LIMITS.position.max)),
    width: round(clamp(layer.width, LAYER_LIMITS.size.min, LAYER_LIMITS.size.max)),
    height:
      layer.height === undefined
        ? undefined
        : round(clamp(layer.height, LAYER_LIMITS.size.min, LAYER_LIMITS.size.max)),
    stretchY: layer.stretchY || undefined,
    rotation: layer.rotation
      ? round(clamp(layer.rotation, LAYER_LIMITS.rotation.min, LAYER_LIMITS.rotation.max))
      : undefined,
    opacity:
      layer.opacity === undefined || layer.opacity >= 1
        ? undefined
        : round(clamp(layer.opacity, 0, 1) * 100) / 100,
  };
}

export function normalizeLayers(layers: CosmeticLayer[]): CosmeticLayer[] {
  return layers.slice(0, MAX_LAYERS).map(normalizeLayer);
}

/**
 * The CSS for one layer, in container units.
 *
 * `cqw` is one percent of the *stack's* width, and the stack is the card — so
 * these are the stored numbers with a unit stuck on them. The one calculation
 * is the centring: the stored position is the layer's middle, and CSS places a
 * box by its edges.
 */
export function layerStyle(layer: CosmeticLayer): React.CSSProperties {
  const style: React.CSSProperties = {
    position: "absolute",
    left: `calc(${layer.x}cqw - ${layer.width / 2}cqw)`,
    width: `${layer.width}cqw`,
    opacity: layer.opacity ?? undefined,
  };

  // Three ways a layer gets its height, and each places itself differently.
  //
  //  fixed     the box is known, so its centre can be positioned exactly
  //  stretched the box runs from the anchor to the card's edge, so it is
  //            positioned by that edge and has no centre to speak of
  //  auto      the browser knows the box and this file doesn't — hence the
  //            translate, which centres it without anyone measuring anything
  const stretched = layer.height === undefined && !!layer.stretchY && layer.anchor !== "bottom";
  const fixed = layer.height !== undefined;
  const halfHeight = fixed ? layer.height! / 2 : 0;
  const shifts: string[] = [];

  if (fixed) {
    style.height = `${layer.height}cqw`;
  } else if (stretched) {
    style.height =
      layer.anchor === "center"
        ? `calc(50cqh - ${layer.y}cqw)`
        : `calc(100cqh - ${layer.y}cqw)`;
  } else {
    style.height = "auto";
  }

  if (layer.anchor === "bottom") {
    style.bottom = `calc(${-layer.y}cqw${fixed ? ` - ${halfHeight}cqw` : ""})`;
    if (!fixed) shifts.push("translateY(50%)");
  } else {
    const line = layer.anchor === "center" ? "50cqh + " : "";
    style.top = `calc(${line}${layer.y}cqw${fixed ? ` - ${halfHeight}cqw` : ""})`;
    if (!fixed && !stretched) shifts.push("translateY(-50%)");
  }

  if (layer.rotation) shifts.push(`rotate(${layer.rotation}deg)`);
  if (shifts.length > 0) style.transform = shifts.join(" ");

  return style;
}

/**
 * How much room a set of layers needs outside the card, in percent of its
 * width.
 *
 * Layers are drawn past the card's edges by design, and every box a card sits
 * in — the editor's column, the profile page, a popover — is something that
 * clips. Rather than each of them guessing, they ask what the current
 * placement actually needs.
 *
 * The vertical figures can only be approximate for a layer keeping its own
 * proportions, whose height isn't known until the file loads. What *is* known
 * is where its top edge was put, which is the number somebody drags until it
 * looks right — so that is what this follows, with a margin so the last few
 * pixels aren't shaved off.
 */
export function layersHeadroom(layers: CosmeticLayer[]): {
  top: number;
  bottom: number;
  inline: number;
} {
  let top = 0;
  let bottom = 0;
  let inline = 0;

  for (const layer of layers) {
    const halfWidth = layer.width / 2;
    inline = Math.max(inline, halfWidth - layer.x, layer.x + halfWidth - 100);

    // Height is only known for a layer that was given one; for the rest, half
    // its width is a fair guess at half its height and errs towards more room.
    const halfHeight = (layer.height ?? layer.width) / 2;
    if (layer.anchor === "top") {
      top = Math.max(top, halfHeight - layer.y);
    } else if (layer.anchor === "bottom") {
      bottom = Math.max(bottom, halfHeight + layer.y);
    }
  }

  return {
    top: Math.max(0, top),
    bottom: Math.max(0, bottom),
    inline: Math.max(0, inline),
  };
}

/** Where a freshly uploaded layer lands: centred, a little wider than the card,
 * lifted so it reads as a frame rather than as a picture pasted over one. */
export function defaultFrameLayer(url: string, storageId?: string): CosmeticLayer {
  return {
    id: newLayerId(),
    url,
    storageId,
    anchor: "top",
    x: 50,
    y: 24,
    width: 112,
  };
}

/** The avatar equivalent: the 126% ratio decorations have always been drawn
 * at, centred on the avatar. */
export function defaultDecorationLayer(url: string, storageId?: string): CosmeticLayer {
  return {
    id: newLayerId(),
    url,
    storageId,
    anchor: "center",
    x: 50,
    y: 0,
    width: 126,
  };
}

/** Short, unique enough for a list of eight, and readable in a document. */
export function newLayerId(): string {
  return Math.random().toString(36).slice(2, 10);
}
