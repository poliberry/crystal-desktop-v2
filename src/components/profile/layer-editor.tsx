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
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LayerCanvas } from "@/components/profile/layer-canvas";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  LAYER_LIMITS,
  MAX_LAYERS,
  newLayerId,
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
  const [heightKey, setHeightKey] = useState(heights[0]?.key ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const selected = draft.find((layer) => layer.id === selectedId) ?? null;

  /** A slider fires per pixel of travel, so the two are separate: the draft
   * follows the drag, and only the release is worth a write. */
  const patchLive = (id: string, patch: Partial<CosmeticLayer>) =>
    setDraft((prev) =>
      prev.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)),
    );
  const patchSaved = (id: string, patch: Partial<CosmeticLayer>) =>
    commit(draft.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)));

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
            zoom={zoom}
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
            </div>
          </div>
        </div>

        {/* The panel: what's on the canvas, and the numbers behind whichever
            piece of it is selected. */}
        <div className="flex w-56 shrink-0 flex-col gap-3 overflow-y-auto">
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
                      <span className="size-7 shrink-0 rounded bg-[repeating-conic-gradient(#0000_0_25%,#ffffff12_0_50%)] bg-[length:8px_8px]">
                        <img
                          src={resolveSrc(layer.url)}
                          alt=""
                          className="size-full object-contain"
                          draggable={false}
                        />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                        {Math.round(layer.width)}% · {layer.anchor}
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
              onChange={(patch) => patchLive(selected.id, patch)}
              onCommit={(patch) => patchSaved(selected.id, patch)}
              onDuplicate={() => {
                const copy = { ...selected, id: newLayerId(), x: selected.x + 4, y: selected.y + 4 };
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
  onChange,
  onCommit,
  onDuplicate,
  onRemove,
}: {
  layer: CosmeticLayer;
  /** Live, for a slider mid-drag. */
  onChange: (patch: Partial<CosmeticLayer>) => void;
  /** Saved, for the release and for everything that is one click. */
  onCommit: (patch: Partial<CosmeticLayer>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const anchors: { anchor: LayerAnchor; label: string }[] = [
    { anchor: "top", label: "Top" },
    { anchor: "center", label: "Middle" },
    { anchor: "bottom", label: "Bottom" },
  ];

  return (
    <div className="space-y-3 border-t border-border/50 pt-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Pinned to</Label>
        <div className="grid grid-cols-3 gap-1">
          {anchors.map((option) => (
            <Button
              key={option.anchor}
              type="button"
              size="sm"
              variant={layer.anchor === option.anchor ? "secondary" : "ghost"}
              className="h-7 px-1 text-[11px]"
              onClick={() => onCommit({ anchor: option.anchor })}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <p className="text-[10px] leading-snug text-muted-foreground">
          Which edge it stays with when the card grows.
        </p>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <Label className="text-xs">Grow with the card</Label>
          <p className="text-[10px] leading-snug text-muted-foreground">
            For a border drawn to the card&apos;s whole shape.
          </p>
        </div>
        <Switch
          checked={!!layer.stretchY && layer.height === undefined}
          onCheckedChange={(checked) =>
            onCommit({ stretchY: checked || undefined, height: undefined })
          }
        />
      </div>

      <NumberRow
        label="Size"
        value={layer.width}
        suffix="%"
        min={LAYER_LIMITS.size.min}
        max={LAYER_LIMITS.size.max}
        onChange={(width) => onChange({ width })}
        onCommit={(width) => onCommit({ width })}
      />
      <NumberRow
        label="Across"
        value={layer.x}
        suffix="%"
        min={LAYER_LIMITS.position.min}
        max={LAYER_LIMITS.position.max}
        onChange={(x) => onChange({ x })}
        onCommit={(x) => onCommit({ x })}
      />
      <NumberRow
        label="Down"
        value={layer.y}
        suffix="%"
        min={LAYER_LIMITS.position.min}
        max={LAYER_LIMITS.position.max}
        onChange={(y) => onChange({ y })}
        onCommit={(y) => onCommit({ y })}
      />
      <NumberRow
        label="Turn"
        value={layer.rotation ?? 0}
        suffix="°"
        min={LAYER_LIMITS.rotation.min}
        max={LAYER_LIMITS.rotation.max}
        onChange={(rotation) => onChange({ rotation: rotation || undefined })}
        onCommit={(rotation) => onCommit({ rotation: rotation || undefined })}
      />
      <NumberRow
        label="Fade"
        value={Math.round((layer.opacity ?? 1) * 100)}
        suffix="%"
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

/** A slider with its number beside it — the same control five times, so it is
 * written once. */
function NumberRow({
  label,
  value,
  suffix,
  min,
  max,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  suffix: string;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {Math.round(value)}
          {suffix}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={1}
        onValueChange={([next]) => onChange(next ?? value)}
        onValueCommit={([next]) => onCommit(next ?? value)}
      />
    </div>
  );
}
