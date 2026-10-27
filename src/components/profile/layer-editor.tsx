"use client";

import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Eye,
  HelpCircle,
  ImagePlus,
  Loader2,
  Maximize,
  Minus,
  Plus,
  Redo2,
  Shapes,
  Square,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { LayerCanvas } from "@/components/profile/layer-canvas";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import {
  canvasBounds,
  confineLayer,
  DEFAULT_VARIANT,
  defaultShapeLayer,
  defaultTextLayer,
  layerCentreY,
  layerHeight,
  layerKind,
  layerYFromCentre,
  MAX_LAYERS,
  MAX_TEXT_LENGTH,
  newLayerId,
  STICKER_MAX_WIDTH,
  type CanvasKind,
  type CosmeticLayer,
} from "@/lib/cosmetic-layers";
import { cn } from "@/lib/utils";

/**
 * The editor both cosmetics are arranged in — avatar decorations and profile
 * stickers: a canvas with the real thing on it, the artwork listed beside it,
 * and a few controls for whichever piece is selected.
 *
 * ## Shape of the thing
 *
 * One canvas, one stage. A decoration is worn on an avatar, which is a square
 * at every size; a sticker is stuck on a profile card, which is the same width
 * at every height. Placement is stored in percentages of the stage's width (see
 * src/lib/cosmetic-layers.ts), so one arrangement is right wherever it is drawn
 * and there is nothing to place twice.
 *
 * The canvas has edges. Everything that can move a layer — dragging, the
 * handles, the keyboard, the sliders — holds it inside them (`confineLayer`),
 * so artwork cannot end up three screens from the thing it decorates, and a
 * sticker cannot be a frame.
 *
 * ## Editing is local, saving is not
 *
 * Everything here works on a draft. A drag fires per pointer move, and a
 * mutation per pointer move is a write per pixel — so the canvas edits the draft
 * and only a finished gesture is saved. The draft is re-seeded whenever the
 * stored value changes underneath, which is what makes an edit from another
 * window land.
 */

/** Room round the canvas inside its viewport, in px, so handles and the
 * toolbar at its edges are never against the frame. */
const VIEWPORT_PAD = 48;

/** Fit-to-window is capped, so a small canvas isn't blown up past the point
 * where the artwork is mush: an avatar can go big, a card cannot. */
const MAX_FIT: Record<CanvasKind, number> = { decoration: 5, sticker: 2 };

const HISTORY_LIMIT = 50;

/** The narrowest a layer can be made with the size slider, in percent of the
 * stage's width. */
const MIN_SIZE = 4;

export interface StageSize {
  /** Width of the stage in CSS pixels at zoom 1 — the ruler every layer's
   * percentage geometry is a percentage of. */
  width: number;
  height: number;
}

