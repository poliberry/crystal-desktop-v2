import { spawn, spawnSync } from "node:child_process";
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
  aurSnapshotUrl,
  componentDir,
  desktopEntry,
  digestMatches,
  elevatedAppleScript,
  installBundleScript,
  launchTarget,
  metadataName,
  needsAdmin,
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
  /**
   * Install through the Arch User Repository instead of placing an AppImage (see `chooseAur`): each app is built from its
   * AUR package and installed with pacman, so it is owned by the package manager and updated by it.
   */
  aur?: boolean;
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
  /** Whether apps are installed from the AUR. Starts as asked for, and turns off if the AUR has no package yet. */
  private viaAur: boolean;

  constructor(private readonly o: EngineOptions) {
    this.viaAur = !!o.aur;
  }

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
      // From the AUR it goes where pacman puts it, whatever folder was chosen: the command it installs is the answer.
      out[c.id] = this.viaAur ? `/usr/bin/${identity.aurBinary}` : launchTarget(this.o.platform, base, identity.productName, identity.fileName);
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
      if (this.viaAur) {
        try {
          await this.installFromAur(items.filter((i) => i.status !== "done"), signal);
          this.set({ phase: "done", progress: 1 });
          return;
        } catch (e) {
          // Only "there is no package": any other failure (a build that failed, a password that was refused) is shown, not
          // papered over by installing something different from what was asked for.
          if (!(e instanceof AurUnavailable)) throw e;
          this.viaAur = false;
          this.set({ items: this.state.items.map((i) => (i.status === "done" ? i : { ...i, status: "waiting", note: "Waiting", received: 0 })) });
        }
      }
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

  /**
   * Arch Linux: each app's package is fetched from the AUR and built here, as this person (`makepkg` refuses to run as
   * root), and then every built package is installed in one `pacman -U` run as root through `pkexec`, so there is one
   * password prompt however many apps were chosen. The packages are the ones the release workflow publishes
   * (aur/PKGBUILD.in): they repackage the release's .deb, and `makepkg` checks it against the checksum in the recipe.
   *
   * Throws with a message fit to show; the apps that were built but not installed are marked failed with it.
   */
  private async installFromAur(items: ItemState[], signal: AbortSignal): Promise<void> {
    const built: { id: ComponentId; file: string }[] = [];
    let current: ComponentId[] = [];
    try {
      for (const item of items) {
        current = [item.id];
        const comp = COMPONENTS.find((c) => c.id === item.id)!;
        const pkg = appIdentity(this.o.channel, comp.kind).aurPackage;
        if (!pkg) throw new Error(`${item.title} isn't in the AUR for this channel.`);
        this.setItem(item.id, { status: "installing", note: "Fetching the package from the AUR", received: 0 });
        const dir = await this.fetchAurRecipe(pkg, item.id, signal);
        this.setItem(item.id, { note: "Building the package" });
        built.push({ id: item.id, file: await this.buildAurPackage(dir, item.id, signal) });
        this.setItem(item.id, { note: "Ready to install" });
        this.set({ progress: this.progressOf(this.state.items) });
      }
      current = built.map((b) => b.id);
      for (const b of built) this.setItem(b.id, { note: "Waiting for your administrator password" });
      await elevatedOnLinux("/usr/bin/pacman", ["-U", "--noconfirm", ...built.map((b) => b.file)], signal);
      for (const b of built) {
        const size = this.sources.get(b.id)?.size ?? 0;
        this.setItem(b.id, { status: "done", note: "Installed", received: size });
      }
    } catch (e) {
      if (!signal.aborted) for (const id of current) this.setItem(id, { status: "failed", note: message(e) });
      throw e;
    }
  }

  /** Downloads and unpacks the package's recipe (its PKGBUILD) from the AUR; returns the folder it is in. */
  private async fetchAurRecipe(pkg: string, id: ComponentId, signal: AbortSignal): Promise<string> {
    const res = await (this.o.fetchImpl ?? fetch)(aurSnapshotUrl(pkg), { signal, headers: { "User-Agent": "crystal-installer" } });
    if (res.status === 404) throw new AurUnavailable(`${pkg} isn't in the AUR yet.`);
    if (!res.ok || !res.body) throw new Error(`The AUR didn't answer (HTTP ${res.status}).`);
    const archive = path.join(this.tmp!, `${pkg}.tar.gz`);
    await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(archive), { signal });
    const dest = path.join(this.tmp!, `aur-${id}`);
    await fs.promises.mkdir(dest, { recursive: true });
    await run("tar", ["-xzf", archive, "-C", dest], signal);
    const dir = path.join(dest, pkg);
    if (!fs.existsSync(path.join(dir, "PKGBUILD"))) throw new Error(`The AUR's ${pkg} has no PKGBUILD.`);
    return dir;
  }

  /** Builds the package with `makepkg`, keeping everything it makes inside the installer's temporary folder. */
  private async buildAurPackage(dir: string, id: ComponentId, signal: AbortSignal): Promise<string> {
    const out = path.join(this.tmp!, `pkg-${id}`);
    await fs.promises.mkdir(out, { recursive: true });
    await runCaptured("makepkg", ["--force", "--noconfirm", "--nocolor"], signal, {
      cwd: dir,
      env: { ...process.env, PKGDEST: out, SRCDEST: path.join(dir, "src-cache"), BUILDDIR: path.join(dir, "build"), LC_ALL: "C" },
    });
    const file = (await fs.promises.readdir(out)).find((n) => /\.pkg\.tar(\.[a-z0-9]+)?$/.test(n) && !n.includes("-debug-"));
    if (!file) throw new Error("The package was built but its file couldn't be found.");
    return path.join(out, file);
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
    if (platform === "darwin") {
      // Always a folder of its own: a half-removed one from an earlier try can't get in the way of this one.
      const staging = await fs.promises.mkdtemp(path.join(this.tmp!, `extract-${id}-`));
      await run("/usr/bin/ditto", ["-x", "-k", file, staging], signal);
      const app = (await fs.promises.readdir(staging)).find((n) => n.endsWith(".app"));
      if (!app) throw new Error("The download didn't contain an app.");
      const source = path.join(staging, app);
      const target = launchTarget(platform, sel.base, productName, fileName);
      try {
        await fs.promises.mkdir(sel.base, { recursive: true });
        await removeTree(target, signal);
        await run("/usr/bin/ditto", [source, target], signal);
        // Fetched by this installer rather than a browser, so macOS hasn't flagged it; clear any flag all the same.
        await run("/usr/bin/xattr", ["-dr", "com.apple.quarantine", target], signal).catch(() => {});
      } catch (e) {
        // The old copy, or the folder it is in, belongs to someone else or is held by the system: ask for an administrator's
        // password and do the replacing as root, rather than failing.
        if (signal.aborted || !needsAdmin(e instanceof Error ? e.message : String(e))) throw e;
        this.setItem(id, { note: "Waiting for your administrator password" });
        await elevatedOnMac(installBundleScript(source, target, { uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 }), signal);
        this.setItem(id, { note: "Installing" });
      }
      // The copy in the temporary folder is only scratch space: if it can't be cleared now, quitting clears it, and a
      // finished install is not worth failing over.
      await removeTree(staging, signal).catch(() => {});
      return;
    }
    await fs.promises.mkdir(sel.base, { recursive: true });
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
      const command = this.viaAur ? `/usr/bin/${identity.aurBinary}` : target;
      const child = platform === "darwin" ? spawn("/usr/bin/open", [target], { detached: true, stdio: "ignore" }) : spawn(command, [], { detached: true, stdio: "ignore" });
      child.on("error", () => {});
      child.unref();
    }
  }

  /** Synchronous so it finishes before the process does, when called as the app quits. */
  cleanup(): void {
    const dir = this.tmp;
    this.tmp = null;
    if (!dir) return;
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // Something is still writing into it, or it is locked: the system's own tools are less particular. Quitting never fails over it.
      spawnSync("/usr/bin/chflags", ["-R", "nouchg", dir], { stdio: "ignore" });
      spawnSync("/bin/chmod", ["-R", "u+rwX", dir], { stdio: "ignore" });
      spawnSync("/bin/rm", ["-rf", dir], { stdio: "ignore" });
    }
  }
}

