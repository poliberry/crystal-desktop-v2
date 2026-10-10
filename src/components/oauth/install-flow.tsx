"use client";

import { useMutation, useQuery } from "convex/react";
import { Check, Loader2, Puzzle, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { CAPABILITY_INFO, type Capability } from "../../../convex/lib/extensionManifest";
import { parseInstallRequest, redirectWith, type InstallRequest } from "../../../convex/lib/oauthLinks";
import { ConsentDialog } from "@/components/community/settings/bots-settings";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Adding a bot or an extension from a link. Used by the install page in the browser and by the app
 * when the OS hands it one, so a link behaves the same wherever it is opened.
 *
 * A link only *asks*. A bot: choose a community you manage, then the same consent screen as adding
 * by hand (permissions you don't hold are off and labelled; the server checks all of it again). An
 * extension: it is added to your own account, with the powers you leave ticked.
 */

export type InstallResult =
  | { kind: "bot"; botName: string; communityId: string; communityName: string; permissions: number; redirectTo: string | null }
  | { kind: "extension"; name: string; redirectTo: string | null };

const messageOf = (e: unknown) => (e instanceof Error ? e.message.replace(/^.*Uncaught Error:\s*/s, "").split("\n")[0] : "That didn't work.");

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-md space-y-4 rounded-xl border border-border/50 bg-card/60 p-6">{children}</div>;
}

function Problem({ title, body }: { title: string; body: string }) {
  return (
    <Shell>
      <div className="text-center">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      </div>
    </Shell>
  );
}

export function InstallFlow({ search, onDone, onCancel }: { search: string; onDone: (result: InstallResult) => void; onCancel?: () => void }) {
  const parsed = useMemo(() => parseInstallRequest(search), [search]);
  if (!parsed.ok) return <Problem title="This link doesn't work" body={parsed.reason} />;
  return parsed.request.kind === "bot" ? <BotInstall request={parsed.request} onDone={onDone} onCancel={onCancel} /> : <ExtensionInstall request={parsed.request} onDone={onDone} onCancel={onCancel} />;
}

function BotInstall({ request, onDone, onCancel }: { request: Extract<InstallRequest, { kind: "bot" }>; onDone: (r: InstallResult) => void; onCancel?: () => void }) {
  const info = useQuery(api.bots.authorizeInfo, { clientId: request.clientId, redirectUri: request.redirectUri ?? undefined });
  const install = useMutation(api.bots.install);
  const [picked, setPicked] = useState<string | null>(request.communityId);
  const [consenting, setConsenting] = useState(false);

  if (info === undefined) return <Loader2 className="size-6 animate-spin text-muted-foreground" />;
  if (info === null) return <Problem title="That bot isn't available" body="The link may be wrong, the bot may be private to its author, or it may have been removed." />;

  const { bot, communities } = info;
  const choice = communities.find((c) => c.id === picked && !c.installed) ?? null;

  if (consenting && choice) {
    // What the link asked for, cut down to what the bot is registered for and what this person holds.
    const initial = request.permissions & bot.permissions & choice.myPermissions;
    return (
      <ConsentDialog
        consent={{
          name: bot.name,
          imageUrl: bot.imageUrl,
          owner: bot.owner?.username ?? null,
          description: bot.description,
          requested: bot.permissions,
          requestedScopes: bot.scopes,
          initial,
          initialScopes: request.scopes.filter((s) => bot.scopes.includes(s)),
        }}
        myPermissions={choice.myPermissions}
        confirmLabel={`Add to ${choice.name}`}
        note={bot.canReceiveEvents ? undefined : "Events are switched off for this bot, so it won't hear about messages or commands until its author turns them back on."}
        onCancel={() => setConsenting(false)}
        onConfirm={async (permissions, scopes) => {
          await install({ botId: bot.id as Id<"bots">, communityId: choice.id as Id<"communities">, permissions, scopes });
          onDone({
            kind: "bot",
            botName: bot.name,
            communityId: choice.id,
            communityName: choice.name,
            permissions,
            // Only ever the address the author registered, as the server worked it out: never what was in the link.
            redirectTo: info.redirectUri ? redirectWith(info.redirectUri, { community_id: choice.id, permissions: String(permissions), scopes: scopes.join(","), state: request.state }) : null,
          });
        }}
      />
    );
  }

  return (
    <Shell>
      <div className="flex items-center gap-3">
        <Avatar className="size-12 rounded-xl">
          {bot.imageUrl && <AvatarImage src={bot.imageUrl} alt="" className="rounded-xl" />}
          <AvatarFallback className="rounded-xl">{bot.name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Add a bot to a community</p>
          <h1 className="truncate text-lg font-semibold">{bot.name}</h1>
          {bot.owner && <p className="text-xs text-muted-foreground">by @{bot.owner.username}</p>}
        </div>
      </div>
      {bot.description && <p className="text-sm text-muted-foreground">{bot.description}</p>}

      {communities.length === 0 ? (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          You don&apos;t manage any community yet. Adding a bot needs the <span className="font-medium text-foreground">Manage Integrations</span> permission in the community, so ask someone who has it to open this link.
        </p>
      ) : (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">Add it to</p>
          {communities.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={c.installed}
              onClick={() => setPicked(c.id)}
              aria-pressed={picked === c.id}
              className={cn("flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-colors", picked === c.id ? "border-primary bg-primary/10" : "border-border hover:bg-accent/40", c.installed && "cursor-not-allowed opacity-60")}
            >
              <Avatar className="size-8 rounded-lg">
                {c.imageUrl && <AvatarImage src={c.imageUrl} alt="" className="rounded-lg" />}
                <AvatarFallback className="rounded-lg text-xs">{c.name.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
              {c.installed ? <span className="text-xs text-muted-foreground">Already added</span> : picked === c.id ? <Check className="size-4 text-primary" /> : null}
            </button>
          ))}
        </div>
      )}

      <p className="flex gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
        You&apos;ll see exactly what it asks for before it gets anything, and you can only give what you hold yourself.
      </p>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button disabled={!choice} onClick={() => setConsenting(true)}>
          Continue
        </Button>
      </div>
    </Shell>
  );
}

function ExtensionInstall({ request, onDone, onCancel }: { request: Extract<InstallRequest, { kind: "extension" }>; onDone: (r: InstallResult) => void; onCancel?: () => void }) {
  const info = useQuery(api.extensions.installInfoBySlug, { slug: request.clientId });
  const install = useMutation(api.extensions.install);
  const [granted, setGranted] = useState<Capability[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (info === undefined) return <Loader2 className="size-6 animate-spin text-muted-foreground" />;
  if (info === null) return <Problem title="That extension isn't available" body="The link may be wrong, or the extension may not be published (or may have been stopped)." />;

  const caps = info.capabilities as Capability[];
  const on = granted ?? caps;
  const current = info.installed?.current;

  return (
    <Shell>
      <div className="flex items-center gap-3">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <Puzzle className="size-6" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Add an extension to your account</p>
          <h1 className="truncate text-lg font-semibold">{info.name}</h1>
          <p className="text-xs text-muted-foreground">
            by {info.publisher} · v{info.version}
          </p>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{info.description}</p>

      {caps.length === 0 ? (
        <p className="text-sm text-muted-foreground">It doesn&apos;t ask for any powers.</p>
      ) : (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">It asks to</p>
          {caps.map((c) => (
            <label key={c} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-2.5 hover:bg-accent/40">
              <input type="checkbox" className="mt-1" checked={on.includes(c)} disabled={busy} onChange={(e) => setGranted(e.target.checked ? [...on, c] : on.filter((x) => x !== c))} />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{CAPABILITY_INFO[c].label}</span>
                <span className="block text-xs text-muted-foreground">{CAPABILITY_INFO[c].description}</span>
                {c === "network" && info.network.length > 0 && <span className="mt-0.5 block break-all font-mono text-[11px] text-muted-foreground">{info.network.join(", ")}</span>}
              </span>
            </label>
          ))}
        </div>
      )}
      {current && <p className="text-xs text-muted-foreground">You already have this version. Installing again changes which powers it has.</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await install({ versionId: info.versionId, granted: on });
              onDone({ kind: "extension", name: info.name, redirectTo: null });
            } catch (e) {
              setError(messageOf(e));
              setBusy(false);
            }
          }}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {info.installed ? "Update" : "Add extension"}
        </Button>
      </div>
    </Shell>
  );
}
