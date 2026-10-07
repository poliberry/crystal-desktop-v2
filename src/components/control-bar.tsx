"use client";

import {
  ChevronUp,
  Headphones,
  HeadphoneOff,
  Mic,
  MicOff,
  MonitorCog,
  MonitorUp,
  Music4,
  ScreenShareOff,
  Video,
  VideoOff,
} from "lucide-react";
import { AnimatePresence, animate, motion, useMotionValue } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { AudioDeviceWheels } from "@/components/audio-device-wheels";
import { SoundboardPanel } from "@/components/call/soundboard";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { GLASS_BASE, GLASS_DARK } from "@/components/sidebar/glass";
import { cn } from "@/lib/utils";
import { PhoneIcon } from "@animateicons/react/lucide";

interface ControlBarProps {
  cameraEnabled: boolean;
  microphoneEnabled: boolean;
  deafened: boolean;
  screenSharing: boolean;
  cameraAvailable?: boolean;
  microphoneAvailable?: boolean;
  onToggleCamera: () => void;
  onToggleMicrophone: () => void;
  onToggleDeafen: () => void;
  onToggleScreenShare: () => void;
  /** Re-open the picker against the running share to change screen, audio
   * source or quality without stopping it. */
  onOpenShareSettings: () => void;
  onLeave: () => Promise<void>;
  busy: boolean;
  /** Told when the device pickers open or close, so the room can keep the bar
   * on screen while they are open. */
  onPickersOpenChange?: (open: boolean) => void;
}

/**
 * One curve and one duration for everything that changes when a panel opens or
 * closes — the panel's height, its fade, and the card's width.
 *
 * Springs were used for these and each settled on its own schedule: the height
 * of a panel that is a couple of hundred pixels tall and the width of a card that
 * only grows a few dozen don't take the same time, so on closing the panel was
 * gone while the card was still wide, and for a moment the bar was a long strip
 * with its buttons spread apart before it narrowed. Sharing a duration is what
 * keeps them in step.
 */
const PANEL_TRANSITION = { duration: 0.26, ease: [0.32, 0.72, 0, 1] as const };
/** Wide enough for the input and output wheels side by side. */
const PICKER_WIDTH = 416;