/**
 * Removes a folder this person's account can reach, however stubborn: retried (macOS can still be indexing or scanning
 * what was just extracted, which shows up as "directory not empty"), then with locks and read-only flags cleared and the
 * system's own `rm`. Throws if it is still there, so a caller can decide whether to ask for an administrator.
 */
async function removeTree(dir: string, signal: AbortSignal): Promise<void> {
  try {
    await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    return;
  } catch (e) {
    if (signal.aborted) throw e;
  }
  await run("/usr/bin/chflags", ["-R", "nouchg", dir], signal).catch(() => {});
  await run("/bin/chmod", ["-R", "u+rwX", dir], signal).catch(() => {});
  await run("/bin/rm", ["-rf", dir], signal).catch(() => {
    // `rm` itself said no: report it in the terms the rest of the installer understands.
    throw new Error(`EACCES: couldn't remove ${dir}`);
  });
}

/**
 * Runs a program and waits, keeping the end of what it said on stderr so a failure can be explained. `makepkg` and `pacman`
 * say why they stopped there, and "makepkg stopped with code 1" alone tells nobody anything.
 */
function runCaptured(cmd: string, args: string[], signal: AbortSignal, opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], signal, ...opts });
    let tail = "";
    const keep = (d: Buffer) => (tail = (tail + d.toString()).slice(-1500));
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    child.on("error", (e) => reject(e));
    child.on("close", (code) => {
      if (code === 0) return resolve();
      const last = tail.trim().split("\n").filter(Boolean).slice(-3).join(" ");
      reject(new Error(`${path.basename(cmd)} stopped with code ${code}${last ? `: ${last}` : "."}`));
    });
  });
}

/**
 * Runs a program as root on Linux through polkit (`pkexec`), which asks for an administrator's password in the desktop's
 * own dialog: the installer has no terminal to ask in, and never sees the password.
 */
async function elevatedOnLinux(cmd: string, args: string[], signal: AbortSignal): Promise<void> {
  try {
    await runCaptured("pkexec", [cmd, ...args], signal);
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    // pkexec: 126 is a dismissed or refused prompt, 127 is no way to ask (no polkit agent running).
    if (/code 126/.test(raw)) throw new Error("The administrator's password wasn't entered, so nothing was installed.");
    if (/code 127/.test(raw)) throw new Error("No password prompt could be shown (is a polkit agent running?). Nothing was installed.");
    throw e;
  }
}

/** Runs a shell command as root, after macOS has asked for an administrator's password. */
function elevatedOnMac(command: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/osascript", ["-e", elevatedAppleScript(command)], { stdio: ["ignore", "ignore", "pipe"], signal });
    let err = "";
    child.stderr?.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", (e) => reject(e));
    child.on("close", (code) => {
      if (code === 0) return resolve();
      // -128 is "User canceled."
      if (/-128|canceled/i.test(err)) return reject(new Error("Crystal needs an administrator's password to replace the copy that's already installed."));
      reject(new Error(`The installer couldn't finish with administrator rights${err.trim() ? `: ${err.trim()}` : "."}`));
    });
  });
}

/** The AUR has no package for this app (yet): the one AUR failure the installer answers by installing the AppImage instead. */
class AurUnavailable extends Error {}

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
