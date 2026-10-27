"use client";

import { useMutation, useQuery } from "convex/react";
import { Play } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useAudioPreferences } from "@/components/audio-provider";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BUILTIN_SOUNDS, playSound } from "@/lib/soundboard";

/** `<Select>` needs a non-empty value, and "" is our "unset" sentinel. */
const NONE = "__none__";
const INHERIT = "__inherit__";

/**
 * Picks the clip that plays for everyone else when this user joins a call.
 *
 * Offers every soundboard sound across every server they're in, plus the
 * built-ins — a join sound isn't scoped to where it came from. With a
 * `communityId` this edits that server's override, and gains an extra option
 * for falling back to the global choice.
 */
export function JoinSoundPicker({ communityId }: { communityId?: Id<"communities"> }) {
  const groups = useQuery(api.soundboard.listAccessible) ?? [];
  const current = useQuery(
    api.soundboard.myJoinSound,
    communityId ? { communityId } : {}
  );
  const globalChoice = useQuery(api.soundboard.myJoinSound, {});
  const setJoinSound = useMutation(api.soundboard.setJoinSound);
  const { soundboardVolume, outputDeviceId } = useAudioPreferences();

  // For a server picker, "inherit" is the state where no override is set —
  // which reads as the resolved value matching the global one.
  const scoped = communityId
    ? current?.soundId !== globalChoice?.soundId
      ? current?.soundId
      : undefined
    : current?.soundId;
  const value = scoped ?? (communityId ? INHERIT : NONE);

  const choose = (next: string) => {
    const soundId = next === NONE || next === INHERIT ? "" : next;
    void setJoinSound({ soundId, communityId }).catch(() => {});
  };

  const preview = () => {
    const soundId = current?.soundId;
    if (!soundId) return;
    const url =
      BUILTIN_SOUNDS.find((s) => s.id === soundId)?.url ?? current?.soundUrl ?? undefined;
    if (url) {
      void playSound(url, {
        volume: soundboardVolume,
        outputDeviceId: outputDeviceId || undefined,
      });
    }
  };

  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <Select value={value} onValueChange={choose}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-56">
            {communityId ? (
              <SelectItem value={INHERIT}>Use my default</SelectItem>
            ) : (
              <SelectItem value={NONE}>No join sound</SelectItem>
            )}

            <SelectGroup>
              <SelectLabel>Default sounds</SelectLabel>
              {BUILTIN_SOUNDS.map((sound) => (
                <SelectItem key={sound.id} value={sound.id}>
                  {sound.emoji} {sound.name}
                </SelectItem>
              ))}
            </SelectGroup>

            {groups.map((group) => (
              <SelectGroup key={group.communityId}>
                <SelectLabel>{group.communityName}</SelectLabel>
                {group.sounds.map((sound) => (
                  <SelectItem key={sound.id} value={sound.id}>
                    {sound.emoji ?? "🔊"} {sound.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button variant="outline" size="icon" disabled={!current?.soundId} onClick={preview}>
        <Play className="size-4" />
      </Button>
    </div>
  );
}
