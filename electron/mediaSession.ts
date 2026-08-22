import { execFile, spawn, type ChildProcess } from "node:child_process";

/**
 * Cross-platform "what is playing right now", read from the operating
 * system's media-session layer rather than from any one music app.
 *
 * Every modern player — Spotify, Apple Music, browsers, VLC — publishes its
 * metadata, playback state and timeline to the OS so the volume flyout /
 * lock screen / media keys can drive it. Reading *that* means we support
 * every player at once and never scrape a UI or depend on a service API:
 *
 *  - **Windows**: System Media Transport Controls (SMTC). A long-lived
 *    PowerShell child holds the WinRT session manager open and prints one
 *    compact JSON line per poll, which is far cheaper than paying process
 *    startup every few seconds.
 *  - **macOS**: Spotify and Apple Music are both scriptable, and expose
 *    player position, track duration and (for Spotify) an artwork URL.
 *    macOS has no supported API for reading *another* app's Now Playing
 *    info, so these two are the coverage.
 *  - **Linux**: MPRIS over D-Bus via `playerctl`, which every mainstream
 *    Linux player implements.
 *
 * Position is sampled, not streamed: consumers get `positionMs` plus the
 * timestamp it was taken at and interpolate locally, so the seek bar moves
 * smoothly without us polling the OS at animation rates.
 */

export interface NowPlaying {
  title: string;
  artist?: string;
  album?: string;
  /** Cover art URL. Supplied by the player where possible, otherwise looked
   * up from the iTunes Search API (see `resolveArtwork`). */
  artworkUrl?: string;
  durationMs?: number;
  positionMs?: number;
  /** Epoch ms at which `positionMs` was read, so consumers can interpolate. */
  positionSampledAt?: number;
  /** Friendly name of the app playing it ("Spotify", "Microsoft Edge", …). */
  source: string;
}

/** How often each platform's probe runs. */
const POLL_INTERVAL_MS = 3_000;

/** Restart delay after the Windows helper exits unexpectedly. */
const RESPAWN_DELAY_MS = 10_000;

/**
 * Runs inside the long-lived PowerShell child. Opens the SMTC session
 * manager once, then prints one JSON line per iteration.
 *
 * `TimelineProperties.Position` is only refreshed when the playing app pushes
 * an update, so it can be seconds stale; `LastUpdatedTime` says when it was
 * accurate and we advance it by that age ourselves before reporting.
 */
const WINDOWS_SMTC_SCRIPT = `
$ErrorActionPreference = 'Stop'
# PowerShell writes stdout in the console's OEM codepage by default, so any
# non-ASCII in a track or artist name ("Le voyage de Pénélope") reaches Node
# as mojibake. Force UTF-8, which is what we decode the pipe as.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
# The generic overload we want takes IAsyncOperation\`1. Spelling the arity
# marker as [char]96 keeps a literal backtick — PowerShell's escape character —
# out of both this template literal and PowerShell's own parser.
$opName = 'IAsyncOperation' + [char]96 + '1'
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq $opName
})[0]
function Await($op, $t) {
  $m = $asTask.MakeGenericMethod($t)
  $task = $m.Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
$MGR = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$PROPS = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$mgr = Await ($MGR::RequestAsync()) $MGR

while ($true) {
  try {
    $s = $mgr.GetCurrentSession()
    if ($null -eq $s) {
      Write-Output '{"playing":false}'
    } else {
      $p = Await ($s.TryGetMediaPropertiesAsync()) $PROPS
      $tl = $s.GetTimelineProperties()
      $pb = $s.GetPlaybackInfo()
      $playing = ($pb.PlaybackStatus -eq 'Playing')
      $duration = [Math]::Round($tl.EndTime.TotalMilliseconds - $tl.StartTime.TotalMilliseconds)
      $position = [Math]::Round($tl.Position.TotalMilliseconds - $tl.StartTime.TotalMilliseconds)
      # Plenty of browser sessions publish a placeholder timeline (EndTime of
      # zero or -0.001, Position pinned near zero, LastUpdatedTime frozen at
      # session creation). Nothing in it can be trusted, including the age
      # correction below, so say so and let the caller synthesise instead.
      $timeline = ($duration -gt 0)
      # Advance a stale sample to "now" ourselves. Many apps — browsers in
      # particular — push a timeline update once when playback starts and then
      # never again, so Position can be minutes behind. There's deliberately no
      # cap on the age: PlaybackStatus already told us it is playing, so the
      # elapsed wall-clock time really has been played. The clamp to duration
      # below is what keeps a looping track from running off the end.
      if ($timeline -and $playing -and $tl.LastUpdatedTime.Year -gt 1970) {
        $age = ([DateTimeOffset]::UtcNow - $tl.LastUpdatedTime).TotalMilliseconds
        if ($age -gt 0) { $position = $position + [Math]::Round($age) }
      }
      if ($duration -gt 0 -and $position -gt $duration) { $position = $duration }
      $o = [ordered]@{
        playing    = $playing
        title      = [string]$p.Title
        artist     = [string]$p.Artist
        album      = [string]$p.AlbumTitle
        durationMs = [int]$duration
        positionMs = [int]$position
        timelineOk = $timeline
        source     = [string]$s.SourceAppUserModelId
      }
      Write-Output (ConvertTo-Json $o -Compress)
    }
  } catch {
    Write-Output '{"playing":false}'
  }
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds ${POLL_INTERVAL_MS}
}
`;

