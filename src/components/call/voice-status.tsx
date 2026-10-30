"use client";

import { useMutation, useQuery } from "convex/react";
import { Pencil } from "lucide-react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { VOICE_STATUS_MAX } from "../../../convex/lib/voiceGrant";

/**
 * The line under a voice channel's name, in the call header: shows the status, and — for someone with Set Voice
 * Status — lets them change it. The server checks the permission again (and that they are in the channel) and clears
 * the line when the last person leaves.
 */
export function VoiceStatusLine({ channelId }: { channelId: Id<"channels"> }) {
  const channel = useQuery(api.channels.get, { channelId });
  const setStatus = useMutation(api.voiceChannels.setStatus);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  if (!channel) return null;
  const status = channel.voiceStatus;
  // Whoever manages the channel can clear a status they can't set.
  const canEdit = channel.canSetVoiceStatus;
  if (!status && !canEdit) return null;

  const save = async (value: string) => {
    setError(null);
    try {
      await setStatus({ channelId, status: value });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const text = (
    <span className={status ? "truncate text-xs text-muted-foreground" : "truncate text-xs italic text-muted-foreground/70"}>
      {status ?? "Set a status"}
    </span>
  );

  if (!canEdit) return <div className="min-w-0">{text}</div>;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setDraft(status ?? "");
          setError(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className="group flex min-w-0 items-center gap-1 rounded px-1 hover:bg-accent/50" aria-label="Edit voice channel status">
          {text}
          <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-2 p-3">
        <p className="text-sm font-semibold">Channel status</p>
        <Input
          value={draft}
          maxLength={VOICE_STATUS_MAX}
          placeholder="What's happening in here?"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save(draft);
          }}
          autoFocus
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-between gap-2">
          <Button variant="ghost" size="sm" disabled={!status} onClick={() => void save("")}>
            Clear
          </Button>
          <Button size="sm" onClick={() => void save(draft)}>
            Save
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">Shown under the channel&apos;s name. It clears when everyone has left.</p>
      </PopoverContent>
    </Popover>
  );
}
