"use client";

import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import { PartyPopper } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAccessibility } from "@/components/accessibility-provider";
import { useAudioPreferences } from "@/components/audio-provider";
import { CONFETTI_COLOURS, scatter } from "@/lib/celebration";
import { playClip, startMusicTrack } from "@/lib/ui-sounds";
import { Button } from "@/components/ui/button";

/** Where the celebration is up to. `gift` waits on a click; the rest run
 * themselves. */
type Stage = "gift" | "opening" | "party";

interface Piece {
  id: number;
  colour: string;
  /** Viewport percentage across. */
  left: number;
  width: number;
  height: number;
  delay: number;
  duration: number;
  drift: number;
  spin: number;
}

function makeConfetti(count: number, salt: number): Piece[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    colour: CONFETTI_COLOURS[Math.floor(scatter(i, salt + 1) * CONFETTI_COLOURS.length)]!,
    left: scatter(i, salt + 2) * 100,
    width: 6 + scatter(i, salt + 3) * 7,
    height: 9 + scatter(i, salt + 4) * 12,
    delay: scatter(i, salt + 5) * 2.4,
    duration: 3.4 + scatter(i, salt + 6) * 2.6,
    drift: (scatter(i, salt + 7) - 0.5) * 240,
    spin: (scatter(i, salt + 8) - 0.5) * 900,
  }));
}

const MUSIC_URL = "/sounds/birthday-music.mp3";

/** Where the good bit starts. The opening half-minute is an intro nobody is
 * waiting through while a box sits on screen. */
const MUSIC_START_SECONDS = 29;

/** Music sits at half the volume the one-shots get: it runs for minutes under
 * everything else, where they're over in a moment. */
const MUSIC_LEVEL = 0.5;

/** Fired on each tap, pitched up a little further every time so three of them
 * in a row read as progress rather than a stuck key. */
const TAP_CLIP = "/sounds/rustle.mp3";

/** Taps needed before the lid comes off. Each one shakes the box and shifts
 * the lid a little further, so the last one is earned rather than arbitrary. */
const TAPS_TO_OPEN = 3;

/**
 * The unopened box.
 *
 * Three nested wrappers, each animating exactly one thing, because `transform`
 * is a single property: framer-motion writes it inline, so anything it touches
 * cannot also carry the scene's static tilt. Bob, shake and tilt therefore get
 * a node each, and every one of them passes the 3D context down — `perspective`
 * only reaches direct children, so a wrapper without `preserve-3d` flattens
 * everything below it.
 */
