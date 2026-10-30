/**
 * The two players "Watch together" can drive, behind one small interface, so the sync logic in
 * components/call/watch-together.tsx doesn't care which it has: a YouTube video through YouTube's own
 * IFrame API, or a direct video / audio file through a media element.
 *
 * Positions are milliseconds throughout. Nothing here talks to the server.
 */

export interface WatchPlayer {
  play(): void;
  pause(): void;
  seek(ms: number): void;
  position(): number;
  duration(): number | undefined;
  isPlaying(): boolean;
  setVolume(volume01: number): void;
  setMuted(muted: boolean): void;
  destroy(): void;
}

export interface PlayerEvents {
  onReady(): void;
  /** The person using this player did something with it (host only — a follower's controls are off). */
  onUserPlay(): void;
  onUserPause(): void;
  onUserSeek(): void;
  onEnded(): void;
}

// --- Direct media --------------------------------------------------------------------------------

export function createDirectPlayer(el: HTMLMediaElement, events: PlayerEvents): WatchPlayer {
  const onPlay = () => events.onUserPlay();
  const onPause = () => events.onUserPause();
  const onSeeked = () => events.onUserSeek();
  const onEnded = () => events.onEnded();
  const onReady = () => events.onReady();
  el.addEventListener("play", onPlay);
  el.addEventListener("pause", onPause);
  el.addEventListener("seeked", onSeeked);
  el.addEventListener("ended", onEnded);
  el.addEventListener("loadedmetadata", onReady);
  if (el.readyState >= 1) queueMicrotask(onReady);

  return {
    play: () => void el.play().catch(() => {}),
    pause: () => el.pause(),
    seek: (ms) => {
      el.currentTime = ms / 1000;
    },
    position: () => el.currentTime * 1000,
    duration: () => (Number.isFinite(el.duration) ? el.duration * 1000 : undefined),
    isPlaying: () => !el.paused && !el.ended,
    setVolume: (v) => {
      el.volume = Math.min(1, Math.max(0, v));
    },
    setMuted: (m) => {
      el.muted = m;
    },
    destroy: () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("seeked", onSeeked);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("loadedmetadata", onReady);
      el.pause();
    },
  };
}

// --- YouTube -------------------------------------------------------------------------------------

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    el: HTMLElement,
    options: {
      videoId: string;
      host?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: () => void;
        onStateChange?: (event: { data: number }) => void;
      };
    },
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const YT_STATE = { ended: 0, playing: 1, paused: 2 } as const;

let ytApi: Promise<YTNamespace> | null = null;

/** YouTube's IFrame API, loaded once. Rejects if it can't be reached, which the player shows as "couldn't load". */
function loadYouTubeApi(): Promise<YTNamespace> {
  if (typeof window === "undefined") return Promise.reject(new Error("No window."));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytApi) return ytApi;
  ytApi = new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YouTube's player didn't load."));
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      ytApi = null;
      reject(new Error("Couldn't reach YouTube."));
    };
    document.head.appendChild(script);
  });
  return ytApi;
}

/**
 * A YouTube player in `host` (an element it fills). A follower's player has YouTube's controls and keyboard
 * off; the host keeps them, and their play, pause and seek reach the room through the events. A seek on
 * YouTube raises no event of its own, so it is noticed as the position jumping away from where playback
 * would have taken it.
 */
export async function createYouTubePlayer(
  host: HTMLElement,
  videoId: string,
  options: { controls: boolean; startMs: number },
  events: PlayerEvents,
): Promise<WatchPlayer> {
  const YT = await loadYouTubeApi();
  const mount = document.createElement("div");
  host.replaceChildren(mount);

  let destroyed = false;
  let lastState = -1;
  let lastPos = 0;
  let lastAt = performance.now();

  const player = await new Promise<YTPlayer>((resolve) => {
    const created: YTPlayer = new YT.Player(mount, {
      videoId,
      // The privacy-enhanced host, the one the app already allows to be framed.
      host: "https://www.youtube-nocookie.com",
      playerVars: {
        controls: options.controls ? 1 : 0,
        disablekb: options.controls ? 0 : 1,
        rel: 0,
        playsinline: 1,
        modestbranding: 1,
        fs: 0,
        autoplay: 1,
        start: Math.floor(options.startMs / 1000),
        ...(typeof location !== "undefined" && location.protocol.startsWith("http") ? { origin: location.origin } : {}),
      },
      events: {
        onReady: () => {
          resolve(created);
          events.onReady();
        },
        onStateChange: ({ data }) => {
          if (destroyed) return;
          if (data === YT_STATE.playing && lastState !== YT_STATE.playing) events.onUserPlay();
          else if (data === YT_STATE.paused && lastState !== YT_STATE.paused) events.onUserPause();
          else if (data === YT_STATE.ended) events.onEnded();
          lastState = data;
          lastPos = created.getCurrentTime() * 1000;
          lastAt = performance.now();
        },
      },
    });
  });

  const poll = setInterval(() => {
    if (destroyed) return;
    const now = performance.now();
    const pos = player.getCurrentTime() * 1000;
    const expected = lastState === YT_STATE.playing ? lastPos + (now - lastAt) : lastPos;
    if (Math.abs(pos - expected) > 1500) events.onUserSeek();
    lastPos = pos;
    lastAt = now;
  }, 500);

  return {
    play: () => player.playVideo(),
    pause: () => player.pauseVideo(),
    seek: (ms) => {
      lastPos = ms;
      lastAt = performance.now();
      player.seekTo(ms / 1000, true);
    },
    position: () => player.getCurrentTime() * 1000,
    duration: () => {
      const d = player.getDuration();
      return d > 0 ? d * 1000 : undefined;
    },
    isPlaying: () => player.getPlayerState() === YT_STATE.playing,
    setVolume: (v) => player.setVolume(Math.round(Math.min(1, Math.max(0, v)) * 100)),
    setMuted: (m) => (m ? player.mute() : player.unMute()),
    destroy: () => {
      destroyed = true;
      clearInterval(poll);
      try {
        player.destroy();
      } catch {
        /* already gone */
      }
      host.replaceChildren();
    },
  };
}
