"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import {
  Activity,
  Cpu,
  ExternalLink,
  HardDrive,
  Loader2,
  MemoryStick,
  Play,
  Plus,
  RefreshCw,
  Info,
  Server,
  Settings2,
  Skull,
  Square,
  Unplug,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ServerIcon, ServerInfo, type ServerInfoData } from "@/components/community/surfaces/server-info";
import { ServerProfileDialog } from "@/components/community/surfaces/server-profile-dialog";
import { EmptyState, errorText, SurfaceFrame } from "@/components/community/surfaces/surface-frame";
import type { MinecraftInfo, ServerProfile } from "../../../../convex/lib/serverProfile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Level = "none" | "view" | "power" | "manage";
const RANK: Record<Level, number> = { none: 0, view: 1, power: 2, manage: 3 };

interface Resources {
  state: string;
  suspended: boolean;
  cpuPercent: number;
  memoryBytes: number;
  diskBytes: number;
  networkRxBytes: number;
  networkTxBytes: number;
  uptimeMs: number;
}

const bytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
};

const uptime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
};

const STATE_STYLE: Record<string, string> = {
  running: "bg-emerald-500/15 text-emerald-500",
  starting: "bg-amber-500/15 text-amber-500",
  stopping: "bg-amber-500/15 text-amber-500",
  offline: "bg-foreground/10 text-muted-foreground",
};

// --- Connecting a panel -------------------------------------------------------------------

