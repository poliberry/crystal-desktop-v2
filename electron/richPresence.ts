import { app } from "electron";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

import mediaSession, { type NowPlaying } from "./mediaSession";

/**
 * Rich Presence for the desktop app — "what is this person doing right now",
 * shown under their bio on the profile cards.
 *
 * Three independent sources feed one resolved activity:
 *
 *  1. **Discord's detectable list.** `games.json` / `non-games.json` on
 *     Discord's public CDN are the same catalogs the Discord client uses to
 *     recognise tens of thousands of games by executable name. We download
 *     them, build an executable → game index, and match it against the
 *     running process list on a timer. No Discord account or connection to
 *     Discord is involved; the catalogs are plain public JSON.
 *  2. **A Discord-compatible IPC server.** Games and tools that ship
 *     Discord's Game SDK (or any `discord-rpc` library) connect to a local
 *     socket named `discord-ipc-N` and push a much richer activity than we
 *     could ever infer from a process name. We listen on the first free `N`,
 *     speak the same framing (u32 opcode + u32 length + JSON), and answer
 *     `SET_ACTIVITY`. If the real Discord client is running it holds
 *     `discord-ipc-0` and we simply take the next slot.
 *  3. **Now-playing music**, read from the operating system's media-session
 *     layer (see electron/mediaSession.ts) — SMTC on Windows, the scriptable
 *     players on macOS, MPRIS on Linux — which covers every player at once
 *     and carries a timeline, so the profile card can draw a seek bar.
 *
 * All of them are published together, ordered richest-first: explicit IPC
 * activities, then a detected game, then music. A profile card shows the
 * first as the headline and the rest underneath, so "playing something while
 * listening to something" reads correctly instead of one hiding the other.
 */

const GAMES_URL = "https://cdn.discordapp.com/detectables/games.json";
const NON_GAMES_URL = "https://cdn.discordapp.com/detectables/non-games.json";

/** How long a downloaded detectable catalog stays fresh on disk. */
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

/** How often the process scan runs. */
const SCAN_INTERVAL_MS = 15_000;

/** Highest `discord-ipc-N` index to try before giving up. */
const MAX_IPC_SLOTS = 10;

export type ActivityType = "playing" | "listening" | "watching" | "streaming";

/** Discord's numeric activity types, as sent in a `SET_ACTIVITY` payload. */
const IPC_ACTIVITY_TYPES: Record<number, ActivityType> = {
  0: "playing",
  1: "streaming",
  2: "listening",
  3: "watching",
};

export interface RichPresenceActivity {
  type: ActivityType;
  /** Game name, or the app playing the music ("Spotify", "Microsoft Edge"). */
  name: string;
  /** Track title, for music. */
  details?: string;
  /** Artist, for music. */
  state?: string;
  album?: string;
  imageUrl?: string;
  startedAt?: number;
  /** Track length and playback position, so viewers can draw a seek bar.
   * `positionSampledAt` is when `positionMs` was read, so the bar can be
   * interpolated between updates instead of polled. */
  durationMs?: number;
  positionMs?: number;
  positionSampledAt?: number;
  source?: "detectable" | "ipc" | "music";
}

/** One entry of Discord's detectables catalog (only the fields we use). The
 * hash fields are Discord CDN image hashes, both served from `app-icons`:
 * `icon_hash` is the square app icon, `cover_image_hash` the wider store art
 * (absent for plenty of entries, hence the fallback below). */
interface Detectable {
  id: string;
  name: string;
  icon_hash?: string;
  cover_image_hash?: string;
  executables?: { name: string; os: string; is_launcher?: boolean }[];
}

/** Box art / icon URL for a detected game, or undefined if it has neither. */
function detectableImageUrl(entry: Detectable): string | undefined {
  const hash = entry.icon_hash ?? entry.cover_image_hash;
  return hash ? `https://cdn.discordapp.com/app-icons/${entry.id}/${hash}.png?size=160` : undefined;
}

