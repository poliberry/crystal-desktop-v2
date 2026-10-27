"use client";

import { ArrowDownToLine, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/*
 * Downloads for the public site.
 *
 * Release files carry their version in the name (`Crystal-Installer-0.2.6.exe`), so there is no fixed
 * "latest" link to each one. Instead the page asks GitHub for the newest stable release when it loads
 * (the repo's "latest" is the newest non-prerelease vX.Y.Z, see .github/workflows/release.yml) and picks
 * the right file. The answer is cached for the visit. If GitHub can't be reached, every button falls
 * back to the releases page, so a download is never a dead end.
 */

export const RELEASES_URL = "https://github.com/poliberry/crystal-desktop-v2/releases/latest";
const API = "https://api.github.com/repos/poliberry/crystal-desktop-v2/releases/latest";
const CACHE_KEY = "crystal-latest-release";

export type Platform = "windows" | "mac" | "linux" | "ios" | "android" | "unknown";
export type Asset = { name: string; url: string; size: number };
export type Release = { version: string; publishedAt: string; assets: Asset[] };

export const PLATFORM_LABEL: Record<Platform, string> = {
  windows: "Windows",
  mac: "macOS",
  linux: "Linux",
  ios: "iPhone",
  android: "Android",
  unknown: "your computer",
};

export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  const uaPlatform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? "";
  if (/iPhone|iPad|iPod/i.test(ua) || (uaPlatform === "MacIntel" && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Win/i.test(uaPlatform) || /Windows/i.test(ua)) return "windows";
  if (/Mac/i.test(uaPlatform) || /Mac OS X/i.test(ua)) return "mac";
  if (/Linux|X11|CrOS/i.test(uaPlatform + ua)) return "linux";
  return "unknown";
}

let inflight: Promise<Release | null> | null = null;

export function fetchLatestRelease(): Promise<Release | null> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) return JSON.parse(cached) as Release;
    } catch {}
    try {
      const response = await fetch(API, { headers: { Accept: "application/vnd.github+json" } });
      if (!response.ok) return null;
      const body = (await response.json()) as { tag_name: string; published_at: string; assets: { name: string; browser_download_url: string; size: number }[] };
      const release: Release = {
        version: body.tag_name.replace(/^v/, ""),
        publishedAt: body.published_at,
        assets: body.assets.map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })),
      };
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(release));
      } catch {}
      return release;
    } catch {
      return null;
    }
  })();
  return inflight;
}

export function useLatestRelease() {
  const [release, setRelease] = useState<Release | null | undefined>(undefined);
  const [platform, setPlatform] = useState<Platform>("unknown");
  useEffect(() => {
    setPlatform(detectPlatform());
    let live = true;
    void fetchLatestRelease().then((r) => live && setRelease(r));
    return () => {
      live = false;
    };
  }, []);
  return { release, platform };
}

/** The installer for a platform: one small app that installs Crystal, Crystal Studio or both. */
export function installerFor(release: Release | null | undefined, platform: Platform): Asset | null {
  if (!release) return null;
  const ext = platform === "windows" ? ".exe" : platform === "mac" ? ".dmg" : platform === "linux" ? ".AppImage" : null;
  if (!ext) return null;
  return release.assets.find((a) => a.name.startsWith("Crystal-Installer-") && a.name.endsWith(ext)) ?? null;
}