/** Raw shape emitted by the platform probes, before artwork resolution. */
interface RawNowPlaying {
  playing: boolean;
  title?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  durationMs?: number;
  positionMs?: number;
  /** False when the player published a placeholder timeline, so `positionMs`
   * and `durationMs` are meaningless. Defaults to true — the macOS and Linux
   * probes read a real player position. */
  timelineOk?: boolean;
  source?: string;
}

class MediaSession {
  private listeners = new Set<(now: NowPlaying | null) => void>();
  private current: NowPlaying | null = null;

  /** Fallback playback anchor for sessions with no usable timeline: the wall
   * clock when we first saw this track, treated as position zero. */
  private syntheticStart: { key: string; at: number } | null = null;

  private timer: ReturnType<typeof setInterval> | null = null;
  private child: ChildProcess | null = null;
  private respawnTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    if (process.platform === "win32") this.startWindows();
    else this.startPolling();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.respawnTimer) clearTimeout(this.respawnTimer);
    this.timer = null;
    this.respawnTimer = null;
    this.child?.kill();
    this.child = null;
    this.current = null;
    this.syntheticStart = null;
  }

  getNowPlaying(): NowPlaying | null {
    return this.current;
  }

  onChange(cb: (now: NowPlaying | null) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // --- Windows: one long-lived PowerShell holding the SMTC manager --------

  private startWindows(): void {
    // -EncodedCommand sidesteps every layer of quoting between here and
    // PowerShell's parser, which a script this size would otherwise trip on.
    const encoded = Buffer.from(WINDOWS_SMTC_SCRIPT, "utf16le").toString("base64");
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { stdio: ["ignore", "pipe", "ignore"], windowsHide: true }
    );
    this.child = child;

    let buffer = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        try {
          void this.publish(JSON.parse(trimmed) as RawNowPlaying);
        } catch {
          /* malformed line — skip */
        }
      }
    });

    const onExit = () => {
      if (this.child !== child) return;
      this.child = null;
      void this.publish({ playing: false });
      if (this.stopped) return;
      this.respawnTimer = setTimeout(() => this.startWindows(), RESPAWN_DELAY_MS);
    };
    child.on("exit", onExit);
    child.on("error", onExit);
  }

  // --- macOS / Linux: cheap probes on a timer ----------------------------

  private startPolling(): void {
    const tick = async () => {
      let raw: RawNowPlaying;
      try {
        raw =
          process.platform === "darwin" ? await readMacNowPlaying() : await readLinuxNowPlaying();
      } catch {
        raw = { playing: false };
      }
      await this.publish(raw);
    };
    this.timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
    void tick();
  }

  // --- normalisation -----------------------------------------------------

  private async publish(raw: RawNowPlaying): Promise<void> {
    if (this.stopped) return;

    if (!raw.playing || !raw.title) {
      if (this.current) {
        this.current = null;
        this.emit();
      }
      return;
    }

    const next: NowPlaying = {
      title: raw.title,
      artist: raw.artist || undefined,
      album: raw.album || undefined,
      artworkUrl: raw.artworkUrl || undefined,
      durationMs: raw.durationMs && raw.durationMs > 0 ? raw.durationMs : undefined,
      positionMs: typeof raw.positionMs === "number" ? Math.max(0, raw.positionMs) : undefined,
      positionSampledAt: Date.now(),
      source: friendlySourceName(raw.source),
    };

    const trackChanged =
      this.current?.title !== next.title ||
      this.current?.artist !== next.artist ||
      this.current?.source !== next.source;

    // No usable timeline: measure from when this track first appeared instead
    // of trusting a frozen sample. That's right whenever we catch a track from
    // its start — the normal case, since a track change is what triggers this
    // — and self-corrects at the next one if we joined mid-track.
    if (raw.timelineOk === false) {
      const key = `${next.title}|${next.artist ?? ""}|${next.source}`;
      if (this.syntheticStart?.key !== key) this.syntheticStart = { key, at: Date.now() };
      next.positionMs = Date.now() - this.syntheticStart.at;
    }

    // One lookup covers both gaps, and only when the player left one: art we
    // weren't given, and a length the session didn't publish (SMTC reports
    // `EndTime` as zero for a fair number of browser sessions). The result is
    // reused across position updates — only a real track change re-queries.
    if (!next.artworkUrl || !next.durationMs) {
      const info = trackChanged
        ? await resolveTrackInfo(next.artist, next.album, next.title)
        : { artworkUrl: this.current?.artworkUrl, durationMs: this.current?.durationMs };
      next.artworkUrl = next.artworkUrl ?? info.artworkUrl;
      next.durationMs = next.durationMs ?? info.durationMs;
    }

    // A position past the end means the fallback length was short for this
    // edition of the track; pin it rather than let the bar overflow.
    if (next.durationMs && next.positionMs !== undefined) {
      next.positionMs = Math.min(next.positionMs, next.durationMs);
    }

    // Position advances on its own between samples, so re-emitting every poll
    // would be pure noise. Only surface a change when the track/metadata
    // changed, or when the real position has drifted from what a consumer
    // would have interpolated (a seek, a pause, or the track looping).
    if (!trackChanged && !this.hasDrifted(next)) return;

    this.current = next;
    this.emit();
  }

  /** Whether `next`'s position is far enough from the interpolated estimate
   * that consumers need a correction. */
  private hasDrifted(next: NowPlaying): boolean {
    const prev = this.current;
    if (!prev) return true;
    if (prev.album !== next.album || prev.durationMs !== next.durationMs) return true;
    if (prev.positionMs === undefined || next.positionMs === undefined) {
      return prev.positionMs !== next.positionMs;
    }
    const elapsed = (next.positionSampledAt ?? 0) - (prev.positionSampledAt ?? 0);
    const predicted = prev.positionMs + elapsed;
    // Threshold sits above the jitter of a ~3s poll so a steadily-advancing
    // track never re-broadcasts; only a real seek or pause clears it.
    return Math.abs(predicted - next.positionMs) > 4_000;
  }

  private emit(): void {
    for (const cb of this.listeners) {
      try {
        cb(this.current);
      } catch (err) {
        console.warn("[media-session] listener threw", err);
      }
    }
  }
}

