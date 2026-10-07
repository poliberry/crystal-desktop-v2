"use client";

import { useQuery } from "convex/react";
import { ChevronDown, ChevronUp, Redo2, Undo2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Canvas } from "@/studio/editor/canvas";
import { Inspector } from "@/studio/editor/inspector";
import { LayersPanel, ProblemsPanel } from "@/studio/editor/layers-panel";
import { PreviewPanel } from "@/studio/editor/preview-panel";
import { Toolbar } from "@/studio/editor/toolbar";
import { useDocEditor } from "@/studio/editor/use-doc-editor";
import { checkCosmetic, checkScene } from "@/studio/model/compile";
import { addNode, makeImage, nodesInOrder, patchNodes, removeNodes } from "@/studio/model/doc";
import type { Doc, ImageNode, Project } from "@/studio/model/types";
import { ASSET_LIMITS, useProjectAssets } from "@/studio/storage/assets";
import { SubmitPanel } from "@/studio/shell/submit-panel";
import { cn } from "@/lib/utils";

type SideTab = "inspector" | "layers" | "assets";
type BottomTab = "problems" | "preview" | "submit";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
/** A scene's room can also be a short looping clip. */
const SCENE_VIDEO_TYPES = ["video/webm", "video/mp4"];

/** Where an imported picture goes, and how big, for the kind of design. */
function fitImage(doc: Doc, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const { w: AW, h: AH } = doc.artboard;
  const max = doc.kind === "decoration" ? AW : doc.kind === "sticker" ? AW * 0.5 : AW * 0.3;
  // Never blown up past its own size, only brought down to fit.
  const k = Math.min(max / w, max / h, 1);
  const iw = w * k;
  const ih = h * k;
  return { x: (AW - iw) / 2, y: doc.kind === "sticker" ? AH * 0.05 : (AH - ih) / 2, w: iw, h: ih };
}

/**
 * The design editor for cosmetics and scenes: tools down the left, the canvas,
 * and an inspector / layers / assets column on the right, with problems, preview
 * and submission in a panel along the bottom — laid out as a code editor is.
 */
