"use client";

import {
  ArrowDown,
  ArrowUp,
  Copy,
  ImagePlus,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  Square,
  Trash2,
  Type,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSmoothScrollRef } from "@/hooks/use-smooth-scroll";

import { LayerCanvas } from "@/components/profile/layer-canvas";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  ANCHORS,
  clearVariant,
  defaultShapeLayer,
  defaultTextLayer,
  layerKind,
  MAX_TEXT_LENGTH,
  DEFAULT_VARIANT,
  LAYER_LIMITS,
  layerHeight,
  MAX_LAYERS,
  newLayerId,
  patchLayer,
  reanchorLayer,
  resolveLayer,
  type CosmeticLayer,
  type LayerAnchor,
} from "@/lib/cosmetic-layers";
import { cn } from "@/lib/utils";

/**
 * The editor both cosmetics are arranged in: a canvas with the real thing on
 * it, a list of the artwork on top, and the numbers behind whatever is
 * selected.
 *
 * One component for the profile frame and the avatar decoration because the
 * two are the same problem at different scales — place some pictures against
 * something. What differs is the backdrop and how tall it can be, which is why
 * both arrive as props: `renderStage` draws the thing being decorated, and
 * `heights` says which shapes of it are worth checking against.
 *
 * ## Editing is local, saving is not
 *
 * Everything here works on a draft. A drag fires per pointer move, and a
 * mutation per pointer move is a write per pixel — so the canvas edits the
 * draft and only a finished gesture is saved. The draft is re-seeded whenever
 * the stored value changes underneath, which is what makes "Reset" and an edit
 * from another window both land.
 */

/** Which unit the inspector's measurements are typed in. Percent is what gets
 * stored — it has to be, since a card is drawn at several widths — and pixels
 * are what anybody lining artwork up with an edge is actually thinking in. */
export type SizeUnit = "percent" | "px";

/** What each anchor is called in the interface. "Locked" is the odd one out and
 * says so: the other three name an edge, and it names what it does. */
const ANCHOR_LABELS: Record<LayerAnchor, string> = {
  top: "Top",
  center: "Middle",
  bottom: "Bottom",
  locked: "Locked",
};

export interface StageHeightOption {
  key: string;
  label: string;
  /** Height of the stage in CSS pixels, at zoom 1. */
  height: number;
  hint?: string;
}

