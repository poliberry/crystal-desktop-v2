"use client";

import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import { AlertTriangle, Check, Copy, ImagePlus, KeyRound, Loader2, Plus, RefreshCw, Send, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { botInstallUrl, checkRedirectUris } from "../../../convex/lib/oauthLinks";
import { APP_ORIGIN } from "@/lib/deeplinks";
import { BOT_IMAGE_BYTES, BOT_LIMITS, BOT_PERMISSIONS, BOT_SCOPES, BOT_SCOPE_INFO, validateBotName, validateCommands, validateRequest } from "../../../convex/lib/botAuth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CodeWorkbenchView } from "@/studio/code/code-workbench";
import { useCodeWorkbench } from "@/studio/code/use-code-workbench";
import { useStudioChrome } from "@/studio/shell/chrome";
import { uploadCreation } from "@/lib/creation-upload";
import { useProjectAssets } from "@/studio/storage/assets";
import { getAssetBlob } from "@/studio/storage/db";
import type { BotData, Project } from "@/studio/model/types";
import { cn } from "@/lib/utils";

const messageOf = (e: unknown) => (e instanceof Error ? e.message.replace(/^.*Uncaught Error:\s*/s, "").split("\n")[0] : "That didn't work.");

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => undefined);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {done ? "Copied" : label}
    </Button>
  );
}

/** Secrets, shown once. They aren't in the project file and can't be read back — only replaced. */
function SecretsDialog({ secrets, onClose }: { secrets: { token?: string; signingSecret?: string }; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Save these now</DialogTitle>
          <DialogDescription>They&apos;re shown once. Put them in your bot&apos;s environment — never in code you share or commit. If you lose one, make a new one.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {secrets.token && (
            <div className="space-y-1">
              <p className="text-xs font-medium">Bot token <span className="font-normal text-muted-foreground">— CRYSTAL_BOT_TOKEN</span></p>
              <div className="flex gap-2">
                <code className="min-w-0 flex-1 break-all rounded-md bg-muted p-2 text-[11px]">{secrets.token}</code>
                <CopyButton text={secrets.token} />
              </div>
            </div>
          )}
          {secrets.signingSecret && (
            <div className="space-y-1">
              <p className="text-xs font-medium">Signing secret <span className="font-normal text-muted-foreground">— CRYSTAL_SIGNING_SECRET</span></p>
              <div className="flex gap-2">
                <code className="min-w-0 flex-1 break-all rounded-md bg-muted p-2 text-[11px]">{secrets.signingSecret}</code>
                <CopyButton text={secrets.signingSecret} />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>I&apos;ve saved them</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A bot: a TypeScript project in the code workbench, plus how it is registered with Crystal. The
 * bot runs on your own computer or server (the terminal here is for `npm install` and `npm start`);
 * the project settings hold who it is, what it asks for, its commands and where events go, and make
 * its token and test its endpoint.
 *
 * Everything is checked with the server's own functions as you type. What a community actually
 * gives the bot is up to the person who adds it, who can never give more than they hold themselves.
 */
/**
 * The link to share so people can add the bot without being given an id: opens Crystal (or the web
 * page) on a screen that asks which community and what to allow. It carries what the bot asks for as
 * the starting point; whoever opens it can give less, never more than they hold. A link only exists
 * once the bot is registered, since it names the bot.
 */
/** Where the bot's public listing stands, and what a save does to it. */
function ListingNotice({ linked, wantsPublic, name, description }: { linked: { visibility: "private" | "public"; name: string; description: string; pending: { name: string; description: string; makePublic: boolean } | null; lastReview: { ok: boolean; note?: string } | null }; wantsPublic: boolean; name: string; description: string }) {
  const live = linked.visibility === "public";
  const pending = linked.pending;
  // What saving now would change in the listing people see: so the author isn't surprised that a save didn't go live.
  const differs = live && (name !== linked.name || description.trim() !== linked.description);
  let line: string | null = null;
  if (pending?.makePublic) line = "Asked to be listed publicly: waiting for review. Until it is approved the bot is only available to you, by its ID.";
  else if (pending) line = `You changed the public listing (${[pending.name !== linked.name && "name", pending.description !== linked.description && "description"].filter(Boolean).join(" and ") || "picture"}). The page people see is unchanged until staff approve it.`;
  else if (live && differs) line = "Saving sends the new name or description for review. The public listing keeps what it says now until it is approved.";
  else if (live) line = "In the public list.";
  else if (wantsPublic) line = "Saving sends it for review to be listed publicly.";
  if (!line && !linked.lastReview) return null;
  return (
    <div className="space-y-1.5 rounded-xl border border-border p-3 text-xs">
      {line && <p className="text-muted-foreground">{line}</p>}
      {linked.lastReview && !linked.lastReview.ok && !pending && <p className="rounded-md bg-amber-500/10 p-2 text-foreground">Staff turned down the last listing change{linked.lastReview.note ? `: ${linked.lastReview.note}` : "."} Edit it and save to send it again.</p>}
      {linked.lastReview?.ok && !pending && live && <p className="text-emerald-500">The last listing change was approved.</p>}
    </div>
  );
}

const PICTURE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** A picture slot in the bot's profile: the avatar (square) or the banner (wide), chosen from files on this computer. */
function PictureSlot({ label, hint, url, shape, onPick, onRemove, busy }: { label: string; hint: string; url?: string | null; shape: "avatar" | "banner"; onPick: (f: File) => void; onRemove?: () => void; busy?: boolean }) {
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium">{label}</span>
      <div className="flex items-center gap-3">
        <label className={cn("relative flex shrink-0 cursor-pointer items-center justify-center overflow-hidden border border-dashed border-border bg-card/40 text-muted-foreground hover:border-foreground/40 hover:text-foreground", shape === "avatar" ? "size-16 rounded-full" : "h-16 w-40 rounded-lg")}>
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="size-full object-cover" />
          ) : busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ImagePlus className="size-5" />
          )}
          <input type="file" accept={PICTURE_TYPES.join(",")} hidden aria-label={`Choose ${label.toLowerCase()}`} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onPick(f); }} />
        </label>
        <div className="min-w-0 space-y-1">
          <p className="text-[11px] text-muted-foreground">{hint}</p>
          {onRemove && <button type="button" onClick={onRemove} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive"><X className="size-3" /> Remove</button>}
        </div>
      </div>
    </div>
  );
}