function GiftBox({
  stage,
  taps,
  reducedMotion,
  soundVolume,
  outputDeviceId,
  onTap,
  onLidOff,
}: {
  stage: Stage;
  taps: number;
  reducedMotion: boolean;
  soundVolume: number;
  outputDeviceId: string | undefined;
  onTap: () => void;
  onLidOff: () => void;
}) {
  const opening = stage === "opening";
  const shake = useAnimationControls();

  const handleTap = () => {
    if (opening) return;
    onTap();
    playClip(TAP_CLIP, {
      volume: soundVolume,
      // Climbs with each tap, so the third one sounds like the last one.
      rate: 1 + taps * 0.14,
      outputDeviceId,
    });
    // Fired imperatively rather than through `animate`: the same shake has to
    // replay on every tap, and a declarative target that hasn't changed
    // wouldn't re-run.
    void shake.start({
      rotate: [0, -6, 6, -4, 4, -2, 0],
      x: [0, -11, 11, -7, 7, -3, 0],
      transition: { duration: 0.5, ease: "easeInOut" },
    });
  };

  return (
    <motion.button
      type="button"
      onClick={handleTap}
      disabled={opening}
      aria-label={
        opening ? "Opening your present" : `Tap to open your present (${taps} of ${TAPS_TO_OPEN})`
      }
      className="gift-scene relative h-72 w-72 cursor-pointer rounded-3xl outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      // Exit is the whole gift dropping away once the lid has cleared it,
      // which is what hands the stage to the confetti.
      exit={{ opacity: 0, y: 320, transition: { duration: 0.55, ease: "easeIn" } }}
    >
      {/* A slow bob while it's waiting to be opened, so the box reads as
          something to touch rather than a picture. */}
      <motion.div
        className="gift-3d absolute inset-0"
        animate={opening ? { y: 0 } : { y: [0, -10, 0] }}
        transition={
          opening
            ? { duration: 0.2 }
            : { duration: 3.2, repeat: Infinity, ease: "easeInOut" }
        }
      >
        <motion.div className="gift-3d absolute inset-0" animate={shake}>
          <div className="gift-tilt absolute inset-0">
            <div className="gift-shadow" />

            <div className="gift-base">
              <div className="gift-face gift-face--front gift-face--wrap" />
              <div className="gift-face gift-face--back gift-face--wrap" />
              <div className="gift-face gift-face--left gift-face--side gift-face--wrap" />
              <div className="gift-face gift-face--right gift-face--side gift-face--wrap" />
              {/* The inside, seen for the second the lid is in the air. */}
              <div className="gift-face gift-face--top" />
            </div>

            {/* Each tap jogs the lid up and skews it further off true; the
                last one lifts it clear and holds it there, since the drop is
                the parent's exit and the lid must not settle back down
                first. */}
            <motion.div
              className="gift-lid"
              animate={
                opening
                  ? { y: -150, rotate: -12 }
                  : { y: taps * -14, rotate: taps * -3.5, x: taps * 2 }
              }
              transition={{
                delay: opening ? 0.28 : 0,
                duration: opening ? (reducedMotion ? 0.2 : 0.85) : 0.4,
                ease: opening ? [0.22, 1, 0.36, 1] : "easeOut",
              }}
              onAnimationComplete={() => {
                if (opening) onLidOff();
              }}
            >
              <div className="gift-face gift-face--front gift-face--wrap" />
              <div className="gift-face gift-face--back gift-face--wrap" />
              <div className="gift-face gift-face--left gift-face--side gift-face--wrap" />
              <div className="gift-face gift-face--right gift-face--side gift-face--wrap" />
              <div className="gift-face gift-face--top" />
              {/* A sibling of the faces, not a child of the top one: the bow
                  stands up out of the lid's 3D space, where a face is a flat
                  plane that would lay it down. */}
              <div className="gift-bow">
                <div className="gift-bow__loop gift-bow__loop--back" />
                <div className="gift-bow__loop gift-bow__loop--left" />
                <div className="gift-bow__loop gift-bow__loop--right" />
                <div className="gift-bow__loop gift-bow__loop--front" />
                <div className="gift-knot" />
              </div>
            </motion.div>
          </div>
        </motion.div>
      </motion.div>
    </motion.button>
  );
}

