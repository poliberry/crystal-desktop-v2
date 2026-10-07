"use client";

import { useMemo, useState } from "react";

import { ScenePropView } from "@/components/lounge/lounge-props";
import { SceneBackground } from "@/components/lounge/scene-background";
import { LayerContent } from "@/components/profile/layer-content";
import { layerStyle, type CosmeticLayer } from "@/lib/cosmetic-layers";
import { compileLayers, compileScene } from "@/studio/model/compile";
import { nodesInOrder } from "@/studio/model/doc";
import type { Doc, ImageNode } from "@/studio/model/types";
import type { LoadedAsset } from "@/studio/storage/assets";
import { cn } from "@/lib/utils";

/**
 * Cosmetics are previewed by the same two functions the app draws them with —
 * `layerStyle` for where a layer goes and `LayerContent` for what is in it — so
 * what is shown here is what a buyer gets, not a second opinion about it.
 * (The avatar component itself refuses pictures that aren't on the web, which
 * unsubmitted artwork isn't, so it is bypassed for the address only.)
 */
function Layers({ layers }: { layers: CosmeticLayer[] }) {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 [container-type:size]">
      {layers.map((layer) => (
        <span key={layer.id} className="absolute" style={layerStyle(layer)}>
          <LayerContent layer={layer} />
        </span>
      ))}
    </span>
  );
}

function Initials({ name }: { name: string }) {
  return <span className="flex size-full items-center justify-center bg-neutral-600 text-[0.4em] font-semibold text-white">{name.slice(0, 2).toUpperCase()}</span>;
}

function DecorationPreview({ layers, avatarUrl, name }: { layers: CosmeticLayer[]; avatarUrl?: string; name: string }) {
  const sizes = [
    { px: 128, label: "Profile" },
    { px: 64, label: "Message" },
    { px: 40, label: "Member list" },
    { px: 28, label: "Call" },
  ];
  return (
    <div className="space-y-4 p-4">
      {sizes.map(({ px, label }) => (
        <div key={label} className="flex items-center gap-4">
          <div className="relative shrink-0" style={{ width: px, height: px }}>
            <div className="size-full overflow-hidden rounded-full" style={{ fontSize: px }}>
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="" className="size-full object-cover" />
              ) : (
                <Initials name={name} />
              )}
            </div>
            <Layers layers={layers} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium">{label}</p>
            <p className="text-[11px] text-muted-foreground">{px}px</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function StickerPreview({ layers, avatarUrl, name, doc }: { layers: CosmeticLayer[]; avatarUrl?: string; name: string; doc: Doc }) {
  const [width, setWidth] = useState<"card" | "wide">("card");
  const w = width === "card" ? 288 : 360;
  const h = (w * doc.artboard.h) / doc.artboard.w;
  return (
    <div className="space-y-3 p-4">
      <div className="flex gap-1">
        {(["card", "wide"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setWidth(k)} className={cn("rounded-md border px-2.5 py-1 text-xs", width === k ? "border-primary bg-primary/10" : "border-border text-muted-foreground")}>
            {k === "card" ? "Popover" : "Profile page"}
          </button>
        ))}
      </div>
      <div className="relative mx-auto overflow-visible rounded-2xl bg-neutral-800" style={{ width: w, height: h }}>
        <div className="h-[28%] overflow-hidden rounded-t-2xl bg-gradient-to-br from-violet-500/50 to-sky-500/40" />
        <div className="absolute overflow-hidden rounded-full border-4 border-neutral-800 bg-neutral-600" style={{ left: 18, top: h * 0.28 - 34, width: 68, height: 68 }}>
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="size-full object-cover" />
          ) : (
            <Initials name={name} />
          )}
        </div>
        <div className="absolute space-y-1.5" style={{ left: 18, top: h * 0.28 + 44 }}>
          <p className="text-sm font-semibold text-white">{name}</p>
          <div className="h-2 w-24 rounded bg-white/25" />
        </div>
        <Layers layers={layers} />
      </div>
    </div>
  );
}