export function LayerEditor({
  layers: stored,
  onSave,
  renderStage,
  stage,
  kind,
  upload,
  uploadHint,
  presets,
  previewOptions,
  resolveSrc = (url) => url,
  className,
}: {
  layers: CosmeticLayer[];
  onSave: (layers: CosmeticLayer[]) => void | Promise<unknown>;
  /** The thing being decorated, drawn at the stage's width and height. */
  renderStage: (stage: StageSize) => React.ReactNode;
  stage: StageSize;
  /** What is being decorated, which decides where the canvas ends. */
  kind: CanvasKind;
  /** Puts a picked file in storage and hands back what a layer needs. */
  upload: (file: File) => Promise<{ url: string; storageId?: string }>;
  uploadHint: string;
  /** Artwork that needs no upload — the built-in decoration presets. Their
   * `url` is the *stored* form (a preset key), which is what a layer keeps. */
  presets?: { label: string; url: string }[];
  /** Controls for what the backdrop shows — the sticker editor's "show the
   * badges / roles / …" switches. Owned by the caller because the same state
   * also drives what `renderStage` draws. */
  previewOptions?: React.ReactNode;
  /** A stored url to the picture to draw for it. Only the decoration editor
   * needs one, because only decorations have artwork that isn't a file. */
  resolveSrc?: (url: string) => string;
  className?: string;
}) {
  const [draft, setDraft] = useState<CosmeticLayer[]>(stored);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** Zoom relative to "fits the window" — 1 is the whole canvas in view. */
  const [userZoom, setUserZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<{ w: number; h: number } | null>(null);

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

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setViewport({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  /** Artwork proportions, so a layer that keeps its own shape can be given
   * handles that sit on it. Filled in as the files load. */
  const [ratios, setRatios] = useState<Record<string, number>>({});
  useEffect(() => {
    for (const layer of draft) {
      if (layerKind(layer) !== "image" || !layer.url || ratios[layer.url]) continue;
      const image = new Image();
      image.onload = () => {
        if (!image.naturalHeight) return;
        setRatios((prev) => ({ ...prev, [layer.url]: image.naturalWidth / image.naturalHeight }));
      };
      image.src = resolveSrc(layer.url);
    }
  }, [draft, ratios, resolveSrc]);

  const stageHeightPercent = (stage.height / stage.width) * 100;

  const heightOf = useCallback(
    (layer: CosmeticLayer) => layerHeight(layer, ratios[layer.url], stageHeightPercent),
    [ratios, stageHeightPercent],
  );

  /** Every layer held inside the canvas. Everything below goes through this on
   * the way into the draft, so the canvas's edges hold for whichever control
   * did the moving. */
  const confineAll = useCallback(
    (list: CosmeticLayer[]) =>
      list.map((layer) => confineLayer(layer, kind, stageHeightPercent, heightOf)),
    [heightOf, kind, stageHeightPercent],
  );

  // --- Zoom ------------------------------------------------------------------

  const bounds = canvasBounds(kind, stageHeightPercent);
  const boundsWidth = ((bounds.maxX - bounds.minX) / 100) * stage.width;
  const boundsHeight = ((bounds.maxY - bounds.minY) / 100) * stage.width;
  const fit = viewport
    ? Math.max(
        0.3,
        Math.min(
          (viewport.w - VIEWPORT_PAD * 2) / boundsWidth,
          (viewport.h - VIEWPORT_PAD * 2) / boundsHeight,
          MAX_FIT[kind],
        ),
      )
    : 1;
  const zoom = fit * userZoom;

  const zoomBy = (factor: number) =>
    setUserZoom((z) => Math.min(6, Math.max(0.4, Math.round(z * factor * 100) / 100)));
  const resetView = () => {
    setUserZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // --- History and saving ----------------------------------------------------

  const history = useRef<{ past: CosmeticLayer[][]; future: CosmeticLayer[][] }>({
    past: [],
    future: [],
  });
  const [historyVersion, setHistoryVersion] = useState(0);

  const save = useCallback(
    (next: CosmeticLayer[]) => {
      setSaving((n) => n + 1);
      void Promise.resolve(onSave(next))
        .catch((err) => setError(err instanceof Error ? err.message : "Couldn't save that."))
        .finally(() => setSaving((n) => n - 1));
    },
    [onSave],
  );

  const commit = useCallback(
    (raw: CosmeticLayer[]) => {
      const next = confineAll(raw);
      history.current.past.push(draft);
      if (history.current.past.length > HISTORY_LIMIT) history.current.past.shift();
      history.current.future = [];
      setHistoryVersion((v) => v + 1);
      setDraft(next);
      save(next);
    },
    [confineAll, draft, save],
  );

  const undo = useCallback(() => {
    const previous = history.current.past.pop();
    if (!previous) return;
    history.current.future.push(draft);
    setHistoryVersion((v) => v + 1);
    setDraft(previous);
    save(previous);
  }, [draft, save]);

  const redo = useCallback(() => {
    const next = history.current.future.pop();
    if (!next) return;
    history.current.past.push(draft);
    setHistoryVersion((v) => v + 1);
    setDraft(next);
    save(next);
  }, [draft, save]);

  const canUndo = history.current.past.length > 0 && historyVersion >= 0;
  const canRedo = history.current.future.length > 0 && historyVersion >= 0;

  const deleteLayers = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      commit(draft.filter((layer) => !ids.includes(layer.id)));
      setSelectedIds([]);
    },
    [commit, draft],
  );

  const duplicateLayers = useCallback(
    (ids: string[]) => {
      const chosen = draft.filter((layer) => ids.includes(layer.id));
      if (chosen.length === 0) return;
      if (draft.length + chosen.length > MAX_LAYERS) {
        setError(`That's the most one of these can hold (${MAX_LAYERS}).`);
        return;
      }
      const copies = chosen.map((layer) => ({
        ...layer,
        id: newLayerId(),
        x: layer.x + 4,
        y: layer.y + 4,
      }));
      commit([...draft, ...copies]);
      setSelectedIds(copies.map((copy) => copy.id));
    },
    [commit, draft],
  );

  const move = (id: string, direction: -1 | 1) => {
    const index = draft.findIndex((layer) => layer.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= draft.length) return;
    const next = [...draft];
    const [layer] = next.splice(index, 1);
    next.splice(target, 0, layer!);
    commit(next);
  };

  // --- Adding ----------------------------------------------------------------

  /** Put a new layer where new layers go, and select it so its controls are
   * what's next to it. Nudged by how many are already there, so adding three
   * of the same thing doesn't stack them exactly. */
  const addLayerObject = (layer: CosmeticLayer) => {
    if (draft.length >= MAX_LAYERS) {
      setError(`That's the most one of these can hold (${MAX_LAYERS}).`);
      return;
    }
    const offset = (draft.length % 4) * 3;
    const placed: CosmeticLayer =
      kind === "sticker"
        ? {
            ...layer,
            anchor: "top",
            x: 50 + offset,
            // A third of the way down: where a sticker reads as a sticker on a
            // card, not as something stuck over its name.
            y: stageHeightPercent * 0.3 + offset,
          }
        : { ...layer, anchor: "center", x: 50 + offset, y: offset };
    commit([...draft, placed]);
    setSelectedIds([placed.id]);
  };

  const addImage = (url: string, storageId?: string, width = kind === "sticker" ? 36 : 100) =>
    addLayerObject({ id: newLayerId(), url, storageId, anchor: "center", x: 50, y: 0, width });

  const pickFiles = async (files: File[] | FileList | null) => {
    const list = files ? Array.from(files) : [];
    if (list.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const room = MAX_LAYERS - draft.length;
      const chosen = list.slice(0, Math.max(0, room));
      // Uploaded one at a time and added as a batch: adding them one by one
      // would save between each, and a half-uploaded set is not an arrangement
      // anybody meant to keep.
      const added: CosmeticLayer[] = [];
      for (const [index, file] of chosen.entries()) {
        const { url, storageId } = await upload(file);
        const offset = ((draft.length + index) % 4) * 3;
        added.push(
          kind === "sticker"
            ? {
                id: newLayerId(),
                url,
                storageId,
                anchor: "top",
                x: 50 + offset,
                y: stageHeightPercent * 0.3 + offset,
                width: 36,
              }
            : {
                id: newLayerId(),
                url,
                storageId,
                anchor: "center",
                x: 50 + offset,
                y: offset,
                width: 100,
              },
        );
      }
      if (added.length > 0) {
        commit([...draft, ...added]);
        setSelectedIds([added[added.length - 1]!.id]);
      }
      if (chosen.length < list.length) {
        setError(`Only ${chosen.length} of those fitted — ${MAX_LAYERS} is the limit.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "That upload didn't work.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // --- Editing the selected layer ---------------------------------------------

  const selected =
    selectedIds.length === 1 ? (draft.find((layer) => layer.id === selectedIds[0]) ?? null) : null;

  /** A slider fires per pixel of travel, so the two are separate: the draft
   * follows the drag, and only the release is worth a write. */
  const patchLive = (id: string, patch: (layer: CosmeticLayer) => Partial<CosmeticLayer>) =>
    setDraft((prev) => confineAll(prev.map((l) => (l.id === id ? { ...l, ...patch(l) } : l))));
  const patchSaved = (id: string, patch: (layer: CosmeticLayer) => Partial<CosmeticLayer>) =>
    commit(draft.map((l) => (l.id === id ? { ...l, ...patch(l) } : l)));

  const maxSize = kind === "sticker" ? STICKER_MAX_WIDTH : bounds.maxX - bounds.minX;

  /** Resizing by width carries the rest of the layer's size with it, in the
   * shape it had: an explicit height, and the type size of a text layer. */
  const resized = (layer: CosmeticLayer, width: number): Partial<CosmeticLayer> => {
    const factor = width / Math.max(layer.width, 0.0001);
    return {
      width,
      height: layer.height === undefined ? undefined : layer.height * factor,
      fontSize: layer.fontSize === undefined ? undefined : layer.fontSize * factor,
    };
  };

  const centreLayer = (layer: CosmeticLayer) => {
    patchSaved(layer.id, (l) => ({
      x: 50,
      // An avatar is as tall as it is wide, so centred means centred both ways;
      // a card is not, and a sticker only centres across it.
      ...(kind === "decoration"
        ? { y: layerYFromCentre(l.anchor, 50, stageHeightPercent) }
        : {}),
    }));
  };

  const emptyState = (
    <div className="flex w-[22rem] max-w-full flex-col items-center gap-3 rounded-xl border border-dashed border-primary/40 bg-background/80 p-5 text-center shadow-lg backdrop-blur">
      <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
        <ImagePlus className="size-5" />
      </span>
      <div className="space-y-0.5">
        <p className="text-sm font-medium">
          {kind === "sticker" ? "Stick something on your card" : "Decorate your avatar"}
        </p>
        <p className="text-xs text-muted-foreground">
          Drop an image anywhere on the canvas, or choose one.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
          Choose images
        </Button>
        <Button size="sm" variant="outline" onClick={() => addLayerObject(defaultTextLayer())}>
          <Type className="size-4" />
          Add text
        </Button>
      </div>
      {presets && presets.length > 0 && (
        <div className="flex flex-col items-center gap-1.5">
          <p className="text-[11px] text-muted-foreground">or start from a built-in</p>
          <div className="flex gap-1">
            {presets.map((preset) => (
              <button
                key={preset.url}
                type="button"
                title={preset.label}
                onClick={() => addImage(preset.url)}
                className="size-10 rounded-md border border-border/60 bg-background/60 p-1 transition-colors hover:border-primary hover:bg-accent/40"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
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
    </div>
  );

  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          {/* The toolbar: adding things on the left, looking at them on the
              right. */}
          <div className="flex flex-wrap items-center gap-1.5">
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
              disabled={busy || draft.length >= MAX_LAYERS}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
              Add image
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={draft.length >= MAX_LAYERS}
              onClick={() => addLayerObject(defaultTextLayer())}
            >
              <Type className="size-4" />
              Text
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={draft.length >= MAX_LAYERS}
              onClick={() => addLayerObject(defaultShapeLayer("rect"))}
            >
              <Square className="size-4" />
              Shape
            </Button>
            {presets && presets.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" size="sm" variant="outline" disabled={draft.length >= MAX_LAYERS}>
                    <Shapes className="size-4" />
                    Built in
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-2">
                  <div className="flex gap-1">
                    {presets.map((preset) => (
                      <button
                        key={preset.url}
                        type="button"
                        title={preset.label}
                        onClick={() => addImage(preset.url)}
                        className="size-12 rounded-md border border-border/60 p-1.5 transition-colors hover:border-primary hover:bg-accent/40"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={resolveSrc(preset.url)}
                          alt={preset.label}
                          className="size-full object-contain"
                          draggable={false}
                        />
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            )}

            <div className="ml-auto flex items-center gap-1">
              <IconButton title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
                <Undo2 className="size-3.5" />
              </IconButton>
              <IconButton title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
                <Redo2 className="size-3.5" />
              </IconButton>
              <span aria-hidden className="mx-1 h-4 w-px bg-border" />
              <IconButton title="Zoom out" onClick={() => zoomBy(1 / 1.25)}>
                <Minus className="size-3.5" />
              </IconButton>
              <span className="w-11 text-center text-xs tabular-nums text-muted-foreground">
                {Math.round(userZoom * 100)}%
              </span>
              <IconButton title="Zoom in" onClick={() => zoomBy(1.25)}>
                <Plus className="size-3.5" />
              </IconButton>
              <IconButton
                title="Fit the canvas to the window"
                disabled={userZoom === 1 && pan.x === 0 && pan.y === 0}
                onClick={resetView}
              >
                <Maximize className="size-3.5" />
              </IconButton>
              {previewOptions && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button type="button" size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs">
                      <Eye className="size-3.5" />
                      Preview
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-56">
                    <p className="mb-2 text-xs font-medium">Show on the card</p>
                    {previewOptions}
                  </PopoverContent>
                </Popover>
              )}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    title="Shortcuts"
                    aria-label="Shortcuts"
                  >
                    <HelpCircle className="size-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64 text-xs">
                  <Shortcuts />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* The canvas fills what's left. It is measured, so "fit" means fit
              this window rather than a size picked in advance. */}
          <div ref={viewportRef} className="min-h-0 flex-1">
            <LayerCanvas
              className="size-full"
              layers={draft}
              stage={stage}
              kind={kind}
              selectedIds={selectedIds}
              onSelect={setSelectedIds}
              onChange={setDraft}
              onCommit={commit}
              onDelete={deleteLayers}
              onDuplicate={duplicateLayers}
              onReorder={move}
              onUndo={undo}
              onRedo={redo}
              ratios={ratios}
              variant={DEFAULT_VARIANT}
              zoom={zoom}
              onZoomChange={(next) => setUserZoom(Math.min(6, Math.max(0.4, next / fit)))}
              pan={pan}
              onPanChange={setPan}
              resolveSrc={resolveSrc}
              onFiles={(files) => void pickFiles(files)}
              emptyState={emptyState}
            >
              {renderStage(stage)}
            </LayerCanvas>
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-[11px] text-muted-foreground">{uploadHint}</p>
            <span
              className={cn(
                "flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground transition-opacity",
                draft.length === 0 && saving === 0 && "opacity-0",
              )}
            >
              {saving > 0 ? (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Check className="size-3 text-emerald-500" />
                  Saved
                </>
              )}
            </span>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        {/* The side panel: what's on the canvas, and what can be done to the
            selected piece of it. */}
        <ScrollArea className="w-60 shrink-0">
          <div className="flex flex-col gap-4 pr-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Layers</Label>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {draft.length}/{MAX_LAYERS}
                </span>
              </div>
              {draft.length === 0 ? (
                <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                  Nothing here yet.
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {/* Reversed: the last layer is drawn on top, and a list that
                      reads top-down should say so. */}
                  {[...draft].reverse().map((layer, index) => (
                    <LayerRow
                      key={layer.id}
                      layer={layer}
                      label={layerLabel(layer, draft.length - index)}
                      selected={selectedIds.includes(layer.id)}
                      resolveSrc={resolveSrc}
                      onSelect={(additive) =>
                        setSelectedIds((prev) =>
                          additive
                            ? prev.includes(layer.id)
                              ? prev.filter((id) => id !== layer.id)
                              : [...prev, layer.id]
                            : [layer.id],
                        )
                      }
                      onForward={() => move(layer.id, 1)}
                      onBackward={() => move(layer.id, -1)}
                      onDelete={() => deleteLayers([layer.id])}
                    />
                  ))}
                </div>
              )}
            </div>

            {selected ? (
              <Inspector
                layer={selected}
                kind={kind}
                maxSize={maxSize}
                onLive={(patch) => patchLive(selected.id, patch)}
                onSaved={(patch) => patchSaved(selected.id, patch)}
                resized={resized}
                onCentre={() => centreLayer(selected)}
                onDuplicate={() => duplicateLayers([selected.id])}
                onRemove={() => deleteLayers([selected.id])}
                centreY={layerCentreY(selected, stageHeightPercent)}
              />
            ) : draft.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Select something on the canvas, or in the list, to change it.
              </p>
            ) : null}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

/** A name for a layer in the list: what it says, what shape it is, or which
 * picture. */
function layerLabel(layer: CosmeticLayer, position: number): string {
  const kind = layerKind(layer);
  if (kind === "text") return (layer.text ?? "").trim().slice(0, 24) || "Text";
  if (kind === "shape") return layer.shape === "ellipse" ? "Ellipse" : "Rectangle";
  return `Image ${position}`;
}

function IconButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="size-7"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function Shortcuts() {
  const rows: [string, string][] = [
    ["Move", "Drag, or arrow keys (Shift for 10×)"],
    ["Resize", "Drag a corner, or A / D"],
    ["Turn", "Drag the round handle, or Q / E"],
    ["Select several", "Shift-click"],
    ["Duplicate", "Ctrl/Cmd + D"],
    ["Delete", "Delete"],
    ["Undo / redo", "Ctrl/Cmd + Z / Shift + Z"],
    ["Zoom", "Ctrl/Cmd + scroll"],
    ["Pan", "Scroll, or hold Space and drag"],
    ["No snapping", "Hold Shift while dragging"],
  ];
  return (
    <dl className="space-y-1.5">
      {rows.map(([name, how]) => (
        <div key={name} className="flex justify-between gap-3">
          <dt className="font-medium">{name}</dt>
          <dd className="text-right text-muted-foreground">{how}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One layer in the list. */
function LayerRow({
  layer,
  label,
  selected,
  resolveSrc,
  onSelect,
  onForward,
  onBackward,
  onDelete,
}: {
  layer: CosmeticLayer;
  label: string;
  selected: boolean;
  resolveSrc: (url: string) => string;
  onSelect: (additive: boolean) => void;
  onForward: () => void;
  onBackward: () => void;
  onDelete: () => void;
}) {
  const kind = layerKind(layer);
  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 rounded-lg border p-1 transition-colors",
        selected ? "border-primary bg-accent/60" : "border-transparent hover:bg-accent/40",
      )}
    >
      <button
        type="button"
        onClick={(event) => onSelect(event.shiftKey || event.ctrlKey || event.metaKey)}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        {/* A thumbnail of the thing itself rather than of its file: a text layer
            has no file, and "Aa" in the right colour identifies it faster than a
            name would. */}
        <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[repeating-conic-gradient(#0000_0_25%,#ffffff12_0_50%)] bg-[length:8px_8px]">
          {kind === "text" ? (
            <span
              className="text-[11px] font-bold leading-none"
              style={{ color: layer.color ?? "#ffffff" }}
            >
              Aa
            </span>
          ) : kind === "shape" ? (
            <span
              className="size-4"
              style={{
                background: layer.color ?? "#ffffff",
                borderRadius: layer.shape === "ellipse" ? "50%" : 2,
              }}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={resolveSrc(layer.url)}
              alt=""
              className="size-full object-contain"
              draggable={false}
            />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs">{label}</span>
      </button>
      <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          title="Bring forward"
          className="rounded p-1 text-muted-foreground hover:text-foreground"
          onClick={onForward}
        >
          <ArrowUp className="size-3" />
        </button>
        <button
          type="button"
          title="Send backward"
          className="rounded p-1 text-muted-foreground hover:text-foreground"
          onClick={onBackward}
        >
          <ArrowDown className="size-3" />
        </button>
        <button
          type="button"
          title="Delete"
          className="rounded p-1 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="size-3" />
        </button>
      </div>
    </div>
  );
}

/**
 * The few controls behind the selected layer.
 *
 * Everything position-related is on the canvas — dragging, the handles, the
 * keyboard — so what is here is what a drag can't say: an exact size, a turn,
 * how faded, and the parts that belong to one kind of layer (the words of a
 * text, the colour of a shape).
 */
function Inspector({
  layer,
  kind,
  maxSize,
  centreY,
  resized,
  onLive,
  onSaved,
  onCentre,
  onDuplicate,
  onRemove,
}: {
  layer: CosmeticLayer;
  kind: CanvasKind;
  maxSize: number;
  centreY: number;
  resized: (layer: CosmeticLayer, width: number) => Partial<CosmeticLayer>;
  /** Live, for a slider mid-drag. */
  onLive: (patch: (layer: CosmeticLayer) => Partial<CosmeticLayer>) => void;
  /** Saved, for the release and for everything that is one click. */
  onSaved: (patch: (layer: CosmeticLayer) => Partial<CosmeticLayer>) => void;
  onCentre: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const layerType = layerKind(layer);
  void centreY;

  return (
    <div className="space-y-3 border-t border-border/50 pt-3">
      <Label className="text-xs">
        {layerType === "text" ? "Text" : layerType === "shape" ? "Shape" : "Image"}
      </Label>

      {layerType === "text" && (
        <div className="space-y-2">
          <textarea
            value={layer.text ?? ""}
            maxLength={MAX_TEXT_LENGTH}
            rows={2}
            aria-label="Words"
            onChange={(event) => onLive(() => ({ text: event.target.value }))}
            // Typed live and saved on the way out: a mutation per keystroke is a
            // write per letter.
            onBlur={(event) => onSaved(() => ({ text: event.target.value }))}
            className="w-full resize-none rounded-md border border-border/60 bg-background px-2 py-1 text-xs outline-none focus-visible:border-ring"
          />
          <div className="grid grid-cols-4 gap-1">
            {[400, 600, 700, 900].map((weight) => (
              <Button
                key={weight}
                type="button"
                size="sm"
                variant={(layer.fontWeight ?? 700) === weight ? "secondary" : "ghost"}
                className="h-7 px-1 text-[11px]"
                style={{ fontWeight: weight }}
                onClick={() => onSaved(() => ({ fontWeight: weight }))}
              >
                Aa
              </Button>
            ))}
          </div>
        </div>
      )}

      {layerType === "shape" && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-1">
            {(["rect", "ellipse"] as const).map((shape) => (
              <Button
                key={shape}
                type="button"
                size="sm"
                variant={(layer.shape ?? "rect") === shape ? "secondary" : "ghost"}
                className="h-7 px-1 text-[11px]"
                onClick={() => onSaved(() => ({ shape }))}
              >
                {shape === "rect" ? "Rectangle" : "Ellipse"}
              </Button>
            ))}
          </div>
          {(layer.shape ?? "rect") === "rect" && (
            <SliderRow
              label="Corners"
              value={layer.radius ?? 0}
              min={0}
              max={50}
              suffix="%"
              onChange={(radius) => onLive(() => ({ radius }))}
              onCommit={(radius) => onSaved(() => ({ radius }))}
            />
          )}
        </div>
      )}

      {layerType !== "image" && (
        <div className="space-y-2">
          <ColorRow
            label={layerType === "text" ? "Colour" : "Fill"}
            value={layer.color ?? "#ffffff"}
            onChange={(color) => onSaved(() => ({ color }))}
          />
          <ColorRow
            label="Outline"
            value={layer.strokeColor}
            onChange={(strokeColor) =>
              onSaved((l) => ({
                strokeColor,
                // An outline with no width is an outline nobody can see, so
                // turning one on gives it something to draw.
                strokeWidth: strokeColor ? l.strokeWidth || 0.5 : undefined,
              }))
            }
          />
        </div>
      )}

      <SliderRow
        label="Size"
        value={Math.round(layer.width)}
        min={MIN_SIZE}
        max={Math.round(maxSize)}
        suffix="%"
        onChange={(width) => onLive((l) => resized(l, width))}
        onCommit={(width) => onSaved((l) => resized(l, width))}
      />
      <SliderRow
        label="Turn"
        value={Math.round(layer.rotation ?? 0)}
        min={-180}
        max={180}
        suffix="°"
        onChange={(rotation) => onLive(() => ({ rotation: rotation || undefined }))}
        onCommit={(rotation) => onSaved(() => ({ rotation: rotation || undefined }))}
      />
      <SliderRow
        label="Opacity"
        value={Math.round((layer.opacity ?? 1) * 100)}
        min={10}
        max={100}
        suffix="%"
        onChange={(value) => onLive(() => ({ opacity: value >= 100 ? undefined : value / 100 }))}
        onCommit={(value) => onSaved(() => ({ opacity: value >= 100 ? undefined : value / 100 }))}
      />

      <div className="flex flex-wrap gap-1">
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={onCentre}>
          {kind === "decoration" ? "Centre on avatar" : "Centre across"}
        </Button>
        {(layer.rotation ?? 0) !== 0 && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={() => onSaved(() => ({ rotation: undefined }))}
          >
            Straighten
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={onDuplicate}>
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

/** A labelled slider with its value alongside. */
function SliderRow({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {value}
          {suffix}
        </span>
      </div>
      <Slider
        value={[Math.min(max, Math.max(min, value))]}
        min={min}
        max={max}
        step={1}
        onValueChange={([next]) => onChange(next ?? value)}
        onValueCommit={([next]) => onCommit(next ?? value)}
      />
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
