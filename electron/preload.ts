import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import type { UpdaterState } from "./updater";

const api = {
  isElectron: true,
  platform: process.platform,
  appInfo: () => ipcRenderer.invoke("app:info"),
  settings: {
    open: () => ipcRenderer.invoke("settings:open"),
  },
  window: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
    close: () => ipcRenderer.invoke("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
    setZoomFactor: (factor: number) => ipcRenderer.invoke("window:set-zoom", factor),
    onMaximizedChange: (cb: (maximized: boolean) => void) => {
      const handler = (_e: IpcRendererEvent, maximized: boolean) => cb(maximized);
      ipcRenderer.on("window:maximized-changed", handler);
      return () => ipcRenderer.removeListener("window:maximized-changed", handler);
    },
  },
  updater: {
    getState: () => ipcRenderer.invoke("updater:state"),
    check: () => ipcRenderer.invoke("updater:check"),
    download: () => ipcRenderer.invoke("updater:download"),
    install: () => ipcRenderer.invoke("updater:install"),
    openReleases: () => ipcRenderer.invoke("updater:open-releases"),
    onStateChange: (cb: (state: UpdaterState) => void) => {
      const handler = (_e: IpcRendererEvent, state: UpdaterState) => cb(state);
      ipcRenderer.on("updater:state-changed", handler);
      return () => ipcRenderer.removeListener("updater:state-changed", handler);
    },
  },
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
  richPresence: {
    get: () => ipcRenderer.invoke("rich-presence:get"),
    status: () => ipcRenderer.invoke("rich-presence:status"),
    setEnabled: (enabled: boolean) => ipcRenderer.invoke("rich-presence:set-enabled", enabled),
    onChange: (cb: (activities: unknown[]) => void) => {
      const handler = (_e: IpcRendererEvent, activities: unknown[]) => cb(activities);
      ipcRenderer.on("rich-presence:changed", handler);
      return () => ipcRenderer.removeListener("rich-presence:changed", handler);
    },
  },
  notifications: {
    configure: (url: string, token: string | null, userId: string | null) =>
      ipcRenderer.invoke("notifications:configure", url, token, userId),
    setActiveView: (view: { kind: "conversation" | "channel"; id: string } | null) =>
      ipcRenderer.invoke("notifications:set-active-view", view),
    onNavigate: (cb: (target: NavigateTarget) => void) => {
      const handler = (_e: IpcRendererEvent, target: NavigateTarget) => cb(target);
      ipcRenderer.on("notifications:navigate", handler);
      return () => ipcRenderer.removeListener("notifications:navigate", handler);
    },
  },
  auth: {
    onCallback: (cb: (url: string) => void) => {
      const handler = (_e: IpcRendererEvent, url: string) => cb(url);
      ipcRenderer.on("auth:callback", handler);
      return () => ipcRenderer.removeListener("auth:callback", handler);
    },
  },
  pip: {
    open: (options?: { width?: number; height?: number; title?: string }) =>
      ipcRenderer.invoke("pip:open", options),
    close: () => ipcRenderer.invoke("pip:close"),
    sendFrame: (dataUrl: string) => ipcRenderer.send("pip:send-frame", dataUrl),
    onFrame: (cb: (dataUrl: string) => void) => {
      const handler = (_e: IpcRendererEvent, dataUrl: string) => cb(dataUrl);
      ipcRenderer.on("pip:frame", handler);
      return () => ipcRenderer.removeListener("pip:frame", handler);
    },
    onClosed: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on("pip:closed", handler);
      return () => ipcRenderer.removeListener("pip:closed", handler);
    },
    onSize: (cb: (size: { width: number; height: number }) => void) => {
      const handler = (_e: IpcRendererEvent, size: { width: number; height: number }) => cb(size);
      ipcRenderer.on("pip:size", handler);
      return () => ipcRenderer.removeListener("pip:size", handler);
    },
  },
};

type NavigateTarget =
  | { kind: "conversation"; conversationId: string }
  | { kind: "channel"; communityId: string; channelId: string };

contextBridge.exposeInMainWorld("desktopAPI", api);