// --- source naming ---------------------------------------------------------

/** SMTC reports an App User Model ID, MPRIS a bus name — neither is meant for
 * humans. Map the common ones and fall back to something presentable. */
function friendlySourceName(raw: string | undefined): string {
  if (!raw) return "Music";
  const id = raw.toLowerCase();
  if (id.includes("spotify")) return "Spotify";
  if (id.includes("apple") && id.includes("music")) return "Apple Music";
  if (id.includes("itunes")) return "iTunes";
  if (id.includes("msedge") || id.includes("microsoftedge")) return "Microsoft Edge";
  if (id.includes("chrome")) return "Google Chrome";
  if (id.includes("firefox")) return "Firefox";
  if (id.includes("vlc")) return "VLC";
  if (id.includes("tidal")) return "TIDAL";
  if (id.includes("deezer")) return "Deezer";
  if (id.includes("youtube")) return "YouTube Music";
  if (id.includes("foobar")) return "foobar2000";
  if (id.includes("cider")) return "Cider";
  if (id.includes("musicbee")) return "MusicBee";
  if (id.includes("winamp")) return "Winamp";
  // A packaged app's AUMID is "Publisher.AppName_publisherhash!EntryPoint",
  // and that entry point is almost always a generic "App" — so name the
  // package, not the entry point. Win32 apps report a bare exe name, which
  // falls through the same trimming unchanged.
  const packageName = raw.split("!")[0] ?? raw;
  const hashAt = packageName.lastIndexOf("_");
  const withoutHash = hashAt > 0 ? packageName.slice(0, hashAt) : packageName;
  const cleaned = withoutHash.split(".").pop() ?? withoutHash;
  return cleaned.replace(/\.exe$/i, "").split(".")[0] || "Music";
}

// --- artwork ---------------------------------------------------------------

interface TrackLookup {
  artworkUrl?: string;
  durationMs?: number;
}

/** Resolved lookups by `artist|album|title`, including empty results so a
 * track with no match isn't looked up again every time it plays. */
const lookupCache = new Map<string, TrackLookup>();
const LOOKUP_CACHE_LIMIT = 200;

/**
 * Best-effort cover art and track length for players that don't publish them.
 *
 * Two gaps make this necessary. Windows' SMTC does carry a thumbnail, but
 * reading that WinRT stream needs a native addon — out of proportion for one
 * image. And plenty of sessions publish a degenerate timeline: browsers in
 * particular often report `EndTime` as zero, which leaves a seek bar with
 * nothing to scale against.
 *
 * The iTunes Search API fills both in. It's public, needs no key, and covers
 * the same catalogue users are listening to. Everything here is best-effort:
 * a miss just means a music glyph and an elapsed-time line instead of a bar,
 * and a length taken from here matches the release iTunes knows about rather
 * than the exact file being played — the player's own value always wins when
 * it has one.
 */
