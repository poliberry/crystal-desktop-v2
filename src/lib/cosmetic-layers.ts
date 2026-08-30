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

/**
 * What a layer *is*.
 *
 * Absent means `"image"`, which is what every layer was before there was a
 * choice — so nothing stored has to be migrated to keep meaning what it meant.
 *
 * The geometry above is shared by all three: a line of text and a rectangle
 * are placed, sized, turned and anchored exactly the way a picture is, so
 * everything that reasons about position — the canvas, the handles, the
 * headroom, the per-shape variants — never has to ask which kind it has.
 */
export type LayerKind = "image" | "text" | "shape";

/** The shapes worth having. Two, because a rectangle with a corner radius is
 * already most of them and the rest is a drawing program. */
export type LayerShape = "rect" | "ellipse";

export type LayerAlign = "left" | "center" | "right";

export interface CosmeticLayer {
  id: string;
  /** Absent is `"image"` — see `LayerKind`. */
  kind?: LayerKind;
  /** The picture, for an image layer. Empty on the other two, which draw
   * themselves. */
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
  /** Height follows the card's: the layer runs between its anchor line and one
   * of the card's edges. Ignored when `height` is set, and meaningless on a
   * `"locked"` layer, which has no edge to grow from. */
  stretchY?: boolean;
  /**
   * Which way a stretched layer grows. Absent is `"down"`, which is what every
   * stretched layer meant before there was a choice.
   *
   * `"down"` holds the anchor line and follows the card's bottom edge — a
   * border drawn to the whole card. `"up"` holds the card's *top* edge and
   * follows the anchor line, which is what a band across the middle needs: the
   * part above it grows and the band stays where it was put. Between the two,
   * either end of a middle-pinned layer can be the one that gives.
   */
  stretchDirection?: "down" | "up";
  rotation?: number;
  /** 0–1. */
  opacity?: number;

  /** What it says, for a text layer. Newlines are kept. */
  text?: string;
  /** Type size, in percent of the target box's width like every other
   * measurement here — so text on a card scales with the card rather than
   * staying fourteen pixels on a thumbnail. */
  fontSize?: number;
  fontWeight?: number;
  italic?: boolean;
  align?: LayerAlign;
  /** The text's colour, or the shape's fill. Any CSS colour. */
  color?: string;
  /** Rectangle or ellipse, for a shape layer. Absent is a rectangle. */
  shape?: LayerShape;
  /** Corner radius, in percent of the box's width. Rectangles only. */
  radius?: number;
  /** An outline, around the shape or around the letters. */
  strokeColor?: string;
  strokeWidth?: number;
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
    stretchDirection:
      patch.stretchDirection !== undefined
        ? patch.stretchDirection
        : layer.stretchDirection,
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

/** Long enough for a name, a slogan or a joke; short enough that a layer
 * cannot become a paragraph nobody can see the end of. */
export const MAX_TEXT_LENGTH = 120;

/** Percent of the card's width. About 22px on a 288px card, which is roughly
 * the size of the name on a profile card. */
export const DEFAULT_FONT_SIZE = 7.5;

/** What a layer is, with the default filled in. */
export function layerKind(layer: Pick<CosmeticLayer, "kind">): LayerKind {
  return layer.kind === "text" || layer.kind === "shape" ? layer.kind : "image";
}

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
    stretchDirection:
      layer.stretchY && layer.anchor !== "locked" && layer.stretchDirection === "up"
        ? "up"
        : undefined,
    rotation: layer.rotation
      ? round(clamp(layer.rotation, LAYER_LIMITS.rotation.min, LAYER_LIMITS.rotation.max))
      : undefined,
    opacity:
      layer.opacity === undefined || layer.opacity >= 1
        ? undefined
        : round(clamp(layer.opacity, 0, 1) * 100) / 100,
    variants: normalizeVariants(layer.variants),
    ...normalizeContent(layer),
  };
}

