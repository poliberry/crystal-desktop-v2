import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";

/**
 * Housekeeping that is run by hand rather than on a schedule.
 *
 * Right now that is one job: deleting stored files nothing points at any more.
 * Every cosmetic deletes the blob it replaces, but "every" is a claim about
 * code that has been rewritten several times — an upload abandoned halfway, a
 * mutation that threw between the upload and the document write, a field that
 * was dropped from the schema before anybody thought about its files. Each of
 * those leaves a blob that is billable and unreachable, and nothing else will
 * ever find it.
 */

/**
 * Tables that can hold a storage id, anywhere in a document.
 *
 * Listed rather than discovered because the sweep reads every row of each one,
 * and the two biggest tables in the app — messages and channel messages — hold
 * no files at all: their attachments live in their own tables, which are here.
 * Adding a table with an upload in it means adding it here, and the comment on
 * `referencedIds` explains what happens if somebody forgets.
 */
const TABLES_WITH_FILES = [
  "users",
  "serverProfiles",
  "conversations",
  "communities",
  "channels",
  "messageAttachments",
  "channelMessageAttachments",
  "callParticipants",
  "channelCallParticipants",
  "communityEmojis",
  "communitySounds",
  "profileWidgets",
  "communityWidgets",
] as const;

/**
 * How recently a file may have been uploaded and still be swept.
 *
 * An upload and the document that points at it are two round trips, and
 * everything in between is a file nothing references yet — the crop editor
 * uploads an original *and* a crop before either is saved. An hour is long
 * enough that no honest sequence is still in flight, and short enough that
 * a genuinely abandoned upload doesn't sit around for a week.
 */
const GRACE_MS = 60 * 60 * 1000;

interface StoredFile {
  id: Id<"_storage">;
  size: number;
  createdAt: number;
}

interface StorageSweep {
  files: number;
  referenced: number;
  orphans: number;
  megabytes: number;
  tooRecentToTouch: number;
  deleted: number;
  dryRun: boolean;
}

export const listStorageFiles = internalQuery({
  args: {},
  handler: async (ctx) => {
    const files = await ctx.db.system.query("_storage").collect();
    return files.map((file) => ({
      id: file._id,
      size: file.size,
      createdAt: file._creationTime,
    }));
  },
});

/**
 * Every storage id any document points at.
 *
 * Found by walking each document for strings that *are* one of the ids that
 * exist, rather than by reading the fields we think hold them. Those two are
 * the same thing right up until somebody adds an upload nested inside a widget,
 * or an array of layers — both of which have happened — and the field-by-field
 * version quietly starts deleting files that are in use.
 *
 * Erring this way is also the safe direction: a string that happens to equal a
 * storage id but isn't one costs us a file we could have deleted, which is
 * nothing. Missing a real reference costs somebody their avatar.
 */
export const referencedIds = internalQuery({
  args: { known: v.array(v.string()) },
  handler: async (ctx, { known }) => {
    const exists = new Set(known);
    const found = new Set<string>();

    const walk = (value: unknown) => {
      if (typeof value === "string") {
        if (exists.has(value)) found.add(value);
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) walk(item);
        return;
      }
      if (value && typeof value === "object") {
        for (const item of Object.values(value)) walk(item);
      }
    };

    for (const table of TABLES_WITH_FILES) {
      for (const doc of await ctx.db.query(table).collect()) walk(doc);
    }
    return [...found];
  },
});

export const deleteFiles = internalMutation({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, { ids }) => {
    let deleted = 0;
    for (const id of ids) {
      // Swallowed one at a time: a file that has already gone is not a reason
      // to abandon the rest of the sweep.
      await ctx.storage
        .delete(id as Id<"_storage">)
        .then(() => {
          deleted++;
        })
        .catch(() => {});
    }
    return deleted;
  },
});

/**
 * Delete every stored file nothing points at.
 *
 * An action rather than one mutation because the two halves have different
 * shapes: reading every document that could hold a file is one pass, and the
 * deletes are batched so a large sweep isn't one enormous transaction.
 *
 * Run it with `dryRun` first — it reports exactly what it would remove and how
 * much space that is, without touching anything:
 *
 *     npx convex run maintenance:collectStorageGarbage '{"dryRun":true}'
 *     npx convex run maintenance:collectStorageGarbage
 */
export const collectStorageGarbage = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  // Annotated, and the two reads with it: an action that calls functions from
  // its own module is a cycle as far as inference is concerned, and TypeScript
  // gives up on the lot rather than working round it.
  handler: async (ctx, { dryRun }): Promise<StorageSweep> => {
    const files: StoredFile[] = await ctx.runQuery(
      internal.maintenance.listStorageFiles,
      {},
    );
    const referenced = new Set<string>(
      await ctx.runQuery(internal.maintenance.referencedIds, {
        known: files.map((file) => file.id),
      })
    );

    const cutoff = Date.now() - GRACE_MS;
    const orphans = files.filter(
      (file) => !referenced.has(file.id) && file.createdAt < cutoff
    );
    const bytes = orphans.reduce((sum, file) => sum + file.size, 0);
    const summary = {
      files: files.length,
      referenced: referenced.size,
      orphans: orphans.length,
      // Reported in megabytes, which is the unit anybody deciding whether to
      // run this actually thinks in.
      megabytes: Math.round((bytes / 1024 / 1024) * 100) / 100,
      tooRecentToTouch: files.filter(
        (file) => !referenced.has(file.id) && file.createdAt >= cutoff
      ).length,
    };

    if (dryRun) return { ...summary, deleted: 0, dryRun: true };

    let deleted = 0;
    for (let index = 0; index < orphans.length; index += 100) {
      deleted += await ctx.runMutation(internal.maintenance.deleteFiles, {
        ids: orphans.slice(index, index + 100).map((file) => file.id),
      });
    }
    return { ...summary, deleted, dryRun: false };
  },
});
