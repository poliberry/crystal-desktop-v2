"use client";

import { Loader2, Mic, Pause, Play, Send, Square, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { readAudioPreferences } from "@/lib/audio-prefs";
import { cn } from "@/lib/utils";

import { MAX_VOICE_MS, VOICE_WAVEFORM_BARS, resamplePeaks } from "../../../convex/lib/voicePure";
import { formatVoiceTime, readableError, remainingMs } from "./voice-format";

/** Best first. Chromium and Firefox take the first two; Safari only does mp4. */
const RECORDER_TYPES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];
/** Anything shorter is a stray tap on the mic button, not a message. */
const MIN_VOICE_MS = 700;
/** Bars drawn in the live waveform while recording. */
const LIVE_BARS = 40;
/** How often a loudness reading is kept: 20 a second is plenty for 64 bars over five minutes. */
const SAMPLE_EVERY_MS = 50;
const WARN_AT_MS = 30_000;

type Phase = "starting" | "recording" | "preview" | "short" | "error";

interface Recording {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  waveform: number[];
}

function pickRecorderType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return RECORDER_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

function microphoneError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access is blocked. Allow it in your system or browser settings and try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone was found.";
  if (name === "NotReadableError" || name === "AbortError") return "Your microphone is being used by another app.";
  return "Couldn't start the microphone.";
}

/**
 * Records a voice message in place of the composer's text row: live waveform while talking, then a
 * preview with Discard and Send. It owns the microphone, so everything it opens (tracks, audio
 * context, recorder) is closed again on stop, cancel and unmount.
 */
