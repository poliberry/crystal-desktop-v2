"use client";

import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Loader2, Lock, MessagesSquare, Pin, Plus, Trash2, UserMinus, UserPlus, Users } from "lucide-react";
import { useMemo, useState } from "react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { EmptyState, errorText, SurfaceFrame } from "@/components/community/surfaces/surface-frame";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { describeWait } from "../../../../convex/lib/slowmodePure";

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

/** What the viewer can do in a forum, as the server reported it. */
interface Abilities {
  canCreatePublic: boolean;
  canCreatePrivate: boolean;
  slowmodeSeconds: number;
  slowmodeBypass: boolean;
  timedOut: boolean;
}

/** Why the viewer can't start a thread, or null if they can. */
const startRefusal = (a: Abilities) =>
  a.timedOut ? "You're timed out in this server." : !a.canCreatePublic && !a.canCreatePrivate ? "You don't have permission to start threads in this channel." : null;

/** A small note explaining slowmode, for people it applies to. */
function SlowmodeNote({ seconds, bypass, what }: { seconds: number; bypass: boolean; what: string }) {
  if (!seconds || bypass) return null;
  return <p className="text-xs text-muted-foreground">Slowmode: {describeWait(seconds * 1000)} between {what}.</p>;
}

function NewThread({ channelId, abilities, open, onOpenChange, onCreated }: { channelId: Id<"channels">; abilities: Abilities; open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: Id<"forumPosts">) => void }) {
  const create = useMutation(api.forums.create);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [wantPrivate, setWantPrivate] = useState(false);
  // Someone who may only start private threads has the switch on and locked; someone who may only
  // start public ones doesn't see it.
  const onlyPrivate = abilities.canCreatePrivate && !abilities.canCreatePublic;
  const isPrivate = onlyPrivate || (abilities.canCreatePrivate && wantPrivate);
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
        {abilities.canCreatePrivate && (
          <label className="flex items-center gap-3 rounded-xl border border-foreground/10 p-3">
            <Lock className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Private thread (invite only)</span>
              <span className="block text-xs text-muted-foreground">
                {onlyPrivate ? "You can only start private threads here." : "Only you, the people you invite and moderators can see it."}
              </span>
            </span>
            <Switch checked={isPrivate} disabled={onlyPrivate} onCheckedChange={setWantPrivate} />
          </label>
        )}
        <SlowmodeNote seconds={abilities.slowmodeSeconds} bypass={abilities.slowmodeBypass} what="new posts" />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button
            disabled={title.trim().length < 3 || !body.trim() || busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const id = await create({ channelId, title, body, private: isPrivate });
                setTitle("");
                setBody("");
                setWantPrivate(false);
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

/** Who is in a private thread, with the controls to invite or remove people for those allowed to. */
function PeopleList({ postId, communityId }: { postId: Id<"forumPosts">; communityId: Id<"communities"> }) {
  const people = useQuery(api.forums.members, { postId });
  const everyone = useQuery(api.communities.listMembers, { communityId });
  const invite = useMutation(api.forums.inviteMember);
  const remove = useMutation(api.forums.removeMember);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const candidates = useMemo(() => {
    if (!people || !everyone) return [];
    const inside = new Set<string>([people.author.id, ...people.members.map((m) => m.id)]);
    const q = search.trim().toLowerCase();
    return everyone
      .filter((m) => !m.isBot && !inside.has(m.userId) && (!q || m.name.toLowerCase().includes(q) || m.username.toLowerCase().includes(q)))
      .slice(0, 6);
  }, [people, everyone, search]);

  if (people === undefined) return <Loader2 className="mx-auto my-4 size-4 animate-spin text-muted-foreground" />;
  if (people === null) return <p className="text-sm text-muted-foreground">You no longer have access to this thread.</p>;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">Participants</p>
      <ul className="space-y-1.5">
        <li className="flex items-center gap-2 text-sm">
          <Who user={people.author} />
          <span className="min-w-0 flex-1 truncate">{people.author.name}</span>
          <Badge variant="secondary">Author</Badge>
        </li>
        {people.members.map((m) => (
          <li key={m.id} className="flex items-center gap-2 text-sm">
            <Who user={m} />
            <span className="min-w-0 flex-1 truncate">{m.name}</span>
            {m.canRemove && (
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                disabled={busy === m.id}
                aria-label={m.mine ? "Leave thread" : `Remove ${m.name}`}
                title={m.mine ? "Leave thread" : `Remove ${m.name}`}
                onClick={() => void run(m.id, () => remove({ postId, userId: m.id }))}
              >
                <UserMinus className="size-3.5" />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {people.canInvite ? (
        <div className="space-y-2 border-t border-foreground/10 pt-3">
          <Input placeholder="Invite someone by name" value={search} onChange={(e) => setSearch(e.target.value)} />
          {candidates.map((m) => (
            <div key={m.userId} className="flex items-center gap-2 text-sm">
              <Who user={m} />
              <span className="min-w-0 flex-1 truncate">{m.name}</span>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy === m.userId}
                onClick={() => void run(m.userId, async () => {
                  await invite({ postId, userId: m.userId });
                  setSearch("");
                })}
              >
                <UserPlus /> Invite
              </Button>
            </div>
          ))}
          {everyone !== undefined && candidates.length === 0 && <p className="text-xs text-muted-foreground">No one else to invite{search.trim() ? " by that name" : ""}.</p>}
        </div>
      ) : (
        <p className="border-t border-foreground/10 pt-3 text-xs text-muted-foreground">
          {people.members.length >= people.max ? `This thread has reached its limit of ${people.max} invited people.` : "Only the author or a moderator can invite people."}
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function Thread({ postId, communityId, onBack }: { postId: Id<"forumPosts">; communityId: Id<"communities">; onBack: () => void }) {
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

  // Why the reply box is replaced by a note, if it is.
  const replyBlock = post.timedOut
    ? "You're timed out in this server."
    : post.locked && !post.canModerate
      ? "This thread is locked."
      : !post.canReply
        ? "You don't have permission to reply in threads here."
        : null;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft /> Threads
        </Button>
        <div className="ml-auto flex gap-1.5">
          {post.private && (
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="ghost">
                  <Users /> Participants
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80">
                <PeopleList postId={postId} communityId={communityId} />
              </PopoverContent>
            </Popover>
          )}
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
          {post.private && <Lock className="size-4 shrink-0 text-muted-foreground" aria-label="Private thread" />}
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

      {replyBlock ? (
        <p className="text-center text-sm text-muted-foreground">{replyBlock}</p>
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
          <SlowmodeNote seconds={post.slowmodeSeconds} bypass={post.slowmodeBypass} what="replies" />
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
  // The New button is off, with the reason as its hover text, when the viewer can't start any thread.
  const refusal = list ? startRefusal(list) : null;
  const newButton = (
    <span title={refusal ?? undefined}>
      <Button size="sm" disabled={!list || !!refusal} onClick={() => setCreating(true)}>
        <Plus /> New thread
      </Button>
    </span>
  );

  return (
    <SurfaceFrame
      communityId={communityId}
      icon={MessagesSquare}
      name={name}
      topic={topic}
      actions={
        !open && newButton
      }
    >
      {open ? (
        <Thread postId={open} communityId={communityId} onBack={() => setOpen(null)} />
      ) : list === undefined ? (
        <Loader2 className="mx-auto my-16 size-5 animate-spin text-muted-foreground" />
      ) : list.posts.length === 0 ? (
        <EmptyState icon={MessagesSquare} title="No threads yet" body="Start the first conversation.">
          {newButton}
          {refusal && <p className="text-xs text-muted-foreground">{refusal}</p>}
        </EmptyState>
      ) : (
        <div className="mx-auto max-w-3xl space-y-2 p-4">
          <SlowmodeNote seconds={list.slowmodeSeconds} bypass={list.slowmodeBypass} what="new posts and replies" />
          {list.posts.map((p) => (
            <button key={p.id} type="button" onClick={() => setOpen(p.id)} className="flex w-full items-start gap-3 rounded-xl border border-foreground/10 p-3 text-left transition-colors hover:border-foreground/25">
              <Who user={p.author} className="pt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <span className="truncate">{p.title}</span>
                  {p.private && <Lock className="size-3 shrink-0 text-muted-foreground" aria-label="Private thread" />}
                  {p.pinned && <Pin className="size-3 shrink-0 text-primary" />}
                  {p.locked && <Badge variant="secondary" className="text-[10px]">Locked</Badge>}
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
      {list && <NewThread channelId={channelId} abilities={list} open={creating} onOpenChange={setCreating} onCreated={setOpen} />}
    </SurfaceFrame>
  );
}
