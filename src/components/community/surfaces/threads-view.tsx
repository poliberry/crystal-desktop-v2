"use client";

import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Loader2, Lock, MessagesSquare, Pin, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { EmptyState, errorText, SurfaceFrame } from "@/components/community/surfaces/surface-frame";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const ago = (ms: number) => {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
};

function Who({ user, className }: { user: { name: string; imageUrl?: string }; className?: string }) {
  return (
    <span className={className}>
      <Avatar className="size-5">
        <AvatarImage src={user.imageUrl} alt="" />
        <AvatarFallback className="text-[8px]">{user.name.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
    </span>
  );
}

function NewThread({ channelId, open, onOpenChange, onCreated }: { channelId: Id<"channels">; open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: Id<"forumPosts">) => void }) {
  const create = useMutation(api.forums.create);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start a thread</DialogTitle>
          <DialogDescription>A conversation of its own, found by its title.</DialogDescription>
        </DialogHeader>
        <Input placeholder="Title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        <Textarea placeholder="What do you want to talk about?" value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} className="min-h-32" />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button
            disabled={title.trim().length < 3 || !body.trim() || busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const id = await create({ channelId, title, body });
                setTitle("");
                setBody("");
                onOpenChange(false);
                onCreated(id);
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="animate-spin" />} Post
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Thread({ postId, onBack }: { postId: Id<"forumPosts">; onBack: () => void }) {
  const post = useQuery(api.forums.get, { postId });
  const reply = useMutation(api.forums.reply);
  const moderate = useMutation(api.forums.moderate);
  const removeReply = useMutation(api.forums.removeReply);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (post === undefined) return <Loader2 className="mx-auto my-16 size-5 animate-spin text-muted-foreground" />;
  if (post === null) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        That thread is gone. <Button variant="link" onClick={onBack}>Back</Button>
      </div>
    );
  }
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft /> Threads
        </Button>
        <div className="ml-auto flex gap-1.5">
          {post.canModerate && (
            <>
              <Button size="sm" variant="ghost" onClick={() => void run(() => moderate({ postId, action: post.pinned ? "unpin" : "pin" }))}>
                <Pin /> {post.pinned ? "Unpin" : "Pin"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void run(() => moderate({ postId, action: post.locked ? "unlock" : "lock" }))}>
                <Lock /> {post.locked ? "Unlock" : "Lock"}
              </Button>
            </>
          )}
          {(post.canModerate || post.mine) && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() =>
                void run(async () => {
                  await moderate({ postId, action: "delete" });
                  onBack();
                })
              }
            >
              <Trash2 /> Delete
            </Button>
          )}
        </div>
      </div>

      <article className="space-y-3 rounded-2xl border border-foreground/10 p-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          {post.title}
          {post.pinned && <Badge variant="secondary">Pinned</Badge>}
          {post.locked && <Badge variant="secondary">Locked</Badge>}
        </h2>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Who user={post.author} /> {post.author.name} · {ago(post.createdAt)}
        </p>
        <p className="text-sm whitespace-pre-wrap">{post.body}</p>
      </article>

      <div className="space-y-2">
        {post.replies.map((r) => (
          <div key={r.id} className="group flex gap-3 rounded-xl border border-foreground/10 p-3">
            <Avatar className="size-7">
              <AvatarImage src={r.author.imageUrl} alt="" />
              <AvatarFallback className="text-[9px]">{r.author.name.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{r.author.name}</span> · {ago(r.createdAt)}
              </p>
              <p className="text-sm whitespace-pre-wrap">{r.text}</p>
            </div>
            {(r.mine || post.canModerate) && (
              <Button size="icon" variant="ghost" className="size-7 opacity-0 group-hover:opacity-100" aria-label="Delete reply" onClick={() => void run(() => removeReply({ replyId: r.id }))}>
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
        ))}
      </div>

      {post.locked && !post.canModerate ? (
        <p className="text-center text-sm text-muted-foreground">This thread is locked.</p>
      ) : (
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!text.trim()) return;
            await run(async () => {
              await reply({ postId, text });
              setText("");
            });
          }}
        >
          <Textarea placeholder="Reply…" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} className="min-h-20" />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={!text.trim()}>
            Reply
          </Button>
        </form>
      )}
    </div>
  );
}

export function ThreadsView({ channelId, communityId, name, topic }: { channelId: Id<"channels">; communityId: Id<"communities">; name: string; topic?: string }) {
  const list = useQuery(api.forums.list, { channelId });
  const [open, setOpen] = useState<Id<"forumPosts"> | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <SurfaceFrame
      communityId={communityId}
      icon={MessagesSquare}
      name={name}
      topic={topic}
      actions={
        !open && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> New thread
          </Button>
        )
      }
    >
      {open ? (
        <Thread postId={open} onBack={() => setOpen(null)} />
      ) : list === undefined ? (
        <Loader2 className="mx-auto my-16 size-5 animate-spin text-muted-foreground" />
      ) : list.posts.length === 0 ? (
        <EmptyState icon={MessagesSquare} title="No threads yet" body="Start the first conversation.">
          <Button onClick={() => setCreating(true)}>
            <Plus /> New thread
          </Button>
        </EmptyState>
      ) : (
        <div className="mx-auto max-w-3xl space-y-2 p-4">
          {list.posts.map((p) => (
            <button key={p.id} type="button" onClick={() => setOpen(p.id)} className="flex w-full items-start gap-3 rounded-xl border border-foreground/10 p-3 text-left transition-colors hover:border-foreground/25">
              <Who user={p.author} className="pt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <span className="truncate">{p.title}</span>
                  {p.pinned && <Pin className="size-3 shrink-0 text-primary" />}
                  {p.locked && <Lock className="size-3 shrink-0 text-muted-foreground" />}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{p.preview}</span>
                <span className="block pt-0.5 text-[11px] text-muted-foreground">
                  {p.author.name} · {p.replyCount} {p.replyCount === 1 ? "reply" : "replies"} · active {ago(p.lastActivityAt)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      <NewThread channelId={channelId} open={creating} onOpenChange={setCreating} onCreated={setOpen} />
    </SurfaceFrame>
  );
}