/**
 * The fields that belong to one kind of layer, kept only for that kind.
 *
 * A layer that was a picture and is now a rectangle should not carry the url
 * it used to have, and a document that arrives with a `text` on a shape is
 * either a bug or somebody editing JSON. Dropping them is also what keeps a
 * stored layer honest about what it is.
 */
function normalizeContent(layer: CosmeticLayer): Partial<CosmeticLayer> {
  const kind = layerKind(layer);
  const stroke =
    layer.strokeColor && (layer.strokeWidth ?? 0) > 0
      ? {
          strokeColor: layer.strokeColor,
          strokeWidth: round(clamp(layer.strokeWidth ?? 0, 0, LAYER_LIMITS.size.max)),
        }
      : { strokeColor: undefined, strokeWidth: undefined };

  if (kind === "text") {
    return {
      kind: "text",
      url: "",
      storageId: undefined,
      text: (layer.text ?? "").slice(0, MAX_TEXT_LENGTH),
      fontSize: round(clamp(layer.fontSize ?? DEFAULT_FONT_SIZE, 0.5, LAYER_LIMITS.size.max)),
      fontWeight: clamp(Math.round((layer.fontWeight ?? 700) / 100) * 100, 100, 900),
      italic: layer.italic || undefined,
      align: layer.align === "left" || layer.align === "right" ? layer.align : "center",
      color: layer.color || "#ffffff",
      shape: undefined,
      radius: undefined,
      ...stroke,
    };
  }

  if (kind === "shape") {
    return {
      kind: "shape",
      url: "",
      storageId: undefined,
      text: undefined,
      fontSize: undefined,
      fontWeight: undefined,
      italic: undefined,
      align: undefined,
      color: layer.color || "#ffffff",
      shape: layer.shape === "ellipse" ? "ellipse" : "rect",
      radius:
        layer.shape === "ellipse" || !layer.radius
          ? undefined
          : round(clamp(layer.radius, 0, LAYER_LIMITS.size.max)),
      ...stroke,
    };
  }

  // An image, which is every layer written before there were three kinds —
  // so `kind` stays absent rather than being stamped onto documents that were
  // fine without it.
  return {
    kind: undefined,
    text: undefined,
    fontSize: undefined,
    fontWeight: undefined,
    italic: undefined,
    align: undefined,
    color: undefined,
    shape: undefined,
    radius: undefined,
    strokeColor: undefined,
    strokeWidth: undefined,
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

  const shifts: string[] = [];
  const stretched =
    layer.height === undefined && !!layer.stretchY && layer.anchor !== "locked";

  // Three ways a layer gets its height, and each places itself differently.
  //
  //  stretched the box runs between a fixed line and one of the card's edges,
  //            so it is placed by two edges and has no centre to speak of
  //  fixed     the box is known, so its centre can be positioned exactly
  //  auto      the browser knows the box and this file doesn't — hence the
  //            translate, which centres it without anyone measuring anything
  if (stretched) {
    const edge = stretchEdge(layer);
    if (layer.stretchDirection === "up") {
      // Top edge on the card's, bottom edge on the fixed line: the card grows
      // into the layer from underneath.
      style.top = "0px";
      style.height = `max(0px, ${edge})`;
    } else {
      style.top = edge;
      style.height = `max(0px, calc(100cqh - ${edge}))`;
    }
  } else if (layer.height !== undefined) {
    style.height = `${layer.height}cqw`;
    style.top = `calc(${layerCentreCss(layer)} - ${layer.height / 2}cqw)`;
  } else {
    style.height = "auto";
    style.top = layerCentreCss(layer);
    shifts.push("translateY(-50%)");
  }

  if (layer.rotation) shifts.push(`rotate(${layer.rotation}deg)`);
  if (shifts.length > 0) style.transform = shifts.join(" ");

  return style;
}

/**
 * Where a layer's centre sits, as CSS.
 *
 * The same three-way answer as `layerCentreY`, written in container units
 * instead of numbers: `cqw` is a percent of the card's width and `cqh` a
 * percent of its height, so the anchor line costs nothing to express and a
 * locked layer's `y` — the one measurement taken against the height — is simply
 * the one written in `cqh`.
 */
function layerCentreCss(layer: CosmeticLayer): string {
  if (layer.anchor === "locked") return `${layer.y}cqh`;
  if (layer.anchor === "center") return `calc(50cqh + ${layer.y}cqw)`;
  if (layer.anchor === "bottom") return `calc(100cqh + ${layer.y}cqw)`;
  return `${layer.y}cqw`;
}

/** `stretchEdge` as a number, in percent of the card's width from its top. */
function stretchEdgePercent(
  layer: Pick<CosmeticLayer, "anchor" | "y">,
  stageHeightPercent: number,
): number {
  if (layer.anchor === "center") return stageHeightPercent / 2 + layer.y;
  if (layer.anchor === "bottom") return stageHeightPercent + layer.y;
  return layer.y;
}

/** The line a stretched layer holds still — its anchor, offset by `y`. The
 * other end of it is whichever of the card's edges it grows towards. */
function stretchEdge(layer: CosmeticLayer): string {
  const line =
    layer.anchor === "center" ? "50cqh + " : layer.anchor === "bottom" ? "100cqh + " : "";
  return `calc(${line}${layer.y}cqw)`;
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
  // Text and shapes are created with a height and keep one; a missing one can
  // only be a hand-written document, and a square is a better guess than a
  // ratio nobody measured.
  if (layerKind(layer) !== "image") return layer.width;
  if (layer.stretchY && layer.anchor !== "locked") {
    // The two edges it runs between, whichever way round they are.
    const edge = stretchEdgePercent(layer, stageHeightPercent);
    return Math.max(0, layer.stretchDirection === "up" ? edge : stageHeightPercent - edge);
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
      // between its anchor line and one of the card's edges, so the only thing
      // outside the card is however far past that edge the line itself sits.
      // Treating it like the others reserved half a card's width above a border
      // that begins exactly on the card's top edge.
      const stretches =
        !!variant.stretchY && variant.height === undefined && variant.anchor !== "locked";

      if (stretches) {
        const edge = stretchEdgePercent(variant, shape.heightPercent);
        if (variant.stretchDirection === "up") {
          bottom = Math.max(bottom, edge - shape.heightPercent);
        } else {
          top = Math.max(top, -edge);
        }
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
    top: clamp(top, 0, MAX_HEADROOM),
    bottom: clamp(bottom, 0, MAX_HEADROOM),
    inline: clamp(inline, 0, MAX_HEADROOM),
  };
}

/**
 * The most room a frame can ask the layout for, in percent of the card's width.
 *
 * Because this is a guess, and a guess with no ceiling is a card shoved half a
 * page down by artwork that turned out to be sitting on it. Half a card's width
 * is more than any frame that reads as a frame needs — Discord's hang a tenth
 * of one — and anything past it is drawn anyway, in the hosts that don't clip.
 */
const MAX_HEADROOM = 50;

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

/** A new piece of text: centred, at the size of a name, in white — the colour
 * that reads on the most cards, since a card is a photograph as often as not. */
export function defaultTextLayer(text = "Text"): CosmeticLayer {
  return {
    id: newLayerId(),
    kind: "text",
    url: "",
    anchor: "center",
    x: 50,
    y: 0,
    width: 80,
    // Explicit, unlike an image's: there is no intrinsic shape to fall back
    // on, and a box that grew with the words would resize itself as they were
    // typed.
    height: DEFAULT_FONT_SIZE * 1.6,
    text,
    fontSize: DEFAULT_FONT_SIZE,
    fontWeight: 700,
    align: "center",
    color: "#ffffff",
  };
}

/** A new shape: a square in the middle, which is the easiest thing to see and
 * then drag into whatever was actually wanted. */
export function defaultShapeLayer(shape: LayerShape = "rect"): CosmeticLayer {
  return {
    id: newLayerId(),
    kind: "shape",
    url: "",
    anchor: "center",
    x: 50,
    y: 0,
    width: 40,
    height: 40,
    shape,
    color: "#ffffff",
    radius: shape === "rect" ? 4 : undefined,
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
