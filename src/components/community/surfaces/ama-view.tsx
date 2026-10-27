"use client";

import { useMutation, useQuery } from "convex/react";
import { ArrowBigUp, Check, Loader2, MessageCircleQuestion, Mic, X } from "lucide-react";
import { useState } from "react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { EmptyState, errorText, SurfaceFrame } from "@/components/community/surfaces/surface-frame";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface Question {
  id: Id<"amaQuestions">;
  text: string;
  votes: number;
  answer?: string;
  status: string;
  author: { id: Id<"users">; name: string; imageUrl?: string };
  voted: boolean;
  mine: boolean;
}

function Asker({ q }: { q: Question }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Avatar className="size-4">
        <AvatarImage src={q.author.imageUrl} alt="" />
        <AvatarFallback className="text-[7px]">{q.author.name.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      {q.author.name}
    </span>
  );
}

export function AmaView({ channelId, communityId, name, topic }: { channelId: Id<"channels">; communityId: Id<"communities">; name: string; topic?: string }) {
  const board = useQuery(api.ama.board, { channelId });
  const ask = useMutation(api.ama.ask);
  const vote = useMutation(api.ama.vote);
  const take = useMutation(api.ama.takeQuestion);
  const answer = useMutation(api.ama.answer);
  const dismiss = useMutation(api.ama.dismiss);
  const [text, setText] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <SurfaceFrame communityId={communityId} icon={MessageCircleQuestion} name={name} topic={topic}>
      {board === undefined ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="mx-auto max-w-3xl space-y-6 p-4">
          {board.current && (
            <section className="space-y-3 rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/10 to-transparent p-5">
              <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-primary uppercase">
                <Mic className="size-3.5" /> Answering now
              </p>
              <p className="text-lg leading-snug font-semibold">{board.current.text}</p>
              <Asker q={board.current} />
              {board.canRun && (
                <div className="space-y-2 pt-1">
                  <Textarea placeholder="Write an answer (optional — you can answer out loud)" value={reply} onChange={(e) => setReply(e.target.value)} maxLength={1500} className="min-h-16" />
                  <div className="flex gap-2">
                    <Button
                      onClick={() =>
                        void run(async () => {
                          await answer({ questionId: board.current!.id, answer: reply || undefined });
                          setReply("");
                        })
                      }
                    >
                      <Check /> Mark answered
                    </Button>
                    <Button variant="ghost" onClick={() => void run(() => dismiss({ questionId: board.current!.id }))}>
                      Skip
                    </Button>
                  </div>
                </div>
              )}
            </section>
          )}

          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!text.trim()) return;
              setBusy(true);
              await run(async () => {
                await ask({ channelId, text });
                setText("");
              });
              setBusy(false);
            }}
          >
            <Input placeholder="Ask a question…" value={text} maxLength={280} onChange={(e) => setText(e.target.value)} />
            <Button type="submit" disabled={text.trim().length < 3 || busy}>
              Ask
            </Button>
          </form>
          {error && <p className="text-sm text-destructive">{error}</p>}

          <section className="space-y-2">
            <h2 className="px-1 text-sm font-semibold">Questions</h2>
            {board.open.length === 0 ? (
              <EmptyState icon={MessageCircleQuestion} title="No questions yet" body="Be the first to ask." />
            ) : (
              board.open.map((q) => (
                <div key={q.id} className="flex items-start gap-3 rounded-xl border border-foreground/10 p-3">
                  <button
                    type="button"
                    onClick={() => void run(() => vote({ questionId: q.id }))}
                    aria-pressed={q.voted}
                    className={cn(
                      "flex w-11 shrink-0 flex-col items-center rounded-lg border py-1 text-xs transition-colors",
                      q.voted ? "border-primary bg-primary/10 text-primary" : "border-foreground/15 text-muted-foreground hover:border-foreground/30",
                    )}
                  >
                    <ArrowBigUp className="size-4" />
                    <span className="tabular-nums">{q.votes}</span>
                  </button>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm">{q.text}</p>
                    <Asker q={q} />
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {board.canRun && (
                      <Button size="sm" variant="secondary" onClick={() => void run(() => take({ questionId: q.id }))}>
                        Answer
                      </Button>
                    )}
                    {(board.canRun || q.mine) && (
                      <Button size="icon" variant="ghost" className="size-8" aria-label="Remove" onClick={() => void run(() => dismiss({ questionId: q.id }))}>
                        <X className="size-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </section>

          {board.answered.length > 0 && (
            <section className="space-y-2">
              <h2 className="px-1 text-sm font-semibold text-muted-foreground">Answered</h2>
              {board.answered.map((q) => (
                <div key={q.id} className="space-y-1.5 rounded-xl border border-foreground/10 p-3">
                  <p className="text-sm font-medium">{q.text}</p>
                  <Asker q={q} />
                  {q.answer && <p className="border-l-2 border-primary/50 pl-3 text-sm text-muted-foreground">{q.answer}</p>}
                </div>
              ))}
            </section>
          )}
        </div>
      )}
    </SurfaceFrame>
  );
}