function ConnectPanel({ communityId, onDone }: { communityId: Id<"communities">; onDone?: () => void }) {
  const connect = useAction(api.gameServers.connectPanel);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await connect({ communityId, baseUrl, apiKey });
      setApiKey("");
      onDone?.();
    } catch (e) {
      setError(errorText(e, "Couldn't connect to the panel."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 px-6 py-10">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Connect a Pterodactyl panel</h2>
        <p className="text-sm text-muted-foreground">
          Your members can then start, stop and watch the servers you choose, without leaving Crystal.
        </p>
      </div>
      <div className="space-y-3 rounded-xl border border-foreground/10 p-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="panel-url">Panel address</label>
          <Input id="panel-url" placeholder="https://panel.example.com" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="panel-key">Client API key</label>
          <Input
            id="panel-key"
            type="password"
            autoComplete="off"
            placeholder="ptlc_…"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            In the panel: Account → API Credentials. Use a <strong>client</strong> key, never an admin one. It is stored encrypted and never shown to anyone
            again.
          </p>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button disabled={!baseUrl.trim() || !apiKey.trim() || busy} onClick={() => void submit()}>
          {busy && <Loader2 className="animate-spin" />} Connect
        </Button>
      </div>
    </div>
  );
}

// --- Adding a server ------------------------------------------------------------------------

function AddServerDialog({
  communityId,
  open,
  onOpenChange,
  games,
}: {
  communityId: Id<"communities">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  games: { id: string; name: string }[];
}) {
  const discover = useAction(api.gameServers.discover);
  const add = useAction(api.gameServers.addServer);
  const [servers, setServers] = useState<{ identifier: string; name: string; description: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [gameId, setGameId] = useState<string>("none");

  useEffect(() => {
    if (!open) return;
    setServers(null);
    setError(null);
    discover({ communityId })
      .then(setServers)
      .catch((e) => setError(errorText(e, "Couldn't list the panel's servers.")));
  }, [open, communityId, discover]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a server</DialogTitle>
          <DialogDescription>Pick one of the servers your API key can see. Only managers can use it until you share it.</DialogDescription>
        </DialogHeader>
        {games.length > 0 && (
          <Select value={gameId} onValueChange={setGameId}>
            <SelectTrigger>
              <SelectValue placeholder="Which game?" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not tied to a game</SelectItem>
              {games.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="max-h-72 space-y-1.5 overflow-y-auto">
          {servers === null && !error && <Loader2 className="mx-auto my-6 size-5 animate-spin text-muted-foreground" />}
          {servers?.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Every server is already added.</p>}
          {servers?.map((s) => (
            <div key={s.identifier} className="flex items-center gap-3 rounded-lg border border-foreground/10 p-2.5">
              <Server className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{s.name}</p>
                {s.description && <p className="truncate text-xs text-muted-foreground">{s.description}</p>}
              </div>
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy(s.identifier);
                  setError(null);
                  try {
                    await add({ communityId, identifier: s.identifier, gameId: gameId === "none" ? undefined : gameId });
                    setServers((prev) => prev?.filter((x) => x.identifier !== s.identifier) ?? null);
                  } catch (e) {
                    setError(errorText(e));
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {busy === s.identifier ? <Loader2 className="animate-spin" /> : <Plus />} Add
              </Button>
            </div>
          ))}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}

// --- Who can do what -----------------------------------------------------------------------

type Grant = "none" | "view" | "power";

function AccessDialog({
  communityId,
  server,
  onOpenChange,
}: {
  communityId: Id<"communities">;
  server: { id: Id<"gameServers">; name: string; everyoneLevel?: Grant; roleAccess?: { roleId: Id<"roles">; level: Exclude<Grant, "none"> }[] } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const roles = useQuery(api.roles.list, { communityId }) ?? [];
  const setAccess = useMutation(api.gameServers.setAccess);
  const remove = useMutation(api.gameServers.removeServer);
  const [everyone, setEveryone] = useState<Grant>("none");
  const [byRole, setByRole] = useState<Record<string, Grant>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!server) return;
    setEveryone(server.everyoneLevel ?? "none");
    setByRole(Object.fromEntries((server.roleAccess ?? []).map((r) => [r.roleId as string, r.level])));
    setError(null);
  }, [server]);

  const save = async () => {
    if (!server) return;
    setBusy(true);
    setError(null);
    try {
      await setAccess({
        serverId: server.id,
        everyoneLevel: everyone,
        roleAccess: Object.entries(byRole)
          .filter(([, level]) => level !== "none")
          .map(([roleId, level]) => ({ roleId: roleId as Id<"roles">, level: level as Exclude<Grant, "none"> })),
      });
      onOpenChange(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const picker = (value: Grant, onChange: (g: Grant) => void) => (
    <Select value={value} onValueChange={(v) => onChange(v as Grant)}>
      <SelectTrigger className="h-8 w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">No access</SelectItem>
        <SelectItem value="view">View</SelectItem>
        <SelectItem value="power">View and power</SelectItem>
      </SelectContent>
    </Select>
  );

  return (
    <Dialog open={!!server} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Who can use {server?.name}</DialogTitle>
          <DialogDescription>
            Managers can always do everything. Everyone else gets the most generous of what they&apos;re given here. Opening the server in the panel needs an account there.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 space-y-2 overflow-y-auto">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-foreground/10 p-2.5">
            <span className="text-sm font-medium">Everyone</span>
            {picker(everyone, setEveryone)}
          </div>
          {roles
            .filter((r) => !r.isEveryone)
            .map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-foreground/10 p-2.5">
                <span className="flex items-center gap-2 text-sm">
                  <span className="size-2.5 rounded-full" style={{ background: r.color ?? "currentColor", opacity: r.color ? 1 : 0.4 }} />
                  {r.name}
                </span>
                {picker(byRole[r.id] ?? "none", (g) => setByRole((prev) => ({ ...prev, [r.id]: g })))}
              </div>
            ))}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={async () => {
              if (!server) return;
              await remove({ serverId: server.id });
              onOpenChange(false);
            }}
          >
            Remove from Crystal
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            {busy && <Loader2 className="animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- A server ------------------------------------------------------------------------------

interface ServerRow {
  id: Id<"gameServers">;
  name: string;
  panelName: string;
  gameId?: string;
  level: Level;
  listed: boolean;
  panelUrl?: string;
  info: { description?: string; iconUrl?: string; gameName?: string; gameVersion?: string; address?: string; minecraft?: MinecraftInfo };
  profile?: ServerProfile;
  everyoneLevel?: Grant;
  roleAccess?: { roleId: Id<"roles">; level: Exclude<Grant, "none"> }[];
}

function ServerCard({
  server,
  gameName,
  onAccess,
  onAbout,
}: {
  server: ServerRow;
  gameName?: string;
  onAccess: () => void;
  onAbout: () => void;
}) {
  const getResources = useAction(api.gameServers.resources);
  const power = useAction(api.gameServers.power);
  const [res, setRes] = useState<Resources | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const poll = useCallback(async () => {
    try {
      setRes(await getResources({ serverId: server.id }));
      setError(null);
    } catch (e) {
      setError(errorText(e, "Couldn't reach the server."));
    }
  }, [getResources, server.id]);

  // Someone who can only read about a server has no live state to ask for.
  const canView = RANK[server.level] >= RANK.view;

  // A server on screen is kept up to date; one scrolled away or in a background
  // tab is not asked about.
  useEffect(() => {
    if (!canView) return;
    void poll();
    const timer = window.setInterval(() => {
      if (!document.hidden) void poll();
    }, 6000);
    return () => window.clearInterval(timer);
  }, [poll, canView]);

  const act = async (signal: "start" | "stop" | "restart" | "kill") => {
    if (signal === "kill" && !window.confirm(`Kill ${server.name}? Unsaved progress is lost.`)) return;
    setActing(signal);
    try {
      await power({ serverId: server.id, signal });
      window.setTimeout(() => void poll(), 1500);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setActing(null);
    }
  };

  const canPower = RANK[server.level] >= RANK.power;
  const running = res?.state === "running" || res?.state === "starting";

  return (
    <div className="space-y-3 rounded-xl border border-foreground/10 bg-gradient-to-br from-foreground/[0.06] to-transparent p-4">
      <div className="flex items-start gap-3">
        <ServerIcon url={server.info.iconUrl} className="size-12 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{server.name}</p>
          {gameName && !server.info.gameName && <p className="text-xs text-muted-foreground">{gameName}</p>}
          {server.level === "manage" && !server.listed && <p className="text-xs text-amber-500">Only managers can see this</p>}
        </div>
        {res && canView && (
          <Badge variant="secondary" className={cn("capitalize", STATE_STYLE[res.state] ?? STATE_STYLE.offline)}>
            {res.suspended ? "suspended" : res.state}
          </Badge>
        )}
        {server.level === "manage" && (
          <>
            <Button size="icon" variant="ghost" className="size-7" onClick={onAbout} aria-label="Edit what people see about this server">
              <Info className="size-4" />
            </Button>
            <Button size="icon" variant="ghost" className="size-7" onClick={onAccess} aria-label="Who can use this server">
              <Settings2 className="size-4" />
            </Button>
          </>
        )}
      </div>

      <ServerInfo info={{ name: server.name, ...server.info } as ServerInfoData} />

      {canView && (res ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Cpu className="size-3.5" /> {res.cpuPercent.toFixed(1)}%
          </span>
          <span className="flex items-center gap-1.5">
            <MemoryStick className="size-3.5" /> {bytes(res.memoryBytes)}
          </span>
          <span className="flex items-center gap-1.5">
            <HardDrive className="size-3.5" /> {bytes(res.diskBytes)}
          </span>
          <span className="flex items-center gap-1.5">
            <Activity className="size-3.5" /> {running ? uptime(res.uptimeMs) : "—"}
          </span>
        </div>
      ) : (
        !error && <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ))}
      {error && canView && <p className="text-xs text-destructive">{error}</p>}

      {(canPower || server.panelUrl) && (
        <div className="flex flex-wrap gap-1.5">
          {canPower && (
            <>
              <Button size="sm" variant="secondary" disabled={!!acting || running} onClick={() => void act("start")}>
                {acting === "start" ? <Loader2 className="animate-spin" /> : <Play />} Start
              </Button>
              <Button size="sm" variant="secondary" disabled={!!acting || !running} onClick={() => void act("restart")}>
                {acting === "restart" ? <Loader2 className="animate-spin" /> : <RefreshCw />} Restart
              </Button>
              <Button size="sm" variant="secondary" disabled={!!acting || !running} onClick={() => void act("stop")}>
                {acting === "stop" ? <Loader2 className="animate-spin" /> : <Square />} Stop
              </Button>
              <Button size="icon" variant="ghost" className="size-8 text-destructive" disabled={!!acting || !running} onClick={() => void act("kill")} aria-label="Kill">
                <Skull className="size-4" />
              </Button>
            </>
          )}
          {server.panelUrl && (
            <Button size="sm" variant="ghost" className="ml-auto" asChild title="Opens this server in the panel, in your browser">
              <a href={server.panelUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink /> Open in panel
              </a>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// --- The channel -----------------------------------------------------------------------------

export function ServersView({
  communityId,
  name,
  topic,
}: {
  communityId: Id<"communities">;
  name: string;
  topic?: string;
}) {
  const overview = useQuery(api.gameServers.overview, { communityId });
  const community = useQuery(api.communities.get, { communityId });
  const disconnect = useMutation(api.gameServers.disconnectPanel);
  const [adding, setAdding] = useState(false);
  const [accessFor, setAccessFor] = useState<ServerRow | null>(null);
  const [aboutFor, setAboutFor] = useState<ServerRow | null>(null);
  const [reconnecting, setReconnecting] = useState(false);

  const games = (community as { clanGames?: { id: string; name: string }[] } | null | undefined)?.clanGames ?? [];

  if (overview === undefined) {
    return (
      <SurfaceFrame communityId={communityId} icon={Server} name={name} topic={topic}>
        <div className="flex justify-center py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      </SurfaceFrame>
    );
  }

  const connected = overview.panel.connected;
  const panel = overview.panel as { connected: true; baseUrl?: string; keyHint?: string; lastError?: string } | { connected: false };

  return (
    <SurfaceFrame
      communityId={communityId}
      icon={Server}
      name={name}
      topic={topic}
      actions={
        overview.canManage && connected ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              <Plus /> Add server
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setReconnecting(true)}>
              <Settings2 /> Panel
            </Button>
          </>
        ) : null
      }
    >
      {!connected ? (
        overview.canManage ? (
          <ConnectPanel communityId={communityId} />
        ) : (
          <EmptyState icon={Server} title="No game servers yet" body="A manager hasn't connected a panel." />
        )
      ) : overview.servers.length === 0 ? (
        <EmptyState
          icon={Server}
          title="No servers to show"
          body={overview.canManage ? "Add one of your panel's servers, then choose who can use it." : "You don't have access to any of the servers yet."}
        >
          {overview.canManage && (
            <Button onClick={() => setAdding(true)}>
              <Plus /> Add server
            </Button>
          )}
        </EmptyState>
      ) : (
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {overview.servers.map((s) => (
            <ServerCard
              key={s.id}
              server={s as ServerRow}
              gameName={games.find((g) => g.id === s.gameId)?.name}
              onAccess={() => setAccessFor(s as ServerRow)}
              onAbout={() => setAboutFor(s as ServerRow)}
            />
          ))}
        </div>
      )}

      {connected && overview.canManage && (
        <>
          <AddServerDialog communityId={communityId} open={adding} onOpenChange={setAdding} games={games} />
          <AccessDialog communityId={communityId} server={accessFor} onOpenChange={(o) => !o && setAccessFor(null)} />
          <ServerProfileDialog communityId={communityId} server={aboutFor} onClose={() => setAboutFor(null)} />
          <Dialog open={reconnecting} onOpenChange={setReconnecting}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Panel</DialogTitle>
                <DialogDescription>
                  {"baseUrl" in panel && panel.baseUrl} {"keyHint" in panel && panel.keyHint ? `· key ending ${panel.keyHint}` : ""}
                </DialogDescription>
              </DialogHeader>
              {"lastError" in panel && panel.lastError && <p className="text-sm text-destructive">{panel.lastError}</p>}
              <ConnectPanel communityId={communityId} onDone={() => setReconnecting(false)} />
              <DialogFooter>
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={async () => {
                    if (!window.confirm("Disconnect the panel? Its servers disappear from Crystal and the stored key is deleted.")) return;
                    await disconnect({ communityId });
                    setReconnecting(false);
                  }}
                >
                  <Unplug /> Disconnect
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </SurfaceFrame>
  );
}
