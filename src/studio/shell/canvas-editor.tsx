"use client";

import { useQuery } from "convex/react";
import { Image as ImageIcon, Layers, Palette, SlidersHorizontal, Sparkles, LayoutGrid, Combine } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import "@/studio/editor/illustrator.css";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { AppearancePanel } from "@/studio/editor/appearance-panel";
import { Canvas } from "@/studio/editor/canvas";
import { ColorPanel, DockGutter, Grip, PanelGroup, SwatchesPanel } from "@/studio/editor/dock";
import { ControlBar } from "@/studio/editor/control-bar";
import { PathfinderPanel } from "@/studio/editor/pathfinder-panel";
import { Inspector } from "@/studio/editor/inspector";
import { LayersPanel, ProblemsPanel } from "@/studio/editor/layers-panel";
import { MenuBar, type BottomId, type PanelId } from "@/studio/editor/menu-bar";
import { PreviewPanel } from "@/studio/editor/preview-panel";
import { StatusBar } from "@/studio/editor/status-bar";
import { Toolbar } from "@/studio/editor/toolbar";
import { useDocEditor } from "@/studio/editor/use-doc-editor";
import type { ViewCommands } from "@/studio/editor/view-menu";
import { useViewPrefs } from "@/studio/editor/view-prefs";
import { checkArtwork, checkCosmetic, checkScene } from "@/studio/model/compile";
import { addNode, hasPaint, makeImage, nodesInOrder, patchNodes, removeNodes } from "@/studio/model/doc";
import type { Doc, ImageNode, Node, Project } from "@/studio/model/types";
import { ASSET_LIMITS, useProjectAssets } from "@/studio/storage/assets";
import { ChromeSlot, useStudioChrome } from "@/studio/shell/chrome";
import { SubmitPanel } from "@/studio/shell/submit-panel";
import { cn } from "@/lib/utils";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
/** A scene's room can also be a short looping clip. */
const SCENE_VIDEO_TYPES = ["video/webm", "video/mp4"];

const DOCK_KEY = "crystal-studio-dock";
interface DockState {
  panels: Record<PanelId, boolean>;
  top: "color" | "swatches" | "pathfinder";
  middle: "properties" | "appearance";
  lower: "layers" | "assets";
  collapsed: { top: boolean; middle: boolean; lower: boolean };
  bottom: BottomId | null;
}
const DEFAULT_DOCK: DockState = {
  panels: { color: true, swatches: true, properties: true, appearance: true, pathfinder: true, layers: true, assets: true },
  top: "color",
  middle: "appearance",
  lower: "layers",
  collapsed: { top: false, middle: false, lower: false },
  bottom: null,
};

function readDock(): DockState {
  try {
    const raw = JSON.parse(localStorage.getItem(DOCK_KEY) ?? "null") as Partial<DockState> | null;
    if (!raw || typeof raw !== "object") return DEFAULT_DOCK;
    return { ...DEFAULT_DOCK, ...raw, panels: { ...DEFAULT_DOCK.panels, ...(raw.panels ?? {}) }, collapsed: { ...DEFAULT_DOCK.collapsed, ...(raw.collapsed ?? {}) } };
  } catch {
    return DEFAULT_DOCK;
  }
}

/** Where an imported picture goes, and how big, for the kind of design. */
function fitImage(doc: Doc, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const { w: AW, h: AH } = doc.artboard;
  const max = doc.kind === "decoration" ? AW : doc.kind === "sticker" ? AW * 0.5 : doc.kind === "nameplate" ? AH * 0.9 : doc.kind === "effect" ? AW * 0.6 : AW * 0.3;
  // Never blown up past its own size, only brought down to fit.
  const k = Math.min(max / w, max / h, 1);
  const iw = w * k;
  const ih = h * k;
  return { x: (AW - iw) / 2, y: doc.kind === "sticker" ? AH * 0.05 : (AH - ih) / 2, w: iw, h: ih };
}

const STRIP: { id: PanelId; label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }[] = [
  { id: "color", label: "Color", icon: Palette },
  { id: "swatches", label: "Swatches", icon: LayoutGrid },
  { id: "properties", label: "Properties", icon: SlidersHorizontal },
  { id: "appearance", label: "Appearance", icon: Sparkles },
  { id: "pathfinder", label: "Pathfinder", icon: Combine },
  { id: "layers", label: "Layers", icon: Layers },
  { id: "assets", label: "Assets", icon: ImageIcon },
];

