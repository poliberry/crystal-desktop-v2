import { getDesktopAPI } from "@/lib/desktop";
import type { AssetMeta, Project } from "@/studio/model/types";
import { createDiskStore } from "@/studio/storage/disk";
import { idbStore } from "@/studio/storage/idb";
import type { LoadError, StorageInfo, StudioStorage } from "@/studio/storage/types";

/**
 * Where Studio keeps projects, decided once: files in Documents/Crystal Studio in the desktop app,
 * the browser's own storage on the web (a page can't write to a folder). Everything else in Studio
 * calls these functions and neither knows nor cares which it got.
 */

let store: StudioStorage | null = null;

function backend(): StudioStorage {
  if (store) return store;
  const fs = getDesktopAPI()?.studio?.fs;
  store = fs ? createDiskStore(fs, idbStore) : idbStore;
  return store;
}

export const listProjects = (): Promise<Project[]> => backend().listProjects();
export const getProject = (id: string): Promise<Project | null> => backend().getProject(id);
export const saveProject = (project: Project): Promise<void> => backend().saveProject(project);
export const deleteProject = (id: string): Promise<void> => backend().deleteProject(id);
export const listAssets = (projectId: string): Promise<AssetMeta[]> => backend().listAssets(projectId);
export const putAsset = (meta: AssetMeta, blob: Blob): Promise<void> => backend().putAsset(meta, blob);
export const getAssetBlob = (id: string): Promise<Blob | null> => backend().getAssetBlob(id);
export const deleteAsset = (id: string): Promise<void> => backend().deleteAsset(id);

export const projectFolder = (id: string): Promise<string | null> => backend().projectFolder(id);
export const storageInfo = (): StorageInfo => backend().info();
export const storageLoadErrors = (): LoadError[] => backend().loadErrors();
export const revealStorage = (): Promise<void> => backend().reveal();
