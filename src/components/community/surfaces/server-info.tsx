"use client";

import { Check, Copy, Download, ExternalLink, Package, Palette, Rocket, Server, ShieldAlert } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LOADER_LABELS, MODDED_LOADERS, hostOf, type MinecraftInfo, type MinecraftLoader } from "../../../../convex/lib/serverProfile";
import { prismImportUrl } from "@/lib/prism";
import { cn } from "@/lib/utils";

export interface ServerInfoData {
  name: string;
  description?: string;
  iconUrl?: string;
  gameName?: string;
  gameVersion?: string;
  address?: string;
  minecraft?: MinecraftInfo;
}

function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(address);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
      className="flex w-full items-center gap-2 rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 py-2 text-left font-mono text-xs transition-colors hover:border-foreground/25"
      title="Copy the server address"
    >
      <span className="min-w-0 flex-1 truncate">{address}</span>
      {copied ? <Check className="size-3.5 shrink-0 text-emerald-500" /> : <Copy className="size-3.5 shrink-0 text-muted-foreground" />}
    </button>
  );
}

/** One file to install, with the buttons for getting it. */
function Download_({
  title,
  version,
  url,
  required,
  icon: Icon,
  prism,
  badge,
  pageUrl,
}: {
  title: string;
  version?: string;
  url: string;
  required?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  /** Offer "Open in Prism Launcher" — for packs a launcher installs as an instance. */
  prism?: boolean;
  badge?: string;
  pageUrl?: string;
}) {
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  return (
    <div className="space-y-2 rounded-lg border border-foreground/10 p-2.5">
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {title}
            {version && <span className="font-normal text-muted-foreground"> · {version}</span>}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">from {hostOf(url)}</p>
        </div>
        {required !== undefined && (
          <Badge variant="secondary" className={cn("shrink-0", required && "bg-amber-500/15 text-amber-500")}>
            {required ? "Required" : "Optional"}
          </Badge>
        )}
        {badge && <Badge variant="secondary">{badge}</Badge>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="secondary" asChild>
          <a href={url} target="_blank" rel="noopener noreferrer" download>
            <Download /> Download .{ext}
          </a>
        </Button>
        {prism && (
          <Button size="sm" variant="ghost" asChild title="Opens Prism Launcher if you have it installed">
            <a href={prismImportUrl(url)}>
              <Rocket /> Open in Prism Launcher
            </a>
          </Button>
        )}
        {pageUrl && (
          <Button size="icon" variant="ghost" className="size-8" asChild aria-label="Open its page">
            <a href={pageUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-4" />
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}

/** What anyone in the community can read about a server. */
export function ServerInfo({ info }: { info: ServerInfoData }) {
  const mc = info.minecraft;
  const loader = mc ? LOADER_LABELS[mc.loader as MinecraftLoader] ?? mc.loader : null;
  const modded = mc ? MODDED_LOADERS.includes(mc.loader as MinecraftLoader) : false;
  const required = mc?.packs.filter((p) => p.required) ?? [];
  const optional = mc?.packs.filter((p) => !p.required) ?? [];

  const hasDetail = info.address || mc?.modpack || (mc?.packs.length ?? 0) > 0;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {(info.gameName || info.gameVersion) && (
          <Badge variant="secondary">
            {[info.gameName, info.gameVersion].filter(Boolean).join(" ")}
          </Badge>
        )}
        {loader && (
          <Badge variant="secondary" className={cn(modded && "bg-violet-500/15 text-violet-400")}>
            {loader}
            {mc?.loaderVersion ? ` ${mc.loaderVersion}` : ""}
          </Badge>
        )}
      </div>

      {info.description && <p className="text-sm text-muted-foreground">{info.description}</p>}

      {hasDetail && (
        <div className="space-y-2">
          {info.address && <CopyAddress address={info.address} />}

          {mc?.modpack && (
            <>
              <p className="flex items-center gap-1.5 pt-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                <ShieldAlert className="size-3.5 text-amber-500" /> To join, install
              </p>
              <Download_
                title={mc.modpack.name}
                version={mc.modpack.version}
                url={mc.modpack.url}
                icon={Package}
                prism
                badge={mc.modpack.source === "modrinth" ? "Modrinth" : mc.modpack.source === "curseforge" ? "CurseForge" : undefined}
                pageUrl={mc.modpack.pageUrl}
              />
            </>
          )}
          {modded && !mc?.modpack && (
            <p className="text-xs text-muted-foreground">This server uses {loader}, so your game needs {loader} installed to join.</p>
          )}

          {required.length > 0 && (
            <>
              <p className="pt-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Required packs</p>
              {required.map((p) => (
                <Download_ key={p.url} title={p.name} version={p.version} url={p.url} required icon={Palette} badge={p.kind === "shader" ? "Shader" : undefined} />
              ))}
            </>
          )}
          {optional.length > 0 && (
            <>
              <p className="pt-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Optional</p>
              {optional.map((p) => (
                <Download_ key={p.url} title={p.name} version={p.version} url={p.url} required={false} icon={Palette} badge={p.kind === "shader" ? "Shader" : undefined} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ServerIcon({ url, className }: { url?: string; className?: string }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className={cn("rounded-xl object-cover", className)} />
  ) : (
    <span className={cn("flex items-center justify-center rounded-xl bg-foreground/10 text-muted-foreground", className)}>
      <Server className="size-1/2" />
    </span>
  );
}
