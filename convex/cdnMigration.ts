/**
 * Moves every file still in Convex storage onto the Cloudflare CDN.
 *
 * Run it from a terminal — it is internal, so it is not reachable from the app:
 *
 *     npx convex run cdnMigration:run '{"dryRun": true}'     # what would move
 *     npx convex run cdnMigration:run '{}'                   # move up to 200 files
 *     npx convex run cdnMigration:run '{}' --prod            # the same, in production
 *
 * Repeat the real run until it reports `remaining: 0`. It is safe to stop and
 * start: a file is only ever in one of two states — still in Convex and still
 * pointed at, or on the CDN and pointed at — and nothing is deleted until the
 * switch has been made.
 *
 * ## What happens to each file
 *
 *  1. It is read out of Convex storage and written to R2 as
 *     `migrated/<storageId><ext>`. The key comes from the storage id, so doing
 *     it twice writes the same object to the same place.
 *  2. It is fetched back **from the CDN address** — not from the bucket — and
 *     the length checked against what was sent. That is the address every
 *     client will be given, so it is the one worth proving works. A file that
 *     doesn't come back whole is left exactly as it was.
 *  3. Only then, in one mutation, every document that pointed at the Convex
 *     file is pointed at the CDN address, and the Convex file is deleted.
 *
 * A file is grouped with everything that references it before any of that: an
 * avatar and the cropped avatar made from it can be the same object, and
 * deleting it after fixing the first reference would break the second.
 *
 * ## What it covers
 *
 * Avatars, banners, nameplates, effects, frames and decorations (account and
 * per-server, including every layer of a decoration or a sticker set), the
 * recent-pictures history, community icons and banners, channel and
 * conversation backgrounds and banners, group icons, emoji, soundboard clips,
 * profile and overview widget pictures, and message attachments in both kinds
 * of conversation.
 *
 * Stream thumbnails are left alone: they are replaced every few seconds and
 * cleared when the stream ends, so there is nothing to carry over.
 */

import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";

/** One place that points at a Convex file. Plain data, so it can travel between
 * the query that finds it, the action that moves the file, and the mutation that
 * repoints it. */
type Slot =
  | { kind: "flat"; table: string; id: string; urlField: string; storageField: string }
  /** A list of placed layers; the layer is found by the file it uses. */
  | { kind: "layers"; table: string; id: string; arrayField: string }
  /** A profile widget's image fields. */
  | { kind: "widgetFields"; id: string }
  /** An overview banner card, whose picture is inside its `config`. */
  | { kind: "widgetConfig"; id: string }
  /** A message attachment: gains a CDN key and address rather than a url. */
  | { kind: "attachment"; table: string; id: string }
  /** The one-image avatar decoration from before decorations were lists. */
  | { kind: "singleDecoration"; id: string };

/** The pairs of fields that hold "a picture's address, and the Convex file
 * behind it", per table. The same names on a user and on a server profile. */
const PROFILE_PAIRS: [string, string][] = [
  ["imageUrl", "avatarStorageId"],
  ["avatarOriginalUrl", "avatarOriginalStorageId"],
  ["bannerUrl", "bannerStorageId"],
  ["bannerOriginalUrl", "bannerOriginalStorageId"],
  ["nameplateUrl", "nameplateStorageId"],
  ["profileEffect", "profileEffectStorageId"],
  ["profileFrame", "profileFrameStorageId"],
];

const FLAT_PAIRS: Record<string, [string, string][]> = {
  users: PROFILE_PAIRS,
  serverProfiles: PROFILE_PAIRS,
  communities: [
    ["imageUrl", "iconStorageId"],
    ["bannerUrl", "bannerStorageId"],
  ],
  channels: [
    ["backgroundUrl", "backgroundStorageId"],
    ["bannerUrl", "bannerStorageId"],
  ],
  conversations: [
    ["imageUrl", "iconStorageId"],
    ["backgroundUrl", "backgroundStorageId"],
  ],
  communityEmojis: [["imageUrl", "storageId"]],
  communitySounds: [["soundUrl", "storageId"]],
  profileWidgets: [["imageUrl", "imageStorageId"]],
  profileImages: [
    ["url", "storageId"],
    ["originalUrl", "originalStorageId"],
  ],
};