export function VoiceMessageRecorder({
  disabled,
  onCancel,
  onSend,
}: {
  disabled?: boolean;
  onCancel: () => void;
  onSend: (recording: Recording) => Promise<void>;
}) {
  const [phase, setPhase] = useState<Phase>("starting");
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playedMs, setPlayedMs] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef(0);
  const timerRef = useRef(0);
  const chunksRef = useRef<Blob[]>([]);
  const peaksRef = useRef<number[]>([]);
  const startedAtRef = useRef(0);
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const audioRef = useRef<HTMLAudioElement>(null);
  const mountedRef = useRef(true);
  // Bumped on every start and release, so a microphone prompt answered after the user
  // has left (or restarted) is recognised as stale and its stream closed straight away.
  const attemptRef = useRef(0);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  /** Close everything that holds the microphone or a timer. Safe to call twice. */
  const release = useCallback(() => {
    attemptRef.current++;
    cancelAnimationFrame(frameRef.current);
    window.clearInterval(timerRef.current);
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) {
      // Detach first: stopping a recorder fires its last data and stop events, and a cancelled one must not act on them.
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          /* already stopping */
        }
      }
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const ctx = contextRef.current;
    contextRef.current = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
  }, []);

  const start = useCallback(async () => {
    release();
    const attempt = attemptRef.current;
    setPhase("starting");
    setError(null);
    setSendError(null);
    setElapsedMs(0);
    setRecording(null);
    chunksRef.current = [];
    peaksRef.current = [];

    const type = pickRecorderType();
    if (!navigator.mediaDevices?.getUserMedia || !type) {
      setError(
        !navigator.mediaDevices?.getUserMedia
          ? "Voice recording isn't available here."
          : "This browser can't record audio."
      );
      setPhase("error");
      return;
    }

    let stream: MediaStream;
    try {
      // Honour the microphone picked in settings; "ideal" so a since-unplugged device falls back to the default.
      const inputDeviceId = readAudioPreferences().inputDeviceId;
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          ...(inputDeviceId ? { deviceId: { ideal: inputDeviceId } } : {}),
        },
      });
    } catch (err) {
      if (attempt !== attemptRef.current || !mountedRef.current) return;
      setError(microphoneError(err));
      setPhase("error");
      return;
    }
    if (attempt !== attemptRef.current || !mountedRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;

    try {
      const recorder = new MediaRecorder(stream, { mimeType: type });
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onerror = () => {
        release();
        if (!mountedRef.current) return;
        setError("The recording failed. Try again.");
        setPhase("error");
      };

      const AudioContextCtor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioContextCtor();
      contextRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      void ctx.resume().catch(() => {});
      const samples = new Uint8Array(analyser.fftSize);

      recorder.start(250);
      startedAtRef.current = performance.now();
      setPhase("recording");

      // Loudest reading since the last kept sample, so a short click between samples still counts.
      let held = 0;
      let lastKept = startedAtRef.current;
      const live: number[] = new Array(LIVE_BARS).fill(0);
      const draw = (now: number) => {
        analyser.getByteTimeDomainData(samples);
        for (let i = 0; i < samples.length; i++) held = Math.max(held, Math.abs(samples[i] - 128) / 128);
        if (now - lastKept >= SAMPLE_EVERY_MS) {
          lastKept = now;
          peaksRef.current.push(held);
          live.push(held);
          live.shift();
          held = 0;
          // Bars are set straight on the elements: twenty React renders a second for decoration isn't worth it.
          for (let i = 0; i < LIVE_BARS; i++) {
            const bar = barRefs.current[i];
            // The square root lifts ordinary speech out of the bottom of the range.
            if (bar) bar.style.height = `${Math.max(10, Math.min(100, Math.sqrt(live[i]) * 130))}%`;
          }
        }
        frameRef.current = requestAnimationFrame(draw);
      };
      frameRef.current = requestAnimationFrame(draw);

      timerRef.current = window.setInterval(() => {
        const elapsed = performance.now() - startedAtRef.current;
        setElapsedMs(Math.min(elapsed, MAX_VOICE_MS));
        if (elapsed >= MAX_VOICE_MS) stopRef.current();
      }, 200);
    } catch {
      release();
      setError("This browser can't record audio.");
      setPhase("error");
    }
  }, [release]);

  // The interval above outlives the render that made it, so it calls stop through a ref.
  const stopRef = useRef<() => void>(() => {});
  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    // The stopwatch is the truth for length: MediaRecorder's webm has no duration in it.
    const durationMs = Math.min(performance.now() - startedAtRef.current, MAX_VOICE_MS);
    const type = recorder.mimeType || RECORDER_TYPES[0];
    const peaks = peaksRef.current;
    recorder.onstop = () => {
      const chunks = chunksRef.current;
      release();
      if (!mountedRef.current) return;
      if (durationMs < MIN_VOICE_MS || chunks.length === 0) {
        setPhase("short");
        return;
      }
      // Parameters like ;codecs=opus are dropped so the upload goes out with a plain content type.
      const mimeType = type.split(";")[0];
      const blob = new Blob(chunks, { type: mimeType });
      setElapsedMs(durationMs);
      setRecording({ blob, mimeType, durationMs: Math.round(durationMs), waveform: resamplePeaks(peaks, VOICE_WAVEFORM_BARS) });
      setPhase("preview");
    };
    // Stopping the timers now, ahead of onstop, so nothing ticks past the end.
    cancelAnimationFrame(frameRef.current);
    window.clearInterval(timerRef.current);
    try {
      recorder.stop();
    } catch {
      release();
    }
  }, [release]);
  stopRef.current = stop;

  const cancel = useCallback(() => {
    release();
    onCancelRef.current();
  }, [release]);

  useEffect(() => {
    mountedRef.current = true;
    void start();
    return () => {
      mountedRef.current = false;
      release();
    };
  }, [start, release]);

  // The preview's audio lives only as long as its object URL.
  useEffect(() => {
    if (!recording) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(recording.blob);
    setPreviewUrl(url);
    setPlaying(false);
    setPlayedMs(0);
    return () => URL.revokeObjectURL(url);
  }, [recording]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || sending) return;
      e.preventDefault();
      cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancel, sending]);

  const togglePreview = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setSendError("Couldn't play the preview."));
    else audio.pause();
  };

  const send = async () => {
    if (!recording || sending || disabled) return;
    audioRef.current?.pause();
    setSending(true);
    setSendError(null);
    try {
      await onSend(recording);
    } catch (err) {
      if (mountedRef.current) setSendError(readableError(err, "Couldn't send the voice message."));
    } finally {
      if (mountedRef.current) setSending(false);
    }
  };

  if (phase === "error" || phase === "short") {
    return (
      <div className="flex h-[58px] items-center gap-2 px-2">
        <p className={cn("min-w-0 flex-1 px-1 text-sm", phase === "error" ? "text-destructive" : "text-muted-foreground")}>
          {phase === "error" ? error : "Too short. Hold on a little longer to record a message."}
        </p>
        {phase === "short" && (
          <Button variant="secondary" size="sm" onClick={() => void start()}>
            <Mic className="size-4" />
            Try again
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={cancel}>
          Close
        </Button>
      </div>
    );
  }

  if (phase === "preview" && recording) {
    const progress = recording.durationMs > 0 ? Math.min(1, playedMs / recording.durationMs) : 0;
    return (
      <div className="flex h-[58px] items-center gap-2 px-2">
        {previewUrl && (
          <audio
            ref={audioRef}
            src={previewUrl}
            preload="auto"
            className="hidden"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => {
              setPlaying(false);
              setPlayedMs(0);
            }}
            onTimeUpdate={(e) => setPlayedMs(e.currentTarget.currentTime * 1000)}
          />
        )}
        <Button
          variant="secondary"
          size="icon"
          className="size-9 shrink-0 rounded-full"
          onClick={togglePreview}
          aria-label={playing ? "Pause preview" : "Play preview"}
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </Button>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
          <div className="flex h-7 items-center gap-[2px]" aria-hidden>
            {recording.waveform.map((v, i) => (
              <span
                key={i}
                className={cn("min-h-[3px] flex-1 rounded-full", i / recording.waveform.length < progress ? "bg-primary" : "bg-muted-foreground/40")}
                style={{ height: `${Math.max(8, (v / 255) * 100)}%` }}
              />
            ))}
          </div>
          {sendError && (
            <p role="alert" className="truncate text-[11px] leading-tight text-destructive" title={sendError}>
              {sendError}
            </p>
          )}
        </div>
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {formatVoiceTime(playing || playedMs > 0 ? playedMs : recording.durationMs)}
        </span>
        <Button variant="ghost" size="sm" onClick={cancel} disabled={sending} aria-label="Discard voice message">
          <Trash2 className="size-4" />
          Discard
        </Button>
        <Button size="sm" onClick={() => void send()} disabled={disabled || sending} aria-label="Send voice message">
          {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Send
        </Button>
      </div>
    );
  }

  const remaining = remainingMs(elapsedMs, MAX_VOICE_MS);
  return (
    <div className="flex h-[58px] items-center gap-2 px-2">
      <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={cancel} aria-label="Cancel recording">
        <X className="size-4" />
      </Button>
      <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-red-500" aria-hidden />
      <span className="w-10 shrink-0 text-sm tabular-nums" aria-label="Recording time">
        {formatVoiceTime(elapsedMs)}
      </span>
      <div className="flex h-7 min-w-0 flex-1 items-center gap-[2px] overflow-hidden" aria-hidden>
        {Array.from({ length: LIVE_BARS }, (_, i) => (
          <span
            key={i}
            ref={(el) => {
              barRefs.current[i] = el;
            }}
            className="min-h-[3px] flex-1 rounded-full bg-primary/80"
            style={{ height: "10%" }}
          />
        ))}
      </div>
      {phase === "recording" && remaining <= WARN_AT_MS && (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatVoiceTime(remaining)} left</span>
      )}
      <Button size="sm" onClick={stop} disabled={phase !== "recording"} aria-label="Stop recording">
        <Square className="size-3.5 fill-current" />
        Stop
      </Button>
    </div>
  );
}
