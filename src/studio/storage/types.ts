import type { AssetMeta, Project } from "@/studio/model/types";

/** Where a project's files are kept, for the status bar. */
export type StorageInfo = { kind: "disk"; root: string } | { kind: "browser" };

/** A project folder that couldn't be opened (or opened with a problem), and why. */
export interface LoadError {
  folder: string;
  /** An error means the project didn't open; a warning means it did, with something wrong. */
  level: "error" | "warning";
  message: string;
}

/**
 * What Studio needs of wherever it keeps projects. There are two: a folder in Documents (the desktop
 * app — disk.ts) and the browser's IndexedDB (the web build — idb.ts). Everything else in Studio
 * goes through db.ts and doesn't know which.
 */
export interface StudioStorage {
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  saveProject(project: Project): Promise<void>;
  deleteProject(id: string): Promise<void>;
  listAssets(projectId: string): Promise<AssetMeta[]>;
  putAsset(meta: AssetMeta, blob: Blob): Promise<void>;
  getAssetBlob(id: string): Promise<Blob | null>;
  deleteAsset(id: string): Promise<void>;
  /** The project's folder name under the Studio folder, where there is one (desktop only). Can change when the project is renamed, so ask each time. */
  projectFolder(id: string): Promise<string | null>;
  info(): StorageInfo;
  /** Projects found on the last listing that couldn't be read. */
  loadErrors(): LoadError[];
  /** Show the projects folder in Finder / Explorer, where there is one. */
  reveal(): Promise<void>;
}
