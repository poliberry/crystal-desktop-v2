"use client";

import { useQuery } from "convex/react";
import { Music4, Volume2 } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import { useCall } from "@/components/call/call-provider";
import { useAudioPreferences } from "@/components/audio-provider";
import { EmojiGlyph } from "@/components/home/emoji-select";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BUILTIN_SOUNDS, type SoundboardClip } from "@/lib/soundboard";
import { cn } from "@/lib/utils";

function SoundGrid({
  clips,
  onPlay,
}: {
  clips: SoundboardClip[];
  onPlay: (clip: SoundboardClip) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {clips.map((clip) => (
        <button
          key={clip.id}
          type="button"
          onClick={() => onPlay(clip)}
          title={clip.name}
          className={cn(
            "flex aspect-square flex-col items-center justify-center gap-0.5 rounded-md border border-border/40",
            "bg-muted/40 px-1 transition-colors hover:bg-muted active:scale-95",
            "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none"
          )}
        >
          <EmojiGlyph value={clip.emoji} className="text-lg leading-none" />
          <span className="w-full truncate text-center text-[10px] text-muted-foreground">
            {clip.name}
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * The soundboard: built-in clips plus whatever the current community has
 * uploaded. Clicking one broadcasts it to everyone in the call (a LiveKit
 * data packet, not an extra audio track — see `src/lib/soundboard.ts`) and
 * plays it locally.
 *
 * Community clips only appear in a community voice channel; a DM call has no
 * server to draw them from, so it gets the built-ins alone.
 */
export function SoundboardButton({ className }: { className?: string }) {
  const { activeCall, controller } = useCall();
  const { soundboardVolume, setSoundboardVolume, deafened } = useAudioPreferences();

  const communityId = activeCall?.kind === "channel" ? activeCall.communityId : null;
  const communitySounds = useQuery(
    api.soundboard.list,
    communityId ? { communityId } : "skip"
  );

  const uploaded: SoundboardClip[] = (communitySounds ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    emoji: s.emoji ?? "🔊",
    url: s.soundUrl,
    builtin: false,
  }));

  const play = (clip: SoundboardClip) => {
    void controller.playSoundboardClip(clip);
  };

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="secondary"
              size="icon"
              className={cn("size-12 rounded-full", className)}
            >
              <Music4 />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Soundboard</TooltipContent>
      </Tooltip>

      <PopoverContent side="top" align="center" className="w-80 p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold">Soundboard</p>
          {deafened && (
            <span className="text-[10px] text-muted-foreground">
              You won&apos;t hear these while deafened
            </span>
          )}
        </div>

        <ScrollArea className="max-h-72">
          <div className="space-y-3 pr-2">
            {uploaded.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  This server
                </p>
                <SoundGrid clips={uploaded} onPlay={play} />
              </div>
            )}
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Default
              </p>
              <SoundGrid clips={BUILTIN_SOUNDS} onPlay={play} />
            </div>
          </div>
        </ScrollArea>

        <div className="mt-3 flex items-center gap-2 border-t pt-3">
          <Volume2 className="size-3.5 shrink-0 text-muted-foreground" />
          <Slider
            value={[Math.round(soundboardVolume * 100)]}
            min={0}
            max={100}
            step={5}
            onValueChange={([value]) => setSoundboardVolume((value ?? 0) / 100)}
          />
          <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {Math.round(soundboardVolume * 100)}%
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