function InviteLink({ botId, visibility, permissions, scopes, redirectUris }: { botId?: string; visibility: "private" | "public"; permissions: number; scopes: string[]; redirectUris: string[] }) {
  const [redirect, setRedirect] = useState("");
  if (!botId) {
    return <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">Register the bot to get an invite link people can use to add it.</p>;
  }
  const chosen = redirect && redirectUris.includes(redirect) ? redirect : undefined;
  const url = botInstallUrl(APP_ORIGIN, { botId, permissions, scopes, redirectUri: chosen });
  return (
    <div className="space-y-1.5 rounded-lg border border-border p-3">
      <p className="text-xs font-medium">Invite link</p>
      <div className="flex items-center gap-2">
        <Input readOnly value={url} className="font-mono text-[11px]" onFocus={(e) => e.currentTarget.select()} />
        <CopyButton text={url} label="Copy link" />
      </div>
      {redirectUris.length > 0 && (
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          Send them to
          <select className="h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-1.5 font-mono text-[11px]" value={redirect} onChange={(e) => setRedirect(e.target.value)}>
            <option value="">nowhere (stay in Crystal)</option>
            {redirectUris.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </label>
      )}
      <p className="text-[11px] text-muted-foreground">
        {visibility === "private" ? "The bot is private, so only you can use this link. Make it public to share it." : "Anyone with Manage Integrations in a community can use this."} It asks for exactly what is ticked above; save changes first so the bot is registered for them. It's the same on the web, and opens in the app for people who have it.
      </p>
    </div>
  );
}

export function BotEditor({ project, onChange }: { project: Project; onChange: (p: Project) => void }) {
  const chrome = useStudioChrome();
  const convex = useConvex();
  const { assets, add } = useProjectAssets(project.id);
  const bot = project.bot!;
  const set = (patch: Partial<BotData>) => onChange({ ...project, bot: { ...bot, ...patch } });
  const mine = useQuery(api.bots.mine, {});
  const linked = mine?.find((b) => b.id === bot.botId) ?? null;
  const create = useMutation(api.bots.create);
  const update = useMutation(api.bots.update);
  const rotateToken = useMutation(api.bots.rotateToken);
  const rotateSecret = useMutation(api.bots.rotateSigningSecret);
  const enableEvents = useMutation(api.bots.enableEvents);
  const remove = useMutation(api.bots.remove);
  const sendTest = useAction(api.bots.sendTest);

  const wb = useCodeWorkbench(project);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [secrets, setSecrets] = useState<{ token?: string; signingSecret?: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // The server's own validators, so a problem shows here before it is a refusal there.
  const problems = useMemo(() => {
    const out: string[] = [];
    try { validateBotName(project.name); } catch (e) { out.push(messageOf(e)); }
    try { validateRequest(bot.permissions, bot.scopes); } catch (e) { out.push(messageOf(e)); }
    try { validateCommands(bot.commands); } catch (e) { out.push(messageOf(e)); }
    if (bot.visibility === "public" && bot.description.trim().length < 10) out.push("A public bot needs a description, so people know what they're adding.");
    if (bot.endpointUrl.trim() && !/^https:\/\//i.test(bot.endpointUrl.trim())) out.push("The endpoint has to be an https address.");
    try { checkRedirectUris(bot.redirectUris); } catch (e) { out.push(messageOf(e)); }
    if ([...(bot.bio ?? "")].length > BOT_LIMITS.bioChars) out.push(`The bio is up to ${BOT_LIMITS.bioChars} characters.`);
    return out;
  }, [project.name, bot]);

  const fields = () => ({
    description: bot.description,
    visibility: bot.visibility,
    permissions: bot.permissions,
    scopes: bot.scopes,
    commands: bot.commands,
    endpointUrl: bot.endpointUrl.trim() || null,
    redirectUris: bot.redirectUris,
  });

  /** Put a picture of this project on Crystal's CDN, and give back its address. The same picture is the same address, so sending it again changes nothing. */
  const publishPicture = async (assetId: string, what: string): Promise<string> => {
    const meta = assets.get(assetId);
    const blob = meta ? await getAssetBlob(assetId) : null;
    if (!meta || !blob) throw new Error(`The ${what} picture is missing from this project. Choose it again.`);
    return uploadCreation(convex, new File([blob], meta.name, { type: meta.type }));
  };
  /** The profile as the server takes it: the bio, and the pictures that have been chosen here, uploaded. A field never touched here is left out, so what the bot set for itself through the API is not overwritten. */
  const profile = async () => ({
    ...(bot.bio !== undefined ? { bio: bot.bio } : {}),
    ...(bot.avatarAssetId ? { imageUrl: await publishPicture(bot.avatarAssetId, "avatar") } : {}),
    ...(bot.bannerAssetId ? { bannerUrl: await publishPicture(bot.bannerAssetId, "banner") } : {}),
  });
  const pick = (kind: "avatar" | "banner") => async (file: File) => {
    const limit = kind === "avatar" ? BOT_IMAGE_BYTES.avatar : BOT_IMAGE_BYTES.banner;
    if (!PICTURE_TYPES.includes(file.type)) return setError("Use a PNG, JPEG, WebP or GIF picture.");
    if (file.size > limit) return setError(`That ${kind} is over ${limit / 1024 / 1024} MB.`);
    setError(null);
    setBusy(kind);
    try {
      const a = await add(file);
      set(kind === "avatar" ? { avatarAssetId: a.id } : { bannerAssetId: a.id });
    } finally {
      setBusy(null);
    }
  };
  const removePicture = (kind: "avatar" | "banner") =>
    act(`remove-${kind}`, async () => {
      set(kind === "avatar" ? { avatarAssetId: undefined } : { bannerAssetId: undefined });
      // On Crystal too, if the bot is registered: taking a picture away is a change like any other.
      if (bot.botId && linked) await update({ botId: bot.botId as Id<"bots">, ...(kind === "avatar" ? { imageUrl: null } : { bannerUrl: null }) });
    });

  const act = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  };

  const register = () =>
    act("register", async () => {
      const r = await create({ name: project.name, ...fields(), ...(await profile()), endpointUrl: bot.endpointUrl.trim() || undefined });
      set({ botId: r.botId });
      // Registering is done on the server, so the project has to remember the id now: if it were left
      // as an unsaved change, closing without saving would leave a registered bot nobody can reach.
      await chrome.saveSettings?.(project.id);
      setSecrets({ token: r.token, signingSecret: r.signingSecret });
    });
  const save = () =>
    act("save", async () => {
      await update({ botId: bot.botId as Id<"bots">, name: project.name, ...fields(), ...(await profile()) });
      await chrome.saveSettings?.(project.id);
      setNotice("Saved. Communities that gave it more than it now asks for lose the difference straight away.");
    });
  const test = () =>
    act("test", async () => {
      const r = await sendTest({ botId: bot.botId as Id<"bots"> });
      setNotice(r.ok ? `Your endpoint answered ${r.status} in ${r.ms} ms.` : `The test failed: ${r.error}`);
    });

  const togglePerm = (bit: number, on: boolean) => set({ permissions: on ? bot.permissions | bit : bot.permissions & ~bit });
  const toggleScope = (s: string, on: boolean) => set({ scopes: on ? [...new Set([...bot.scopes, s])] : bot.scopes.filter((x) => x !== s) });
  const setCommand = (i: number, patch: Partial<{ name: string; description: string }>) => set({ commands: bot.commands.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  const settings = (
    <>
      <p className="mx-auto max-w-2xl px-6 pt-5 text-xs text-muted-foreground">Saved to this project&apos;s <code>.crysproj</code>. The bot&apos;s code is in <code>src/</code>; run it from the terminal below.</p>
      <div className="mx-auto w-full max-w-2xl space-y-6 p-6">
      {linked ? (
        <div className="space-y-2 rounded-xl border border-border p-4 text-sm">
          <p className="flex items-center gap-2 font-medium"><span className="size-2 rounded-full bg-emerald-500" /> Registered · in {linked.installCount} communit{linked.installCount === 1 ? "y" : "ies"}</p>
          <p className="break-all text-xs text-muted-foreground">Bot ID <code>{linked.id}</code> — share it so a community manager can add this bot{linked.visibility === "public" ? ", or find it in the public list" : ""}.</p>
          {linked.suspended && <p className="text-xs text-destructive">This bot was suspended by Crystal staff{linked.suspendedReason ? `: ${linked.suspendedReason}` : ""}.</p>}
          {linked.eventsDisabled && (
            <p className="flex items-center gap-2 text-xs text-destructive">
              <AlertTriangle className="size-3.5" /> Events were switched off after {linked.consecutiveFailures} failures in a row.
              <Button size="sm" variant="secondary" className="h-6 text-xs" onClick={() => void act("enable", async () => { await enableEvents({ botId: linked.id }); })}>Turn back on</Button>
            </p>
          )}
          {linked.lastDelivery && <p className="text-xs text-muted-foreground">Last delivery {new Date(linked.lastDelivery.at).toLocaleString()}: {linked.lastDelivery.ok ? "delivered" : `failed — ${linked.lastDelivery.error ?? linked.lastDelivery.status}`}.</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            <CopyButton text={linked.id} label="Copy ID" />
            <Button size="sm" variant="secondary" disabled={!!busy || !linked.endpointUrl} title={linked.endpointUrl ? undefined : "Only for a bot with an endpoint"} onClick={() => void test()}>{busy === "test" ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Send a test event</Button>
            <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void act("token", async () => { const r = await rotateToken({ botId: linked.id }); setSecrets({ token: r.token }); })}><KeyRound className="size-3.5" /> New token</Button>
            <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void act("secret", async () => { const r = await rotateSecret({ botId: linked.id }); setSecrets({ signingSecret: r.signingSecret }); })}><RefreshCw className="size-3.5" /> New signing secret</Button>
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={!!busy} onClick={() => setConfirmDelete(true)}><Trash2 className="size-3.5" /> Delete bot</Button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          {bot.botId ? "This bot isn't registered any more (it was deleted). Register it again to get a new token." : "Not registered yet. Fill this in, then register to get a token and add it to a community."}
        </div>
      )}

      {linked && <ListingNotice linked={linked} wantsPublic={bot.visibility === "public"} name={project.name} description={bot.description} />}

      <div className="space-y-4 rounded-xl border border-border p-4">
        <p className="text-sm font-medium">Profile</p>
        <p className="-mt-3 text-[11px] text-muted-foreground">What people see when they open the bot&apos;s profile or look at its messages. Chosen here, sent to Crystal when you register or save.{bot.visibility === "public" ? " The bot is public, so staff read changes to its picture and bio before they show." : ""}</p>
        <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
          <PictureSlot label="Avatar" hint="A square picture, up to 2 MB." shape="avatar" busy={busy === "avatar"} url={bot.avatarAssetId ? assets.get(bot.avatarAssetId)?.url : (linked?.imageUrl ?? null)} onPick={pick("avatar")} onRemove={bot.avatarAssetId || linked?.imageUrl ? () => void removePicture("avatar") : undefined} />
          <PictureSlot label="Banner" hint="Wide, across the top of its profile card, up to 6 MB." shape="banner" busy={busy === "banner"} url={bot.bannerAssetId ? assets.get(bot.bannerAssetId)?.url : (linked?.bannerUrl ?? null)} onPick={pick("banner")} onRemove={bot.bannerAssetId || linked?.bannerUrl ? () => void removePicture("banner") : undefined} />
        </div>
        <Field label="Bio" hint={`A line about the bot on its profile. ${[...(bot.bio ?? linked?.bio ?? "")].length} / ${BOT_LIMITS.bioChars}. Leave it alone to keep whatever the bot has set for itself.`}>
          <Textarea rows={2} maxLength={BOT_LIMITS.bioChars} value={bot.bio ?? linked?.bio ?? ""} onChange={(e) => set({ bio: e.target.value })} />
        </Field>
      </div>

      <Field label="What it does" hint={`Shown to people before they add it. Up to ${BOT_LIMITS.descriptionChars} characters.${bot.visibility === "public" ? " Staff read it before it is shown in the public list, and again when you change it." : ""}`}>
        <Textarea rows={3} maxLength={BOT_LIMITS.descriptionChars} value={bot.description} onChange={(e) => set({ description: e.target.value })} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Who can add it" hint={bot.visibility === "private" ? "Only you, using its ID." : "Anyone with Manage Integrations, from the public list once staff have approved it."}>
          <select className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" value={bot.visibility} onChange={(e) => set({ visibility: e.target.value as BotData["visibility"] })}>
            <option value="private">Just me</option>
            <option value="public">Anyone (public)</option>
          </select>
        </Field>
        <Field label="Endpoint" hint="Optional. Leave it empty and the SDK collects events itself, from anywhere, with nothing to host. Set an https address only if you want Crystal to call your server.">
          <Input value={bot.endpointUrl} onChange={(e) => set({ endpointUrl: e.target.value })} placeholder="https://my-bot.example.com/crystal" className="font-mono text-xs" />
        </Field>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium">What it asks for</p>
        <p className="text-[11px] text-muted-foreground">A community manager sees this and chooses what to give. They can only give what they hold themselves, and your bot loses anything they later lose. Ask only for what it needs.</p>
        {BOT_PERMISSIONS.map((p) => (
          <label key={p.key} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-accent/40">
            <input type="checkbox" className="mt-1" checked={(bot.permissions & p.bit) !== 0} onChange={(e) => togglePerm(p.bit, e.target.checked)} />
            <span>
              <span className="block text-sm font-medium">{p.label} {p.risk !== "low" && <span className={cn("ml-1 text-[10px] font-semibold uppercase", p.risk === "high" ? "text-destructive" : "text-amber-500")}>{p.risk} impact</span>}</span>
              <span className="block text-xs text-muted-foreground">{p.description}</span>
            </span>
          </label>
        ))}
        {BOT_SCOPES.map((s) => (
          <label key={s} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-accent/40">
            <input type="checkbox" className="mt-1" checked={bot.scopes.includes(s)} onChange={(e) => toggleScope(s, e.target.checked)} />
            <span>
              <span className="block text-sm font-medium">{BOT_SCOPE_INFO[s].label}</span>
              <span className="block text-xs text-muted-foreground">{BOT_SCOPE_INFO[s].description}</span>
            </span>
          </label>
        ))}
        <p className="text-[11px] text-muted-foreground">Bots can&apos;t be given administrator, role, channel, ban or invite powers, by anyone.</p>
      </div>

      <Field label="Redirect addresses" hint="Optional. After someone adds your bot from an invite link, their browser can be sent to one of these, carrying community_id, permissions and your state. One per line, https (or http://localhost while developing). Up to 5.">
        <Textarea
          rows={2}
          className="font-mono text-xs"
          value={bot.redirectUris.join("\n")}
          placeholder="https://my-bot.example.com/crystal/added"
          onChange={(e) => set({ redirectUris: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean) })}
        />
      </Field>

      <InviteLink botId={bot.botId} visibility={bot.visibility} permissions={bot.permissions} scopes={bot.scopes} redirectUris={bot.redirectUris} />

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium">Slash commands <span className="font-normal text-muted-foreground">({bot.commands.length}/{BOT_LIMITS.commands})</span></p>
          <Button size="sm" variant="secondary" disabled={bot.commands.length >= BOT_LIMITS.commands} onClick={() => set({ commands: [...bot.commands, { name: "", description: "" }] })}><Plus className="size-3.5" /> Add</Button>
        </div>
        {bot.commands.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">/</span>
            <Input value={c.name} onChange={(e) => setCommand(i, { name: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })} placeholder="roll" className="h-8 w-32 font-mono text-xs" maxLength={32} />
            <Input value={c.description} onChange={(e) => setCommand(i, { description: e.target.value })} placeholder="What it does" className="h-8 flex-1 text-xs" maxLength={100} />
            <Button size="icon" variant="ghost" className="size-8" aria-label="Remove command" onClick={() => set({ commands: bot.commands.filter((_, j) => j !== i) })}><Trash2 className="size-3.5" /></Button>
          </div>
        ))}
        {bot.commands.length > 0 && !bot.endpointUrl.trim() && <p className="text-[11px] text-muted-foreground">With no endpoint, commands reach the bot while it is running and logged in.</p>}
      </div>

      {problems.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          {problems.map((p, i) => <li key={i} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />{p}</li>)}
        </ul>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notice && <p className="text-sm text-emerald-500">{notice}</p>}

      <div className="flex justify-end gap-2 border-t border-border/60 pt-4">
        {linked ? (
          <Button disabled={!!busy || problems.length > 0} onClick={() => void save()}>{busy === "save" && <Loader2 className="size-4 animate-spin" />} Save changes</Button>
        ) : (
          <Button disabled={!!busy || problems.length > 0} onClick={() => void register()}>{busy === "register" && <Loader2 className="size-4 animate-spin" />} Register bot</Button>
        )}
      </div>
    </div>
    </>
  );

  return (
    <>
      <CodeWorkbenchView wb={wb} projectName={project.name} settings={settings} settingsLabel="Setup" guide={{ label: "Bot SDK guides", id: "bots/overview" }} reference={{ label: "Bot SDK reference", anchor: "bot/Client" }} />
      {secrets && <SecretsDialog secrets={secrets} onClose={() => setSecrets(null)} />}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this bot?</DialogTitle>
            <DialogDescription>It leaves every community it is in and its token stops working. This can&apos;t be undone. The project here is kept.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { setConfirmDelete(false); void act("delete", async () => { await remove({ botId: bot.botId as Id<"bots"> }); set({ botId: undefined }); }); }}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
