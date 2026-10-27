"use client";

import { useMutation, useQuery } from "convex/react";
import { AlertTriangle, ArrowUpCircle, Loader2, Puzzle, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CAPABILITIES, CAPABILITY_INFO, type Capability } from "../../../../convex/lib/extensionManifest";
import { SettingRow, SettingsCard, SettingsGroup } from "@/components/settings/settings-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useExtensions } from "@/extensions/extensions-provider";
import { ExtensionFrame } from "@/extensions/ui-render";
import { cn } from "@/lib/utils";

const message = (e: unknown) => (e instanceof Error ? e.message.replace(/\[CONVEX [^\]]*\]\s*/g, "").replace(/^.*Uncaught Error:\s*/s, "").split("\n")[0] : "That didn't work.");

interface Entry {
  extensionId: Id<"extensions">;
  versionId: Id<"extensionVersions">;
  name: string;
  description: string;
  version: string;
  capabilities: string[];
  network: string[];
  publisher: string;
  installed: { versionId: Id<"extensionVersions">; granted: string[]; current: boolean } | null;
}

/** What someone is agreeing to, stated plainly, with each power switched on or off on its own. */
function ConsentDialog({ entry, onClose }: { entry: Entry | null; onClose: () => void }) {
  const install = useMutation(api.extensions.install);
  const [granted, setGranted] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [seeded, setSeeded] = useState<string | null>(null);

  if (entry && seeded !== entry.versionId) {
    setSeeded(entry.versionId);
    setGranted(new Set(entry.capabilities));
  }
  if (!entry && seeded) setSeeded(null);

  const caps = (entry?.capabilities ?? []).filter((c): c is Capability => (CAPABILITIES as readonly string[]).includes(c));
  return (
    <Dialog open={!!entry} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entry?.installed ? "Update" : "Add"} {entry?.name}</DialogTitle>
          <DialogDescription>
            By {entry?.publisher} · version {entry?.version}. {entry?.description}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-500">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            An extension is code someone else wrote. It runs in a sandbox on this device and can only do what you allow here — you can turn any of it off, and remove it whenever you like.
          </p>
          {caps.length === 0 ? (
            <p className="text-sm text-muted-foreground">It asks for nothing: it can't show anything or save anything.</p>
          ) : (
            caps.map((c) => (
              <label key={c} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={granted.has(c)}
                  onChange={(e) =>
                    setGranted((g) => {
                      const next = new Set(g);
                      if (e.target.checked) next.add(c);
                      else next.delete(c);
                      return next;
                    })
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {CAPABILITY_INFO[c].label}
                    {CAPABILITY_INFO[c].risk === "medium" && <Badge variant="secondary" className="bg-amber-500/15 text-amber-500">Reaches the internet</Badge>}
                  </span>
                  <span className="block text-xs text-muted-foreground">{CAPABILITY_INFO[c].description}</span>
                  {c === "network" && (
                    <span className="mt-1 block font-mono text-[11px]">
                      {entry!.network.map((o) => (
                        <span key={o} className="block">{o}</span>
                      ))}
                    </span>
                  )}
                </span>
              </label>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={busy}
            onClick={async () => {
              if (!entry) return;
              setBusy(true);
              try {
                await install({ versionId: entry.versionId, granted: [...granted] });
                toast.success(`${entry.name} is on.`);
                onClose();
              } catch (e) {
                toast.error(message(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="animate-spin" />} {entry?.installed ? "Update" : "Add it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PanelDialog({ id, name, version, onClose }: { id: string | null; name: string; version: string; onClose: () => void }) {
  const ext = useExtensions();
  const state = id ? ext.state(id) : null;
  return (
    <Dialog
      open={!!id}
      onOpenChange={(o) => {
        if (!o && id) {
          // The sandbox lives as long as its panel is open.
          ext.stop(id);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="sr-only">{name}</DialogTitle>
          <DialogDescription className="sr-only">An extension's panel.</DialogDescription>
        </DialogHeader>
        {id && state && (
          <ExtensionFrame
            name={name}
            version={version}
            status={state.status}
            detail={state.detail}
            tree={state.tree}
            act={(a, v) => ext.action(id, a, v)}
            onRestart={() => ext.open(id)}
            onStop={() => {
              ext.stop(id);
              onClose();
            }}
          >
            {state.logs.some((l) => l.level === "error" || l.level === "host") && (
              <details className="mt-3 text-xs text-muted-foreground">
                <summary className="cursor-pointer">Messages from the extension</summary>
                <ul className="mt-1 space-y-0.5 font-mono">
                  {state.logs.slice(-20).map((l, i) => (
                    <li key={i} className={cn(l.level === "error" && "text-red-400", l.level === "host" && "text-amber-500")}>{l.text}</li>
                  ))}
                </ul>
              </details>
            )}
          </ExtensionFrame>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ExtensionsTab() {
  const ext = useExtensions();
  const directory = useQuery(api.extensions.directory);
  const uninstall = useMutation(api.extensions.uninstall);
  const [consent, setConsent] = useState<Entry | null>(null);
  const [opened, setOpened] = useState<{ id: string; name: string; version: string } | null>(null);
  const installed = ext.installed ?? [];

  return (
    <div className="space-y-8">
      <SettingsGroup title="Installed">
        {installed.length === 0 ? (
          <SettingsCard className="px-4 py-5 text-sm text-muted-foreground">Nothing installed.</SettingsCard>
        ) : (
          installed.map((i) => {
            const entry = directory?.find((d) => d.extensionId === i.extensionId);
            return (
              <SettingRow key={i.extensionId} icon={ShieldCheck} title={`${i.name} · v${i.version}`} description={i.granted.length ? `Allowed to: ${i.granted.map((g) => CAPABILITY_INFO[g as Capability]?.label.toLowerCase() ?? g).join(", ")}` : "Allowed to do nothing"}>
                {i.updateAvailable && entry && (
                  <Button size="sm" variant="secondary" onClick={() => setConsent(entry as Entry)}>
                    <ArrowUpCircle /> Update to {i.updateAvailable}
                  </Button>
                )}
                {i.granted.includes("ui.panel") && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setOpened({ id: i.extensionId, name: i.name, version: i.version });
                      ext.open(i.extensionId);
                    }}
                  >
                    Open
                  </Button>
                )}
                <Button size="icon" variant="ghost" aria-label={`Remove ${i.name}`} onClick={() => void uninstall({ extensionId: i.extensionId }).then(() => toast.success("Removed, and everything it saved is gone."))}>
                  <Trash2 className="size-4" />
                </Button>
              </SettingRow>
            );
          })
        )}
      </SettingsGroup>

      <SettingsGroup title="Available">
        {directory === undefined ? (
          <Loader2 className="mx-auto my-6 size-5 animate-spin text-muted-foreground" />
        ) : directory.filter((d) => !d.installed).length === 0 ? (
          <SettingsCard className="px-4 py-5 text-sm text-muted-foreground">
            Nothing to add right now. Extensions are reviewed by Crystal's staff before they appear here, and for now they are written by Crystal itself.
          </SettingsCard>
        ) : (
          directory
            .filter((d) => !d.installed)
            .map((d) => (
              <SettingRow key={d.extensionId} icon={Puzzle} title={`${d.name} · v${d.version}`} description={d.description}>
                <Button size="sm" onClick={() => setConsent(d as Entry)}>
                  Add
                </Button>
              </SettingRow>
            ))
        )}
      </SettingsGroup>

      <ConsentDialog entry={consent} onClose={() => setConsent(null)} />
      <PanelDialog id={opened?.id ?? null} name={opened?.name ?? ""} version={opened?.version ?? ""} onClose={() => setOpened(null)} />
    </div>
  );
}
