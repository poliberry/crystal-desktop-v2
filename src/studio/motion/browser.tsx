"use client";

import { CloudDownload, Check, ImagePlus, Layers, Loader2, Plus, Sparkles, Type, Wand2, Waves } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { MOTION_LIMITS, allClips, introLength, newClip, type Clip } from "../../../convex/lib/motion";
import { artworkNodes, isLayerClip, layerBox } from "@/studio/model/motion-doc";
import type { Doc } from "@/studio/model/types";
import type { LoadedAsset } from "@/studio/storage/assets";
import { EFFECTS, EFFECT_GROUPS, GENERATORS, GENERATOR_GROUPS, TITLES, TRANSITIONS, clipFromGenerator, clipFromTitle, newTransition } from "@/studio/motion/library";
import { addClip, setTransition, snapFrame } from "@/studio/motion/ops";
import { LIBRARY_FOLDER, type EffectCatalogEntry } from "../../../convex/lib/effectLibrary";
import { cdnBaseUrl } from "@/lib/cdn";
import { LibraryError, downloadEffect, downloadedIds, fetchCatalog, fetchEffectClips, libraryBase, removeDownload, withDownloads } from "@/studio/motion/effect-library-client";
import type { MotionEditor } from "@/studio/motion/use-motion-editor";
import { cn } from "@/lib/utils";

type Tab = "generators" | "library" | "titles" | "effects" | "transitions" | "layers" | "pictures";

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "generators", label: "Generators", icon: Sparkles },
  { id: "library", label: "Library", icon: CloudDownload },
  { id: "titles", label: "Titles", icon: Type },
  { id: "effects", label: "Effects", icon: Wand2 },
  { id: "transitions", label: "Transitions", icon: Waves },
  { id: "layers", label: "Canvas", icon: Layers },
  { id: "pictures", label: "Pictures", icon: ImagePlus },
];

const tile = "flex h-8 items-center justify-between gap-1 rounded-[3px] border border-white/10 bg-white/[0.04] px-2 text-left text-[11px] text-[var(--ai-text)] hover:border-white/30 hover:bg-white/10 disabled:opacity-40";

/**
 * Where new things come from, as Final Cut's Browser and Effects browser are: generators and titles become clips at the
 * playhead, effects and transitions are applied to what is selected, and the project's own artwork and pictures can be put
 * on the timeline.
 */