const LAYER_ARRAYS: Record<string, string[]> = {
  users: ["avatarDecorationLayers", "profileFrameLayers"],
  serverProfiles: ["profileFrameLayers"],
};

const ATTACHMENT_TABLES = ["messageAttachments", "channelMessageAttachments"];

/** Every table this looks at, in the order it scans them. */
const TABLES = [
  ...Object.keys(FLAT_PAIRS),
  "communityWidgets",
  ...ATTACHMENT_TABLES,
];

interface Found {
  storageId: string;
  slot: Slot;
}

/** Every Convex file a document points at, with where it is pointed at from. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function slotsOf(table: string, doc: any): Found[] {
  const found: Found[] = [];
  const id = String(doc._id);

  if (ATTACHMENT_TABLES.includes(table)) {
    // Already on the CDN once it has a key or an address of its own.
    if (doc.storageId && !doc.cdnKey && !doc.cdnUrl) {
      found.push({ storageId: String(doc.storageId), slot: { kind: "attachment", table, id } });
    }
    return found;
  }

  for (const [urlField, storageField] of FLAT_PAIRS[table] ?? []) {
    if (doc[storageField]) {
      found.push({
        storageId: String(doc[storageField]),
        slot: { kind: "flat", table, id, urlField, storageField },
      });
    }
  }

  for (const arrayField of LAYER_ARRAYS[table] ?? []) {
    for (const layer of doc[arrayField] ?? []) {
      if (layer.storageId) {
        found.push({
          storageId: String(layer.storageId),
          slot: { kind: "layers", table, id, arrayField },
        });
      }
    }
  }

  if (table === "users" && doc.avatarDecorationStorageId) {
    found.push({
      storageId: String(doc.avatarDecorationStorageId),
      slot: { kind: "singleDecoration", id },
    });
  }

  if (table === "profileWidgets") {
    for (const field of doc.fields ?? []) {
      if (field.storageId) {
        found.push({ storageId: String(field.storageId), slot: { kind: "widgetFields", id } });
      }
    }
  }

  if (table === "communityWidgets" && doc.config?.kind === "banner" && doc.config.imageStorageId) {
    found.push({
      storageId: String(doc.config.imageStorageId),
      slot: { kind: "widgetConfig", id },
    });
  }

  return found;
}

/** One page of one table: what in it still points at Convex storage, and how big
 * each such file is. */
export const scan = internalQuery({
  args: { table: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { table, cursor }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = await (ctx.db.query(table as any) as any).paginate({
      numItems: 200,
      cursor,
    });
    const found: (Found & { size: number; contentType: string | null })[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const doc of page.page as any[]) {
      for (const entry of slotsOf(table, doc)) {
        const meta = await ctx.db.system.get(entry.storageId as Id<"_storage">);
        // A reference to a file that is already gone has nothing to move; it is
        // reported, not hidden, by the missing size.
        found.push({
          ...entry,
          size: meta?.size ?? -1,
          contentType: meta?.contentType ?? null,
        });
      }
    }
    return { found, cursor: page.isDone ? null : (page.continueCursor as string), done: page.isDone };
  },
});

/** The extension a stored file's content type implies, so a key like
 * `…/<id>.webm` keeps the thing the renderer tells videos by. */
function extensionFor(contentType: string | null): string {
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
    "image/avif": ".avif",
    "video/webm": ".webm",
    "video/mp4": ".mp4",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/webm": ".weba",
    "audio/mp4": ".m4a",
  };
  return map[(contentType ?? "").split(";")[0]!.trim().toLowerCase()] ?? "";
}