export function CanvasEditor({ project, onChange }: { project: Project; onChange: (p: Project) => void }) {
  const doc0 = project.doc!;
  const projectRef = useMemo(() => ({ current: project }), [project]);
  const editor = useDocEditor(doc0, (doc) => onChange({ ...projectRef.current, doc }), project.id);
  const { doc, selection, setSelection } = editor;
  const { assets, add, remove } = useProjectAssets(project.id);
  const me = useQuery(api.users.getCurrentUser);

  const [side, setSide] = useState<SideTab>("inspector");
  const [bottom, setBottom] = useState<BottomTab>("problems");
  const [bottomOpen, setBottomOpen] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const problems = useMemo(() => (doc.kind === "scene" ? checkScene(doc, (id) => assets.has(id)) : checkCosmetic(doc, (id) => assets.has(id))), [doc, assets]);
  const errorCount = problems.filter((p) => p.severity === "error").length;

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
    [add, editor, setSelection],
  );

  const bottomTabs: { id: BottomTab; label: string; badge?: number }[] = [
    { id: "problems", label: "Problems", badge: problems.length },
    { id: "preview", label: "Preview" },
    { id: "submit", label: "Submit" },
  ];
  const sideTabs: { id: SideTab; label: string }[] = [
    { id: "inspector", label: "Inspector" },
    { id: "layers", label: "Layers" },
    { id: "assets", label: "Assets" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1">
        <Toolbar kind={doc.kind} tool={editor.tool} setTool={editor.setTool} />

        <div className="relative min-w-0 flex-1">
          <Canvas editor={editor} assets={assets} avatarUrl={me?.imageUrl} onDropFiles={(files, at) => void importFiles(files, at)} />
          <div className="absolute top-2 left-2 flex items-center gap-1 rounded-lg border border-border bg-card/90 p-0.5 shadow">
            <Button variant="ghost" size="icon" className="size-7" disabled={!editor.canUndo} onClick={editor.undo} aria-label="Undo" title="Undo (⌘Z)">
              <Undo2 className="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="size-7" disabled={!editor.canRedo} onClick={editor.redo} aria-label="Redo" title="Redo (⇧⌘Z)">
              <Redo2 className="size-3.5" />
            </Button>
          </div>
          {notice && <div className="absolute top-2 left-1/2 -translate-x-1/2 rounded-md border border-destructive/40 bg-card px-3 py-1.5 text-sm text-destructive shadow">{notice}</div>}
        </div>

        <aside className="flex w-72 shrink-0 flex-col border-l border-border/60 bg-card/30">
          <div className="flex shrink-0 border-b border-border/60">
            {sideTabs.map((t) => (
              <button key={t.id} type="button" onClick={() => setSide(t.id)} className={cn("flex-1 border-b-2 px-2 py-2 text-xs font-medium", side === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {side === "inspector" && <Inspector editor={editor} assets={assets} onSetBackground={setBackground} />}
            {side === "layers" && <LayersPanel editor={editor} />}
            {side === "assets" && (
              <div className="space-y-3 p-3">
                <label className="flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-border py-5 text-sm text-muted-foreground hover:border-foreground/40 hover:text-foreground">
                  {doc.kind === "scene" ? "Import pictures or a clip…" : "Import pictures…"}
                  <input
                    type="file"
                    multiple
                    accept={(doc.kind === "scene" ? [...IMAGE_TYPES, ...SCENE_VIDEO_TYPES] : IMAGE_TYPES).join(",")}
                    hidden
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      e.target.value = "";
                      void importFiles(files);
                    }}
                  />
                </label>
                <p className="text-[11px] text-muted-foreground">PNG, JPEG, WebP or GIF{doc.kind === "scene" ? ", or a short looping WebM/MP4 clip for an animated room" : ""}, up to {ASSET_LIMITS.image / 1024 / 1024} MB. You can also drop files onto the canvas.</p>
                <div className="grid grid-cols-2 gap-2">
                  {[...assets.values()].map((a) => {
                    const used = Object.values(doc.nodes).some((n) => n.type === "image" && n.assetId === a.id);
                    return (
                      <div key={a.id} className="group relative overflow-hidden rounded-lg border border-border">
                        {a.type.startsWith("video/") ? (
                          <video src={a.url} muted loop playsInline autoPlay className="aspect-square w-full bg-black object-cover" />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={a.url} alt="" className="aspect-square w-full bg-[conic-gradient(#2a2a30_25%,#222228_0_50%,#2a2a30_0_75%,#222228_0)] [background-size:16px_16px] object-contain" />
                        )}
                        <div className="space-y-1 p-1.5">
                          <p className="truncate text-[11px]" title={a.name}>{a.name}</p>
                          <div className="flex gap-1">
                            <Button size="sm" variant="secondary" className="h-6 flex-1 px-1 text-[11px]" onClick={() => (doc.kind === "scene" ? setBackground(a.id) : void importFromAsset(a.id))}>
                              {doc.kind === "scene" ? "Use as room" : "Add"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1.5 text-[11px] text-destructive hover:text-destructive"
                              onClick={() => {
                                if (used && !window.confirm("It's used in this design. Delete it and its layers?")) return;
                                editor.commit((cur) => removeNodes(cur, Object.values(cur.nodes).filter((n) => n.type === "image" && n.assetId === a.id).map((n) => n.id)));
                                void remove(a.id);
                              }}
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      <section className={cn("shrink-0 border-t border-border/60 bg-card/30", bottomOpen ? "h-[300px]" : "h-9")}>
        <div className="flex h-9 items-center border-b border-border/60 px-1">
          {bottomTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setBottom(t.id);
                setBottomOpen(true);
              }}
              className={cn("flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium", bottomOpen && bottom === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              {t.label}
              {t.badge ? <span className={cn("rounded-full px-1.5 text-[10px]", errorCount ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400")}>{t.badge}</span> : null}
            </button>
          ))}
          <button type="button" onClick={() => setBottomOpen((o) => !o)} className="ml-auto rounded p-1.5 text-muted-foreground hover:text-foreground" aria-label={bottomOpen ? "Collapse panel" : "Expand panel"}>
            {bottomOpen ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </button>
        </div>
        {bottomOpen && (
          <div className="h-[calc(100%-2.25rem)] overflow-y-auto">
            {bottom === "problems" && <ProblemsPanel problems={problems} onSelect={(id) => setSelection([id])} />}
            {bottom === "preview" && <PreviewPanel doc={doc} assets={assets} avatarUrl={me?.imageUrl} name={me?.name ?? "You"} />}
            {bottom === "submit" && <SubmitPanel project={project} onChange={onChange} />}
          </div>
        )}
      </section>
    </div>
  );

  // Adding a picture that is already imported: placed like a fresh import.
  async function importFromAsset(assetId: string) {
    const a = assets.get(assetId);
    if (!a) return;
    const r = fitImage(editor.doc, a.width ?? 200, a.height ?? 200);
    const node = makeImage(a.id, a.name.replace(/\.[^.]+$/, ""), r.x, r.y, r.w, r.h);
    editor.commit((cur) => addNode(cur, node));
    setSelection([node.id]);
  }
}

export { patchNodes };
