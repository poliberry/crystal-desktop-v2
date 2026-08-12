import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

const api = {
  isElectron: true,
  platform: process.platform,
  appInfo: () => ipcRenderer.invoke("app:info"),
  systemAudio: {
    enable: () => ipcRenderer.invoke("system-audio:enable"),
    disable: () => ipcRenderer.invoke("system-audio:disable"),
    info: () => ipcRenderer.invoke("system-audio:info"),
  },
  systemAudioLinux: {
    enable: () => ipcRenderer.invoke("system-audio-linux:enable"),
    disable: () => ipcRenderer.invoke("system-audio-linux:disable"),
    info: () => ipcRenderer.invoke("system-audio-linux:info"),
    listAudioApps: () => ipcRenderer.invoke("system-audio-linux:list-apps"),
    setMode: (mode: "system" | "app", appIds: string[] = []) =>
      ipcRenderer.invoke("system-audio-linux:set-mode", mode, appIds),
    onAudio: (cb: (data: ArrayBuffer) => void) => {
      const handler = (_e: IpcRendererEvent, data: ArrayBuffer) => cb(data);
      ipcRenderer.on("system-audio-linux:audio", handler);
      return () => ipcRenderer.removeListener("system-audio-linux:audio", handler);
    },
  },
  systemAudioMac: {
    enable: () => ipcRenderer.invoke("system-audio-mac:enable"),
    disable: () => ipcRenderer.invoke("system-audio-mac:disable"),
    info: () => ipcRenderer.invoke("system-audio-mac:info"),
    onAudio: (cb: (data: ArrayBuffer) => void) => {
      const handler = (_e: IpcRendererEvent, data: ArrayBuffer) => cb(data);
      ipcRenderer.on("system-audio-mac:audio", handler);
      return () => ipcRenderer.removeListener("system-audio-mac:audio", handler);
    },
  },
  screenShare: {
    getSources: () => ipcRenderer.invoke("screen-share:get-sources"),
    setSource: (id: string) => ipcRenderer.invoke("screen-share:set-source", id),
  },
};

contextBridge.exposeInMainWorld("desktopAPI", api);
