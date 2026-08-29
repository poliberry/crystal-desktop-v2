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
 * the card grows between them. `stretchY` is another answer — grow with it —
 * for the one kind of artwork that has to: a border drawn to the card's whole
 * shape.
 *
 * `"locked"` is the last answer, and the only one that measures `y` against the
 * card's *height*: 0 is the top edge, 100 the bottom, and the layer stays a
 * third of the way down whatever the card does. Artwork sitting against
 * something in the middle of the card — a signature over the bio, a character
 * standing on the bottom third — is placed by eye against a card of one shape,
 * and pinning it to an edge slides it off whatever it was placed against the
 * moment the card grows. This keeps it where it was put.
 *
 * The CSS falls out of that: the stack these are drawn in is a *container*, so
 * `cqw` is one percent of the card's width, `cqh` one percent of its height,
 * and the numbers here are written into styles almost unchanged.
 */

export type LayerAnchor = "top" | "center" | "bottom" | "locked";

export interface CosmeticLayer {
  id: string;
  url: string;
  /** Absent for a built-in preset, which owns no uploaded file. */
  storageId?: string;
  anchor: LayerAnchor;
  /** Centre of the layer, in percent of the target box's width. `y` runs
   * downwards from the anchor line, so a negative `y` on a top-anchored layer
   * lifts the artwork above the card — which is how a frame overhangs.
   *
   * The one exception is a `"locked"` layer, whose `y` is a percentage of the
   * card's *height* rather than its width. Nothing else changes: `x` is still
   * measured against the width, and so is every size. */
  x: number;
  y: number;
  width: number;
  /** Absent keeps the artwork's own proportions. */
  height?: number;
  /** Height follows the card's, from the anchor down. Ignored when `height`
   * is set, and meaningless on a `"locked"` layer, which has no edge to grow
   * from. */
  stretchY?: boolean;
  rotation?: number;
  /** 0–1. */
  opacity?: number;
  /**
   * Placement for one shape of card, overriding the numbers above.
   *
   * A card that has grown is not the same picture with more space in it: a
   * badge that sat beside the bio on a short card is halfway up a tall one, and
   * where somebody wants it is a different answer per shape. Anchoring solves
   * the common case and this solves the rest — adjust a layer while a taller
   * card is on the canvas and only that shape moves.
   *
   * Keyed by `CARD_VARIANTS`. Absent, or absent for a given shape, means the
   * placement above is used — which is what every layer starts as, so nothing
   * has to be arranged three times to be arranged once.
   */
  variants?: Record<string, LayerVariant>;
}

/** What one card shape may say differently. Geometry only: what a layer is
 * pinned to, whether it stretches and how faded it is are decisions about the
 * artwork rather than about the card it happens to be on. */
export interface LayerVariant {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
}

/**
 * The shapes a profile card comes in, tallest last.
 *
 * Named after their cause rather than their size, because that is how somebody
 * picks one: the question is "what happens when I write a long bio", not "what
 * happens at 156% of the width". The heights are proportions of the card's
 * width for the same reason everything else here is — a card is drawn at
 * several widths and only its shape is constant.
 *
 * Shared by the editor, which draws a card at each of these, and by the
 * renderer, which measures the card it is actually on and picks the one it
 * matches. Two lists would drift the first time anybody added a shape.
 */
export const CARD_VARIANTS: {
  key: string;
  label: string;
  hint: string;
  /** Card height as a percentage of its width. */
  heightPercent: number;
}[] = [
  {
    key: "plain",
    label: "Plain",
    hint: "A name and not much else.",
    heightPercent: 127,
  },
  {
    key: "bio",
    label: "With a bio",
    hint: "A few lines written about you.",
    heightPercent: 157,
  },
  {
    key: "activity",
    label: "Playing something",
    hint: "A rich presence card under the bio — the tallest a card usually gets.",
    heightPercent: 200,
  },
];

/** The first shape is the one everything falls back to: edits made against it
 * are edits to the layer itself rather than to one card's worth of it. */
export const DEFAULT_VARIANT = CARD_VARIANTS[0]!.key;

/**
 * Which shape a card of this height counts as.
 *
 * The tallest variant it has reached, so a card between two of them keeps the
 * placement made for the shorter one until it actually grows into the next —
 * artwork that jumps as somebody types would be worse than artwork slightly
 * early.
 */
export function variantForHeight(heightPercent: number): string {
  let match = DEFAULT_VARIANT;
  for (const variant of CARD_VARIANTS) {
    if (heightPercent >= variant.heightPercent - 1) match = variant.key;
  }
  return match;
}