async function resolveTrackInfo(
  artist: string | undefined,
  album: string | undefined,
  title: string
): Promise<TrackLookup> {
  const key = `${artist ?? ""}|${album ?? ""}|${title}`.toLowerCase();
  const cached = lookupCache.get(key);
  if (cached) return cached;

  const found: TrackLookup = {};
  try {
    const term = [artist, title].filter(Boolean).join(" ");
    const url =
      "https://itunes.apple.com/search?media=music&entity=song&limit=1&term=" +
      encodeURIComponent(term);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (res.ok) {
      const json = (await res.json()) as {
        results?: { artworkUrl100?: string; trackTimeMillis?: number }[];
      };
      const hit = json.results?.[0];
      if (hit?.trackTimeMillis && hit.trackTimeMillis > 0) {
        found.durationMs = hit.trackTimeMillis;
      }
      const raw = hit?.artworkUrl100;
      // The API returns a 100px thumbnail; the same path serves any size.
      if (raw) found.artworkUrl = raw.replace(/\/\d+x\d+bb\./, "/512x512bb.");
    }
  } catch {
    /* offline, rate-limited, or no match — fall through to an empty result */
  }

  if (lookupCache.size >= LOOKUP_CACHE_LIMIT) {
    lookupCache.delete(lookupCache.keys().next().value as string);
  }
  lookupCache.set(key, found);
  return found;
}

// --- platform probes -------------------------------------------------------

function run(command: string, args: string[], timeoutMs = 5_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      }
    );
  });
}

/**
 * macOS: Spotify and Apple Music both expose `current track` and
 * `player position`. Guarded by `application … is running` so querying never
 * *launches* either of them. Field order must match the parse below.
 */
const MAC_NOW_PLAYING_SCRIPT = [
  'set out to ""',
  'if application "Spotify" is running then',
  '  tell application "Spotify"',
  "    if player state is playing then",
  "      set t to current track",
  // Spotify reports track duration in ms and player position in seconds.
  '      set out to "Spotify" & linefeed & (name of t) & linefeed & (artist of t) & linefeed & (album of t) & linefeed & (artwork url of t) & linefeed & ((duration of t) as text) & linefeed & ((player position * 1000) as text)',
  "    end if",
  "  end tell",
  "end if",
  'if out is "" then',
  '  if application "Music" is running then',
  '    tell application "Music"',
  "      if player state is playing then",
  "        set t to current track",
  // Apple Music reports both in seconds.
  '        set out to "Apple Music" & linefeed & (name of t) & linefeed & (artist of t) & linefeed & (album of t) & linefeed & "" & linefeed & ((duration of t) * 1000 as text) & linefeed & ((player position * 1000) as text)',
  "      end if",
  "    end tell",
  "  end if",
  "end if",
  "return out",
].join("\n");

async function readMacNowPlaying(): Promise<RawNowPlaying> {
  const out = await run("/usr/bin/osascript", ["-e", MAC_NOW_PLAYING_SCRIPT], 4_000).catch(() => "");
  const [source, title, artist, album, artwork, duration, position] = out.trim().split("\n");
  if (!source || !title) return { playing: false };
  return {
    playing: true,
    title,
    artist,
    album,
    artworkUrl: artwork?.startsWith("http") ? artwork : undefined,
    durationMs: toFiniteInt(duration),
    positionMs: toFiniteInt(position),
    source,
  };
}

/** Linux: MPRIS via `playerctl`, if it's installed. */
async function readLinuxNowPlaying(): Promise<RawNowPlaying> {
  const format = [
    "{{playerName}}",
    "{{status}}",
    "{{title}}",
    "{{artist}}",
    "{{album}}",
    "{{mpris:artUrl}}",
    "{{mpris:length}}",
    "{{position}}",
  ].join("\n");
  const out = await run("playerctl", ["metadata", "--format", format], 4_000).catch(() => "");
  const [player, status, title, artist, album, artUrl, length, position] = out.trim().split("\n");
  if (!player || status !== "Playing" || !title) return { playing: false };

  // MPRIS expresses both `mpris:length` and `position` in microseconds.
  const toMs = (value: string | undefined) => {
    const micros = toFiniteInt(value);
    return micros === undefined ? undefined : Math.round(micros / 1000);
  };

  return {
    playing: true,
    title,
    artist,
    album,
    artworkUrl: artUrl?.startsWith("http") ? artUrl : undefined,
    durationMs: toMs(length),
    positionMs: toMs(position),
    source: player,
  };
}

function toFiniteInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : undefined;
}

export default new MediaSession();