/** Falling-upward confetti across the whole window, rising in from below. */
function ConfettiField() {
  const pieces = useMemo(() => makeConfetti(34, 7), []);

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none fixed inset-0 overflow-hidden"
      initial={{ opacity: 0, y: 80 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
    >
      {pieces.map((piece) => (
        <motion.span
          key={piece.id}
          className="absolute bottom-0 block rounded-[2px]"
          style={{
            left: `${piece.left}%`,
            width: piece.width,
            height: piece.height,
            backgroundColor: piece.colour,
          }}
          initial={{ y: "12vh", opacity: 0 }}
          animate={{
            y: "-105vh",
            x: piece.drift,
            rotate: piece.spin,
            opacity: [0, 1, 1, 0],
          }}
          transition={{
            duration: piece.duration,
            delay: piece.delay,
            repeat: Infinity,
            ease: "linear",
            // Fade in over the first stretch and out over the last, rather
            // than popping in at full strength halfway up the screen.
            opacity: { duration: piece.duration, delay: piece.delay, repeat: Infinity, times: [0, 0.12, 0.8, 1] },
          }}
        />
      ))}
    </motion.div>
  );
}

/** The horn, and the arc of paper coming out of it. */
function Popper() {
  const burst = useMemo(() => makeConfetti(16, 91), []);

  return (
    <div className="relative">
      <motion.div
        // A recoil on each blow, timed to the burst below it.
        animate={{ rotate: [-14, -30, -14], scale: [1, 1.12, 1] }}
        transition={{ duration: 0.7, repeat: Infinity, repeatDelay: 1.1, ease: "easeOut" }}
      >
        <PartyPopper className="size-16 text-amber-300" />
      </motion.div>

      {/* Fired from the horn's mouth, up and to the right. */}
      <div aria-hidden className="pointer-events-none absolute top-0 right-0">
        {burst.map((piece) => (
          <motion.span
            key={piece.id}
            className="absolute block rounded-[2px]"
            style={{
              width: piece.width,
              height: piece.height * 0.8,
              backgroundColor: piece.colour,
            }}
            initial={{ x: 0, y: 0, opacity: 0, scale: 0.6 }}
            animate={{
              x: 40 + piece.drift * 0.9,
              y: -90 - Math.abs(piece.drift) * 0.5,
              rotate: piece.spin,
              opacity: [0, 1, 1, 0],
              scale: 1,
            }}
            transition={{
              duration: 1.4,
              delay: piece.delay * 0.4,
              repeat: Infinity,
              repeatDelay: 0.5,
              ease: "easeOut",
            }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The celebration itself, from unopened box to confetti.
 *
 * Knows nothing about whose birthday it is or whether today counts — that
 * lives in `BirthdayProvider`, so the same sequence can be replayed on demand
 * from the top nav. Mount it under a changing `key` to start it over.
 */
export function BirthdayCelebration({
  name,
  onDone,
}: {
  name: string | undefined;
  onDone: () => void;
}) {
  const { reducedMotion } = useAccessibility();
  const { uiSoundVolume, outputDeviceId } = useAudioPreferences();
  const [stage, setStage] = useState<Stage>("gift");
  const [taps, setTaps] = useState(0);

  /** The stopper for the music, held so dismissing can end it and so the
   * track can't outlive the overlay. */
  const stopMusic = useRef<((fadeOutMs?: number) => void) | null>(null);

  // Starts on the way into the party and not a moment sooner: the track is
  // scoring the confetti, so it begins as the lid clears rather than under a
  // box nobody has touched yet.
  useEffect(() => {
    if (stage !== "party") return;
    stopMusic.current = startMusicTrack(MUSIC_URL, {
      startAt: MUSIC_START_SECONDS,
      fadeInMs: 1800,
      volume: uiSoundVolume * MUSIC_LEVEL,
      outputDeviceId: outputDeviceId || undefined,
    });
    // Covers every way out — the button, Escape, or the overlay being
    // unmounted from under us.
    return () => stopMusic.current?.();
    // Deliberately not re-running on a volume change: restarting the track
    // mid-celebration would be worse than it finishing at the volume it
    // started at.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const dismiss = useCallback(() => {
    stopMusic.current?.();
    onDone();
  }, [onDone]);

  // Escape is the way out of anything that covers the window, including
  // before the box has been opened.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  const firstName = name?.split(" ")[0] ?? "you";
  const lines = [
    `Happy birthday, ${firstName}!`,
    "From everyone at Crystal, we hope you enjoy your special day.",
  ];

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Birthday"
      // Under the window controls (z-999) on purpose: covering the whole app
      // shouldn't mean losing the ability to minimise or close the window.
      className="fixed inset-0 z-[998] flex flex-col items-center justify-center overflow-hidden bg-background/80 backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
    >
      {stage === "party" && !reducedMotion && <ConfettiField />}

      <AnimatePresence>
        {stage !== "party" && (
          <GiftBox
            key="gift"
            stage={stage}
            taps={taps}
            reducedMotion={reducedMotion}
            soundVolume={uiSoundVolume}
            outputDeviceId={outputDeviceId || undefined}
            onTap={() => {
              const next = taps + 1;
              setTaps(next);
              if (next >= TAPS_TO_OPEN) setStage("opening");
            }}
            onLidOff={() => setStage("party")}
          />
        )}
      </AnimatePresence>

      {/* Nothing about a box says "keep going", so the hint says it — and
          leaves once the tapping has clearly been understood. */}
      <AnimatePresence>
        {stage === "gift" && taps === 0 && (
          <motion.p
            key="hint"
            className="absolute bottom-24 text-sm text-muted-foreground"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, delay: 0.6 }}
          >
            Tap the box to open it
          </motion.p>
        )}
      </AnimatePresence>

      {stage === "party" && (
        // Delayed as a group so the gift has finished dropping out before any
        // of this arrives, rather than the two crossing over.
        <motion.div
          className="relative flex flex-col items-center gap-6 px-6 text-center"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.35 }}
        >
          {reducedMotion ? (
            <PartyPopper className="size-16 -rotate-12 text-amber-300" />
          ) : (
            <Popper />
          )}

          <div className="flex flex-col gap-2">
            {lines.map((line, i) => (
              <motion.p
                key={line}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.7 + i * 0.35 }}
                className={
                  i === 0
                    ? "text-3xl font-bold tracking-tight"
                    : "text-base text-muted-foreground"
                }
              >
                {line}
              </motion.p>
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.7 + lines.length * 0.35 }}
          >
            <Button onClick={dismiss}>Thanks!</Button>
          </motion.div>
        </motion.div>
      )}
    </motion.div>
  );
}
