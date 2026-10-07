"use client";

import { useMutation, useQuery } from "convex/react";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, Plus, Swords, Radio, Star } from "lucide-react";
import { useMemo, useState } from "react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { errorText, SurfaceFrame } from "@/components/community/surfaces/surface-frame";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { cn } from "@/lib/utils";

type Kind = "event" | "scrim" | "stream";

const KIND_META: Record<Kind, { label: string; icon: typeof Star; tone: string }> = {
  event: { label: "Event", icon: Star, tone: "bg-sky-500/15 text-sky-500" },
  scrim: { label: "Scrim", icon: Swords, tone: "bg-rose-500/15 text-rose-500" },
  stream: { label: "Stream", icon: Radio, tone: "bg-purple-500/15 text-purple-500" },
};

const DAY = 24 * 60 * 60 * 1000;
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
/** `datetime-local` wants local time without a zone. */
const toInput = (ms: number) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
};

interface EventRow {
  id: Id<"communityEvents">;
  kind: Kind;
  title: string;
  details?: string;
  gameId?: string;
  startsAt: number;
  endsAt?: number;
  capacity?: number;
  cancelled: boolean;
  going: { id: Id<"users">; name: string; imageUrl?: string; starter: boolean }[];
  maybe: { id: Id<"users">; name: string; imageUrl?: string }[];
  mine: "going" | "maybe" | null;
}