/**
 * The design editor for cosmetics and scenes, laid out as Illustrator's workspace is: the menu bar in
 * Studio's title bar, the control bar beneath it, a toolbar down the left, the canvas on its pasteboard
 * with a status bar under it, and a dock of panel groups on the right beside a strip of panel icons.
 */
export function CanvasEditor({ project, onChange }: { project: Project; onChange: (p: Project) => void }) {
  const doc0 = project.doc!;
  const projectRef = useMemo(() => ({ current: project }), [project]);
  const editor = useDocEditor(doc0, (doc) => onChange({ ...projectRef.current, doc }), project.id);
  const { doc, selection, setSelection } = editor;
  const { assets, add, remove } = useProjectAssets(project.id);
  const me = useQuery(api.users.getCurrentUser);
  const [prefs, setPrefs] = useViewPrefs();
  const viewCommands = useRef<ViewCommands | null>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const chrome = useStudioChrome();

  const [dock, setDockState] = useState<DockState>(() => (typeof window === "undefined" ? DEFAULT_DOCK : readDock()));
  const setDock = useCallback((patch: Partial<DockState> | ((d: DockState) => Partial<DockState>)) => {
    setDockState((cur) => {
      const next = { ...cur, ...(typeof patch === "function" ? patch(cur) : patch) };
      try {
        localStorage.setItem(DOCK_KEY, JSON.stringify(next));
      } catch {
        // Not remembered, that's all.
      }
      return next;
    });
  }, []);
  const [zoom, setZoom] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  /** Say something that went wrong (or couldn't be done), for a few seconds. */
  const say = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((cur) => (cur === message ? null : cur)), 5000);
  }, []);

  const problems = useMemo(
    () => (doc.kind === "scene" ? checkScene(doc, (id) => assets.has(id)) : doc.kind === "nameplate" || doc.kind === "effect" ? checkArtwork(doc, (id) => assets.has(id)) : checkCosmetic(doc, (id) => assets.has(id))),
    [doc, assets],
  );
  const errorCount = problems.filter((p) => p.severity === "error").length;
  const selected = selection.length === 1 ? (doc.nodes[selection[0]] ?? null) : null;

  const setBackground = useCallback(
    (assetId: string) => {
      const a = assets.get(assetId);
      if (!a) return;
      editor.commit((cur) => {
        // One room: any earlier background goes, and the picture is stretched to the artboard.
        let next = removeNodes(cur, nodesInOrder(cur).filter((n) => n.type === "image" && n.role === "background").map((n) => n.id));
        const node = { ...makeImage(assetId, "Room", 0, 0, cur.artboard.w, cur.artboard.h), role: "background" as const } as ImageNode;
        next = addNode(next, node);
        return { ...next, order: [node.id, ...next.order.filter((id) => id !== node.id)] };
      });
    },
    [assets, editor],
  );

  const importFiles = useCallback(
    async (files: File[], at?: { x: number; y: number }) => {
      setNotice(null);
      for (const file of files) {
        const isVideo = SCENE_VIDEO_TYPES.includes(file.type);
        if (!IMAGE_TYPES.includes(file.type) && !(isVideo && editor.doc.kind === "scene")) {
          setNotice(editor.doc.kind === "scene" ? `“${file.name}” isn't a picture (PNG, JPEG, WebP, GIF) or a WebM/MP4 clip.` : `“${file.name}” isn't a PNG, JPEG, WebP or GIF.`);
          continue;
        }
        if (file.size > (isVideo ? ASSET_LIMITS.video : ASSET_LIMITS.image)) {
          setNotice(`“${file.name}” is over ${ASSET_LIMITS.image / 1024 / 1024} MB.`);
          continue;
        }
        // A clip is only ever the room itself, never something placed in it.
        if (isVideo && nodesInOrder(editor.doc).some((n) => n.type === "image" && n.role === "background")) {
          const a = await add(file);
          setBackground(a.id);
          continue;
        }
        const asset = await add(file);
        const current = editor.doc;
        const hasBackground = nodesInOrder(current).some((n) => n.type === "image" && n.role === "background");
        if (current.kind === "scene" && !hasBackground) {
          // The first picture in a scene is the room itself.
          editor.commit((cur) => {
            const node = { ...makeImage(asset.id, "Room", 0, 0, cur.artboard.w, cur.artboard.h), role: "background" as const } as ImageNode;
            return { ...addNode(cur, node), order: [node.id, ...cur.order] };
          });
        } else {
          const r = fitImage(current, asset.width ?? 200, asset.height ?? 200);
          const node = makeImage(asset.id, asset.name.replace(/\.[^.]+$/, ""), at ? at.x - r.w / 2 : r.x, at ? at.y - r.h / 2 : r.y, r.w, r.h);
          editor.commit((cur) => addNode(cur, node));
          setSelection([node.id]);
        }
      }
    },
    [add, editor, setBackground, setSelection],
  );

  const importFromAsset = (assetId: string) => {
    const a = assets.get(assetId);
    if (!a) return;
    const r = fitImage(editor.doc, a.width ?? 200, a.height ?? 200);
    const node = makeImage(a.id, a.name.replace(/\.[^.]+$/, ""), r.x, r.y, r.w, r.h);
    editor.commit((cur) => addNode(cur, node));
    setSelection([node.id]);
  };

  const setPaint = (key: "fill" | "stroke", c: string) => {
    if (!hasPaint(selected)) return;
    const field = key === "stroke" ? "stroke" : selected.type === "text" ? "color" : "fill";
    editor.commit(patchNodes(editor.doc, selection, { [field]: c } as Partial<Node>), field);
  };

  const togglePanel = (id: PanelId) => setDock((d) => ({ panels: { ...d.panels, [id]: !d.panels[id] } }));
  /** Bring a panel into view: shown, its tab chosen, its group open. */
  const reveal = (id: PanelId) =>
    setDock((d) => {
      const panels = { ...d.panels, [id]: true };
      if (id === "color" || id === "swatches" || id === "pathfinder") return { panels, top: id, collapsed: { ...d.collapsed, top: false } };
      if (id === "properties" || id === "appearance") return { panels, middle: id, collapsed: { ...d.collapsed, middle: false } };
      return { panels, lower: id, collapsed: { ...d.collapsed, lower: false } };
    });

  const visible = (ids: PanelId[]) => ids.filter((id) => dock.panels[id]);
  const topTabs = visible(["color", "swatches", "pathfinder"]);
  const midTabs = visible(["properties", "appearance"]);
  const lowTabs = visible(["layers", "assets"]);
  const label = (id: string) => STRIP.find((s) => s.id === id)?.label ?? id;
  const pick = <T extends string>(tabs: T[], want: T) => (tabs.includes(want) ? want : tabs[0]);
  const wide = dock.bottom === "preview" || dock.bottom === "submit";

  const menu = (
    <MenuBar
      editor={editor}
      prefs={prefs}
      setPrefs={setPrefs}
      commands={viewCommands}
      panels={dock.panels}
      onTogglePanel={togglePanel}
      bottom={dock.bottom}
      onBottom={(b) => setDock({ bottom: b })}
      onImport={() => fileInput.current?.click()}
      onNotice={say}
      onOpenGuides={chrome.openGuides ? () => chrome.openGuides!("start") : undefined}
      onSave={chrome.saveProject ? () => void chrome.saveProject!(project.id).then(() => say("Saved."), (e) => say(`Couldn't save: ${e instanceof Error ? e.message : "something went wrong."}`)) : undefined}
      canSave={chrome.isDirty?.(project.id) ?? false}
    />
  );
  // At the right end of the title bar, after the menus and the draggable space between.
  const actions = (
    <div className="flex h-[30px] items-center pr-2" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
      <button
        type="button"
        onClick={() => setDock({ bottom: "submit" })}
        className="h-[22px] rounded-full bg-[var(--ai-accent)] px-4 text-[12px] font-medium text-white hover:brightness-110"
        title="Check the design and send it to the Marketplace"
      >
        Submit
      </button>
    </div>
  );
  const bar = (
    <ControlBar
      editor={editor}
      prefs={prefs}
      setPrefs={setPrefs}
      onDocSetup={() => {
        setSelection([]);
        reveal("properties");
      }}
    />
  );

  return (
    <div className="ai flex h-full min-h-0 flex-col">
      <ChromeSlot host={chrome.menuHost} className="ai" fit>{menu}</ChromeSlot>
      <ChromeSlot host={chrome.actionsHost ?? null} className="ai" fit>{actions}</ChromeSlot>
      <ChromeSlot host={chrome.barHost} className="ai">{bar}</ChromeSlot>

      <div className="flex min-h-0 flex-1">
        <Toolbar kind={doc.kind} tool={editor.tool} setTool={editor.setTool} commands={viewCommands} selected={selected} onFill={(c) => setPaint("fill", c)} onStroke={(c) => setPaint("stroke", c)} />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <Canvas
              editor={editor}
              assets={assets}
              avatarUrl={me?.imageUrl}
              onDropFiles={(files, at) => void importFiles(files, at)}
              prefs={prefs}
              setPrefs={setPrefs}
              commands={viewCommands}
              readout={readout}
              onZoom={setZoom}
              onNotice={say}
            />
            {notice && <div className="absolute top-2 left-1/2 -translate-x-1/2 rounded-md border border-destructive/40 bg-card px-3 py-1.5 text-sm text-destructive shadow">{notice}</div>}
          </div>
          <StatusBar
            zoom={zoom}
            commands={viewCommands}
            tool={editor.tool}
            artboard={doc.artboard}
            readout={readout}
            problems={{ errors: errorCount, warnings: problems.length - errorCount }}
            onProblems={() => setDock({ bottom: "problems" })}
          />
        </div>

        {/* The dock: panel groups in a column, with the strip of panel icons beside it. */}
        <div className="flex shrink-0 ai-edge-l">
          <div className={cn("flex min-h-0 flex-col bg-[var(--ai-edge)]", wide ? "w-[360px]" : "w-60")}>
            {topTabs.length > 0 && (
              <>
                <PanelGroup tabs={topTabs.map((id) => ({ id, label: label(id) }))} active={pick(topTabs, dock.top)} onActive={(id) => setDock({ top: id as DockState["top"] })} collapsed={dock.collapsed.top} onCollapsed={(c) => setDock((d) => ({ collapsed: { ...d.collapsed, top: c } }))}>
                  {pick(topTabs, dock.top) === "color" ? <ColorPanel editor={editor} selected={selected} /> : pick(topTabs, dock.top) === "swatches" ? <SwatchesPanel editor={editor} selected={selected} /> : <PathfinderPanel editor={editor} onNotice={say} />}
                </PanelGroup>
                <DockGutter />
              </>
            )}
            {midTabs.length > 0 && (
              <>
                <PanelGroup tabs={midTabs.map((id) => ({ id, label: label(id) }))} active={pick(midTabs, dock.middle)} onActive={(id) => setDock({ middle: id as DockState["middle"] })} collapsed={dock.collapsed.middle} onCollapsed={(c) => setDock((d) => ({ collapsed: { ...d.collapsed, middle: c } }))} grow={lowTabs.length === 0 && !dock.bottom}>
                  {pick(midTabs, dock.middle) === "properties" ? <Inspector editor={editor} assets={assets} onSetBackground={setBackground} /> : <AppearancePanel editor={editor} />}
                </PanelGroup>
                <DockGutter />
              </>
            )}
            {lowTabs.length > 0 && (
              <PanelGroup tabs={lowTabs.map((id) => ({ id, label: label(id) }))} active={pick(lowTabs, dock.lower)} onActive={(id) => setDock({ lower: id as DockState["lower"] })} collapsed={dock.collapsed.lower} onCollapsed={(c) => setDock((d) => ({ collapsed: { ...d.collapsed, lower: c } }))} grow>
                {pick(lowTabs, dock.lower) === "layers" ? (
                  <LayersPanel editor={editor} />
                ) : (
                  <div className="space-y-2 p-2">
                    <label className="flex cursor-pointer items-center justify-center border border-dashed border-[var(--ai-edge)] py-4 text-[11px] text-[var(--ai-dim)] hover:text-foreground">
                      {doc.kind === "scene" ? "Import pictures or a clip…" : "Import pictures…"}
                    </label>
                    <p className="text-[10px] text-[var(--ai-dim)]">
                      PNG, JPEG, WebP or GIF{doc.kind === "scene" ? ", or a short looping WebM/MP4 clip for an animated room" : ""}, up to {ASSET_LIMITS.image / 1024 / 1024} MB. You can also drop files onto the canvas.
                    </p>
                    <Button size="sm" variant="secondary" className="h-6 w-full rounded-[2px] text-[11px]" onClick={() => fileInput.current?.click()}>
                      Choose files…
                    </Button>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[...assets.values()].map((a) => {
                        const used = Object.values(doc.nodes).some((n) => n.type === "image" && n.assetId === a.id);
                        return (
                          <div key={a.id} className="overflow-hidden border border-[var(--ai-edge)]">
                            {a.type.startsWith("video/") ? (
                              <video src={a.url} muted loop playsInline autoPlay className="aspect-square w-full bg-black object-cover" />
                            ) : (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={a.url} alt="" className="aspect-square w-full bg-[conic-gradient(#8884_25%,#0000_0_50%,#8884_0_75%,#0000_0)] [background-size:12px_12px] object-contain" />
                            )}
                            <div className="space-y-1 p-1">
                              <p className="truncate text-[10px]" title={a.name}>{a.name}</p>
                              <div className="flex gap-1">
                                <button type="button" className="ai-button !h-5 flex-1 !px-1 text-[10px]" onClick={() => (doc.kind === "scene" ? setBackground(a.id) : importFromAsset(a.id))}>
                                  {doc.kind === "scene" ? "Use as room" : "Add"}
                                </button>
                                <button
                                  type="button"
                                  className="ai-button !h-5 !px-1.5 text-[10px] text-destructive"
                                  onClick={() => {
                                    if (used && !window.confirm("It's used in this design. Delete it and its layers?")) return;
                                    editor.commit((cur) => removeNodes(cur, Object.values(cur.nodes).filter((n) => n.type === "image" && n.assetId === a.id).map((n) => n.id)));
                                    void remove(a.id);
                                  }}
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </PanelGroup>
            )}
            <DockGutter />
            <PanelGroup
              tabs={[
                { id: "problems", label: "Problems" },
                { id: "preview", label: "Preview" },
                { id: "submit", label: "Submit" },
              ]}
              active={dock.bottom ?? "problems"}
              onActive={(id) => setDock({ bottom: id as BottomId })}
              collapsed={dock.bottom === null}
              onCollapsed={(c) => setDock((d) => ({ bottom: c ? null : (d.bottom ?? "problems") }))}
              grow={lowTabs.length === 0 && midTabs.length === 0}
              badge={{ problems: problems.length || undefined }}
            >
              <div className="max-h-[320px] overflow-y-auto">
                {dock.bottom === "problems" && <ProblemsPanel problems={problems} onSelect={(id) => setSelection([id])} />}
                {dock.bottom === "preview" && <PreviewPanel doc={doc} assets={assets} avatarUrl={me?.imageUrl} name={me?.name ?? "You"} />}
                {dock.bottom === "submit" && <SubmitPanel project={project} onChange={onChange} />}
              </div>
            </PanelGroup>
          </div>

          <div className="flex w-9 shrink-0 flex-col items-center gap-px bg-[var(--ai-body)] ai-edge-l">
            <div className="flex h-[14px] w-full items-center justify-center bg-[var(--ai-header)] text-[var(--ai-dim)]">
              <Grip />
            </div>
            {STRIP.map(({ id, label: l, icon: Icon }) => (
              <button key={id} type="button" className="ai-tool mt-px !w-7" aria-label={l} title={`${dock.panels[id] ? "Hide" : "Show"} ${l}`} aria-pressed={dock.panels[id]} onClick={() => (dock.panels[id] ? togglePanel(id) : reveal(id))}>
                <Icon className="size-4" strokeWidth={1.5} />
              </button>
            ))}
          </div>
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        accept={(doc.kind === "scene" ? [...IMAGE_TYPES, ...SCENE_VIDEO_TYPES] : IMAGE_TYPES).join(",")}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          void importFiles(files);
        }}
      />
    </div>
  );
}

export { patchNodes };