export function formatSize(bytes: number) {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

/**
 * "Download for macOS": starts the right installer straight away, with a quiet link underneath to the
 * page with every platform (for downloading on one machine to install on another). On a phone there's
 * no installer to give, so it goes to the downloads page, which explains the web app instead.
 */
export function DownloadButton({ className, variant = "secondary", showOther = true }: { className?: string; variant?: "primary" | "secondary"; showOther?: boolean }) {
  const { release, platform } = useLatestRelease();
  const asset = installerFor(release, platform);
  const desktop = platform === "windows" || platform === "mac" || platform === "linux";
  const href = asset?.url ?? (desktop ? RELEASES_URL : "/download/");
  const label = desktop ? `Download for ${PLATFORM_LABEL[platform]}` : "Get the desktop app";

  return (
    <span className="inline-flex flex-col items-center gap-2">
      <a
        href={href}
        {...(asset || !desktop ? {} : { target: "_blank", rel: "noreferrer" })}
        className={cn(
          "inline-flex items-center gap-2 rounded-xl px-6 py-3.5 text-[15px] font-semibold transition active:scale-[0.97]",
          variant === "primary" ? "bg-emerald-300 font-bold text-[#06110c] hover:bg-emerald-200" : "border border-white/15 text-white/80 hover:border-white/30 hover:text-white",
          className,
        )}
      >
        <ArrowDownToLine className="size-4" /> {label}
      </a>
      {showOther && (
        <a href="/download/" className="text-xs text-white/45 underline-offset-4 transition hover:text-white/80 hover:underline">
          {desktop && release ? `v${release.version} · ` : ""}Other platforms
        </a>
      )}
    </span>
  );
}

type Row = { platform: Platform; title: string; note: string; installer: string; extra: { label: string; match: (name: string) => boolean }[] };
const ROWS: Row[] = [
  {
    platform: "windows",
    title: "Windows",
    note: "Windows 10 and 11, 64-bit. Runs directly, nothing to unzip.",
    installer: ".exe",
    extra: [{ label: "Crystal only (.exe)", match: (n) => /^Crystal-Setup-[\d.]+\.exe$/.test(n) }],
  },
  {
    platform: "mac",
    title: "macOS",
    note: "Apple Silicon (M1 and newer). Open the .dmg and run the installer.",
    installer: ".dmg",
    extra: [
      { label: "Crystal only (.dmg)", match: (n) => /^Crystal-[\d.]+\.dmg$/.test(n) },
      { label: "Crystal only (.zip)", match: (n) => /^Crystal-[\d.]+\.zip$/.test(n) },
    ],
  },
  {
    platform: "linux",
    title: "Linux",
    note: "Make the AppImage executable, then run it. On Arch: yay -S crystal-desktop-bin.",
    installer: ".AppImage",
    extra: [
      { label: "Crystal only (.AppImage)", match: (n) => /^Crystal-[\d.]+\.AppImage$/.test(n) },
      { label: "Crystal only (.deb)", match: (n) => /^Crystal-[\d.]+\.deb$/.test(n) },
    ],
  },
];

export function DownloadList() {
  const { release, platform } = useLatestRelease();
  return (
    <div className="space-y-4">
      {ROWS.map((row) => {
        const installer = installerFor(release, row.platform);
        const mine = row.platform === platform;
        return (
          <div key={row.platform} className={cn("rounded-2xl border p-6 sm:flex sm:items-center sm:justify-between sm:gap-6", mine ? "border-emerald-200/25 bg-emerald-300/[0.05]" : "border-white/[0.08] bg-white/[0.02]")}>
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-lg font-semibold text-white">
                {row.title}
                {mine && <span className="rounded-full bg-emerald-300/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-200">This device</span>}
              </p>
              <p className="mt-1 text-[15px] leading-7 text-white/55">{row.note}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {row.extra.map((extra) => {
                  const asset = release?.assets.find((a) => extra.match(a.name));
                  return asset ? (
                    <a key={extra.label} href={asset.url} className="text-white/50 underline-offset-4 transition hover:text-white hover:underline">
                      {extra.label} · {formatSize(asset.size)}
                    </a>
                  ) : null;
                })}
              </div>
            </div>
            <a
              href={installer?.url ?? RELEASES_URL}
              {...(installer ? {} : { target: "_blank", rel: "noreferrer" })}
              className={cn(
                "mt-4 inline-flex shrink-0 items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition active:scale-[0.97] sm:mt-0",
                mine ? "bg-emerald-300 font-bold text-[#06110c] hover:bg-emerald-200" : "border border-white/15 text-white/85 hover:border-white/30",
              )}
            >
              <ArrowDownToLine className="size-4" />
              {installer ? `Installer · ${formatSize(installer.size)}` : release === undefined ? "Finding the latest…" : "See releases"}
            </a>
          </div>
        );
      })}
      <p className="pt-2 text-sm text-white/40">
        {release ? `Latest version: ${release.version}, released ${new Date(release.publishedAt).toLocaleDateString("en", { day: "numeric", month: "long", year: "numeric" })}. ` : ""}
        <a href={RELEASES_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-white/60 underline-offset-4 hover:text-white hover:underline">
          All releases and checksums <ChevronRight className="size-3.5" />
        </a>
      </p>
    </div>
  );
}