interface CachedCatalog {
  fetchedAt: number;
  entries: Detectable[];
}

/** Map key: lowercased executable basename without a trailing ".exe". */
type ExecutableIndex = Map<string, Detectable>;

function catalogPath(): string {
  return path.join(app.getPath("userData"), "detectables.json");
}

/** Discord's own `os` values in `executables[]`. */
function detectableOsKey(): string {
  if (process.platform === "win32") return "win32";
  if (process.platform === "darwin") return "darwin";
  return "linux";
}

/**
 * Normalise a detectable's executable entry (or a running process name) to a
 * common key. Detectables store things like `steamapps/common/Foo/foo.exe`,
 * `Foo.app/Contents/MacOS/Foo`, or a bare `foo`; the process list gives us a
 * bare command name. Comparing the lowercased basename with any `.exe`
 * stripped is what makes those meet in the middle.
 */
function normalizeExecutable(name: string): string {
  const basename = name.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? name;
  return basename.toLowerCase().replace(/\.exe$/, "").trim();
}

/** Executables too generic to attribute to a game — matching these would
 * label half the machine as "playing" something. */
const EXECUTABLE_DENYLIST = new Set([
  "explorer",
  "finder",
  "steam",
  "steamwebhelper",
  "electron",
  "node",
  "python",
  "python3",
  "java",
  "javaw",
  "cmd",
  "powershell",
  "pwsh",
  "bash",
  "zsh",
  "crystal-desktop",
  "crystal",
  // Generic names the catalog does map to a specific title — `update.exe` is
  // filed under one game, `quest.exe` under another — but which any number of
  // unrelated programs also ship. A match on one of these says nothing.
  "update",
  "updater",
  "updatemanager",
  "updater_downloader",
  "launcher",
  "launcher_updater",
  "helper",
  "crashpad_handler",
  "quest",
]);

/**
 * Executables and catalog entries we never want to publish, by pattern.
 *
 * Two families, for the same reason: neither is the user *doing* something.
 *
 *  - Anything Discord. Its client, its channel builds, its Chromium helpers,
 *    and the third-party quest tools the catalog carries as real entries
 *    ("Discord Quest Helper", "Discord Bot Maker"). Having Discord — or
 *    something farming its quests — open in the background isn't an activity,
 *    and announcing it in Crystal is worse than saying nothing.
 *  - Chromium/Electron helper processes generally, which every app of that
 *    shape spawns several of and which occasionally collide with a catalog
 *    entry's generic executable name.
 */
const DENIED_EXECUTABLE_PATTERNS: RegExp[] = [
  /discord/,
  /(^|[\s._-])helper([\s._-]|$)/,
  /crashpad/,
];

/** Catalog entries suppressed by title, whatever they're running as. */
const DENIED_DETECTABLE_NAME_PATTERNS: RegExp[] = [/discord/i, /\bquests?\s+(helper|farmer|sniper|spoofer|bot)\b/i];

function isDeniedExecutable(key: string): boolean {
  return EXECUTABLE_DENYLIST.has(key) || DENIED_EXECUTABLE_PATTERNS.some((re) => re.test(key));
}

function isDeniedDetectable(name: string): boolean {
  return DENIED_DETECTABLE_NAME_PATTERNS.some((re) => re.test(name));
}

/**
 * Our own executable and product names, so Crystal never detects itself.
 *
 * The static denylist can't cover this on its own: each release channel
 * installs under its own product name ("Crystal Canary", "Crystal
 * Development"), and a dev run is whatever Electron's binary is called.
 */
function selfExecutableKeys(): Set<string> {
  const keys = new Set<string>();
  for (const name of [app.getName(), app.getPath("exe"), process.execPath]) {
    const key = normalizeExecutable(name);
    if (key) keys.add(key);
  }
  return keys;
}

class RichPresence {
  // Only the executable index is retained: the raw catalog is ~10 MB of JSON
  // and keeping it resident for the life of the process buys nothing once the
  // index is built.
  private detectableCount = 0;
  private index: ExecutableIndex = new Map();

