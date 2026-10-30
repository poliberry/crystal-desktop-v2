"use client";

import { useMutation, useQuery } from "convex/react";
import { Hand, Mic, MicOff, Radio } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A stage channel's people: who is up speaking, who is listening, and — for the people who run the stage —
 * the queue of raised hands.
 *
 * The roster is the channel's participant list, which the server keeps (convex/voiceChannels.ts): `stageSpeaker`
 * is whether someone is up, `handRaisedAt` when they asked. Bringing someone up or sending them back needs Mute
 * Members, checked again by the server; the buttons only show for people who hold it. The speakers' tiles are in
 * the call grid above; this is the rest of the room.
 */
export function StagePanel({ channelId }: { channelId: Id<"channels"> }) {
  const roster = useQuery(api.channels.listVoiceParticipants, { channelId });
  const channel = useQuery(api.channels.get, { channelId });
  const me = useQuery(api.users.getCurrentUser);
  const setSpeaker = useMutation(api.voiceChannels.setSpeaker);
  const raiseHand = useMutation(api.voiceChannels.raiseHand);

  if (!roster || !channel) return null;
  const canModerate = channel.canMuteMembers;
  const speakers = roster.filter((p) => p.stageSpeaker);
  const audience = roster.filter((p) => !p.stageSpeaker);
  const queue = audience
    .filter((p) => p.handRaisedAt !== undefined)
    .sort((a, b) => (a.handRaisedAt ?? 0) - (b.handRaisedAt ?? 0));
  const listening = audience.filter((p) => p.handRaisedAt === undefined).sort((a, b) => a.joinedAt - b.joinedAt);

  const bringUp = (userId: Id<"users">) => void setSpeaker({ channelId, userId, speaker: true }).catch(() => {});
  const sendDown = (userId: Id<"users">) => void setSpeaker({ channelId, userId, speaker: false }).catch(() => {});
  const dismiss = (userId: Id<"users">) => {
    // Only your own hand can be lowered by you; a moderator dismissing a request just leaves it for them to lower or ignore.
    if (userId === me?._id) void raiseHand({ channelId, raised: false }).catch(() => {});
  };

  const Person = ({ p, children }: { p: (typeof roster)[number]; children?: React.ReactNode }) => (
    <div className="flex items-center gap-2 py-1 text-sm">
      <Avatar className="size-6">
        <AvatarImage src={p.imageUrl} alt={p.name} />
        <AvatarFallback className="text-[9px]">{p.name.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <span className="truncate">{p.name}</span>
      {p.id === me?._id && <span className="text-xs text-muted-foreground">(you)</span>}
      <div className="ml-auto flex items-center gap-1">{children}</div>
    </div>
  );

  return (
    <div className="grid gap-3 rounded-2xl border border-[color:var(--glass-border)] bg-[color:var(--glass-bg)] p-3 shadow-lg shadow-black/20 sm:grid-cols-2">
      <section>
        <h3 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Radio className="size-3.5" /> On stage · {speakers.length}
        </h3>
        {speakers.length === 0 ? (
          <p className="py-1 text-xs text-muted-foreground">Nobody is speaking yet.</p>
        ) : (
          speakers.map((p) => (
            <Person key={p.id} p={p}>
              {p.muted || p.serverMuted ? <MicOff className="size-3.5 text-destructive" aria-label="Muted" /> : <Mic className="size-3.5 text-emerald-500" aria-label="Speaking allowed" />}
              {canModerate && p.id !== me?._id && (
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => sendDown(p.id)}>
                  Move to audience
                </Button>
              )}
            </Person>
          ))
        )}
      </section>

      <section>
        {queue.length > 0 && (
          <div className="mb-2">
            <h3 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-500">
              <Hand className="size-3.5" /> Asking to speak · {queue.length}
            </h3>
            {queue.map((p) => (
              <Person key={p.id} p={p}>
                {canModerate ? (
                  <Button size="sm" className="h-6 px-2 text-xs" onClick={() => bringUp(p.id)}>
                    Bring up
                  </Button>
                ) : p.id === me?._id ? (
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => dismiss(p.id)}>
                    Lower hand
                  </Button>
                ) : (
                  <Hand className="size-3.5 text-amber-500" aria-label="Hand raised" />
                )}
              </Person>
            ))}
          </div>
        )}
        <h3 className={cn("mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground")}>
          Audience · {audience.length}
        </h3>
        {listening.length === 0 && queue.length === 0 ? (
          <p className="py-1 text-xs text-muted-foreground">Nobody is listening yet.</p>
        ) : (
          <div className="max-h-40 overflow-y-auto">
            {listening.map((p) => (
              <Person key={p.id} p={p}>
                {canModerate && (
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => bringUp(p.id)}>
                    Invite to speak
                  </Button>
                )}
              </Person>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
