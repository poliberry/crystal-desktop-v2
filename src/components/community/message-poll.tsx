"use client";

import { useMutation, useQuery } from "convex/react";
import { BarChart3, Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { errorText, nextSelection, percentages, sameSelection, tickDelayMs, timeLeftText, votesText } from "./poll-format";

/**
 * A poll inside a channel message: the question, one row per option with its live share of the
 * votes, and the controls to vote or (for the author and moderators) end it. The words come from
 * `words` when the channel is end-to-end encrypted, else from the stored poll itself.
 */
export function MessagePoll({
  messageId,
  poll,
  words,
  canEnd,
  pending = false,
}: {
  messageId: Id<"channelMessages">;
  poll: {
    multi: boolean;
    optionCount: number;
    question: string | null;
    options: { id: number; text: string }[] | null;
    expiresAt: number | null;
    endedAt: number | null;
  };
  words: { question: string; options: string[] } | null;
  canEnd: boolean;
  pending?: boolean;
}) {
  // Results are a query of their own: they change with every vote and differ for each viewer.
  const results = useQuery(api.polls.results, pending ? "skip" : { messageId });
  const castVote = useMutation(api.polls.vote);
  const endPoll = useMutation(api.polls.end);

  const [now, setNow] = useState(() => Date.now());
  // A multi-answer viewer's unsent choices; null means "show what the server has".
  const [draft, setDraft] = useState<number[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The server result only re-runs when someone votes, so the deadline passing is noticed here.
  const closed =
    poll.endedAt !== null || results?.open === false || (poll.expiresAt !== null && now >= poll.expiresAt);

  useEffect(() => {
    if (closed || poll.expiresAt === null) return;
    const timer = setTimeout(() => setNow(Date.now()), tickDelayMs(poll.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [closed, poll.expiresAt, now]);

  const question = words?.question ?? poll.question;
  const texts = words?.options ?? poll.options?.map((o) => o.text) ?? null;

  if (question === null || texts === null) {
    return (
      <div className="bg-muted/30 text-muted-foreground mt-1 flex w-full max-w-md items-center gap-2 rounded-lg border px-3 py-2 text-sm">
        <BarChart3 className="size-4 shrink-0" />
        {pending ? "Sending poll…" : "Encrypted poll. Unlock your account to read it."}
      </div>
    );
  }

  const counts = texts.map((_, id) => results?.counts[id] ?? 0);
  const voters = results?.voters ?? 0;
  const shares = percentages(counts, poll.multi, voters);
  const mine = results?.mine ?? [];
  const leading = new Set(results?.leading ?? []);
  const chosen = poll.multi ? (draft ?? mine) : mine;
  const canVote = !closed && !pending && results != null && !busy;

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (e) {
      setError(errorText(e, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submitVote = async (optionIds: number[]) => {
    if (await run(() => castVote({ messageId, optionIds }), "Couldn't record your vote.")) setDraft(null);
  };

  const onPick = (id: number) => {
    if (!canVote) return;
    if (poll.multi) {
      setDraft(nextSelection(chosen, id, true));
      setError(null);
    } else {
      void submitVote(nextSelection(mine, id, false));
    }
  };

  const timeLeft = !closed && poll.expiresAt !== null ? timeLeftText(poll.expiresAt, now) : null;

  return (
    <div className="bg-muted/30 mt-1 w-full max-w-md rounded-lg border p-3">
      <div className="flex items-start gap-2">
        <BarChart3 className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <p className="text-sm leading-snug font-medium break-words">{question}</p>
      </div>
      <p className="text-muted-foreground mt-0.5 pl-6 text-xs">
        {poll.multi ? "Select one or more" : "Select one"}
      </p>

      <div role="group" aria-label="Poll results" className="mt-2.5 grid gap-1.5">
        {texts.map((text, id) => {
          const selected = chosen.includes(id);
          const winner = closed && leading.has(id);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={selected}
              disabled={!canVote}
              onClick={() => onPick(id)}
              className={cn(
                "relative flex w-full items-center gap-2 overflow-hidden rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors",
                "focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]",
                selected ? "border-primary/60" : "border-border",
                canVote ? "hover:bg-accent/40 cursor-pointer" : "cursor-default",
                busy && "opacity-70",
              )}
            >
              {/* The bar is only decoration; the figures beside it say the same in words. */}
              <span
                aria-hidden
                className={cn(
                  "absolute inset-y-0 left-0 transition-[width] duration-300",
                  winner ? "bg-primary/35" : "bg-primary/15",
                )}
                style={{ width: `${shares[id]}%` }}
              />
              <span className="relative flex size-4 shrink-0 items-center justify-center">
                {selected && <Check className="text-primary size-4" aria-label="Your vote" />}
              </span>
              <span className={cn("relative min-w-0 flex-1 break-words", winner && "font-semibold")}>{text}</span>
              <span className="text-muted-foreground relative shrink-0 text-xs tabular-nums">
                <span className={cn(winner && "text-foreground font-semibold")}>{shares[id]}%</span>
                <span className="mx-1" aria-hidden>
                  ·
                </span>
                {counts[id]}
              </span>
            </button>
          );
        })}
      </div>

      {poll.multi && !closed && !pending && (
        <div className="mt-2 flex items-center gap-2">
          <Button
            size="sm"
            disabled={!canVote || chosen.length === 0 || sameSelection(chosen, mine)}
            onClick={() => void submitVote(chosen)}
          >
            {busy && <Loader2 className="animate-spin" />}
            Vote
          </Button>
          {mine.length > 0 && (
            <Button size="sm" variant="ghost" disabled={!canVote} onClick={() => void submitVote([])}>
              Remove vote
            </Button>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-destructive mt-2 text-xs">
          {error}
        </p>
      )}

      <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span>{votesText(voters)}</span>
        {(closed || timeLeft) && <span aria-hidden>·</span>}
        {closed ? <span>Poll ended</span> : timeLeft && <span>Ends in {timeLeft}</span>}
        {canEnd && !closed && !pending && (
          <span className="ml-auto flex items-center gap-1.5">
            {confirmEnd ? (
              <>
                <span>Really end it?</span>
                <button
                  type="button"
                  disabled={busy}
                  className="text-foreground font-medium hover:underline disabled:opacity-50"
                  onClick={async () => {
                    if (await run(() => endPoll({ messageId }), "Couldn't end the poll.")) setConfirmEnd(false);
                  }}
                >
                  Yes
                </button>
                <button type="button" disabled={busy} className="hover:underline disabled:opacity-50" onClick={() => setConfirmEnd(false)}>
                  No
                </button>
              </>
            ) : (
              <button
                type="button"
                className="hover:text-foreground hover:underline"
                onClick={() => {
                  setError(null);
                  setConfirmEnd(true);
                }}
              >
                End poll
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
