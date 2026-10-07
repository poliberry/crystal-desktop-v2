import type { AssetMeta, Project } from "@/studio/model/types";

/**
 * Where Studio keeps projects: in the browser's IndexedDB, on this device.
 *
 * Nothing here ever leaves the machine until a creator presses Submit, which is
 * the point — a half-finished design is theirs alone. Project documents are small
 * JSON; the files they use are stored as blobs beside them, keyed by asset id, so
 * a picture is stored once however many nodes use it.
 */

const DB_NAME = "crystal-studio";
const VERSION = 1;

let opened: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (opened) return opened;
  opened = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
      if (!db.objectStoreNames.contains("assets")) {
        const assets = db.createObjectStore("assets", { keyPath: "id" });
        assets.createIndex("by_project", "projectId");
      }
      if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opened = null;
      reject(request.error ?? new Error("Couldn't open Studio's storage."));
    };
  });
  return opened;
}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function tx<T>(stores: string[], mode: IDBTransactionMode, run: (t: IDBTransaction) => Promise<T> | T): Promise<T> {
  const db = await open();
  const t = db.transaction(stores, mode);
  const done = new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
  const result = await run(t);
  await done;
  return result;
}

// --- Projects ------------------------------------------------------------------------------

export async function listProjects(): Promise<Project[]> {
  const all = await tx(["projects"], "readonly", (t) => wrap(t.objectStore("projects").getAll() as IDBRequest<Project[]>));
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<Project | null> {
  return (await tx(["projects"], "readonly", (t) => wrap(t.objectStore("projects").get(id) as IDBRequest<Project | undefined>))) ?? null;
}

export async function saveProject(project: Project): Promise<void> {
  await tx(["projects"], "readwrite", (t) => wrap(t.objectStore("projects").put({ ...project, updatedAt: Date.now() })));
}

export async function deleteProject(id: string): Promise<void> {
  const assets = await listAssets(id);
  await tx(["projects", "assets", "blobs"], "readwrite", async (t) => {
    t.objectStore("projects").delete(id);
    for (const a of assets) {
      t.objectStore("assets").delete(a.id);
      t.objectStore("blobs").delete(a.id);
    }
  });
}

// --- Assets --------------------------------------------------------------------------------

export async function listAssets(projectId: string): Promise<AssetMeta[]> {
  return tx(["assets"], "readonly", (t) => wrap(t.objectStore("assets").index("by_project").getAll(projectId) as IDBRequest<AssetMeta[]>));
}

export async function putAsset(meta: AssetMeta, blob: Blob): Promise<void> {
  await tx(["assets", "blobs"], "readwrite", async (t) => {
    t.objectStore("assets").put(meta);
    t.objectStore("blobs").put(blob, meta.id);
  });
}

export async function getAssetBlob(id: string): Promise<Blob | null> {
  return (await tx(["blobs"], "readonly", (t) => wrap(t.objectStore("blobs").get(id) as IDBRequest<Blob | undefined>))) ?? null;
}

export async function deleteAsset(id: string): Promise<void> {
  await tx(["assets", "blobs"], "readwrite", async (t) => {
    t.objectStore("assets").delete(id);
    t.objectStore("blobs").delete(id);
  });
}
