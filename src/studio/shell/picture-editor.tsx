"use client";

import { useQuery } from "convex/react";
import { Loader2, Upload } from "lucide-react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ProfileEffectLayer } from "@/components/profile/profile-card-cosmetics";
import { SubmitPanel } from "@/studio/shell/submit-panel";
import type { Project } from "@/studio/model/types";
import { useProjectAssets } from "@/studio/storage/assets";

const ACCEPT = "image/png,image/gif,image/webp,image/jpeg,video/webm,video/mp4";
const MAX = 8 * 1024 * 1024;

/**
 * Nameplates and profile effects are a single picture (or short clip) each — there
 * is nothing to arrange — so their editor is a drop zone and the place the thing
 * will be worn: behind a name in a list, over a profile card.
 */
export function PictureEditor({ project, onChange }: { project: Project; onChange: (p: Project) => void }) {
  const { assets, add, remove } = useProjectAssets(project.id);
  const me = useQuery(api.users.getCurrentUser);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const asset = project.picture ? assets.get(project.picture.assetId) : undefined;
  const isVideo = asset?.type.startsWith("video/");
  const name = me?.name ?? "You";

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!ACCEPT.split(",").includes(file.type)) return setError("Use a PNG, GIF, WebP or JPEG picture, or a short WebM or MP4 clip.");
    if (file.size > MAX) return setError("That file is over 8 MB.");
    setBusy(true);
    try {
      const previous = project.picture?.assetId;
      const a = await add(file);
      onChange({ ...project, picture: { assetId: a.id } });
      if (previous) await remove(previous);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="grid gap-6 p-6 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">{project.kind === "nameplate" ? "Nameplate artwork" : "Effect artwork"}</h2>
          <label
            className="flex min-h-48 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground hover:border-foreground/40 hover:text-foreground"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void pick(e.dataTransfer.files[0]);
            }}
          >
            {busy ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
            {asset ? `${asset.name} — click or drop to replace` : "Click or drop a picture or short clip"}
            <input type="file" accept={ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void pick(f); }} />
          </label>
          <p className="text-xs text-muted-foreground">
            {project.kind === "nameplate"
              ? "Drawn faintly behind a name and faded towards the text, so wide, simple artwork works best. Up to 8 MB; a short looping clip is allowed."
              : "Played once over the whole profile card and then held still for a while. Transparent PNG, GIF or WebP, up to 8 MB."}
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Preview</h2>
          {asset ? (
            project.kind === "nameplate" ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="relative flex h-11 items-center gap-2.5 overflow-hidden rounded-lg bg-card px-3">
                    {isVideo ? (
                      <video src={asset.url} autoPlay loop muted playsInline aria-hidden className="fade-mask-l pointer-events-none absolute inset-0 size-full object-cover opacity-20" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={asset.url} alt="" aria-hidden className="fade-mask-l pointer-events-none absolute inset-0 size-full object-cover opacity-20" />
                    )}
                    <Avatar className="relative size-7">
                      <AvatarImage src={me?.imageUrl} alt="" />
                      <AvatarFallback className="text-[10px]">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <span className="relative text-sm font-medium">{i === 0 ? name : i === 1 ? "A friend" : "Someone else"}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="relative mx-auto h-64 w-72 overflow-hidden rounded-2xl bg-neutral-800">
                <div className="h-[28%] bg-gradient-to-br from-violet-500/50 to-sky-500/40" />
                <Avatar className="absolute top-[18%] left-4 size-16 border-4 border-neutral-800">
                  <AvatarImage src={me?.imageUrl} alt="" />
                  <AvatarFallback>{name.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <p className="absolute top-[56%] left-4 text-sm font-semibold text-white">{name}</p>
                {isVideo ? <video src={asset.url} autoPlay loop muted playsInline className="pointer-events-none absolute inset-0 size-full object-cover" /> : <ProfileEffectLayer src={asset.url} rounded="rounded-2xl" />}
              </div>
            )
          ) : (
            <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Add the artwork to see it worn.</p>
          )}
        </div>
      </div>
      <div className="border-t border-border/60">
        <SubmitPanel project={project} onChange={onChange} />
      </div>
    </div>
  );
}