function ScenePreview({ doc, assets, name, avatarUrl }: { doc: Doc; assets: Map<string, LoadedAsset>; name: string; avatarUrl?: string }) {
  const [sharing, setSharing] = useState(false);
  const spec = useMemo(() => {
    const bg = nodesInOrder(doc).find((n): n is ImageNode => n.type === "image" && n.role === "background");
    return compileScene(doc, name, bg ? (assets.get(bg.assetId)?.url ?? "") : "");
  }, [doc, assets, name]);
  const bgNode = nodesInOrder(doc).find((n): n is ImageNode => n.type === "image" && n.role === "background");
  const bgIsVideo = !!bgNode && !!assets.get(bgNode.assetId)?.type.startsWith("video/");
  const dim = spec.lights.dimOnShare && sharing;
  const people = spec.seats.slice(0, 5);

  return (
    <div className="space-y-3 p-4">
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={sharing} onChange={(e) => setSharing(e.target.checked)} /> Someone is sharing their screen
      </label>
      <div className="relative w-full overflow-hidden rounded-xl bg-neutral-900 shadow-lg" style={{ aspectRatio: "16 / 9", containerType: "inline-size" }}>
        {spec.backgroundUrl && (
          <div className="absolute inset-0">
            <SceneBackground url={spec.backgroundUrl} video={bgIsVideo} />
          </div>
        )}
        <div className="absolute inset-0 bg-[#05030a] transition-opacity duration-1000" style={{ opacity: dim ? spec.lights.amount : 0 }} />
        <div
          className="absolute overflow-hidden rounded-[0.3cqw] bg-black"
          style={{ left: `${spec.screen.x}%`, top: `${spec.screen.y}%`, width: `${spec.screen.w}%`, height: `${spec.screen.h}%` }}
        >
          <div className={cn("flex size-full items-center justify-center text-[1.6cqw] text-white/70", sharing ? "bg-gradient-to-br from-indigo-700 via-fuchsia-600 to-orange-400" : "bg-neutral-950")}>
            {sharing ? "Live" : "No signal"}
          </div>
        </div>
        {spec.props.map((p) => (
          <ScenePropView key={p.id} prop={p} on={p.on} onToggle={() => {}} disabled />
        ))}
        {people.map((s, i) => {
          const depth = Math.min(1, Math.max(0, (s.y - spec.floorTop) / (100 - spec.floorTop)));
          const size = 3.3 + depth * 1.5;
          return (
            <div key={i} className="absolute overflow-hidden rounded-[24%] bg-indigo-500 shadow-lg" style={{ left: `${s.x}%`, top: `${s.y}%`, width: `${size}cqw`, aspectRatio: "1", transform: "translate(-50%, -88%)", zIndex: Math.round(s.y * 10) + 5 }}>
              {i === 0 && avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="" className="size-full object-cover" />
              ) : null}
            </div>
          );
        })}
        <div className="pointer-events-none absolute inset-x-0 h-px bg-amber-400/30" style={{ top: `${spec.floorTop}%` }} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        People shown sitting in the first {people.length} seats, at the size they are in a real lounge. The amber line is where walking starts.
      </p>
    </div>
  );
}

export function PreviewPanel({ doc, assets, avatarUrl, name }: { doc: Doc; assets: Map<string, LoadedAsset>; avatarUrl?: string; name: string }) {
  const layers = useMemo(
    () =>
      doc.kind === "scene"
        ? []
        : (compileLayers(doc, (id) => assets.get(id)?.url) as unknown as CosmeticLayer[]).filter((l) => (l.kind && l.kind !== "image") || l.url),
    [doc, assets],
  );
  if (doc.kind === "decoration") return <DecorationPreview layers={layers} avatarUrl={avatarUrl} name={name} />;
  if (doc.kind === "sticker") return <StickerPreview layers={layers} avatarUrl={avatarUrl} name={name} doc={doc} />;
  return <ScenePreview doc={doc} assets={assets} name={name || "Scene"} avatarUrl={avatarUrl} />;
}
