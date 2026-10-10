import { contextBridge, ipcRenderer } from "electron";

import type { ComponentId } from "./core";
import type { InstallState, ResolvedPlan, Selection } from "./engine";

/** What the installer's window can ask of the main process. Nothing else is reachable from the page. */
const api = {
  info: (): Promise<{
    platform: "win32" | "darwin" | "linux";
    arch: string;
    channel: string;
    channelLabel: string;
    version: string;
    defaultBase: string;
    installed: Record<ComponentId, boolean>;
    appsInOwnFolder: boolean;
  }> => ipcRenderer.invoke("installer:info"),
  plan: (): Promise<ResolvedPlan> => ipcRenderer.invoke("installer:plan"),
  state: (): Promise<InstallState> => ipcRenderer.invoke("installer:state"),
  targets: (base: string): Promise<Record<ComponentId, string>> => ipcRenderer.invoke("installer:targets", base),
  chooseFolder: (current: string): Promise<string | null> => ipcRenderer.invoke("installer:choose-folder", current),
  checkFolder: (dir: string): Promise<{ ok: boolean; reason: string | null }> => ipcRenderer.invoke("installer:check-folder", dir),
  start: (selection: Selection): Promise<void> => ipcRenderer.invoke("installer:start", selection),
  cancel: (): Promise<void> => ipcRenderer.invoke("installer:cancel"),
  launch: (ids: ComponentId[], base: string): Promise<void> => ipcRenderer.invoke("installer:launch", ids, base),
  openReleases: (): Promise<void> => ipcRenderer.invoke("installer:open-releases"),
  quit: (): Promise<void> => ipcRenderer.invoke("installer:quit"),
  minimize: (): Promise<void> => ipcRenderer.invoke("installer:minimize"),
  onState: (cb: (s: InstallState) => void): (() => void) => {
    const listener = (_e: unknown, s: InstallState) => cb(s);
    ipcRenderer.on("installer:state", listener);
    return () => ipcRenderer.removeListener("installer:state", listener);
  },
};

contextBridge.exposeInMainWorld("installer", api);
export type InstallerApi = typeof api;