export function LayerEditor({
  layers: stored,
  onSave,
  renderStage,
  stageWidth,
  heights,
  upload,
  uploadHint,
  presets,
  resolveSrc = (url) => url,
  className,
}: {
  layers: CosmeticLayer[];
  onSave: (layers: CosmeticLayer[]) => void | Promise<unknown>;
  /** The thing being decorated, drawn at `stageWidth` by the given height. */
  renderStage: (height: number) => React.ReactNode;
  stageWidth: number;
  /**
   * The shapes the backdrop is worth seeing at.
   *
   * A profile card has no one height — a long bio or a rich presence card makes
   * it grow — so a frame placed against a short card has to be checked against
   * a tall one. That is what these are: the same artwork, the same numbers, a
   * different card underneath.
   */
  heights: StageHeightOption[];
  /** Puts a picked file in storage and hands back what a layer needs. */
  upload: (file: File) => Promise<{ url: string; storageId?: string }>;
  uploadHint: string;
  /** Artwork that needs no upload — the built-in decoration presets. Their
   * `url` is the *stored* form (a preset key), which is what a layer keeps. */
  presets?: { label: string; url: string }[];
  /** A stored url to the picture to draw for it. Only the decoration editor
   * needs one, because only decorations have artwork that isn't a file. */
  resolveSrc?: (url: string) => string;
  className?: string;
}) {
  const [draft, setDraft] = useState<CosmeticLayer[]>(stored);
  const [selectedId, setSelectedId] = useState<string | null>(stored[0]?.id ?? null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  /** Percent of the card, or pixels at the size it is drawn here. The stored
   * number is the percentage either way — this only decides which one you type
   * into, and pixels are what somebody matching artwork to a card edge wants. */
  const [unit, setUnit] = useState<SizeUnit>("percent");
  const [heightKey, setHeightKey] = useState(heights[0]?.key ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const smoothRef = useSmoothScrollRef<HTMLDivElement>();

  /**
   * The stored value as it was the last time the draft was seeded from it.
   *
   * The comparison is against *stored*, never against what was last saved.
   * Comparing against the save was the bug that made every drag snap back: a
   * save is a round trip, so for the frame or two before it lands, `stored` is
   * still the old value — and a guard that noticed the difference would helpfully
   * throw away the edit that caused it. Waiting for `stored` itself to change
   * means the draft is only ever overwritten by something that really did.
   */
  const storedKey = JSON.stringify(stored);
  const [seenStored, setSeenStored] = useState(storedKey);
  if (storedKey !== seenStored) {
    setSeenStored(storedKey);
    setDraft(stored);
  }

  /** Artwork proportions, so a layer that keeps its own shape can be given
   * handles that sit on it. Filled in as the files load. */
  const [ratios, setRatios] = useState<Record<string, number>>({});
  useEffect(() => {
    for (const layer of draft) {
      if (ratios[layer.url]) continue;
      const image = new Image();
      image.onload = () => {
        if (!image.naturalHeight) return;
        setRatios((prev) => ({
          ...prev,
          [layer.url]: image.naturalWidth / image.naturalHeight,
        }));
      };
      image.src = resolveSrc(layer.url);
    }
  }, [draft, ratios, resolveSrc]);

  const stageHeight =
    heights.find((option) => option.key === heightKey)?.height ?? heights[0]?.height ?? stageWidth;

  const commit = useCallback(
    (next: CosmeticLayer[]) => {
      setDraft(next);
      void Promise.resolve(onSave(next)).catch((err) =>
        setError(err instanceof Error ? err.message : "Couldn't save that."),
      );
    },
    [onSave],
  );

  const selectedStored = draft.find((layer) => layer.id === selectedId) ?? null;
  /** The selected layer as it is drawn on the shape currently on the canvas. */
  const selected = selectedStored ? resolveLayer(selectedStored, heightKey) : null;

  /**
   * A slider fires per pixel of travel, so the two are separate: the draft
   * follows the drag, and only the release is worth a write.
   *
   * Both go through `patchLayer`, which decides whether an edit belongs to the
   * layer or to the shape of card currently on the canvas.
   */
  const patchLive = (id: string, patch: Partial<CosmeticLayer>) =>
    setDraft((prev) =>
      prev.map((layer) => (layer.id === id ? patchLayer(layer, patch, heightKey) : layer)),
    );
  const patchSaved = (id: string, patch: Partial<CosmeticLayer>) =>
    commit(
      draft.map((layer) => (layer.id === id ? patchLayer(layer, patch, heightKey) : layer)),
    );

  /** How tall each shape on offer is, in percent of the stage's width — the
   * unit every layer is stored in, and what re-anchoring converts against. */
  const heightPercentOf = useCallback(
    (key: string) =>
      (((heights.find((option) => option.key === key)?.height ?? stageHeight) / stageWidth) *
        100),
    [heights, stageHeight, stageWidth],
  );

  /**
   * Pin the selected layer to something else, keeping it where it is.
   *
   * Not through `patchSaved`, which routes an edit to the shape currently on the
   * canvas: an anchor is the layer's, and changing it changes what *every*
   * shape's position means.
   */
  const reanchor = (anchor: LayerAnchor) => {
    if (!selectedStored) return;
    commit(
      draft.map((layer) =>
        layer.id === selectedStored.id
          ? reanchorLayer(layer, anchor, heightPercentOf)
          : layer,
      ),
    );
  };

  /** Put a ready-made layer on the canvas and select it, which is what makes
   * the inspector show its controls straight away. */
  const addLayerObject = (layer: CosmeticLayer) => {
    if (draft.length >= MAX_LAYERS) {
      setError(`That's the most one of these can hold (${MAX_LAYERS}).`);
      return;
    }
    commit([...draft, layer]);
    setSelectedId(layer.id);
  };

  const addLayer = (url: string, storageId?: string) => {
    if (draft.length >= MAX_LAYERS) {
      setError(`That's the most artwork one of these can hold (${MAX_LAYERS}).`);
      return;
    }
    // Dropped in the middle at a size that reads as "this is your picture,
    // now put it somewhere" rather than in a corner where it might be missed.
    const layer: CosmeticLayer = {
      id: newLayerId(),
      url,
      storageId,
      anchor: "center",
      x: 50,
      y: 0,
      width: 100,
    };
    commit([...draft, layer]);
    setSelectedId(layer.id);
  };

  const pickFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      const room = MAX_LAYERS - draft.length;
      const chosen = Array.from(files).slice(0, Math.max(0, room));
      // Uploaded one at a time and added as a batch: adding them one by one
      // would save between each, and a half-uploaded set is not an arrangement
      // anybody meant to keep.
      const added: CosmeticLayer[] = [];
      for (const file of chosen) {
        const { url, storageId } = await upload(file);
        added.push({
          id: newLayerId(),
          url,
          storageId,
          anchor: "center",
          x: 50,
          y: 0,
          width: 100,
        });
      }
      if (added.length > 0) {
        commit([...draft, ...added]);
        setSelectedId(added[added.length - 1]!.id);
      }
      if (chosen.length < files.length) {
        setError(`Only ${chosen.length} of those fitted — ${MAX_LAYERS} is the limit.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "That upload didn't work.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const move = (id: string, direction: -1 | 1) => {
    const index = draft.findIndex((layer) => layer.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= draft.length) return;
    const next = [...draft];
    const [layer] = next.splice(index, 1);
    next.splice(target, 0, layer!);
    commit(next);
  };

  const stageOptions = useMemo(
    () => heights.filter((option) => option.height > 0),
    [heights],
  );

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)}>
      <div className="flex min-h-0 flex-1 gap-3">
        {/* The canvas. Left alone by the panel beside it: this is the part
            being looked at, so it gets the room. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          <LayerCanvas
            layers={draft}
            stage={{ width: stageWidth, height: stageHeight }}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChange={setDraft}
            onCommit={commit}
            ratios={ratios}
            variant={heightKey}
            zoom={zoom}
            onZoomChange={setZoom}
            pan={pan}
            onPanChange={setPan}
            resolveSrc={resolveSrc}
            className="min-h-0 flex-1"
          >
            {renderStage(stageHeight)}
          </LayerCanvas>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="size-7"
                title="Zoom out"
                onClick={() => setZoom((z) => Math.max(0.35, Math.round((z - 0.1) * 100) / 100))}
              >
                <Minus className="size-3.5" />
              </Button>
              <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="size-7"
                title="Zoom in"
                onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.1) * 100) / 100))}
              >
                <Plus className="size-3.5" />
              </Button>
              {/* Only offered once the view has actually been moved — a button
                  that undoes nothing is a button in the way. */}
              {(zoom !== 1 || pan.x !== 0 || pan.y !== 0) && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  title="Back to 100% and centred"
                  onClick={() => {
                    setZoom(1);
                    setPan({ x: 0, y: 0 });
                  }}
                >
                  Reset view
                </Button>
              )}
            </div>

            {/* The shapes the backdrop comes in. Not a preview toggle so much
                as the second half of placing a frame: a card grows with what's
                written on it, and artwork that only works on a short one is
                artwork that mostly doesn't work. */}
            {stageOptions.length > 1 && (
              <div className="flex items-center gap-1">
                {stageOptions.map((option) => (
                  <Button
                    key={option.key}
                    type="button"
                    size="sm"
                    variant={heightKey === option.key ? "secondary" : "ghost"}
                    className="h-7 px-2 text-xs"
                    title={option.hint}
                    onClick={() => setHeightKey(option.key)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            )}

            <div className="ml-auto flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/gif,image/webp,image/jpeg,image/svg+xml"
                multiple
                className="hidden"
                onChange={(event) => void pickFiles(event.target.files)}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7"
                disabled={busy || draft.length >= MAX_LAYERS}
                onClick={() => fileRef.current?.click()}
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ImagePlus className="size-3.5" />
                )}
                Add images
              </Button>
              {/* A frame is not only pictures: a name across the bottom or a
                  band behind the avatar is a thing people want and had to
                  make in another program and upload. */}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7"
                disabled={draft.length >= MAX_LAYERS}
                onClick={() => addLayerObject(defaultTextLayer())}
              >
                <Type className="size-3.5" />
                Text
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7"
                disabled={draft.length >= MAX_LAYERS}
                onClick={() => addLayerObject(defaultShapeLayer("rect"))}
              >
                <Square className="size-3.5" />
                Shape
              </Button>
            </div>
          </div>
        </div>

        {/* The panel: what's on the canvas, and the numbers behind whichever
            piece of it is selected. */}
        <div
          ref={smoothRef}
          className="flex w-56 shrink-0 flex-col gap-3 overflow-y-auto"
        >
          <div className="space-y-1.5">
            <Label className="text-xs">Artwork</Label>
            {draft.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing yet.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {/* Reversed: the last layer is drawn on top, and a list that
                    reads top-down should say so. */}
                {[...draft].reverse().map((layer) => (
                  <div
                    key={layer.id}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md border p-1 transition-colors",
                      layer.id === selectedId
                        ? "border-primary bg-accent/60"
                        : "border-transparent hover:bg-accent/40",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedId(layer.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      {/* A thumbnail of the thing itself rather than of its
                          file: a text layer has no file, and "Aa" in the
                          right colour identifies it faster than a name would. */}
                      <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded bg-[repeating-conic-gradient(#0000_0_25%,#ffffff12_0_50%)] bg-[length:8px_8px] [container-type:size]">
                        {layerKind(layer) === "text" ? (
                          <span
                            className="text-[11px] font-bold leading-none"
                            style={{ color: layer.color ?? "#ffffff" }}
                          >
                            Aa
                          </span>
                        ) : layerKind(layer) === "shape" ? (
                          <span
                            className="size-4"
                            style={{
                              background: layer.color ?? "#ffffff",
                              borderRadius: layer.shape === "ellipse" ? "50%" : 2,
                            }}
                          />
                        ) : (
                          <img
                            src={resolveSrc(layer.url)}
                            alt=""
                            className="size-full object-contain"
                            draggable={false}
                          />
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                        {Math.round(layer.width)}% · {ANCHOR_LABELS[layer.anchor]}
                      </span>
                    </button>
                    <div className="flex shrink-0 flex-col">
                      <button
                        type="button"
                        title="Bring forward"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => move(layer.id, 1)}
                      >
                        <ArrowUp className="size-3" />
                      </button>
                      <button
                        type="button"
                        title="Send back"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => move(layer.id, -1)}
                      >
                        <ArrowDown className="size-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {presets && presets.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Built in</Label>
              <div className="flex flex-wrap gap-1">
                {presets.map((preset) => (
                  <button
                    key={preset.url}
                    type="button"
                    title={preset.label}
                    onClick={() => addLayer(preset.url)}
                    className="size-9 rounded border border-border/60 p-0.5 hover:bg-accent/40"
                  >
                    <img
                      src={resolveSrc(preset.url)}
                      alt={preset.label}
                      className="size-full object-contain"
                      draggable={false}
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          {selected && (
            <LayerInspector
              layer={selected}
              height={layerHeight(
                selected,
                ratios[selected.url],
                (stageHeight / stageWidth) * 100,
              )}
              unit={unit}
              onUnitChange={setUnit}
              // The stage is drawn at the card's real width, so a percent of it
              // is a pixel of it — which is what makes "396px" mean the same
              // thing here as it does in the artwork somebody exported.
              pxPerPercent={stageWidth / 100}
              stageHeightPercent={(stageHeight / stageWidth) * 100}
              onAnchorChange={reanchor}
              variantLabel={
                heightKey === DEFAULT_VARIANT
                  ? undefined
                  : (heights.find((option) => option.key === heightKey)?.label ??
                    heightKey)
              }
              overridden={!!selectedStored?.variants?.[heightKey]}
              onMatchDefault={() =>
                selectedStored &&
                commit(
                  draft.map((layer) =>
                    layer.id === selectedStored.id
                      ? clearVariant(layer, heightKey)
                      : layer,
                  ),
                )
              }
              onChange={(patch) => patchLive(selected.id, patch)}
              onCommit={(patch) => patchSaved(selected.id, patch)}
              onDuplicate={() => {
                const copy = {
                  ...(selectedStored ?? selected),
                  id: newLayerId(),
                  x: selected.x + 4,
                  y: selected.y + 4,
                };
                commit([...draft, copy]);
                setSelectedId(copy.id);
              }}
              onRemove={() => {
                commit(draft.filter((layer) => layer.id !== selected.id));
                setSelectedId(null);
              }}
            />
          )}
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
      <p className="text-[11px] text-muted-foreground">{uploadHint}</p>
    </div>
  );
}

/**
 * The numbers behind the selected layer.
 *
 * Everything here is reachable by dragging on the canvas too — this is for
 * saying "exactly 100%" and for the two things a drag can't express: which
 * edge the artwork is pinned to, and whether it should grow with the card.
 */
function LayerInspector({
  layer,
  height,
  unit,
  onUnitChange,
  pxPerPercent,
  stageHeightPercent,
  onAnchorChange,
  variantLabel,
  overridden,
  onMatchDefault,
  onChange,
  onCommit,
  onDuplicate,
  onRemove,
}: {
  layer: CosmeticLayer;
  /** What the layer is actually as tall as right now, in percent — from its own
   * height, from the artwork's proportions, or from the card it stretches to. */
  height: number;
  unit: SizeUnit;
  onUnitChange: (unit: SizeUnit) => void;
  /** Pixels per percent, for the unit that isn't stored. */
  pxPerPercent: number;
  /** How tall the card on the canvas is, in percent of its width — what a
   * locked layer's position is measured against. */
  stageHeightPercent: number;
  /** Change what the layer is pinned to, everywhere at once. */
  onAnchorChange: (anchor: LayerAnchor) => void;
  /** Set when the canvas is showing a shape of card other than the default, in
   * which case the numbers below belong to that shape alone. */
  variantLabel?: string;
  /** Whether this layer has already been placed differently for that shape. */
  overridden: boolean;
  /** Throw that placement away and follow the default again. */
  onMatchDefault: () => void;
  /** Live, for a slider mid-drag. */
  onChange: (patch: Partial<CosmeticLayer>) => void;
  /** Saved, for the release and for everything that is one click. */
  onCommit: (patch: Partial<CosmeticLayer>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const locked = layer.anchor === "locked";
  const stretching = !!layer.stretchY && layer.height === undefined && !locked;
  const kind = layerKind(layer);

  return (
    <div className="space-y-3 border-t border-border/50 pt-3">
      {/* What it is made of, above where it sits: the geometry below is the
          same questions for all three kinds, and these are the ones that only
          make sense for one. */}
      {kind === "text" && (
        <div className="space-y-2">
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="layer-text">
              Words
            </Label>
            <textarea
              id="layer-text"
              value={layer.text ?? ""}
              maxLength={MAX_TEXT_LENGTH}
              rows={2}
              onChange={(event) => onChange({ text: event.target.value })}
              // Typed live and saved on the way out: a mutation per keystroke
              // is a write per letter.
              onBlur={(event) => onCommit({ text: event.target.value })}
              className="w-full resize-none rounded-md border border-border/60 bg-background px-2 py-1 text-xs outline-none focus-visible:border-ring"
            />
          </div>

          <NumberRow
            label="Type size"
            value={layer.fontSize ?? 7.5}
            unit={unit}
            pxPerPercent={pxPerPercent}
            min={0.5}
            max={LAYER_LIMITS.size.max}
            onChange={(fontSize) => onChange({ fontSize })}
            onCommit={(fontSize) => onCommit({ fontSize })}
          />

          <div className="space-y-1.5">
            <Label className="text-xs">Weight</Label>
            <div className="grid grid-cols-4 gap-1">
              {[400, 600, 700, 900].map((weight) => (
                <Button
                  key={weight}
                  type="button"
                  size="sm"
                  variant={(layer.fontWeight ?? 700) === weight ? "secondary" : "ghost"}
                  className="h-7 px-1 text-[11px]"
                  onClick={() => onCommit({ fontWeight: weight })}
                >
                  {weight}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Alignment</Label>
            <div className="grid grid-cols-3 gap-1">
              {(["left", "center", "right"] as const).map((align) => (
                <Button
                  key={align}
                  type="button"
                  size="sm"
                  variant={(layer.align ?? "center") === align ? "secondary" : "ghost"}
                  className="h-7 px-1 text-[11px] capitalize"
                  onClick={() => onCommit({ align })}
                >
                  {align}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs">Italic</Label>
            <Switch
              checked={!!layer.italic}
              onCheckedChange={(italic) => onCommit({ italic: italic || undefined })}
            />
          </div>
        </div>
      )}

      {kind === "shape" && (
        <div className="space-y-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Shape</Label>
            <div className="grid grid-cols-2 gap-1">
              {(["rect", "ellipse"] as const).map((shape) => (
                <Button
                  key={shape}
                  type="button"
                  size="sm"
                  variant={(layer.shape ?? "rect") === shape ? "secondary" : "ghost"}
                  className="h-7 px-1 text-[11px]"
                  onClick={() => onCommit({ shape })}
                >
                  {shape === "rect" ? "Rectangle" : "Ellipse"}
                </Button>
              ))}
            </div>
          </div>

          {(layer.shape ?? "rect") === "rect" && (
            <NumberRow
              label="Corners"
              value={layer.radius ?? 0}
              unit={unit}
              pxPerPercent={pxPerPercent}
              min={0}
              max={50}
              onChange={(radius) => onChange({ radius })}
              onCommit={(radius) => onCommit({ radius })}
            />
          )}
        </div>
      )}

      {kind !== "image" && (
        <div className="space-y-2">
          <ColorRow
            label={kind === "text" ? "Colour" : "Fill"}
            value={layer.color ?? "#ffffff"}
            onChange={(color) => onCommit({ color })}
          />
          <ColorRow
            label="Outline"
            value={layer.strokeColor}
            onChange={(strokeColor) =>
              onCommit({
                strokeColor,
                // An outline with no width is an outline nobody can see, so
                // turning one on gives it something to draw.
                strokeWidth: strokeColor ? layer.strokeWidth || 0.5 : undefined,
              })
            }
          />
          {layer.strokeColor && (
            <NumberRow
              label="Outline width"
              value={layer.strokeWidth ?? 0.5}
              unit={unit}
              pxPerPercent={pxPerPercent}
              min={0}
              max={20}
              onChange={(strokeWidth) => onChange({ strokeWidth })}
              onCommit={(strokeWidth) => onCommit({ strokeWidth })}
            />
          )}
        </div>
      )}
      {/* What editing means right now. Without this the same sliders quietly do
          two different things depending on which card is on the canvas, which
          is the kind of surprise that ends with somebody's frame moved on a
          shape they were not looking at. */}
      {variantLabel && (
        <div className="rounded-md border border-border/60 bg-muted/40 p-2">
          <p className="text-[11px] leading-snug">
            Placing this for <span className="font-medium">{variantLabel}</span>{" "}
            cards only.
          </p>
          {overridden ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="mt-1 h-6 px-1.5 text-[11px]"
              onClick={onMatchDefault}
            >
              <RotateCcw className="size-3" />
              Match the default
            </Button>
          ) : (
            <p className="text-[10px] leading-snug text-muted-foreground">
              Following the default placement until you move it.
            </p>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs">Pinned to</Label>
        <div className="grid grid-cols-4 gap-1">
          {ANCHORS.map((anchor) => (
            <Button
              key={anchor}
              type="button"
              size="sm"
              variant={layer.anchor === anchor ? "secondary" : "ghost"}
              className="h-7 px-1 text-[11px]"
              // Not one of the patches above: an anchor belongs to the layer
              // rather than to the shape on screen, and changing it has to
              // rewrite every shape's position at once — see `reanchorLayer`.
              onClick={() => onAnchorChange(anchor)}
            >
              {ANCHOR_LABELS[anchor]}
            </Button>
          ))}
        </div>
        <p className="text-[10px] leading-snug text-muted-foreground">
          {locked
            ? "Held the same distance down the card, whatever its height."
            : "Which edge it stays with when the card grows."}
        </p>
      </div>

      {!locked && (
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <Label className="text-xs">Grow with the card</Label>
            <p className="text-[10px] leading-snug text-muted-foreground">
              For a border drawn to the card&apos;s whole shape.
            </p>
          </div>
          <Switch
            checked={stretching}
            onCheckedChange={(checked) =>
              onCommit({ stretchY: checked || undefined, height: undefined })
            }
          />
        </div>
      )}

      {/* Which end of a stretched layer gives. Only worth asking once it is
          stretching — and worth asking at all because a band across the middle
          of a card and a border drawn around the whole of it want opposite
          answers: one keeps its place and lets the space above it grow, the
          other keeps its top and follows the card down. */}
      {stretching && (
        <div className="space-y-1.5">
          <Label className="text-xs">Which end gives</Label>
          <div className="grid grid-cols-2 gap-1">
            {([
              { value: "down", label: "Bottom" },
              { value: "up", label: "Top" },
            ] as const).map((option) => (
              <Button
                key={option.value}
                type="button"
                size="sm"
                variant={
                  (layer.stretchDirection ?? "down") === option.value
                    ? "secondary"
                    : "ghost"
                }
                className="h-7 px-1 text-[11px]"
                onClick={() => onCommit({ stretchDirection: option.value })}
              >
                {option.label}
              </Button>
            ))}
          </div>
          <p className="text-[10px] leading-snug text-muted-foreground">
            {(layer.stretchDirection ?? "down") === "down"
              ? "Its top stays put; its bottom follows the card's."
              : "Its bottom stays put; its top reaches the card's top edge."}
          </p>
        </div>
      )}

      {/* Which unit the four measurements below are typed in. Percentages are
          what gets stored — they have to be, since a card is drawn at several
          widths — but nobody matching artwork to an edge thinks in them, so
          pixels are offered against the size the card has here. */}
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">Measurements</Label>
        <div className="flex items-center gap-0.5">
          {(["percent", "px"] as const).map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={unit === option ? "secondary" : "ghost"}
              className="h-6 px-1.5 text-[10px]"
              onClick={() => onUnitChange(option)}
            >
              {option === "percent" ? "%" : "px"}
            </Button>
          ))}
        </div>
      </div>

      <NumberRow
        label="Width"
        value={layer.width}
        unit={unit}
        pxPerPercent={pxPerPercent}
        min={LAYER_LIMITS.size.min}
        max={LAYER_LIMITS.size.max}
        onChange={(width) => onChange({ width })}
        onCommit={(width) => onCommit({ width })}
      />
      <NumberRow
        label="Height"
        value={height}
        unit={unit}
        pxPerPercent={pxPerPercent}
        min={LAYER_LIMITS.size.min}
        max={LAYER_LIMITS.size.max}
        // Typing a height is how a layer stops keeping its own proportions —
        // the two are answers to the same question, so setting one puts the
        // other away.
        hint={
          layer.height === undefined
            ? layer.stretchY
              ? "Following the card."
              : "The artwork's own shape."
            : undefined
        }
        onChange={(next) => onChange({ height: next, stretchY: undefined })}
        onCommit={(next) => onCommit({ height: next, stretchY: undefined })}
      />
      <NumberRow
        label="Across"
        value={layer.x}
        unit={unit}
        pxPerPercent={pxPerPercent}
        min={LAYER_LIMITS.position.min}
        max={LAYER_LIMITS.position.max}
        onChange={(x) => onChange({ x })}
        onCommit={(x) => onCommit({ x })}
      />
      <NumberRow
        label="Down"
        value={layer.y}
        unit={unit}
        // A locked layer's `y` is the one measurement taken against the card's
        // height rather than its width, so a pixel of it is a different number
        // of percent — and typing "80px" has to mean 80 pixels either way.
        pxPerPercent={locked ? (pxPerPercent * stageHeightPercent) / 100 : pxPerPercent}
        min={LAYER_LIMITS.position.min}
        max={LAYER_LIMITS.position.max}
        hint={locked ? "Percent of the card's height." : undefined}
        onChange={(y) => onChange({ y })}
        onCommit={(y) => onCommit({ y })}
      />
      <NumberRow
        label="Turn"
        value={layer.rotation ?? 0}
        unit="degrees"
        pxPerPercent={pxPerPercent}
        min={LAYER_LIMITS.rotation.min}
        max={LAYER_LIMITS.rotation.max}
        onChange={(rotation) => onChange({ rotation: rotation || undefined })}
        onCommit={(rotation) => onCommit({ rotation: rotation || undefined })}
      />
      <NumberRow
        label="Fade"
        value={Math.round((layer.opacity ?? 1) * 100)}
        unit="percent-plain"
        pxPerPercent={pxPerPercent}
        min={0}
        max={100}
        onChange={(value) => onChange({ opacity: value >= 100 ? undefined : value / 100 })}
        onCommit={(value) => onCommit({ opacity: value >= 100 ? undefined : value / 100 })}
      />

      <div className="flex flex-wrap gap-1">
        {layer.height !== undefined && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            title="Back to the artwork's own proportions"
            onClick={() => onCommit({ height: undefined })}
          >
            <RotateCcw className="size-3" />
            Keep shape
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px]"
          onClick={onDuplicate}
        >
          <Copy className="size-3" />
          Duplicate
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px] text-destructive"
          onClick={onRemove}
        >
          <Trash2 className="size-3" />
          Remove
        </Button>
      </div>
    </div>
  );
}

/**
 * A colour, and whether there is one at all.
 *
 * The swatch is a native colour input — the OS picker is better than anything
 * worth building here, and it is the one control people already know. The
 * cross beside it is what makes the value optional: an outline has to be able
 * to be *no* outline, and a colour input has no way to say that.
 */
function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-1">
        <input
          type="color"
          value={value ?? "#ffffff"}
          onChange={(event) => onChange(event.target.value)}
          className="size-7 cursor-pointer rounded-md border border-border/60 bg-transparent p-0.5"
          aria-label={label}
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7"
          title={value ? `Remove ${label.toLowerCase()}` : `No ${label.toLowerCase()}`}
          disabled={!value}
          onClick={() => onChange(undefined)}
        >
          <Trash2 className="size-3" />
        </Button>
      </div>
    </div>
  );
}

/** What a `NumberRow` is measuring. The first two convert; the last two are
 * themselves whatever unit they are. */
type RowUnit = SizeUnit | "degrees" | "percent-plain";

/**
 * One measurement: a field to type an exact number into, and a slider to find
 * an approximate one with.
 *
 * Both, because the two are different jobs. Dragging is how you find out what
 * looks right; typing is how you say "396 pixels, the width of the card" — and
 * a slider cannot say that at any length.
 *
 * The field is only bound to the value while it isn't being typed in. A
 * controlled input that rewrites itself on every keystroke makes "1" into "1%"
 * and then refuses the "2" that was going to follow it.
 */
function NumberRow({
  label,
  value,
  unit,
  pxPerPercent,
  min,
  max,
  hint,
  onChange,
  onCommit,
}: {
  label: string;
  /** Always in the stored unit — percent, or degrees for a turn. */
  value: number;
  unit: RowUnit;
  pxPerPercent: number;
  min: number;
  max: number;
  hint?: string;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const [typing, setTyping] = useState<string | null>(null);

  const factor = unit === "px" ? pxPerPercent : 1;
  const suffix = unit === "degrees" ? "°" : unit === "px" ? "px" : "%";
  /** Pixels are whole; a percentage of a card needs two places to be worth
   * anything, since one percent of it is three pixels. */
  const shown = unit === "px" ? Math.round(value * factor) : Math.round(value * 100) / 100;

  const apply = (text: string, commit: boolean) => {
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) return;
    const next = Math.min(max, Math.max(min, parsed / factor));
    (commit ? onCommit : onChange)(next);
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">{label}</Label>
        <div className="flex items-center gap-1">
          <input
            type="number"
            inputMode="decimal"
            value={typing ?? shown}
            step={unit === "px" ? 1 : 0.5}
            onChange={(event) => {
              setTyping(event.target.value);
              apply(event.target.value, false);
            }}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={(event) => {
              setTyping(null);
              apply(event.target.value, true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            className="h-6 w-16 rounded border border-input bg-transparent px-1 text-right text-[11px] tabular-nums outline-none focus:border-ring"
          />
          <span className="w-5 text-[10px] text-muted-foreground">{suffix}</span>
        </div>
      </div>
      <Slider
        value={[Math.min(max, Math.max(min, value))]}
        min={min}
        max={max}
        step={unit === "px" ? 1 / Math.max(pxPerPercent, 0.001) : 0.5}
        onValueChange={([next]) => onChange(next ?? value)}
        onValueCommit={([next]) => onCommit(next ?? value)}
      />
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
