import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { appIdentity, type ChannelDefinition } from "../channels";
import { newestRelease } from "../releases";
import {
  COMPONENTS,
  type ComponentId,
  type Platform,
  componentDir,
  desktopEntry,
  digestMatches,
  launchTarget,
  metadataName,
  nsisArgs,
  parseMetadata,
  pickInstaller,
  safeFileName,
  unsupportedReason,
} from "./core";

/** What one installable app looks like once the release has been read. */
export interface ResolvedComponent {
  id: ComponentId;
  title: string;
  blurb: string;
  productName: string;
  /** Bytes to download. 0 when the release has no file for this app. */
  size: number;
  /** Set when the app can't be installed from this release, and why (shown instead of its size). */
  unavailable: string | null;
}

export interface ResolvedPlan {
  channelLabel: string;
  version: string;
  /** Set when this computer can't have any of it. */
  unsupported: string | null;
  components: ResolvedComponent[];
}

interface Source {
  url: string;
  fileName: string;
  size: number;
  sha512: string;
}

export interface Selection {
  components: ComponentId[];
  /** The folder chosen on the location step. */
  base: string;
  /** A shortcut on the desktop (Windows and Linux; a Mac's app is dragged out of /Applications if wanted). */
  desktopShortcut: boolean;
}

export type ItemStatus = "waiting" | "downloading" | "verifying" | "installing" | "done" | "failed";

export interface ItemState {
  id: ComponentId;
  title: string;
  status: ItemStatus;
  received: number;
  size: number;
  /** Shown beneath it: what is happening, or what went wrong. */
  note: string;
}

export interface InstallState {
  phase: "idle" | "working" | "done" | "failed" | "cancelled";
  /** 0 to 1 across everything selected. */
  progress: number;
  items: ItemState[];
  error: string | null;
}

export const IDLE: InstallState = { phase: "idle", progress: 0, items: [], error: null };

export interface EngineOptions {
  platform: Platform;
  arch: string;
  channel: ChannelDefinition;
  /** Where the desktop is, for shortcuts. */
  desktopDir: string;
  /** Icons shipped with the installer, by app, for the Linux menu entries. */
  iconFor: (id: ComponentId) => string | null;
  fetchImpl?: typeof fetch;
}

/**
 * Reads the channel's newest release and says what can be installed from it. Throws, with a message fit to show, if the
 * release can't be found or read.
 */
export class Engine {
  private sources = new Map<ComponentId, Source>();
  private tmp: string | null = null;
  private abort: AbortController | null = null;
  private state: InstallState = IDLE;
  private listeners = new Set<(s: InstallState) => void>();

  constructor(private readonly o: EngineOptions) {}

