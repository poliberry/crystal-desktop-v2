"use client";

import { useAction, useConvex, useMutation } from "convex/react";
import { ImagePlus, Loader2, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { errorText } from "@/components/community/surfaces/surface-frame";
import { ServerIcon } from "@/components/community/surfaces/server-info";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { LOADER_LABELS, MINECRAFT_LOADERS, PROFILE_LIMITS, type MinecraftLoader, type ServerProfile } from "../../../../convex/lib/serverProfile";
import { uploadImage } from "@/lib/cdn-upload";

export interface EditableServer {
  id: Id<"gameServers">;
  name: string;
  panelName: string;
  listed: boolean;
  profile?: ServerProfile;
  info: { iconUrl?: string; gameName?: string };
}

interface Pack {
  name: string;
  url: string;
  version?: string;
  kind: "resourcepack" | "shader";
  required: boolean;
}
interface Modpack {
  name: string;
  url: string;
  version?: string;
  pageUrl?: string;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** A manager's form for what a server tells people: and whether it tells everyone. */
export function ServerProfileDialog({
  communityId,
  server,
  onClose,
}: {
  communityId: Id<"communities">;
  server: EditableServer | null;
  onClose: () => void;
}) {
  const convex = useConvex();
  const setProfile = useMutation(api.gameServers.setProfile);
  const setIcon = useMutation(api.gameServers.setServerIcon);
  const clearIcon = useMutation(api.gameServers.clearServerIcon);
  const genUpload = useMutation(api.gameServers.generateIconUploadUrl);
  const detect = useAction(api.gameServers.detectFromPanel);
  const lookup = useAction(api.gameServers.lookupModrinthLink);

  const [listed, setListed] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [gameName, setGameName] = useState("");
  const [gameVersion, setGameVersion] = useState("");
  const [address, setAddress] = useState("");
  const [isMinecraft, setIsMinecraft] = useState(false);
  const [loader, setLoader] = useState<MinecraftLoader>("vanilla");
  const [loaderVersion, setLoaderVersion] = useState("");
  const [modpack, setModpack] = useState<Modpack | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [modrinthPack, setModrinthPack] = useState("");
  const [modrinthExtra, setModrinthExtra] = useState("");
  const [manual, setManual] = useState({ name: "", url: "", required: true });
  const [iconUrl, setIconUrl] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Start from what is stored, once each time it opens.
  useEffect(() => {
    if (!server || seeded === server.id) return;
    setSeeded(server.id);
    const p = server.profile;
    setListed(server.listed);
    setDisplayName(p?.displayName ?? "");
    setDescription(p?.description ?? "");
    setGameName(p?.gameName ?? server.info.gameName ?? "");
    setGameVersion(p?.gameVersion ?? "");
    setAddress(p?.address ?? "");
    setIsMinecraft(!!p?.minecraft || /minecraft/i.test(p?.gameName ?? server.info.gameName ?? ""));
    setLoader((p?.minecraft?.loader as MinecraftLoader) ?? "vanilla");
    setLoaderVersion(p?.minecraft?.loaderVersion ?? "");
    setModpack(p?.minecraft?.modpack ? { name: p.minecraft.modpack.name, url: p.minecraft.modpack.url, version: p.minecraft.modpack.version, pageUrl: p.minecraft.modpack.pageUrl } : null);
    setPacks((p?.minecraft?.packs as Pack[]) ?? []);
    setIconUrl(server.info.iconUrl);
    setError(null);
  }, [server, seeded]);
  useEffect(() => {
    if (!server) setSeeded(null);
  }, [server]);

  const run = async (key: string, fn: () => Promise<void>) => {
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

  const fillFromPanel = () =>
    run("detect", async () => {
      if (!server) return;
      const d = await detect({ serverId: server.id });
      // Only what is still empty: the panel's guess never overwrites what was typed.
      if (!displayName && d.name) setDisplayName(d.name);
      if (!description && d.description) setDescription(d.description);
      if (!address && d.address) setAddress(d.address);
      if (d.isMinecraft) {
        setIsMinecraft(true);
        if (!gameName) setGameName("Minecraft");
        if (!gameVersion && d.gameVersion) setGameVersion(d.gameVersion);
        if (d.loader && (MINECRAFT_LOADERS as readonly string[]).includes(d.loader) && loader === "vanilla") setLoader(d.loader as MinecraftLoader);
        if (!loaderVersion && d.loaderVersion) setLoaderVersion(d.loaderVersion);
      }
    });

  const lookupModpack = () =>
    run("modpack", async () => {
      const r = await lookup({ communityId, url: modrinthPack });
      setModpack({ name: r.title, url: r.file.url, version: r.version, pageUrl: r.pageUrl });
      setIsMinecraft(true);
      if (!gameName) setGameName("Minecraft");
      if (!gameVersion && r.gameVersion) setGameVersion(r.gameVersion);
      if (r.loader && loader === "vanilla") setLoader(r.loader);
      setModrinthPack("");
    });

  const lookupExtra = () =>
    run("extra", async () => {
      const r = await lookup({ communityId, url: modrinthExtra });
      if (packs.length >= PROFILE_LIMITS.packs) throw new Error(`Up to ${PROFILE_LIMITS.packs} packs.`);
      setPacks((prev) => [
        ...prev,
        { name: r.title, url: r.file.url, version: r.version, kind: r.kind === "shader" ? "shader" : "resourcepack", required: true },
      ]);
      setModrinthExtra("");
    });

  const upload = (file: File) =>
    run("icon", async () => {
      if (!server) return;
      const uploaded = await uploadImage(convex, file, "icons", () => genUpload({ communityId }));
      await setIcon({ serverId: server.id, ...uploaded } as never);
      setIconUrl(URL.createObjectURL(file));
    });

  const save = () =>
    run("save", async () => {
      if (!server) return;
      await setProfile({
        serverId: server.id,
        listed,
        profile: {
          displayName,
          description,
          gameName,
          gameVersion,
          address,
          minecraft: isMinecraft
            ? { loader, loaderVersion, modpack: modpack ?? undefined, packs }
            : undefined,
        },
      });
      onClose();
    });

  return (
    <Dialog open={!!server} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>About {server?.panelName}</DialogTitle>
          <DialogDescription>What people in the community see about this server.</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-foreground/10 p-3">
            <div>
              <p className="text-sm font-medium">Show to everyone in the community</p>
              <p className="text-xs text-muted-foreground">They see the details below — not controls. Who can start and stop it is set separately.</p>
            </div>
            <Switch checked={listed} onCheckedChange={setListed} aria-label="Show to everyone" />
          </div>

          <Section title="Server">
            <div className="flex items-start gap-3">
              <button type="button" onClick={() => fileRef.current?.click()} className="group relative shrink-0" aria-label="Change the picture">
                <ServerIcon url={iconUrl} className="size-16" />
                <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                  {busy === "icon" ? <Loader2 className="size-4 animate-spin text-white" /> : <ImagePlus className="size-4 text-white" />}
                </span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void upload(f);
                }}
              />
              <div className="min-w-0 flex-1 space-y-2">
                <Input placeholder={server?.panelName ?? "Name"} value={displayName} maxLength={PROFILE_LIMITS.name} onChange={(e) => setDisplayName(e.target.value)} />
                <Textarea placeholder="Describe it — what's it like, who's it for?" value={description} maxLength={PROFILE_LIMITS.description} onChange={(e) => setDescription(e.target.value)} className="min-h-20" />
                {iconUrl && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline"
                    onClick={() => void run("icon", async () => { if (server) { await clearIcon({ serverId: server.id }); setIconUrl(undefined); } })}
                  >
                    Remove the picture
                  </button>
                )}
              </div>
            </div>
            <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void fillFromPanel()}>
              {busy === "detect" ? <Loader2 className="animate-spin" /> : <Sparkles />} Fill in from the panel
            </Button>
          </Section>

          <Section title="Game">
            <div className="grid gap-2 sm:grid-cols-2">
              <Input placeholder="Game, e.g. Minecraft" value={gameName} maxLength={PROFILE_LIMITS.gameName} onChange={(e) => setGameName(e.target.value)} />
              <Input placeholder="Version, e.g. 1.20.1" value={gameVersion} maxLength={PROFILE_LIMITS.version} onChange={(e) => setGameVersion(e.target.value)} />
            </div>
            <Input placeholder="Address, e.g. play.example.com:25565" value={address} maxLength={PROFILE_LIMITS.address} onChange={(e) => setAddress(e.target.value)} />
          </Section>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-foreground/10 p-3">
            <div>
              <p className="text-sm font-medium">This is a Minecraft server</p>
              <p className="text-xs text-muted-foreground">Adds the loader, the modpack and any packs players need.</p>
            </div>
            <Switch checked={isMinecraft} onCheckedChange={setIsMinecraft} aria-label="Minecraft server" />
          </div>

          {isMinecraft && (
            <>
              <Section title="Loader">
                <div className="grid gap-2 sm:grid-cols-2">
                  <Select value={loader} onValueChange={(v) => setLoader(v as MinecraftLoader)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MINECRAFT_LOADERS.map((l) => (
                        <SelectItem key={l} value={l}>
                          {LOADER_LABELS[l]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input placeholder="Loader version (optional)" value={loaderVersion} maxLength={PROFILE_LIMITS.version} onChange={(e) => setLoaderVersion(e.target.value)} />
                </div>
              </Section>

              <Section title="Modpack" hint="Paste a Modrinth modpack link and Crystal reads its name, version and download. Players can download the .mrpack or open it in Prism Launcher.">
                {modpack ? (
                  <div className="space-y-2 rounded-lg border border-foreground/10 p-3">
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm font-medium">
                        {modpack.name}
                        {modpack.version && <span className="font-normal text-muted-foreground"> · {modpack.version}</span>}
                      </p>
                      <Button size="icon" variant="ghost" className="size-7" onClick={() => setModpack(null)} aria-label="Remove the modpack">
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                    <Input value={modpack.url} onChange={(e) => setModpack({ ...modpack, url: e.target.value })} className="font-mono text-xs" aria-label="Download address" />
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <Input placeholder="https://modrinth.com/modpack/…" value={modrinthPack} onChange={(e) => setModrinthPack(e.target.value)} />
                      <Button variant="secondary" disabled={!modrinthPack.trim() || busy !== null} onClick={() => void lookupModpack()}>
                        {busy === "modpack" ? <Loader2 className="animate-spin" /> : <Search />} Look up
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Not on Modrinth? Host a .mrpack or .zip yourself and add it by link:</p>
                    <Button size="sm" variant="ghost" onClick={() => setModpack({ name: "", url: "https://" })}>
                      <Plus /> Add by link
                    </Button>
                  </>
                )}
                {modpack && !modpack.name && (
                  <Input placeholder="Modpack name" value={modpack.name} onChange={(e) => setModpack({ ...modpack, name: e.target.value })} />
                )}
              </Section>

              <Section title="Resource packs and shaders" hint="Anything players should install to see the server as intended. Mark the ones they have to have.">
                {packs.map((p, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg border border-foreground/10 p-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.name}{p.version && <span className="font-normal text-muted-foreground"> · {p.version}</span>}</p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">{p.url}</p>
                    </div>
                    <label className="flex items-center gap-1.5 text-xs">
                      <Switch checked={p.required} onCheckedChange={(r) => setPacks(packs.map((x, j) => (j === i ? { ...x, required: r } : x)))} />
                      Required
                    </label>
                    <Button size="icon" variant="ghost" className="size-7" onClick={() => setPacks(packs.filter((_, j) => j !== i))} aria-label="Remove">
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Input placeholder="Modrinth link to a resource pack or shader" value={modrinthExtra} onChange={(e) => setModrinthExtra(e.target.value)} />
                  <Button variant="secondary" disabled={!modrinthExtra.trim() || busy !== null} onClick={() => void lookupExtra()}>
                    {busy === "extra" ? <Loader2 className="animate-spin" /> : <Search />} Add
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
                  <Input placeholder="Name" value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} />
                  <Input placeholder="https://…/pack.zip" value={manual.url} onChange={(e) => setManual({ ...manual, url: e.target.value })} />
                  <Button
                    variant="ghost"
                    disabled={!manual.name.trim() || !manual.url.trim() || packs.length >= PROFILE_LIMITS.packs}
                    onClick={() => {
                      setPacks([...packs, { name: manual.name, url: manual.url, kind: "resourcepack", required: manual.required }]);
                      setManual({ name: "", url: "", required: true });
                    }}
                  >
                    <Plus /> Add
                  </Button>
                </div>
              </Section>
            </>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy !== null} onClick={() => void save()}>
            {busy === "save" && <Loader2 className="animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