  /** Latest activity pushed over the Discord-compatible IPC socket, keyed by
   * the connecting client's application id so two connected games don't
   * clobber each other. */
  private ipcActivities = new Map<string, RichPresenceActivity>();

  private detectedGame: RichPresenceActivity | null = null;
  private music: RichPresenceActivity | null = null;

  private current: RichPresenceActivity[] = [];
  private listeners = new Set<(activities: RichPresenceActivity[]) => void>();

  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeMedia: (() => void) | null = null;
  private ipcServer: net.Server | null = null;
  private ipcPath: string | null = null;

  /** Games started before the app launched have no observable start time, so
   * "elapsed" is measured from when we first saw the process instead. Reset
   * whenever the detected game changes (including to nothing), so relaunching
   * a game restarts its counter rather than resuming the old one. */
  private gameStartedAt: { id: string; at: number } | null = null;

  private enabled = true;
  private started = false;

  // --- lifecycle ---------------------------------------------------------

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    await this.loadCatalog();
    await this.startIpcServer();

    this.scanTimer = setInterval(() => void this.scanProcesses(), SCAN_INTERVAL_MS);
    void this.scanProcesses();

    this.unsubscribeMedia = mediaSession.onChange((now) => {
      this.music = toMusicActivity(now);
      this.resolve();
    });
    mediaSession.start();
  }

  stop(): void {
    this.started = false;
    if (this.scanTimer) clearInterval(this.scanTimer);
    this.scanTimer = null;
    this.unsubscribeMedia?.();
    this.unsubscribeMedia = null;
    mediaSession.stop();
    this.ipcServer?.close();
    this.ipcServer = null;
    if (this.ipcPath && process.platform !== "win32") {
      fs.rm(this.ipcPath, { force: true }, () => {});
    }
    this.ipcPath = null;
  }

  /** Master switch, mirrored from the renderer's Settings toggle. Turning it
   * off immediately retracts whatever was published. */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.detectedGame = null;
      this.music = null;
      this.ipcActivities.clear();
    }
    // Stop the OS media probe outright while disabled rather than sampling
    // and discarding — on Windows that's a whole PowerShell child process.
    if (enabled) mediaSession.start();
    else mediaSession.stop();
    this.resolve();
    if (enabled) void this.scanProcesses();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Every activity currently detected, richest first. */
  getActivities(): RichPresenceActivity[] {
    return this.current;
  }

  onChange(cb: (activities: RichPresenceActivity[]) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  getStatus(): {
    enabled: boolean;
    detectableCount: number;
    ipcPath: string | null;
    ipcClients: number;
    activities: RichPresenceActivity[];
  } {
    return {
      enabled: this.enabled,
      detectableCount: this.detectableCount,
      ipcPath: this.ipcPath,
      ipcClients: this.ipcActivities.size,
      activities: this.current,
    };
  }

  // --- detectables catalog -----------------------------------------------

  /**
   * Load the executable index, preferring a cache on disk that's younger than
   * `CATALOG_TTL_MS` and falling back to a stale cache when the network is
   * unavailable — a day-old catalog is far better than none.
   */
  private async loadCatalog(): Promise<void> {
    const cached = this.readCachedCatalog();
    if (cached) this.applyCatalog(cached.entries);
    if (cached && Date.now() - cached.fetchedAt < CATALOG_TTL_MS) return;

    try {
      const entries = await this.downloadCatalog();
      if (entries.length === 0) return;
      this.applyCatalog(entries);
      const payload: CachedCatalog = { fetchedAt: Date.now(), entries };
      await fs.promises.writeFile(catalogPath(), JSON.stringify(payload)).catch(() => {});
    } catch (err) {
      if (!cached) console.warn("[rich-presence] detectables download failed:", err);
    }
  }

  private readCachedCatalog(): CachedCatalog | null {
    try {
      const parsed = JSON.parse(fs.readFileSync(catalogPath(), "utf8")) as CachedCatalog;
      if (!Array.isArray(parsed.entries)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private async downloadCatalog(): Promise<Detectable[]> {
    const fetchList = async (url: string): Promise<Detectable[]> => {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`${url} responded ${res.status}`);
      const json = (await res.json()) as unknown;
      return Array.isArray(json) ? (json as Detectable[]) : [];
    };
    // `non-games.json` failing (the smaller, less critical list) shouldn't
    // cost us the whole game catalog.
    const [games, nonGames] = await Promise.all([
      fetchList(GAMES_URL),
      fetchList(NON_GAMES_URL).catch(() => [] as Detectable[]),
    ]);
    return [...games, ...nonGames];
  }

  private applyCatalog(entries: Detectable[]): void {
    this.detectableCount = entries.length;
    const osKey = detectableOsKey();
    const index: ExecutableIndex = new Map();
    const self = selfExecutableKeys();
    for (const entry of entries) {
      if (!entry?.name || !Array.isArray(entry.executables)) continue;
      if (isDeniedDetectable(entry.name)) continue;
      for (const exe of entry.executables) {
        // Launchers ("Steam", "Epic Games Launcher") are flagged in the
        // catalog so clients can skip them — having one open isn't playing
        // anything.
        if (!exe?.name || exe.is_launcher) continue;
        if (exe.os && exe.os !== osKey) continue;
        const key = normalizeExecutable(exe.name);
        if (!key || key.length < 3 || isDeniedExecutable(key) || self.has(key)) continue;
        // First catalog entry wins, and `games.json` is loaded before
        // `non-games.json`, so a real game beats an app sharing its name.
        if (!index.has(key)) index.set(key, entry);
      }
    }
    this.index = index;
  }

  // --- process scanning --------------------------------------------------

  private async scanProcesses(): Promise<void> {
    if (!this.enabled || this.index.size === 0) return;
    let names: string[];
    try {
      names = await listProcessNames();
    } catch {
      return;
    }

    let match: Detectable | null = null;
    for (const raw of names) {
      const hit = this.index.get(normalizeExecutable(raw));
      if (hit) {
        match = hit;
        break;
      }
    }

    if (!match) {
      this.gameStartedAt = null;
      if (this.detectedGame) {
        this.detectedGame = null;
        this.resolve();
      }
      return;
    }

    if (this.gameStartedAt?.id !== match.id) {
      this.gameStartedAt = { id: match.id, at: Date.now() };
    }

    const next: RichPresenceActivity = {
      type: "playing",
      name: match.name,
      imageUrl: detectableImageUrl(match),
      startedAt: this.gameStartedAt.at,
      source: "detectable",
    };
    if (!sameActivity(this.detectedGame, next)) {
      this.detectedGame = next;
      this.resolve();
    }
  }

  // --- music -------------------------------------------------------------

  // Music arrives pushed from `mediaSession`, which already suppresses
  // no-op updates, so there is no scan loop here — see `start()`.

  // --- Discord-compatible IPC server -------------------------------------

  /**
   * Bind `discord-ipc-N` for the first free `N`. On Windows that's a named
   * pipe; everywhere else it's a unix socket in the runtime dir, matching
   * where `discord-rpc` clients probe.
   */
  private async startIpcServer(): Promise<void> {
    for (let slot = 0; slot < MAX_IPC_SLOTS; slot++) {
      const socketPath = ipcSocketPath(slot);
      if (await this.tryBind(socketPath)) {
        this.ipcPath = socketPath;
        return;
      }
    }
    console.warn("[rich-presence] no free discord-ipc slot; IPC activities disabled");
  }

  private tryBind(socketPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer((socket) => this.handleIpcClient(socket));
      const onError = () => {
        server.removeAllListeners();
        server.close();
        resolve(false);
      };
      server.once("error", onError);
      server.listen(socketPath, () => {
        server.removeListener("error", onError);
        server.on("error", (err) => console.warn("[rich-presence] ipc server error", err));
        this.ipcServer = server;
        resolve(true);
      });
    });
  }

  private handleIpcClient(socket: net.Socket): void {
    let clientId: string | null = null;
    let buffer = Buffer.alloc(0);

    const send = (op: number, payload: unknown) => {
      const body = Buffer.from(JSON.stringify(payload), "utf8");
      const header = Buffer.alloc(8);
      header.writeUInt32LE(op, 0);
      header.writeUInt32LE(body.length, 4);
      socket.write(Buffer.concat([header, body]));
    };

    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      // Frames are u32 opcode + u32 payload length + JSON payload; a chunk can
      // hold several frames or half of one, so drain whatever is complete.
      while (buffer.length >= 8) {
        const op = buffer.readUInt32LE(0);
        const len = buffer.readUInt32LE(4);
        if (buffer.length < 8 + len) break;
        const body = buffer.subarray(8, 8 + len).toString("utf8");
        buffer = buffer.subarray(8 + len);

        let message: Record<string, unknown>;
        try {
          message = JSON.parse(body) as Record<string, unknown>;
        } catch {
          continue;
        }

        if (op === OP_HANDSHAKE) {
          // The handshake payload carries the game's application id.
          clientId = typeof message.client_id === "string" ? message.client_id : "unknown";
          send(OP_FRAME, {
            cmd: "DISPATCH",
            evt: "READY",
            data: {
              v: 1,
              config: {
                cdn_host: "cdn.discordapp.com",
                api_endpoint: "//discord.com/api",
                environment: "production",
              },
            },
            nonce: null,
          });
          continue;
        }

        if (op === OP_PING) {
          send(OP_PONG, message);
          continue;
        }

        if (op === OP_CLOSE) {
          socket.end();
          continue;
        }

        if (op !== OP_FRAME) continue;

        if (message.cmd === "SET_ACTIVITY") {
          const id = clientId ?? "unknown";
          const args = (message.args ?? {}) as Record<string, unknown>;
          const activity = parseIpcActivity(args.activity);
          // Same suppression as the process scan, applied to what a client
          // *claims* to be: quest-farming tools push their activity over this
          // socket, and taking their word for it is how "Discord Quest
          // Helper" ends up on someone's profile.
          if (activity && !isDeniedDetectable(activity.name)) this.ipcActivities.set(id, activity);
          else this.ipcActivities.delete(id);
          this.resolve();
          send(OP_FRAME, {
            cmd: "SET_ACTIVITY",
            data: args.activity ?? null,
            evt: null,
            nonce: message.nonce ?? null,
          });
          continue;
        }

        // Anything else (SUBSCRIBE, AUTHORIZE, …) gets an empty ack so the
        // client isn't left waiting on a nonce that never resolves.
        send(OP_FRAME, {
          cmd: message.cmd ?? null,
          data: null,
          evt: null,
          nonce: message.nonce ?? null,
        });
      }
    });

    const cleanup = () => {
      if (clientId && this.ipcActivities.delete(clientId)) this.resolve();
    };
    socket.on("close", cleanup);
    socket.on("error", cleanup);
  }

  // --- resolution --------------------------------------------------------

  /** Gather every source into one ordered list, richest first. */
  private resolve(): void {
    const next: RichPresenceActivity[] = [];
    if (this.enabled) {
      next.push(...this.ipcActivities.values());
      // A detected game is redundant once the game itself is reporting over
      // IPC, which it does far more richly.
      if (this.detectedGame && !next.some((a) => a.name === this.detectedGame!.name)) {
        next.push(this.detectedGame);
      }
      if (this.music) next.push(this.music);
    }
    if (sameActivities(this.current, next)) return;
    this.current = next;
    for (const cb of this.listeners) {
      try {
        cb(next);
      } catch (err) {
        console.warn("[rich-presence] listener threw", err);
      }
    }
  }
}

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

