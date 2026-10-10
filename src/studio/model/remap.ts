import type { Project } from "@/studio/model/types";

/**
 * Give a project's files new ids, and follow every reference to them.
 *
 * Used when a project is duplicated, and when two projects turn out to share file ids (a project
 * folder copied in Finder carries its ids with it) — either way, an id must mean one file. Changes
 * the project in place; pass a copy.
 */
export function remapAssetIds(project: Project, remap: (id: string) => string): void {
  if (project.doc) for (const n of Object.values(project.doc.nodes)) if (n.type === "image") n.assetId = remap(n.assetId);
  if (project.picture) project.picture.assetId = remap(project.picture.assetId);
  if (project.bot?.avatarAssetId) project.bot.avatarAssetId = remap(project.bot.avatarAssetId);
  if (project.bot?.bannerAssetId) project.bot.bannerAssetId = remap(project.bot.bannerAssetId);
  if (project.motion) {
    const walk = (clips: typeof project.motion.clips) => {
      for (const c of clips) {
        if (c.source.type === "image") {
          const m = /^studio:asset\/([\w-]+)$/.exec(c.source.url);
          if (m) c.source.url = `studio:asset/${remap(m[1])}`;
        }
        if (c.source.type === "compound") walk(c.source.clips);
      }
    };
    walk(project.motion.clips);
  }
  const tp = project.themePack;
  if (tp) {
    if (tp.font?.assetId) tp.font.assetId = remap(tp.font.assetId);
    if (tp.font?.faces) tp.font.faces = tp.font.faces.map((f) => ({ ...f, assetId: remap(f.assetId) }));
    for (const k of Object.keys(tp.sounds)) tp.sounds[k] = remap(tp.sounds[k]);
    for (const k of Object.keys(tp.icons)) tp.icons[k] = remap(tp.icons[k]);
  }
}