function CreateDialog({
  communityId,
  games,
  kinds,
  day,
  open,
  onOpenChange,
}: {
  communityId: Id<"communities">;
  games: { id: string; name: string }[];
  kinds: Kind[];
  day: Date;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const create = useMutation(api.events.create);
  const [kind, setKind] = useState<Kind>(kinds[0] ?? "event");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [gameId, setGameId] = useState("none");
  const [when, setWhen] = useState("");
  const [capacity, setCapacity] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seededFor, setSeededFor] = useState<number | null>(null);

  if (open && seededFor !== day.getTime()) {
    setSeededFor(day.getTime());
    const d = new Date(day);
    d.setHours(19, 0, 0, 0);
    setWhen(toInput(d.getTime()));
    setTitle("");
    setDetails("");
    setGameId("none");
    setCapacity("");
    setKind(kinds[0] ?? "event");
    setError(null);
  }
  if (!open && seededFor !== null) setSeededFor(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule something</DialogTitle>
          <DialogDescription>Everyone in the community can see it and say whether they&apos;re going.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {kinds.length > 1 && (
            <div className="flex gap-1.5">
              {kinds.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    "flex-1 rounded-md border px-3 py-1.5 text-sm transition-colors",
                    kind === k ? "border-primary bg-primary/10" : "border-foreground/15 text-muted-foreground",
                  )}
                >
                  {KIND_META[k].label}
                </button>
              ))}
            </div>
          )}
          <Input placeholder="Title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
          <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          {games.length > 0 && (
            <Select value={gameId} onValueChange={setGameId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Any game</SelectItem>
                {games.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {kind === "scrim" && (
            <Input type="number" min={1} max={100} placeholder="How many can play? (optional)" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          )}
          <Textarea placeholder="Details (optional)" value={details} maxLength={800} onChange={(e) => setDetails(e.target.value)} className="min-h-20" />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button
            disabled={!title.trim() || !when || busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await create({
                  communityId,
                  kind,
                  title,
                  details: details || undefined,
                  gameId: gameId === "none" ? undefined : gameId,
                  startsAt: new Date(when).getTime(),
                  capacity: kind === "scrim" && capacity ? Number(capacity) : undefined,
                });
                onOpenChange(false);
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="animate-spin" />} Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EventDialog({
  event,
  canManage,
  games,
  onClose,
}: {
  event: EventRow | null;
  canManage: boolean;
  games: { id: string; name: string }[];
  onClose: () => void;
}) {
  const rsvp = useMutation(api.events.rsvp);
  const cancel = useMutation(api.events.cancel);
  const setStarter = useMutation(api.events.setStarter);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    }
  };
  if (!event) return <Dialog open={false} onOpenChange={onClose} />;
  const meta = KIND_META[event.kind];
  const game = games.find((g) => g.id === event.gameId)?.name;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {event.title}
            {event.cancelled && <Badge variant="destructive">Cancelled</Badge>}
          </DialogTitle>
          <DialogDescription>
            {new Date(event.startsAt).toLocaleString([], { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })}
            {event.endsAt && ` – ${time(event.endsAt)}`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary" className={meta.tone}>
            {meta.label}
          </Badge>
          {game && <Badge variant="secondary">{game}</Badge>}
          {event.capacity !== undefined && <Badge variant="secondary">{event.going.length} / {event.capacity}</Badge>}
        </div>
        {event.details && <p className="text-sm whitespace-pre-wrap text-muted-foreground">{event.details}</p>}

        {!event.cancelled && (
          <div className="flex gap-2">
            <Button variant={event.mine === "going" ? "default" : "secondary"} onClick={() => void run(() => rsvp({ eventId: event.id, status: event.mine === "going" ? null : "going" }))}>
              Going
            </Button>
            <Button variant={event.mine === "maybe" ? "default" : "secondary"} onClick={() => void run(() => rsvp({ eventId: event.id, status: event.mine === "maybe" ? null : "maybe" }))}>
              Maybe
            </Button>
          </div>
        )}

        <div className="max-h-48 space-y-1 overflow-y-auto">
          {event.going.map((p) => (
            <div key={p.id} className="flex items-center gap-2 text-sm">
              <Avatar className="size-6">
                <AvatarImage src={p.imageUrl} alt="" />
                <AvatarFallback className="text-[9px]">{p.name.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="flex-1 truncate">{p.name}</span>
              {event.kind === "scrim" && canManage ? (
                <Button size="sm" variant={p.starter ? "default" : "ghost"} className="h-6 px-2 text-xs" onClick={() => void run(() => setStarter({ eventId: event.id, userId: p.id, starter: !p.starter }))}>
                  {p.starter ? "Starting" : "Bench"}
                </Button>
              ) : (
                p.starter && <Badge variant="secondary">Starting</Badge>
              )}
            </div>
          ))}
          {event.maybe.length > 0 && <p className="pt-1 text-xs text-muted-foreground">Maybe: {event.maybe.map((p) => p.name).join(", ")}</p>}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {canManage && !event.cancelled && (
          <DialogFooter>
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void run(async () => { await cancel({ eventId: event.id }); onClose(); })}>
              Cancel event
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A month at a time, with who is coming to what. */
export function CalendarView({
  communityId,
  name,
  topic,
}: {
  communityId: Id<"communities">;
  name: string;
  topic?: string;
}) {
  const community = useQuery(api.communities.get, { communityId }) as
    | { kind?: "creator" | "clan"; clanGames?: { id: string; name: string }[] }
    | null
    | undefined;
  const myPerms = useQuery(api.roles.myPermissions, { communityId });
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const range = useMemo(() => {
    const start = new Date(month);
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    return { from: start.getTime() - 7 * DAY, to: end.getTime() + 7 * DAY };
  }, [month]);
  const events = useQuery(api.events.list, { communityId, ...range }) as EventRow[] | undefined;

  const [selected, setSelected] = useState(() => new Date());
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<Id<"communityEvents"> | null>(null);

  const games = community?.clanGames ?? [];
  const kinds: Kind[] = community?.kind === "clan" ? ["scrim", "event"] : ["stream", "event"];
  const canManage = hasPermission(typeof myPerms === "number" ? myPerms : 0, PERMISSIONS.MANAGE_EVENTS);

  const cells = useMemo(() => {
    const first = new Date(month);
    const lead = first.getDay();
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return Array.from({ length: Math.ceil((lead + days) / 7) * 7 }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i - lead + 1));
  }, [month]);

  const forDay = (d: Date) => (events ?? []).filter((e) => sameDay(new Date(e.startsAt), d));
  const opened = events?.find((e) => e.id === openId) ?? null;
  const today = new Date();

  return (
    <SurfaceFrame
      communityId={communityId}
      icon={CalendarDays}
      name={name}
      topic={topic}
      actions={
        canManage ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> Schedule
          </Button>
        ) : null
      }
    >
      <div className="mx-auto grid max-w-6xl gap-4 p-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="rounded-xl border border-foreground/10">
          <header className="flex items-center gap-2 border-b border-foreground/10 px-3 py-2">
            <h2 className="text-sm font-semibold">{month.toLocaleDateString([], { month: "long", year: "numeric" })}</h2>
            <div className="ml-auto flex gap-1">
              <Button size="icon" variant="ghost" className="size-7" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">
                <ChevronLeft className="size-4" />
              </Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setSelected(d); }}>
                Today
              </Button>
              <Button size="icon" variant="ghost" className="size-7" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </header>
          <div className="grid grid-cols-7 border-b border-foreground/10 text-center text-[11px] text-muted-foreground">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="py-1.5">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((d) => {
              const inMonth = d.getMonth() === month.getMonth();
              const items = forDay(d);
              return (
                <button
                  key={d.getTime()}
                  type="button"
                  onClick={() => setSelected(d)}
                  className={cn(
                    "flex min-h-20 flex-col gap-0.5 border-r border-b border-foreground/5 p-1 text-left transition-colors hover:bg-foreground/5",
                    !inMonth && "opacity-40",
                    sameDay(d, selected) && "bg-primary/10",
                  )}
                >
                  <span className={cn("flex size-5 items-center justify-center rounded-full text-[11px]", sameDay(d, today) && "bg-primary text-primary-foreground")}>
                    {d.getDate()}
                  </span>
                  {items.slice(0, 2).map((e) => (
                    <span key={e.id} className={cn("truncate rounded px-1 text-[10px]", KIND_META[e.kind].tone, e.cancelled && "line-through opacity-60")}>
                      {e.title}
                    </span>
                  ))}
                  {items.length > 2 && <span className="px-1 text-[10px] text-muted-foreground">+{items.length - 2} more</span>}
                </button>
              );
            })}
          </div>
        </section>

        <aside className="space-y-2">
          <h2 className="px-1 text-sm font-semibold">
            {selected.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
          </h2>
          {events === undefined ? (
            <Loader2 className="mx-auto my-8 size-5 animate-spin text-muted-foreground" />
          ) : forDay(selected).length === 0 ? (
            <p className="rounded-xl border border-dashed border-foreground/15 p-6 text-center text-sm text-muted-foreground">Nothing scheduled.</p>
          ) : (
            forDay(selected).map((e) => {
              const Icon = KIND_META[e.kind].icon;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setOpenId(e.id)}
                  className="flex w-full items-start gap-3 rounded-xl border border-foreground/10 p-3 text-left transition-colors hover:border-foreground/25"
                >
                  <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", KIND_META[e.kind].tone)}>
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-sm font-medium", e.cancelled && "line-through opacity-60")}>{e.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {time(e.startsAt)} · {e.going.length} going{e.capacity !== undefined && ` of ${e.capacity}`}
                    </span>
                  </span>
                  {e.mine && <Badge variant="secondary" className="capitalize">{e.mine}</Badge>}
                </button>
              );
            })
          )}
        </aside>
      </div>

      <CreateDialog communityId={communityId} games={games} kinds={kinds} day={selected} open={creating} onOpenChange={setCreating} />
      <EventDialog event={opened} canManage={canManage} games={games} onClose={() => setOpenId(null)} />
    </SurfaceFrame>
  );
}