function sameActivities(a: RichPresenceActivity[], b: RichPresenceActivity[]): boolean {
  return a.length === b.length && a.every((activity, i) => sameActivity(activity, b[i]!));
}

function sameActivity(a: RichPresenceActivity | null, b: RichPresenceActivity | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.type === b.type &&
    a.name === b.name &&
    a.details === b.details &&
    a.state === b.state &&
    a.album === b.album &&
    a.imageUrl === b.imageUrl &&
    a.source === b.source &&
    a.durationMs === b.durationMs &&
    // A corrected position has to reach viewers, or their seek bars keep
    // interpolating from a stale anchor after a seek.
    a.positionMs === b.positionMs
  );
}

/** Fold an OS media-session snapshot into the activity shape we publish. */
function toMusicActivity(now: NowPlaying | null): RichPresenceActivity | null {
  if (!now) return null;
  return {
    type: "listening",
    name: now.source,
    details: now.title,
    state: now.artist,
    album: now.album,
    imageUrl: now.artworkUrl,
    durationMs: now.durationMs,
    positionMs: now.positionMs,
    positionSampledAt: now.positionSampledAt,
    source: "music",
  };
}

/** Where `discord-rpc` clients look for the socket, per platform. */
function ipcSocketPath(slot: number): string {
  if (process.platform === "win32") return `\\\\?\\pipe\\discord-ipc-${slot}`;
  const base =
    process.env.XDG_RUNTIME_DIR ||
    process.env.TMPDIR ||
    process.env.TMP ||
    process.env.TEMP ||
    os.tmpdir();
  return path.join(base, `discord-ipc-${slot}`);
}