  onState(cb: (s: InstallState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  getState(): InstallState {
    return this.state;
  }

  private set(patch: Partial<InstallState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  private setItem(id: ComponentId, patch: Partial<ItemState>): void {
    this.set({ items: this.state.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  }

  async resolve(): Promise<ResolvedPlan> {
    const { channel, platform, arch } = this.o;
    const fetchImpl = this.o.fetchImpl ?? fetch;
    const release = await newestRelease(channel, fetchImpl).catch((e: unknown) => {
      throw new Error(`Couldn't reach the release server. Check your connection and try again. (${e instanceof Error ? e.message : String(e)})`);
    });
    if (!release) throw new Error(`No ${channel.label} release has been published yet.`);
    const unsupported = unsupportedReason(platform, arch);

    this.sources.clear();
    const components: ResolvedComponent[] = [];
    for (const c of COMPONENTS) {
      const productName = appIdentity(channel, c.kind).productName;
      const base = { id: c.id, title: c.title, blurb: c.blurb, productName };
      const metaAsset = release.assets.find((a) => a.name === metadataName(c.kind, platform));
      if (!metaAsset) {
        components.push({ ...base, size: 0, unavailable: `Not part of this release for ${platform === "darwin" ? "Mac" : platform === "win32" ? "Windows" : "Linux"}.` });
        continue;
      }
      try {
        const res = await fetchImpl(metaAsset.url, { headers: { "User-Agent": "crystal-installer" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const pick = pickInstaller(parseMetadata(await res.text()), platform);
        if (!pick) throw new Error("no installer in the file list");
        const wanted = decodeURIComponent(pick.url);
        const asset = release.assets.find((a) => a.name === wanted);
        if (!asset) throw new Error(`${wanted} is missing from the release`);
        this.sources.set(c.id, { url: asset.url, fileName: safeFileName(asset.name), size: pick.size || asset.size, sha512: pick.sha512 });
        components.push({ ...base, size: pick.size || asset.size, unavailable: null });
      } catch (e) {
        components.push({ ...base, size: 0, unavailable: `Couldn't read this release's files for it (${e instanceof Error ? e.message : String(e)}).` });
      }
    }
    return { channelLabel: channel.label, version: release.version, unsupported, components };
  }

  cancel(): void {
    this.abort?.abort();
  }

  /** Where each app will be once installed, for a folder: shown on the review step. */
  targets(base: string): Record<ComponentId, string> {
    const out = {} as Record<ComponentId, string>;
    for (const c of COMPONENTS) {
      const identity = appIdentity(this.o.channel, c.kind);
      out[c.id] = launchTarget(this.o.platform, base, identity.productName, identity.fileName);
    }
    return out;
  }

  /**
   * Installs the selected apps, one after another: fetch, check, install. Anything that fails stops the run and is
   * reported on its row; running it again carries on from the first one that isn't done.
   */
  async install(selection: Selection): Promise<void> {
    if (this.state.phase === "working") return;
    const wanted = COMPONENTS.filter((c) => selection.components.includes(c.id));
    const previous = new Map(this.state.items.map((i) => [i.id, i]));
    const items: ItemState[] = wanted.map((c) => {
      const kept = previous.get(c.id);
      const src = this.sources.get(c.id);
      return kept?.status === "done" ? kept : { id: c.id, title: c.title, status: "waiting", received: 0, size: src?.size ?? 0, note: "Waiting" };
    });
    this.abort = new AbortController();
    const { signal } = this.abort;
    this.set({ phase: "working", error: null, items, progress: this.progressOf(items) });
    this.tmp ??= await fs.promises.mkdtemp(path.join(os.tmpdir(), "crystal-installer-"));

    try {
      for (const item of items) {
        if (item.status === "done") continue;
        const comp = COMPONENTS.find((c) => c.id === item.id)!;
        const src = this.sources.get(item.id);
        if (!src) throw new Error(`${item.title} isn't available in this release.`);
        const identity = appIdentity(this.o.channel, comp.kind);
        try {
          this.setItem(item.id, { status: "downloading", note: "Downloading", received: 0 });
          const file = await this.download(item.id, src, signal);
          this.setItem(item.id, { status: "installing", note: "Installing" });
          this.set({ progress: this.progressOf(this.state.items) });
          await this.place(file, identity.productName, identity.fileName, comp.id, identity.scheme, selection, signal);
          await fs.promises.rm(file, { force: true });
          this.setItem(item.id, { status: "done", note: "Installed", received: src.size });
          this.set({ progress: this.progressOf(this.state.items) });
        } catch (e) {
          if (!signal.aborted) this.setItem(item.id, { status: "failed", note: message(e) });
          throw e;
        }
      }
      this.set({ phase: "done", progress: 1 });
    } catch (e) {
      if (signal.aborted) this.set({ phase: "cancelled", error: null, items: this.state.items.map((i) => (i.status === "done" ? i : { ...i, status: "waiting", note: "Cancelled", received: 0 })) });
      else this.set({ phase: "failed", error: message(e) });
    } finally {
      this.abort = null;
    }
  }

  /** Weighted: the download is most of the wait, the install the rest. */
  private progressOf(items: ItemState[]): number {
    if (!items.length) return 0;
    const total = items.reduce((n, i) => n + i.size, 0) || 1;
    const got = items.reduce((n, i) => n + (i.status === "done" ? i.size : Math.min(i.received, i.size)), 0);
    const installed = items.filter((i) => i.status === "done").length;
    return Math.min(1, 0.88 * (got / total) + 0.12 * (installed / items.length));
  }

  private async download(id: ComponentId, src: Source, signal: AbortSignal): Promise<string> {
    const dest = path.join(this.tmp!, src.fileName);
    const res = await (this.o.fetchImpl ?? fetch)(src.url, { signal, headers: { "User-Agent": "crystal-installer" } });
    if (!res.ok || !res.body) throw new Error(`The download failed (HTTP ${res.status}).`);
    const hash = createHash("sha512");
    let received = 0;
    let lastTick = 0;
    const meter = new Transform({
      transform: (chunk: Buffer, _enc, cb) => {
        hash.update(chunk);
        received += chunk.length;
        const now = Date.now();
        if (now - lastTick > 80) {
          lastTick = now;
          this.setItem(id, { received });
          this.set({ progress: this.progressOf(this.state.items) });
        }
        cb(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(res.body as never), meter, fs.createWriteStream(dest), { signal });
    } catch (e) {
      // Cancelled, or the connection dropped: a half-written file is no use to anyone, and must not be mistaken for a download.
      await fs.promises.rm(dest, { force: true });
      throw e;
    }
    this.setItem(id, { received, status: "verifying", note: "Checking the download" });
    if (!digestMatches(src.sha512, hash.digest("base64"))) {
      await fs.promises.rm(dest, { force: true });
      throw new Error("The download didn't match what the release published, so it was thrown away. Try again.");
    }
    return dest;
  }

  /** Puts a downloaded app where it belongs, the way the platform expects. */
  private async place(file: string, productName: string, fileName: string, id: ComponentId, scheme: string, sel: Selection, signal: AbortSignal): Promise<void> {
    const { platform } = this.o;
    if (platform === "win32") {
      const dir = componentDir(platform, sel.base, productName);
      const shortcut = path.win32.join(this.o.desktopDir, `${productName}.lnk`);
      const had = fs.existsSync(shortcut);
      await run(file, nsisArgs(dir), signal, true);
      // The setup always makes a desktop shortcut; remove the one it just made if none was asked for (never one that was already there).
      if (!sel.desktopShortcut && !had) await fs.promises.rm(shortcut, { force: true });
      return;
    }
    await fs.promises.mkdir(sel.base, { recursive: true });
    if (platform === "darwin") {
      const staging = path.join(this.tmp!, `extract-${id}`);
      await fs.promises.rm(staging, { recursive: true, force: true });
      await run("/usr/bin/ditto", ["-x", "-k", file, staging], signal);
      const app = (await fs.promises.readdir(staging)).find((n) => n.endsWith(".app"));
      if (!app) throw new Error("The download didn't contain an app.");
      const target = launchTarget(platform, sel.base, productName, fileName);
      await fs.promises.rm(target, { recursive: true, force: true });
      await run("/usr/bin/ditto", [path.join(staging, app), target], signal);
      // Fetched by this installer rather than a browser, so macOS hasn't flagged it; clear any flag all the same.
      await run("/usr/bin/xattr", ["-dr", "com.apple.quarantine", target], signal).catch(() => {});
      await fs.promises.rm(staging, { recursive: true, force: true });
      return;
    }
    const target = launchTarget(platform, sel.base, productName, fileName);
    await fs.promises.copyFile(file, target);
    await fs.promises.chmod(target, 0o755);
    const home = os.homedir();
    const iconName = fileName.toLowerCase();
    const iconSrc = this.o.iconFor(id);
    const iconDir = path.join(home, ".local", "share", "icons", "hicolor", "512x512", "apps");
    if (iconSrc) {
      await fs.promises.mkdir(iconDir, { recursive: true });
      await fs.promises.copyFile(iconSrc, path.join(iconDir, `${iconName}.png`));
    }
    const entry = desktopEntry({ name: productName, comment: COMPONENTS.find((c) => c.id === id)!.blurb, exec: target, icon: iconName, scheme, wmClass: productName });
    const appsDir = path.join(home, ".local", "share", "applications");
    await fs.promises.mkdir(appsDir, { recursive: true });
    await fs.promises.writeFile(path.join(appsDir, `${iconName}.desktop`), entry, { mode: 0o755 });
    await run("update-desktop-database", [appsDir], signal).catch(() => {});
    if (sel.desktopShortcut && fs.existsSync(this.o.desktopDir)) await fs.promises.writeFile(path.join(this.o.desktopDir, `${productName}.desktop`), entry, { mode: 0o755 });
  }

  /** Starts an installed app and lets it go. */
  launch(ids: ComponentId[], base: string): void {
    const { platform, channel } = this.o;
    for (const id of ids) {
      const comp = COMPONENTS.find((c) => c.id === id);
      if (!comp) continue;
      const identity = appIdentity(channel, comp.kind);
      const target = launchTarget(platform, base, identity.productName, identity.fileName);
      const child = platform === "darwin" ? spawn("/usr/bin/open", [target], { detached: true, stdio: "ignore" }) : spawn(target, [], { detached: true, stdio: "ignore" });
      child.on("error", () => {});
      child.unref();
    }
  }

  /** Synchronous so it finishes before the process does, when called as the app quits. */
  cleanup(): void {
    if (this.tmp) fs.rmSync(this.tmp, { recursive: true, force: true });
    this.tmp = null;
  }
}

function message(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (/EACCES|EPERM/.test(raw)) return "This folder can't be written to. Go back and choose another.";
  if (/ENOSPC/.test(raw)) return "There isn't enough room on the disk.";
  return raw.replace(/^Error: /, "");
}

/**
 * Runs a program and waits. `verbatim` is for the Windows setup, whose `/D=` folder must reach it unquoted, spaces and
 * all, or it installs somewhere else.
 */
function run(cmd: string, args: string[], signal: AbortSignal, verbatim = false): Promise<void> {
  return new Promise((resolve, reject) => {
    // Verbatim means nothing is quoted for us, the program's own path included: a profile folder with a space in it would
    // otherwise split the command line in the wrong place, so it is quoted here (the file to run is still `cmd`, unquoted).
    const child = spawn(cmd, args, { stdio: "ignore", signal, ...(verbatim ? { windowsVerbatimArguments: true, argv0: `"${cmd}"` } : {}) });
    child.on("error", (e) => reject(e));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} stopped with code ${code}.`))));
  });
}
