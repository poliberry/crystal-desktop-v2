# Crystal — LiveKit voice & video chat desktop app

An Electron desktop app for simple voice & video chat powered by [LiveKit],
with screen sharing and cross-platform **system audio sharing**.

- **Frontend:** Next.js (App Router, static export) + [shadcn/ui] + Tailwind CSS v4
- **Desktop shell:** Electron (main + preload, context-isolated renderer)
- **Real-time:** [livekit-client] (WebRTC in the renderer)
- **Tooling:** [bun] for installing, building, running, packaging

```
crystal-desktop/
├── electron/
│   ├── main.ts          # Electron main: window, permissions, IPC
│   ├── preload.ts       # contextBridge → window.desktopAPI
│   └── systemAudio.ts   # Linux PulseAudio system-audio capture layer
├── src/
│   ├── app/             # Next.js App Router (page, layout, globals.css)
│   ├── components/      # Room UI + shadcn/ui components
│   ├── hooks/           # use-room (LiveKit room lifecycle)
│   ├── lib/
│   │   ├── livekit.ts   # (client wiring lives in hooks/use-room)
│   │   ├── system-audio.ts  # renderer-side system audio share + sink routing
│   │   └── desktop.ts   # typed access to window.desktopAPI
│   └── types/           # desktop-api types
├── scripts/
│   ├── token.mjs        # mint LiveKit join tokens from the CLI
│   └── run-electron.mjs # spawns the Electron binary robustly
└── next.config.ts       # static export + relative assetPrefix (file:// support)
```

---

## Quick start

```bash
bun install
cp .env.example .env.local     # add your LiveKit keys (optional for token minting)
bun run dev                    # starts Next.js dev server + Electron window
```

### Getting a LiveKit server + token

Point the app at a [LiveKit Cloud] project or self-host a [LiveKit server].

Then mint a join token:

```bash
# reads LIVEKIT_API_KEY / LIVEKIT_API_SECRET from .env.local
bun run token -- --room my-room --identity alice
```

Paste the URL (e.g. `wss://your-livekit-server.livekit.cloud`) and the JWT
into the connect form. The form also works in a plain browser (`bun run dev:next`)
so you can develop the UI without Electron.

### Building & packaging

```bash
bun run build    # next static export (out/) + tsc for electron (dist-electron/)
bun run dist     # electron-builder → installers in release/
```

---

## System audio sharing

"Share system audio" publishes the audio of **other applications** (music,
players, browser tabs, …) into the room — never the app's own audio, so there
is no echo of the people in the meeting.

| Platform | Capture mechanism |
| --- | --- |
| Linux | PulseAudio virtual sink + monitor (below), captured directly via `parec`/`pw-record` and injected through an AudioWorklet |
| macOS | Bundled ScreenCaptureKit helper (`native/SystemAudioCapture`), with a BlackHole/Background Music fallback in a plain browser |
| Windows | `getDisplayMedia` answered with native WASAPI loopback (`audio: "loopback"`) |

### How Linux system audio capture works

Chromium refuses to open PulseAudio **monitor** sources through plain
`getUserMedia()` — it doesn't even list them in `enumerateDevices()` — no
matter what `deviceId` is passed. The Electron main process
(`electron/systemAudio.ts`) drives PulseAudio directly with `pactl` and
captures the virtual sink's monitor with the `parec` CLI (or `pw-record`),
streaming the raw PCM to the renderer:

1. Load a **null sink** named `crystal_system_audio`:
   `pactl load-module module-null-sink sink_name=crystal_system_audio`
2. Make it the **default sink** so every other application plays into it.
3. Load `module-loopback` from `crystal_system_audio.monitor` back to the real
   hardware output so the user still hears what is being shared.
4. Run `parec --device=crystal_system_audio.monitor …` (fallback
   `pw-record --target=…`) and stream the monitor's raw s16le PCM to the
   renderer as interleaved Float32 over IPC (`system-audio-linux:audio`).
5. The renderer injects that PCM through an AudioWorklet →
   MediaStreamAudioDestinationNode and publishes the resulting track as a
   LiveKit `ScreenShareAudio` track (`acquirePcmLoopbackTrack` in
   `src/lib/system-audio.ts` — the same pipeline the macOS helper uses).

Capturing the *virtual sink's* monitor explicitly — rather than the system
default sink — is what makes sharing reliable: it keeps working even if the
default output changes, never grabs the hardware monitor (which would include
the app's own output → echo), and avoids the experimental
`PulseaudioLoopbackForScreenShare` Chromium path that produced choppy/crackly
audio and started silent.

#### Keeping the app's own audio out of the capture

The whole trick to avoid self-capture is **sink separation**:

- The virtual sink is the *default*, but the app **never** plays into the
  default. Every media element (`<audio>`/`<video>`) that plays LiveKit audio
  is routed to the real hardware sink with `HTMLMediaElement.setSinkId()`.
- A `MutationObserver` watches the DOM while sharing is active and routes any
  newly attached audio element to the hardware sink automatically
  (`src/lib/system-audio.ts` → `routeElementToPlayback`).
- A main-process **routing guardian** (`routeSinkInputs` in
  `electron/systemAudio.ts`) runs every ~400 ms while sharing is active and
  re-moves the app's own Pulse streams to the hardware sink, while keeping
  every other application's stream on the capture sink.
- Because the app writes exclusively to the hardware sink, its own output (and
  the microphone) never enters the monitored null sink → no echo, no
  self-capture, no feedback loop in the shared stream.

On `disable` (or app quit) the recorder is stopped, the modules are unloaded,
and the original default sink is restored.

#### Requirements & caveats

- Requires PulseAudio (or PipeWire with `pipewire-pulse`, which ships `pactl`)
  plus `parec` (`pulseaudio-utils`); `pw-record` (`pipewire-utils`) is used as
  a fallback. If `pactl`/`parec` are unavailable, the toggle surfaces an error.
- Apps that are *already playing* audio when sharing starts are moved into the
  capture sink automatically (and kept there by the routing guardian);
  applications started afterwards play into it because it is the default sink.
- The capture is resilient: if the recorder process exits unexpectedly while
  sharing, it is restarted automatically.
- Tearing down: stop recorder, unload modules, restore default sink (handled
  on quit too).

---

## How the pieces talk

```
Renderer (Next.js, contextIsolated)
  └─ window.desktopAPI  (contextBridge, electron/preload.ts)
       ├─ appInfo()          → platform, versions
       └─ systemAudio        → enable / disable / info
                              └─ electron/systemAudio.ts (pactl, Linux only)
```

Everything else stays in the renderer: `Room` (livekit-client), local
mic/camera, `createLocalScreenTracks` for screen share, and the system-audio
track publishing in `src/lib/system-audio.ts`.

---

## Notes

- The renderer uses `livekit-client` directly (no `@livekit/components-react`)
  so the system-audio / sink-routing logic is fully under our control and easy
  to extend.
- `next.config.ts` uses `output: "export"` + `assetPrefix: "./"` so the built
  app works when Electron loads it over `file://`.
- `scripts/run-electron.mjs` strips a globally exported `ELECTRON_RUN_AS_NODE`
  env var if present (breaks Electron when it leaks from other tooling).

[LiveKit]: https://livekit.io
[LiveKit Cloud]: https://cloud.livekit.io
[LiveKit server]: https://docs.livekit.io/home/self-hosting/
[shadcn/ui]: https://ui.shadcn.com
[livekit-client]: https://github.com/livekit/client-sdk-js
[bun]: https://bun.sh