function r2Config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET;
  const accessKey = process.env.R2_ACCESS_KEY_ID;
  const secretKey = process.env.R2_SECRET_ACCESS_KEY;
  const base = (process.env.R2_PUBLIC_URL ?? process.env.CDN_URL ?? "").replace(/\/$/, "");
  const missing = [
    !accountId && "R2_ACCOUNT_ID",
    !bucket && "R2_BUCKET",
    !accessKey && "R2_ACCESS_KEY_ID",
    !secretKey && "R2_SECRET_ACCESS_KEY",
    !base && "R2_PUBLIC_URL",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`Set these on the deployment first: ${missing.join(", ")}.`);
  }
  return { accountId: accountId!, bucket: bucket!, accessKey: accessKey!, secretKey: secretKey!, base };
}

/**
 * Repoint everything that used a file, then delete the file.
 *
 * One mutation, so a reader never sees a document pointing at a file that has
 * been deleted or at an address that was never written to.
 */
export const swap = internalMutation({
  args: {
    storageId: v.string(),
    key: v.string(),
    url: v.string(),
    slots: v.array(v.any()),
  },
  handler: async (ctx, { storageId, key, url, slots }) => {
    const fileId = storageId as Id<"_storage">;
    // The same document can be named by several slots (a user with an avatar
    // and its original); each pass re-reads it, so they stack rather than clash.
    for (const slot of slots as Slot[]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc: any = await ctx.db.get(slot.id as Id<"users">);
      if (!doc) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const patch = (fields: Record<string, unknown>) => ctx.db.patch(doc._id, fields as any);

      switch (slot.kind) {
        case "flat":
          if (String(doc[slot.storageField]) === storageId) {
            await patch({ [slot.urlField]: url, [slot.storageField]: undefined });
          }
          break;

        case "layers": {
          const layers = (doc[slot.arrayField] ?? []).map(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (layer: any) =>
              String(layer.storageId) === storageId
                ? { ...layer, url, storageId: undefined }
                : layer
          );
          const fields: Record<string, unknown> = { [slot.arrayField]: layers };
          // The decoration is also carried, whole, as a string every query
          // returns — rebuilt from the same layers, in the same form
          // `setAvatarDecorationLayers` writes.
          if (slot.arrayField === "avatarDecorationLayers") {
            fields.avatarDecoration = `layers:${JSON.stringify(layers)}`;
          }
          await patch(fields);
          break;
        }

        case "singleDecoration":
          if (String(doc.avatarDecorationStorageId) === storageId) {
            await patch({ avatarDecoration: url, avatarDecorationStorageId: undefined });
          }
          break;

        case "widgetFields": {
          // An image field's `value` is the picture's address.
          const fields = (doc.fields ?? []).map(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (field: any) =>
              String(field.storageId) === storageId
                ? { ...field, value: url, storageId: undefined }
                : field
          );
          await patch({ fields });
          break;
        }

        case "widgetConfig":
          if (String(doc.config?.imageStorageId) === storageId) {
            await patch({ config: { ...doc.config, imageUrl: url, imageStorageId: undefined } });
          }
          break;

        case "attachment":
          if (String(doc.storageId) === storageId) {
            await patch({ cdnKey: key, cdnUrl: url, storageId: undefined });
          }
          break;
      }
    }
    await ctx.storage.delete(fileId).catch(() => {});
  },
});

const CONCURRENCY = 3;