function ControlButton({
  label,
  active,
  danger,
  onClick,
  disabled,
  children,
  className,
}: {
  label: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={active ? "default" : "ghost"}
          size="icon"
          className={cn(
            "size-10 shrink-0",
            active && "bg-primary text-primary-foreground",
            danger && "text-destructive hover:bg-destructive/15",
            className,
          )}
          onClick={onClick}
          disabled={disabled}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ControlBar({
  cameraEnabled,
  microphoneEnabled,
  deafened,
  screenSharing,
  cameraAvailable = true,
  microphoneAvailable = true,
  onToggleCamera,
  onToggleMicrophone,
  onToggleDeafen,
  onToggleScreenShare,
  onOpenShareSettings,
  onLeave,
  busy,
  onPickersOpenChange,
}: ControlBarProps) {
  const [leaving, setLeaving] = useState(false);
  /** Which panel is unfolded above the buttons, if any. They share the card, so
   * only one is open at a time. */
  const [panel, setPanel] = useState<"devices" | "soundboard" | null>(null);
  const devicesOpen = panel === "devices";
  const soundboardOpen = panel === "soundboard";
  const cardRef = useRef<HTMLDivElement>(null);
  // The card's width, as a number only while it is moving: at rest it is
  // `auto` — as wide as its buttons, whichever of them there are right now —
  // and opening reads that width off the card and eases it out to the pickers'
  // width, then back, then hands it back to `auto`.
  const width = useMotionValue<number | "auto">("auto");
  const restingWidth = useRef(0);
  const toggle = (next: "devices" | "soundboard") => {
    const card = cardRef.current;
    if (!card) return;
    if (panel === null) {
      // Opening from closed is the only time the width has to move; going from
      // one panel to the other it is already as wide as it gets.
      restingWidth.current = card.getBoundingClientRect().width;
      width.set(restingWidth.current);
      animate(width, Math.max(restingWidth.current, PICKER_WIDTH), PANEL_TRANSITION);
    }
    setPanel(panel === next ? null : next);
  };

  // Closing goes through here too, since the outside press and Escape close it
  // without going through a button.
  useEffect(() => {
    if (panel !== null) return;
    if (width.get() === "auto") return;
    const controls = animate(width, restingWidth.current, {
      ...PANEL_TRANSITION,
      onComplete: () => width.set("auto"),
    });
    return () => controls.stop();
  }, [panel, width]);

  // The pickers are part of the card, so nothing dismisses them for us: a press
  // anywhere outside it, or Escape, does.
  useEffect(() => {
    if (panel === null) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!cardRef.current?.contains(event.target as Node)) setPanel(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanel(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [panel]);

  useEffect(() => {
    onPickersOpenChange?.(panel !== null);
  }, [panel, onPickersOpenChange]);

  const handleLeave = async () => {
    setLeaving(true);
    try {
      await onLeave();
    } finally {
      setLeaving(false);
    }
  };

  return (
    <TooltipProvider>
      {/* One glass card, like the user card in the sidebar: the input and
          output pickers unfold above the buttons and the card grows around
          them, rather than a menu opening over a fixed bar. */}
      <motion.div
        ref={cardRef}
        className={cn(GLASS_BASE, GLASS_DARK, "max-w-full rounded-2xl")}
        style={{ width }}
      >
        <AnimatePresence initial={false} mode="wait">
          {panel !== null && (
            <motion.div
              key={panel}
              className="overflow-hidden border-b border-foreground/10"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={PANEL_TRANSITION}
            >
              {panel === "devices" ? (
                <AudioDeviceWheels />
              ) : (
                <SoundboardPanel columns={6} className="px-3 pt-3 pb-3" />
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Every button is a direct child, spread with `justify-between`: when
            the card is as wide as its buttons there is nothing to spread, and
            when the pickers widen it they move apart to fill it. */}
        <div className="flex w-full min-w-max items-center justify-between gap-1.5 p-1.5">
          {/* Mic, with the device pickers hanging off it so switching inputs
              never means leaving the call screen. */}
          <div className="flex shrink-0 items-center">
            <ControlButton
              label={
                !microphoneAvailable
                  ? "No microphone detected"
                  : microphoneEnabled
                    ? "Mute microphone"
                    : "Unmute microphone"
              }
              onClick={onToggleMicrophone}
              disabled={busy || !microphoneAvailable}
              className="rounded-l-md rounded-r-none"
            >
              {microphoneEnabled ? <Mic /> : <MicOff className="text-destructive" />}
            </ControlButton>

            <Button
              variant="ghost"
              size="icon"
              aria-label="Audio devices"
              aria-expanded={devicesOpen}
              className="h-10 w-5 rounded-r-md rounded-l-none"
              onClick={() => toggle("devices")}
            >
              <ChevronUp
                className={cn("size-3 transition-transform duration-300", devicesOpen && "rotate-180")}
              />
            </Button>
          </div>

          <ControlButton
            label={deafened ? "Undeafen" : "Deafen"}
            onClick={onToggleDeafen}
            disabled={busy}
            danger={deafened}
          >
            {deafened ? <HeadphoneOff /> : <Headphones />}
          </ControlButton>

          <ControlButton
            label={
              !cameraAvailable
                ? "No camera detected"
                : cameraEnabled
                  ? "Turn camera off"
                  : "Turn camera on"
            }
            onClick={onToggleCamera}
            disabled={busy || !cameraAvailable}
          >
            {cameraEnabled ? <Video /> : <VideoOff className="text-destructive" />}
          </ControlButton>

          <span aria-hidden className="h-8 w-px shrink-0 bg-foreground/10" />

          <ControlButton
            label={screenSharing ? "Stop sharing screen" : "Share screen"}
            onClick={onToggleScreenShare}
            disabled={busy}
          >
            {screenSharing ? <ScreenShareOff /> : <MonitorUp />}
          </ControlButton>

          {screenSharing && (
            <ControlButton label="Change screen, audio or quality" onClick={onOpenShareSettings}>
              <MonitorCog />
            </ControlButton>
          )}

          {/* Opens in the card, like the device pickers, rather than as a menu
              over the call. */}
          <ControlButton
            label="Soundboard"
            onClick={() => toggle("soundboard")}
            active={false}
            className={cn("shrink-0", soundboardOpen && "bg-foreground/10")}
          >
            <Music4 />
          </ControlButton>

          <Tooltip>
            <TooltipTrigger asChild>
              {/* The glass card's own surface, tinted red — a gradient that fades
                  out from the top-left corner, a hairline edge and the same
                  blur, rather than a flat destructive fill. */}
              <Button
                variant="ghost"
                className={cn(
                  GLASS_BASE,
                  "h-12 w-16 shrink-0 rounded-xl border-0 ring-0 from-red-400/50 via-red-500/25 to-red-500/10 text-red-50 hover:from-red-400/60 hover:via-red-500/30 hover:text-white",
                )}
                onClick={handleLeave}
                disabled={busy || leaving}
              >
                <PhoneIcon duration={1} size={40} className="rotate-135" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Leave room</TooltipContent>
          </Tooltip>
        </div>
      </motion.div>
    </TooltipProvider>
  );
}
