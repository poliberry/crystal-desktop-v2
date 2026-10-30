import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import type { UpdaterState } from "./updater";

const api = {
  isElectron: true,
  platform: process.platform,
  /** Which application this window belongs to: "studio" for the standalone Crystal Studio app. */
  appKind: process.argv.includes("--crystal-app=studio") ? ("studio" as const) : ("crystal" as const),
  appInfo: () => ipcRenderer.invoke("app:info"),
  customCss: {
    read: () => ipcRenderer.invoke("custom-css:read"),
    write: (css: string) => ipcRenderer.invoke("custom-css:write", css),
    path: () => ipcRenderer.invoke("custom-css:path"),
    reveal: () => ipcRenderer.invoke("custom-css:reveal"),
  },
  e2ee: {
    available: () => ipcRenderer.invoke("e2ee:store:available"),
    get: (userId: string) => ipcRenderer.invoke("e2ee:store:get", userId),
    set: (userId: string, value: string) => ipcRenderer.invoke("e2ee:store:set", userId, value),
    clear: (userId: string) => ipcRenderer.invoke("e2ee:store:clear", userId),
  },
  system: {
    accentColor: () => ipcRenderer.invoke("system:accent-color"),
    onAccentColorChange: (cb: (color: string | null) => void) => {
      const handler = (_e: IpcRendererEvent, color: string | null) => cb(color);
      ipcRenderer.on("system:accent-color-changed", handler);
      return () => ipcRenderer.removeListener("system:accent-color-changed", handler);
    },
  },
  window: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
    close: () => ipcRenderer.invoke("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
    isFullScreen: () => ipcRenderer.invoke("window:is-fullscreen"),
    onFullScreenChange: (cb: (fullScreen: boolean) => void) => {
      const handler = (_e: IpcRendererEvent, fullScreen: boolean) => cb(fullScreen);
      ipcRenderer.on("window:fullscreen-changed", handler);
      return () => ipcRenderer.removeListener("window:fullscreen-changed", handler);
    },
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
    getLaunchUpdate: () => ipcRenderer.invoke("updater:launch-update"),
    setLaunchUpdate: (enabled: boolean) => ipcRenderer.invoke("updater:set-launch-update", enabled),
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
    permission: () => ipcRenderer.invoke("screen-share:permission"),
    openPermissionSettings: () => ipcRenderer.invoke("screen-share:open-permission-settings"),
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
    /** The background notifier asking for a one-line preview of an encrypted message. Only the
     * renderer holds keys; the answer goes back to main for the OS toast and nowhere else. */
    onDecryptRequest: (cb: (request: DecryptRequest) => Promise<string | null>) => {
      const handler = (_e: IpcRendererEvent, id: string, request: DecryptRequest) => {
        void Promise.resolve()
          .then(() => cb(request))
          .catch(() => null)
          .then((text) => ipcRenderer.send("notifications:decrypt-result", id, typeof text === "string" ? text : null));
      };
      ipcRenderer.on("notifications:decrypt", handler);
      return () => ipcRenderer.removeListener("notifications:decrypt", handler);
    },
  },
  badge: {
    /** `overlayDataUrl` is a PNG the renderer drew — see use-app-badge.ts.
     * Only Windows uses it; the other platforms draw their own from `count`. */
    set: (count: number, overlayDataUrl: string | null) =>
      ipcRenderer.invoke("badge:set", count, overlayDataUrl),
  },
  auth: {
    onCallback: (cb: (url: string) => void) => {
      const handler = (_e: IpcRendererEvent, url: string) => cb(url);
      ipcRenderer.on("auth:callback", handler);
      return () => ipcRenderer.removeListener("auth:callback", handler);
    },
  },
  invites: {
    /** Fires when the OS hands us a `crystal://invite/<code>` link. */
    onOpen: (cb: (code: string) => void) => {
      const handler = (_e: IpcRendererEvent, code: string) => cb(code);
      ipcRenderer.on("invite:open", handler);
      return () => ipcRenderer.removeListener("invite:open", handler);
    },
  },
  /** Tells the app the page can take deep links now (invites, add-a-bot links); queued ones are sent. */
  deeplinks: {
    ready: () => ipcRenderer.send("deeplink:ready"),
  },
  /** Fires when a link to add a bot or an extension reaches the app: its query string. */
  installs: {
    onOpen: (cb: (search: string) => void) => {
      const handler = (_e: IpcRendererEvent, search: string) => cb(search);
      ipcRenderer.on("install:open", handler);
      return () => ipcRenderer.removeListener("install:open", handler);
    },
  },
  /** Fires when a link to a place in the app arrives (crystal://dm/<id> and the like): its hash route. */
  routes: {
    onOpen: (cb: (hash: string) => void) => {
      const handler = (_e: IpcRendererEvent, hash: string) => cb(hash);
      ipcRenderer.on("route:open", handler);
      return () => ipcRenderer.removeListener("route:open", handler);
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
  editor: {
    open: (options: { kind: "frame" | "decoration"; scopeId?: string; scopeName?: string }) =>
      ipcRenderer.invoke("editor:open", options),
  },
  studio: {
    open: () => ipcRenderer.invoke("studio:open"),
    openCrystal: () => ipcRenderer.invoke("studio:open-crystal"),
    /** Studio's project files. Paths are relative to Documents/Crystal Studio. */
    fs: {
      root: () => ipcRenderer.invoke("studio:fs:root"),
      listDir: (rel: string) => ipcRenderer.invoke("studio:fs:listDir", rel),
      exists: (rel: string) => ipcRenderer.invoke("studio:fs:exists", rel),
      readText: (rel: string) => ipcRenderer.invoke("studio:fs:readText", rel),
      writeText: (rel: string, text: string) => ipcRenderer.invoke("studio:fs:writeText", rel, text),
      readBytes: (rel: string) => ipcRenderer.invoke("studio:fs:readBytes", rel),
      writeBytes: (rel: string, data: Uint8Array) => ipcRenderer.invoke("studio:fs:writeBytes", rel, data),
      mkdir: (rel: string) => ipcRenderer.invoke("studio:fs:mkdir", rel),
      removeFile: (rel: string) => ipcRenderer.invoke("studio:fs:removeFile", rel),
      trash: (rel: string) => ipcRenderer.invoke("studio:fs:trash", rel),
      rename: (from: string, to: string) => ipcRenderer.invoke("studio:fs:rename", from, to),
      reveal: (rel: string) => ipcRenderer.invoke("studio:fs:reveal", rel),
    },
    /** A terminal in a project folder (Studio window only). */
    terminal: {
      open: (folder: string, cols: number, rows: number) => ipcRenderer.invoke("studio:term:open", folder, cols, rows),
      write: (id: string, data: string) => ipcRenderer.invoke("studio:term:write", id, data),
      resize: (id: string, cols: number, rows: number) => ipcRenderer.invoke("studio:term:resize", id, cols, rows),
      kill: (id: string) => ipcRenderer.invoke("studio:term:kill", id),
      onData: (cb: (id: string, data: string) => void) => {
        const h = (_e: IpcRendererEvent, id: string, data: string) => cb(id, data);
        ipcRenderer.on("studio:term:data", h);
        return () => ipcRenderer.removeListener("studio:term:data", h);
      },
      onExit: (cb: (id: string, code: number) => void) => {
        const h = (_e: IpcRendererEvent, id: string, code: number) => cb(id, code);
        ipcRenderer.on("studio:term:exit", h);
        return () => ipcRenderer.removeListener("studio:term:exit", h);
      },
    },
    /** Bundle an extension project's src/ into dist/extension.js. */
    build: {
      extension: (folder: string) => ipcRenderer.invoke("studio:build:extension", folder),
    },
    /** Git in a project folder, and publishing it to GitHub. Every call answers `{ ok, value | message }`. */
    git: {
      status: (folder: string) => ipcRenderer.invoke("studio:git:status", folder),
      init: (folder: string) => ipcRenderer.invoke("studio:git:init", folder),
      diff: (folder: string, req: unknown) => ipcRenderer.invoke("studio:git:diff", folder, req),
      stage: (folder: string, paths: string[]) => ipcRenderer.invoke("studio:git:stage", folder, paths),
      stageAll: (folder: string) => ipcRenderer.invoke("studio:git:stageAll", folder),
      unstage: (folder: string, paths: string[]) => ipcRenderer.invoke("studio:git:unstage", folder, paths),
      unstageAll: (folder: string) => ipcRenderer.invoke("studio:git:unstageAll", folder),
      discard: (folder: string, paths: string[]) => ipcRenderer.invoke("studio:git:discard", folder, paths),
      commit: (folder: string, message: string, identity?: { name: string; email: string }) => ipcRenderer.invoke("studio:git:commit", folder, message, identity),
      push: (folder: string) => ipcRenderer.invoke("studio:git:push", folder),
      pull: (folder: string) => ipcRenderer.invoke("studio:git:pull", folder),
      fetch: (folder: string) => ipcRenderer.invoke("studio:git:fetch", folder),
      setRemote: (folder: string, url: string) => ipcRenderer.invoke("studio:git:setRemote", folder, url),
      branches: (folder: string) => ipcRenderer.invoke("studio:git:branches", folder),
      checkout: (folder: string, branch: string, create: boolean) => ipcRenderer.invoke("studio:git:checkout", folder, branch, create),
      github: {
        account: () => ipcRenderer.invoke("studio:github:account"),
        connect: (token: string) => ipcRenderer.invoke("studio:github:connect", token),
        disconnect: () => ipcRenderer.invoke("studio:github:disconnect"),
        publish: (folder: string, req: unknown) => ipcRenderer.invoke("studio:github:publish", folder, req),
      },
    },
    /** Programs on this computer that can open a project folder. */
    openIn: {
      list: () => ipcRenderer.invoke("studio:openIn:list"),
      open: (folder: string, id: string) => ipcRenderer.invoke("studio:openIn:open", folder, id),
    },
  },
  admin: {
    open: () => ipcRenderer.invoke("admin:open"),
  },
  clipboard: {
    writeImage: (buffer: ArrayBuffer, mimeType: string) =>
      ipcRenderer.invoke("clipboard:write-image", buffer, mimeType),
  },
  call: {
    setActive: (active: boolean) => ipcRenderer.invoke("call:active", active),
  },
  app: {
    gc: () => ipcRenderer.invoke("app:gc"),
  },
  gpu: {
    get: () => ipcRenderer.invoke("gpu:get"),
    setDisabled: (disabled: boolean) => ipcRenderer.invoke("gpu:set-disabled", disabled),
    relaunch: () => ipcRenderer.invoke("gpu:relaunch"),
  },
};

type NavigateTarget =
  | { kind: "conversation"; conversationId: string }
  | { kind: "channel"; communityId: string; channelId: string };

/** Mirrors `DecryptRequest` in backgroundNotifier.ts (preload can't share its module graph). */
type DecryptRequest = {
  userId: string;
  scope: "conversation" | "channel";
  targetId: string;
  authorId: string;
  enc: { keyId: string; iv: string; ct: string };
};

contextBridge.exposeInMainWorld("desktopAPI", api);