export function Browser({ editor, doc, assets, say }: { editor: MotionEditor; doc: Doc; assets: Map<string, LoadedAsset>; say: (m: string) => void }) {
  const [tab, setTab] = useState<Tab>("generators");

  // The effect library: published to the CDN, with the same files served by the app itself as a fallback (see
  // scripts/prepare-studio-assets.mjs), so it works offline and before it is published.
  type Lib = { status: "idle" | "loading" | "ready" | "error"; catalog?: EffectCatalogEntry[]; base?: string; error?: string };
  const [lib, setLib] = useState<Lib>({ status: "idle" });
  const [have, setHave] = useState<Set<string>>(() => downloadedIds());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [group, setGroup] = useState<string>("All");
  const loadLibrary = async () => {
    setLib({ status: "loading" });
    const bases = [libraryBase(cdnBaseUrl()), `/${LIBRARY_FOLDER}`].filter((b): b is string => !!b);
    let last: unknown = null;
    for (const base of bases) {
      try {
        const catalog = await fetchCatalog(base);
        setLib({ status: "ready", catalog: catalog.effects, base });
        return;
      } catch (e) {
        last = e;
      }
    }
    setLib({ status: "error", error: last instanceof LibraryError ? last.message : "Couldn't load the library." });
  };
  useEffect(() => {
    if (tab === "library" && lib.status === "idle") void loadLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, lib.status]);
  const { spec, scope, selection, commit, commitClips, clock, setSelection, path } = editor;
  const stage = spec.stage;
  const total = allClips(spec.clips).length;
  const full = total >= MOTION_LIMITS.clips;

  /** Where a new clip goes: at the playhead, running to the end (at least half a second, at most `max`). */
  const place = (max = 3) => {
    let start = snapFrame(clock.value);
    if (scope.duration - start < 0.4) start = 0;
    return { start, duration: Math.max(0.1, Math.min(max, scope.duration - start)) };
  };
  const add = (c: Clip) => {
    if (full) return say(`A design has at most ${MOTION_LIMITS.clips} clips.`);
    // On top of everything already there, so what is added is seen: the search for a free lane starts at the highest one.
    commitClips((clips) => addClip(clips, { ...c, track: clips.length ? Math.max(...clips.map((x) => x.track)) : 0 }));
    setSelection([c.id]);
  };
  const selected = scope.clips.filter((c) => selection.includes(c.id));
  const needSelection = () => {
    if (selected.length === 0) {
      say("Select a clip on the timeline first.");
      return false;
    }
    return true;
  };

  // Layers on the canvas, and which of them are on the timeline.
  const onTimeline = useMemo(() => new Map(allClips(spec.clips).filter(isLayerClip).map((c) => [c.source.nodeId, c])), [spec]);
  const nodes = artworkNodes(doc);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="ai-edge-b flex shrink-0 flex-wrap gap-0.5 p-1">
        {TABS.map((tb) => (
          <button key={tb.id} type="button" aria-pressed={tab === tb.id} onClick={() => setTab(tb.id)} title={tb.label} className={cn("flex h-6 items-center gap-1 rounded px-1.5 text-[11px]", tab === tb.id ? "bg-white/15 text-foreground" : "text-[var(--ai-dim)] hover:text-foreground")}>
            <tb.icon className="size-3.5" /> {tb.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2">
        {tab === "generators" &&
          GENERATOR_GROUPS.map((g) => (
            <div key={g}>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--ai-dim)]">{g}</div>
              <div className="grid grid-cols-2 gap-1">
                {GENERATORS.filter((x) => x.group === g).map((x) => (
                  <button key={x.id} type="button" className={tile} disabled={full} title={`Add ${x.label} at the playhead`} onClick={() => { const p = place(); add(clipFromGenerator(x, stage, p.start, p.duration)); }}>
                    <span className="truncate">{x.label}</span><Plus className="size-3 shrink-0 text-[var(--ai-dim)]" />
                  </button>
                ))}
              </div>
            </div>
          ))}

        {tab === "library" && (
          <>
            {lib.status === "loading" && <p className="flex items-center gap-1.5 text-[11px] text-[var(--ai-dim)]"><Loader2 className="size-3 animate-spin" /> Loading the library…</p>}
            {lib.status === "error" && (
              <div className="space-y-1.5 text-[11px]">
                <p className="text-[var(--ai-dim)]">{lib.error}</p>
                <button type="button" className={tile} onClick={() => void loadLibrary()}>Try again</button>
              </div>
            )}
            {lib.status === "ready" && lib.catalog && lib.base && (() => {
              const base = lib.base;
              const forThis = lib.catalog.filter((e) => e.kinds.includes(spec.kind));
              const groups = ["All", ...new Set(forThis.map((e) => e.group))];
              const shown = forThis.filter((e) => group === "All" || e.group === group);
              const fetcher = withDownloads(fetch);
              const addEffect = async (e: EffectCatalogEntry) => {
                if (full) return say(`A design has at most ${MOTION_LIMITS.clips} clips.`);
                setBusyId(e.id);
                try {
                  const got = await fetchEffectClips(base, e.id, spec.kind, MOTION_LIMITS.clips - total, fetcher);
                  // Into an empty design the effect brings its own shape: its length, and an intro that plays once before
                  // the loop. Into one that already has things in it, it goes where the playhead is and the design's own
                  // length and loop are left alone.
                  const fresh = spec.clips.length === 0 && path.length === 0;
                  const length = fresh ? got.duration : scope.duration;
                  const p = fresh ? { start: 0, duration: got.duration } : place(MOTION_LIMITS.duration);
                  const lane = spec.clips.length ? Math.min(31, Math.max(...spec.clips.map((x) => x.track)) + 1) : 0;
                  // Clips start part-way through the intro some of the time, so the effect's own timing is kept.
                  const made = got.clips.map((c, i) => {
                    const start = Math.round((p.start + c.start) * 1000) / 1000;
                    return { ...c, start, duration: Math.max(0.1, Math.min(c.duration, length - start)), track: Math.min(31, lane + i) };
                  });
                  const key = `library-${e.id}`;
                  if (fresh) commit((s) => ({ ...s, duration: got.duration, loop: { mode: "loop", rest: s.loop.rest, ...(got.intro > 0 ? { from: got.intro } : {}) } }), key);
                  commitClips((clips) => made.reduce((acc, c) => addClip(acc, c), clips), key);
                  setSelection(made.map((c) => c.id));
                  const wants = !fresh && got.intro > 0 && introLength(spec) === 0;
                  say(wants ? `Added ${e.name}. Set the design's Intro to ${got.intro} s (nothing selected, in the inspector) so its opening plays once instead of every loop.` : `Added ${e.name}.`);
                } catch (err) {
                  say(err instanceof LibraryError ? err.message : `Couldn't add ${e.name}.`);
                } finally {
                  setBusyId(null);
                }
              };
              const keep = async (e: EffectCatalogEntry) => {
                setBusyId(e.id);
                try {
                  await downloadEffect(base, e);
                  setHave(downloadedIds());
                  say(`${e.name} is on this device now.`);
                } catch (err) {
                  say(err instanceof LibraryError ? err.message : `Couldn't download ${e.name}.`);
                } finally {
                  setBusyId(null);
                }
              };
              return (
                <>
                  <p className="text-[10px] text-[var(--ai-dim)]">{forThis.length} ready-made effects for a {spec.kind === "effect" ? "profile effect" : "nameplate"}. Add one to put it on the timeline, or download it to keep it for offline use.</p>
                  <div className="flex flex-wrap gap-1">
                    {groups.map((g) => (
                      <button key={g} type="button" aria-pressed={group === g} onClick={() => setGroup(g)} className={cn("rounded-full border px-2 py-0.5 text-[10px]", group === g ? "border-white/40 bg-white/15 text-foreground" : "border-white/10 text-[var(--ai-dim)] hover:text-foreground")}>{g}</button>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 gap-1">
                    {shown.map((e) => (
                      <div key={e.id} className="flex items-center gap-1 rounded-[3px] border border-white/10 bg-white/[0.04] px-2 py-1.5">
                        <span className="flex size-4 shrink-0 items-center" aria-hidden>
                          {e.colors.slice(0, 3).map((c, i) => <span key={i} className="-ml-1 size-3 rounded-full border border-black/30 first:ml-0" style={{ background: c }} />)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11px] text-[var(--ai-text)]">{e.name}</span>
                          <span className="block truncate text-[10px] text-[var(--ai-dim)]" title={e.description}>{e.description}</span>
                        </span>
                        {have.has(e.id) ? (
                          <button type="button" title="On this device. Click to remove the download." className="text-emerald-400 hover:text-emerald-300" onClick={() => { removeDownload(e.id); setHave(downloadedIds()); }}><Check className="size-3.5" /></button>
                        ) : (
                          <button type="button" title="Download to this device" disabled={busyId === e.id} className="text-[var(--ai-dim)] hover:text-foreground disabled:opacity-40" onClick={() => void keep(e)}><CloudDownload className="size-3.5" /></button>
                        )}
                        <button type="button" disabled={full || busyId === e.id} title={`Add ${e.name} at the playhead`} className="flex h-6 items-center rounded-[3px] border border-white/10 px-1.5 text-[10px] hover:bg-white/10 disabled:opacity-40" onClick={() => void addEffect(e)}>
                          {busyId === e.id ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </>
        )}

        {tab === "titles" && (
          <div className="grid grid-cols-2 gap-1">
            {TITLES.map((t) => (
              <button key={t.id} type="button" className={tile} disabled={full} onClick={() => { const p = place(); add(clipFromTitle(t, p.start, p.duration)); }}>
                <span className="truncate" style={{ fontWeight: t.weight > 700 ? 800 : 600 }}>{t.label}</span><Plus className="size-3 shrink-0 text-[var(--ai-dim)]" />
              </button>
            ))}
          </div>
        )}

        {tab === "effects" && (
          <>
            <button type="button" className={cn(tile, "w-full")} disabled={full} title="A clip with no picture whose effects change everything below it" onClick={() => add(newClip({ type: "adjust" }, { name: "Adjustment layer", start: 0, duration: scope.duration, track: 31, fx: [EFFECTS.find((e) => e.id === "vivid")!.make()] }))}>
              <span>Adjustment layer</span><Plus className="size-3 text-[var(--ai-dim)]" />
            </button>
            {EFFECT_GROUPS.map((g) => (
              <div key={g}>
                <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--ai-dim)]">{g}</div>
                <div className="grid grid-cols-2 gap-1">
                  {EFFECTS.filter((x) => x.group === g).map((x) => (
                    <button key={x.id} type="button" className={tile} title="Apply to the selected clips" onClick={() => needSelection() && commitClips((clips) => clips.map((c) => (selection.includes(c.id) && c.fx.length < MOTION_LIMITS.fx ? { ...c, fx: [...c.fx, x.make()] } : c)))}>
                      <span className="truncate">{x.label}</span><Plus className="size-3 shrink-0 text-[var(--ai-dim)]" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <p className="text-[10px] text-[var(--ai-dim)]">Effects go on the selected clips and can be changed or keyframed in the Inspector.</p>
          </>
        )}

        {tab === "transitions" && (
          <>
            <div className="grid grid-cols-1 gap-1">
              {TRANSITIONS.map((t) => (
                <div key={t.id} className="flex items-center gap-1">
                  <span className="flex-1 rounded-[3px] border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[11px]">{t.label}</span>
                  <button type="button" className="h-7 rounded-[3px] border border-white/10 px-2 text-[11px] hover:bg-white/10" onClick={() => needSelection() && commitClips((clips) => clips.map((c) => (selection.includes(c.id) ? setTransition(c, "in", newTransition(t.id, Math.min(0.5, c.duration / 2))) : c)))}>In</button>
                  <button type="button" className="h-7 rounded-[3px] border border-white/10 px-2 text-[11px] hover:bg-white/10" onClick={() => needSelection() && commitClips((clips) => clips.map((c) => (selection.includes(c.id) ? setTransition(c, "out", newTransition(t.id, Math.min(0.5, c.duration / 2), "right", "in")) : c)))}>Out</button>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-[var(--ai-dim)]">“In” runs as the clip begins, “Out” as it ends, on every selected clip.</p>
          </>
        )}

        {tab === "layers" && (
          <>
            <p className="text-[10px] text-[var(--ai-dim)]">What you draw in the Canvas tab appears here as clips. Each can be animated on its own.</p>
            {nodes.length === 0 && <p className="text-[11px] text-[var(--ai-dim)]">Nothing is drawn yet.</p>}
            {nodes.map((n) => {
              const c = onTimeline.get(n.id);
              return (
                <div key={n.id} className="flex items-center gap-1 rounded-[3px] border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px]">
                  <span className={cn("flex-1 truncate", n.hidden && "opacity-50")}>{n.name}{n.hidden ? " (hidden)" : ""}</span>
                  {c ? (
                    <button type="button" className="text-[var(--ai-accent,#8b5cf6)] hover:underline" onClick={() => setSelection([c.id])}>Select</button>
                  ) : (
                    <button type="button" className="text-[var(--ai-accent,#8b5cf6)] hover:underline" disabled={full} onClick={() => { const b = layerBox(n, doc); add(newClip({ type: "layer", nodeId: n.id, ...b }, { name: n.name, start: 0, duration: scope.duration, loop: false })); }}>Add</button>
                  )}
                </div>
              );
            })}
          </>
        )}

        {tab === "pictures" && (
          <>
            {assets.size === 0 && <p className="text-[11px] text-[var(--ai-dim)]">No pictures in this project yet. Import them in the Canvas tab (File ▸ Import) or the Assets panel, and they will be here.</p>}
            <div className="grid grid-cols-3 gap-1.5">
              {[...assets.values()].filter((a) => a.type.startsWith("image/")).map((a) => (
                <button key={a.id} type="button" disabled={full} title={`Add ${a.name} at the playhead`} className="group relative aspect-square overflow-hidden rounded-[3px] border border-white/10 bg-[repeating-conic-gradient(#2a2a31_0_25%,#202026_0_50%)] bg-[length:12px_12px] hover:border-white/40" onClick={() => {
                  const k = Math.min(1, (stage.w * 0.8) / (a.width ?? 200), (stage.h * 0.8) / (a.height ?? 200));
                  const p = place();
                  add(newClip({ type: "image", url: `studio:asset/${a.id}`, w: Math.round((a.width ?? 200) * k), h: Math.round((a.height ?? 200) * k), ox: 0, oy: 0 }, { name: a.name.replace(/\.[^.]+$/, ""), start: p.start, duration: p.duration, loop: false }));
                }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.url} alt={a.name} className="size-full object-contain" />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