/**
 * A layer as it should be drawn on one shape of card: its own numbers, with
 * that shape's overrides on top.
 *
 * Every reader goes through this — the renderer, the canvas, the inspector — so
 * none of them has to know whether the placement it is looking at came from the
 * layer or from a variant.
 */
export function resolveLayer(layer: CosmeticLayer, variant: string): CosmeticLayer {
  const override = layer.variants?.[variant];
  if (!override || variant === DEFAULT_VARIANT) return layer;
  return { ...layer, ...stripUndefined(override) };
}

function stripUndefined(override: LayerVariant): Partial<CosmeticLayer> {
  const out: Partial<CosmeticLayer> = {};
  for (const [key, value] of Object.entries(override)) {
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/**
 * Apply an edit to a layer, to the right shape of card.
 *
 * On the default shape an edit is an edit to the layer. On any other, it is
 * that shape's business only — which is the whole point of the feature, and
 * also why the override carries the *whole* geometry rather than the one field
 * that changed: a variant that inherited half its position would move whenever
 * the default did, which is not what "I placed this here" means.
 */
export function patchLayer(
  layer: CosmeticLayer,
  patch: Partial<CosmeticLayer>,
  variant: string,
): CosmeticLayer {
  if (variant === DEFAULT_VARIANT) return { ...layer, ...patch };
  const resolved = { ...resolveLayer(layer, variant), ...patch };
  return {
    ...layer,
    variants: {
      ...layer.variants,
      [variant]: {
        x: resolved.x,
        y: resolved.y,
        width: resolved.width,
        height: resolved.height,
        rotation: resolved.rotation,
      },
    },
    // The things a variant has no opinion about are still the layer's.
    anchor: patch.anchor ?? layer.anchor,
    stretchY: patch.stretchY !== undefined ? patch.stretchY : layer.stretchY,
    opacity: patch.opacity !== undefined ? patch.opacity : layer.opacity,
  };
}

/** Forget one shape's placement, putting it back to the layer's own. */
export function clearVariant(layer: CosmeticLayer, variant: string): CosmeticLayer {
  if (!layer.variants?.[variant]) return layer;
  const variants = { ...layer.variants };
  delete variants[variant];
  return {
    ...layer,
    variants: Object.keys(variants).length > 0 ? variants : undefined,
  };
}

/** Every anchor, in the order the editor offers them. */
export const ANCHORS: LayerAnchor[] = ["top", "center", "bottom", "locked"];

/**
 * Where a layer's centre sits, measured down from the card's top edge in
 * percent of the card's width.
 *
 * The one place that knows what `y` means, which is three different things
 * depending on the anchor. Everything that has to reason about a layer in the
 * card's own coordinates — the canvas, the headroom, switching anchors — asks
 * here rather than repeating the arithmetic and getting one of the three wrong.
 */
export function layerCentreY(
  layer: Pick<CosmeticLayer, "anchor" | "y">,
  stageHeightPercent: number,
): number {
  if (layer.anchor === "center") return stageHeightPercent / 2 + layer.y;
  if (layer.anchor === "bottom") return stageHeightPercent + layer.y;
  if (layer.anchor === "locked") return (layer.y / 100) * stageHeightPercent;
  return layer.y;
}

/** The inverse: a centre in card coordinates back to the `y` this anchor would
 * store for it. */
export function layerYFromCentre(
  anchor: LayerAnchor,
  centre: number,
  stageHeightPercent: number,
): number {
  if (anchor === "center") return centre - stageHeightPercent / 2;
  if (anchor === "bottom") return centre - stageHeightPercent;
  if (anchor === "locked") {
    // A card with no height cannot say where a third of the way down is; the
    // top is the honest answer and only happens before the first measurement.
    return stageHeightPercent > 0 ? (centre / stageHeightPercent) * 100 : 0;
  }
  return centre;
}

/**
 * A layer's anchor changed without anything moving.
 *
 * An anchor is a statement about what happens *later* — what the artwork keeps
 * up with as the card grows — so changing one should not move anything now.
 * Without this the layer jumps the moment somebody presses the button whose
 * whole purpose is to stop it from jumping, which reads as the button being
 * broken.
 *
 * Every shape is rewritten, not just the one on screen. `anchor` belongs to the
 * layer rather than to a variant, so changing it changes what every variant's
 * `y` *means* — and a variant left alone would be a placement quietly
 * reinterpreted against a line it was never measured from. Which is why the
 * heights arrive as a function: each shape's `y` is converted against the card
 * it was placed on.
 */
export function reanchorLayer(
  layer: CosmeticLayer,
  anchor: LayerAnchor,
  heightPercentOf: (variant: string) => number,
): CosmeticLayer {
  const convert = (source: Pick<CosmeticLayer, "anchor" | "y">, variant: string) => {
    const height = heightPercentOf(variant);
    return layerYFromCentre(anchor, layerCentreY(source, height), height);
  };

  return {
    ...layer,
    anchor,
    y: convert(layer, DEFAULT_VARIANT),
    // Stretching is a top/centre/bottom idea; a locked layer has no edge to
    // stretch from.
    stretchY: anchor === "locked" ? undefined : layer.stretchY,
    variants: layer.variants
      ? Object.fromEntries(
          Object.entries(layer.variants).map(([key, variant]) => [
            key,
            {
              ...variant,
              // An absent `y` is one this shape never had an opinion about, and
              // giving it one here would pin it to a placement it was following
              // by choice.
              y:
                variant.y === undefined
                  ? undefined
                  : convert(resolveLayer(layer, key), key),
            },
          ]),
        )
      : undefined,
  };
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

/** Round to a hundredth of a percent. A card is around 300 pixels wide, so
 * that is a third of a pixel — fine enough that a number typed in pixels comes
 * back as the pixel that was typed, and coarse enough that stored documents
 * stay readable. */
const round = (value: number) => Math.round(value * 100) / 100;

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
    anchor: ANCHORS.includes(layer.anchor) ? layer.anchor : "top",
    x: round(clamp(layer.x, LAYER_LIMITS.position.min, LAYER_LIMITS.position.max)),
    y: round(clamp(layer.y, LAYER_LIMITS.position.min, LAYER_LIMITS.position.max)),
    width: round(clamp(layer.width, LAYER_LIMITS.size.min, LAYER_LIMITS.size.max)),
    height:
      layer.height === undefined
        ? undefined
        : round(clamp(layer.height, LAYER_LIMITS.size.min, LAYER_LIMITS.size.max)),
    // A locked layer is placed against the card's height rather than an edge of
    // it, so there is no edge for it to grow from — the flag is dropped rather
    // than carried as something that will never be read.
    stretchY: (layer.stretchY && layer.anchor !== "locked") || undefined,
    rotation: layer.rotation
      ? round(clamp(layer.rotation, LAYER_LIMITS.rotation.min, LAYER_LIMITS.rotation.max))
      : undefined,
    opacity:
      layer.opacity === undefined || layer.opacity >= 1
        ? undefined
        : round(clamp(layer.opacity, 0, 1) * 100) / 100,
    variants: normalizeVariants(layer.variants),
  };
}

/** The same clamping for a variant's numbers, and an empty set dropped rather
 * than stored as `{}`. */
function normalizeVariants(
  variants: Record<string, LayerVariant> | undefined,
): Record<string, LayerVariant> | undefined {
  if (!variants) return undefined;
  const out: Record<string, LayerVariant> = {};
  for (const [key, variant] of Object.entries(variants)) {
    // A key no build recognises is dropped: it can only have come from a
    // shape of card that no longer exists, and keeping it would mean carrying
    // it in every query for ever.
    if (!CARD_VARIANTS.some((option) => option.key === key)) continue;
    if (key === DEFAULT_VARIANT) continue;
    out[key] = {
      x:
        variant.x === undefined
          ? undefined
          : round(clamp(variant.x, LAYER_LIMITS.position.min, LAYER_LIMITS.position.max)),
      y:
        variant.y === undefined
          ? undefined
          : round(clamp(variant.y, LAYER_LIMITS.position.min, LAYER_LIMITS.position.max)),
      width:
        variant.width === undefined
          ? undefined
          : round(clamp(variant.width, LAYER_LIMITS.size.min, LAYER_LIMITS.size.max)),
      height:
        variant.height === undefined
          ? undefined
          : round(clamp(variant.height, LAYER_LIMITS.size.min, LAYER_LIMITS.size.max)),
      rotation:
        variant.rotation === undefined
          ? undefined
          : round(
              clamp(variant.rotation, LAYER_LIMITS.rotation.min, LAYER_LIMITS.rotation.max),
            ),
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
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
  const stretched =
    layer.height === undefined &&
    !!layer.stretchY &&
    (layer.anchor === "top" || layer.anchor === "center");
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
    // A locked layer's `y` is the only measurement in the whole model taken
    // against the card's height, so it is the only one written in `cqh` — which
    // is exactly what makes it hold its place as the card grows.
    const line = layer.anchor === "center" ? "50cqh + " : "";
    const offset = layer.anchor === "locked" ? `${layer.y}cqh` : `${layer.y}cqw`;
    style.top = `calc(${line}${offset}${fixed ? ` - ${halfHeight}cqw` : ""})`;
    if (!fixed && !stretched) shifts.push("translateY(-50%)");
  }

  if (layer.rotation) shifts.push(`rotate(${layer.rotation}deg)`);
  if (shifts.length > 0) style.transform = shifts.join(" ");

  return style;
}

/**
 * How the artwork sits in the box the layer gives it.
 *
 * A layer with a height was given that height by somebody dragging a handle
 * until the artwork was the shape they wanted, so the artwork fills it — the
 * box *is* the intent. A layer without one is being drawn at its own
 * proportions, where there is nothing to fill and nothing to letterbox.
 *
 * One rule in one place because it was two: the canvas filled a fixed box and
 * the card contained it, so a border stretched to a card's height in the
 * editor came out letterboxed into a pair of rails down the middle of the real
 * thing.
 */
export function layerObjectFit(layer: CosmeticLayer): "fill" | "contain" {
  return layer.height !== undefined || layer.stretchY ? "fill" : "contain";
}

/**
 * How tall a layer actually is, in the same percent-of-width unit as
 * everything else.
 *
 * Three answers, because a height comes from three places: the layer was given
 * one, the artwork keeps its own proportions (so the file decides, which is
 * why the ratio has to be measured and passed in), or it stretches to the
 * card. The editor needs this to draw handles around artwork it has not been
 * told the shape of.
 */
export function layerHeight(
  layer: CosmeticLayer,
  ratio: number | undefined,
  stageHeightPercent: number,
): number {
  if (layer.height !== undefined) return layer.height;
  if (layer.stretchY && (layer.anchor === "top" || layer.anchor === "center")) {
    return layer.anchor === "center"
      ? stageHeightPercent / 2 - layer.y
      : stageHeightPercent - layer.y;
  }
  return ratio ? layer.width / ratio : layer.width;
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
 *
 * Only a layer pinned to an edge it hangs off is counted. A middle-pinned one
 * is asking to be *on* the card, and half its width is a poor enough guess at
 * its height that counting it reserved hundreds of pixels above cards whose
 * artwork never left them — a full-card border drawn to a tall card is, on the
 * short card's numbers, a layer twice the card's height with nowhere to be.
 * Under-reserving costs the edge of a decoration somebody put in the middle
 * anyway; over-reserving pushed the card off the bottom of its own page.
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
    // Every shape this layer might be drawn in, not just the one on screen: the
    // room is reserved by a margin on the card, and a card that grows into a
    // shape with a taller frame cannot go back and ask for more.
    for (const shape of CARD_VARIANTS) {
      const variant = resolveLayer(layer, shape.key);
      const halfWidth = variant.width / 2;
      inline = Math.max(inline, halfWidth - variant.x, variant.x + halfWidth - 100);

      // Height is only known for a layer that was given one; for the rest, half
      // its width is a fair guess at half its height and errs towards more room.
      const halfHeight = (variant.height ?? variant.width) / 2;
      // A stretched layer is the exception to `y` meaning a centre: it runs
      // from `y` to the card's bottom edge, so `y` *is* its top and the only
      // thing outside the card is however far above it that starts. Treating it
      // like the others reserved half a card's width above a border that begins
      // exactly on the card's top edge.
      const stretches =
        !!variant.stretchY &&
        variant.height === undefined &&
        (variant.anchor === "top" || variant.anchor === "center");

      if (stretches) {
        const topEdge =
          variant.anchor === "center" ? shape.heightPercent / 2 + variant.y : variant.y;
        top = Math.max(top, -topEdge);
      } else if (variant.anchor === "top") {
        top = Math.max(top, halfHeight - variant.y);
      } else if (variant.anchor === "bottom") {
        bottom = Math.max(bottom, halfHeight + variant.y);
      } else if (variant.anchor === "locked") {
        // The one that has to be asked in the card's own coordinates: a locked
        // layer's `y` is a percentage of a height that differs per shape, so it
        // is measured against the shape it would actually be drawn on.
        const centre = layerCentreY(variant, shape.heightPercent);
        top = Math.max(top, halfHeight - centre);
        bottom = Math.max(bottom, centre + halfHeight - shape.heightPercent);
      }
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
