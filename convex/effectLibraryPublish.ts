import { internalAction } from "./_generated/server";
import { EFFECT_LIBRARY, LIBRARY_FOLDER, catalogOf, publishedEffect } from "./lib/effectLibrary";
import { normalizeMotionSpec } from "./lib/motion";
import { MAX_MOTION_BYTES, canonicalJson } from "./lib/motionAddress";
import { isR2Enabled, r2PublicUrlForKey } from "./lib/r2";

/**
 * Puts Crystal's effect library (convex/lib/effectLibrary.ts) on the CDN, where Studio's timeline browser downloads it from.
 *
 * Run by an operator, not callable from the app: it is an internal action, so only `npx convex run` (or another function on the
 * server) can start it, against whichever deployment the command names:
 *
 *   npx convex run effectLibraryPublish:publish            (the dev deployment)
 *   npx convex run effectLibraryPublish:publish --prod     (production)
 *
 * It writes `index.json` (what there is) and one file per effect, under a versioned folder outside `marketplace/` (nothing
 * that cleans up artwork touches it). Every effect is run through the same `normalizeMotionSpec` that guards what is stored
 * for a profile, and refused if it would be changed by it or contains a picture address: the library is data and nothing else.
 * Safe to run again: the same code writes the same files. Files aren't content-addressed (an update replaces them), so they are
 * cached for an hour, not for ever.
 */
export const publish = internalAction({
  args: {},
  handler: async (): Promise<{ published: number; index: string; folder: string }> => {
    if (!isR2Enabled()) throw new Error("This deployment has no CDN configured (R2_* settings), so there is nowhere to publish to.");
    const { AwsClient } = await import("aws4fetch");
    const client = new AwsClient({ accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!, service: "s3", region: "auto" });
    const base = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${process.env.R2_BUCKET}`;
    const put = async (key: string, body: string, cache: string) => {
      const res = await client.fetch(`${base}/${key}`, { method: "PUT", body, headers: { "Content-Type": "application/json", "Cache-Control": cache } });
      if (!res.ok) throw new Error(`Couldn't write ${key} (${res.status}).`);
    };

    // Nothing is written until every effect has been checked: a bad one can't leave the library half published.
    const files: { key: string; body: string }[] = [];
    for (const def of EFFECT_LIBRARY) {
      const effect = publishedEffect(def);
      for (const [kind, clips] of Object.entries(effect.variants)) {
        const spec = { v: 1, kind, name: def.name, duration: effect.duration, loop: { mode: "loop", rest: 0, from: effect.intro }, clips };
        const checked = normalizeMotionSpec(JSON.parse(JSON.stringify(spec)), (url) => {
          throw new Error(`${def.id} has a picture address (${url}); library effects are made only of generators.`);
        });
        if (canonicalJson(checked.clips) !== canonicalJson(JSON.parse(JSON.stringify(clips)))) throw new Error(`${def.id} (${kind}) isn't what the validator would store, so it was not published.`);
        // The intro has to survive too, or what plays once would play on every loop.
        if ((checked.loop.from ?? 0) !== effect.intro) throw new Error(`${def.id} (${kind}) has an intro of ${effect.intro}s that the validator would not keep, so it was not published.`);
      }
      const body = JSON.stringify(effect);
      if (body.length > MAX_MOTION_BYTES) throw new Error(`${def.id} is too large to fetch on demand.`);
      files.push({ key: `${LIBRARY_FOLDER}/${def.id}.json`, body });
    }
    for (const f of files) await put(f.key, f.body, "public, max-age=3600");
    const indexKey = `${LIBRARY_FOLDER}/index.json`;
    await put(indexKey, JSON.stringify(catalogOf()), "public, max-age=300");
    return { published: files.length, index: r2PublicUrlForKey(indexKey), folder: LIBRARY_FOLDER };
  },
});