/** Put the bytes in the bucket and prove they can be read back from the CDN. */
async function copyAndVerify(
  config: ReturnType<typeof r2Config>,
  key: string,
  bytes: ArrayBuffer,
  contentType: string
): Promise<string> {
  const { AwsClient } = await import("aws4fetch");
  const client = new AwsClient({
    accessKeyId: config.accessKey,
    secretAccessKey: config.secretKey,
    service: "s3",
    region: "auto",
  });
  const endpoint = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${key}`;
  const put = await client.fetch(endpoint, {
    method: "PUT",
    body: bytes as unknown as BodyInit,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
  if (!put.ok) {
    throw new Error(`R2 PUT ${put.status} ${(await put.text().catch(() => "")).slice(0, 200)}`);
  }

  const url = `${config.base}/${key}`;
  // A few tries: a new object is readable straight away from the bucket but the
  // edge can take a moment, and a transient failure is not a reason to leave a
  // file for another run.
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const back = await fetch(url);
      if (back.ok) {
        const got = (await back.arrayBuffer()).byteLength;
        if (got === bytes.byteLength) return url;
        lastError = `came back ${got} bytes, sent ${bytes.byteLength}`;
      } else {
        lastError = `CDN answered ${back.status}`;
      }
    } catch (error) {
      lastError = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
  }
  throw new Error(`not readable from ${url}: ${lastError}`);
}

/**
 * The migration. See the notes at the top of the file.
 *
 * `limit` caps how many files one run moves, so a run fits in an action's time
 * limit; run it again until `remaining` is zero.
 */
export const run = internalAction({
  args: { dryRun: v.optional(v.boolean()), limit: v.optional(v.number()) },
  handler: async (ctx, { dryRun, limit }) => {
    // Grouped by file before anything moves — see the notes at the top.
    const files = new Map<string, { slots: Slot[]; size: number; contentType: string | null }>();
    const perTable: Record<string, number> = {};
    for (const table of TABLES) {
      let cursor: string | null = null;
      for (;;) {
        const page: {
          found: (Found & { size: number; contentType: string | null })[];
          cursor: string | null;
          done: boolean;
        } = await ctx.runQuery(internal.cdnMigration.scan, { table, cursor });
        for (const entry of page.found) {
          perTable[table] = (perTable[table] ?? 0) + 1;
          const existing = files.get(entry.storageId);
          if (existing) existing.slots.push(entry.slot);
          else
            files.set(entry.storageId, {
              slots: [entry.slot],
              size: entry.size,
              contentType: entry.contentType,
            });
        }
        if (page.done || page.cursor === null) break;
        cursor = page.cursor;
      }
    }

    const totalBytes = [...files.values()].reduce((sum, f) => sum + Math.max(f.size, 0), 0);
    const dangling = [...files.entries()].filter(([, f]) => f.size < 0).map(([id]) => id);

    if (dryRun) {
      return {
        dryRun: true,
        files: files.size,
        megabytes: Math.round((totalBytes / 1024 / 1024) * 10) / 10,
        references: perTable,
        /** Pointed at, but already missing from Convex — nothing to move. */
        missingFromConvex: dangling.length,
      };
    }

    const config = r2Config();
    const todo = [...files.entries()].filter(([, f]) => f.size >= 0).slice(0, limit ?? 200);
    const failures: { storageId: string; error: string }[] = [];
    let migrated = 0;
    let bytesMoved = 0;

    const work = async ([storageId, file]: [string, (typeof todo)[number][1]]) => {
      try {
        const blob = await ctx.storage.get(storageId as Id<"_storage">);
        if (!blob) throw new Error("not in Convex storage");
        const bytes = await blob.arrayBuffer();
        const contentType = file.contentType ?? blob.type ?? "application/octet-stream";
        const key = `migrated/${storageId}${extensionFor(contentType)}`;
        const url = await copyAndVerify(config, key, bytes, contentType);
        await ctx.runMutation(internal.cdnMigration.swap, {
          storageId,
          key,
          url,
          slots: file.slots,
        });
        migrated++;
        bytesMoved += bytes.byteLength;
      } catch (error) {
        failures.push({ storageId, error: String(error).slice(0, 300) });
      }
    };

    for (let i = 0; i < todo.length; i += CONCURRENCY) {
      await Promise.all(todo.slice(i, i + CONCURRENCY).map(work));
    }

    return {
      dryRun: false,
      migrated,
      megabytesMoved: Math.round((bytesMoved / 1024 / 1024) * 10) / 10,
      failed: failures.length,
      failures: failures.slice(0, 20),
      remaining: files.size - dangling.length - migrated,
      missingFromConvex: dangling.length,
    };
  },
});