/** Translate a Discord Game SDK activity payload into our shape. */
function parseIpcActivity(raw: unknown): RichPresenceActivity | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const details = typeof a.details === "string" ? a.details : undefined;
  const state = typeof a.state === "string" ? a.state : undefined;
  const name = typeof a.name === "string" ? a.name : (details ?? state);
  if (!name) return null;

  const assets = (a.assets ?? {}) as Record<string, unknown>;
  const largeImage = typeof assets.large_image === "string" ? assets.large_image : undefined;
  // An asset can be a proxied external URL (`mp:external/…`) or an uploaded
  // asset key; only the former is resolvable without the app's asset manifest.
  const imageUrl = largeImage?.startsWith("mp:external/")
    ? `https://media.discordapp.net/${largeImage.slice("mp:".length)}`
    : largeImage?.startsWith("http")
      ? largeImage
      : undefined;

  const type =
    typeof a.type === "number" ? (IPC_ACTIVITY_TYPES[a.type] ?? "playing") : "playing";

  const timestamps = (a.timestamps ?? {}) as Record<string, unknown>;
  const rawStart = typeof timestamps.start === "number" ? timestamps.start : undefined;
  // The SDK accepts both seconds and milliseconds; anything below ~1e12 is
  // clearly seconds.
  const startedAt = rawStart ? (rawStart < 1e12 ? rawStart * 1000 : rawStart) : undefined;

  return { type, name, details, state, imageUrl, startedAt, source: "ipc" };
}

// --- OS probes -------------------------------------------------------------

function run(command: string, args: string[], timeoutMs = 5_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      }
    );
  });
}

/** Names of every running process, as the OS reports them. */
async function listProcessNames(): Promise<string[]> {
  if (process.platform === "win32") {
    // `tasklist` is dramatically cheaper than spawning PowerShell every 15s.
    const out = await run("tasklist.exe", ["/fo", "csv", "/nh"]);
    return out
      .split(/\r?\n/)
      .map((line) => /^"([^"]+)"/.exec(line)?.[1])
      .filter((name): name is string => !!name);
  }
  if (process.platform === "darwin") {
    const out = await run("/bin/ps", ["-axco", "command="]);
    return out.split("\n").map((line) => line.trim()).filter(Boolean);
  }
  const out = await run("ps", ["-eo", "comm="]);
  return out.split("\n").map((line) => line.trim()).filter(Boolean);
}

export default new RichPresence();
