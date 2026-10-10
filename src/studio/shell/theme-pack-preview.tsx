"use client";

import {
  Armchair,
  Bell,
  BellOff,
  Crown,
  Hash,
  Headphones,
  HeadphoneOff,
  Mic,
  MicOff,
  MonitorUp,
  Phone,
  PhoneOff,
  Pin,
  Plus,
  Rss,
  Search,
  SendHorizontal,
  Settings,
  Smile,
  Users,
  Video,
  VideoOff,
  Volume2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { GLASS_BASE, GLASS_DARK, GLASS_SOFT } from "@/components/sidebar/glass";
import { SOUND_LABELS } from "@/studio/model/theme-pack";
import type { ThemePackData } from "@/studio/model/types";
import type { LoadedAsset } from "@/studio/storage/assets";
import { cn } from "@/lib/utils";

/**
 * The app's own palettes, copied from `globals.css` (`:root` and `.dark`, plus the `--glass-*`
 * surface), so a pack that sets some colours is drawn over the right defaults whatever theme the
 * creator happens to be wearing. When the app's palette changes, this is what to keep in step.
 */
const LIGHT: Record<string, string> = {
  background: "oklch(1 0 0)",
  foreground: "oklch(0.141 0.005 285.823)",
  card: "oklch(1 0 0)",
  "card-foreground": "oklch(0.141 0.005 285.823)",
  popover: "oklch(1 0 0)",
  "popover-foreground": "oklch(0.141 0.005 285.823)",
  primary: "oklch(0.21 0.006 285.885)",
  "primary-foreground": "oklch(0.985 0 0)",
  secondary: "oklch(0.967 0.001 286.375)",
  "secondary-foreground": "oklch(0.21 0.006 285.885)",
  muted: "oklch(0.967 0.001 286.375)",
  "muted-foreground": "oklch(0.552 0.016 285.938)",
  accent: "oklch(0.967 0.001 286.375)",
  "accent-foreground": "oklch(0.21 0.006 285.885)",
  destructive: "oklch(0.577 0.245 27.325)",
  border: "oklch(0.92 0.004 286.32)",
  input: "oklch(0.92 0.004 286.32)",
  ring: "oklch(0.705 0.015 286.067)",
  "chart-1": "oklch(0.646 0.222 41.116)",
  "chart-2": "oklch(0.6 0.118 184.704)",
  "chart-3": "oklch(0.398 0.07 227.392)",
  "chart-4": "oklch(0.828 0.189 84.429)",
  "chart-5": "oklch(0.769 0.188 70.08)",
  sidebar: "oklch(0.985 0 0)",
  "sidebar-foreground": "oklch(0.141 0.005 285.823)",
  "sidebar-primary": "oklch(0.21 0.006 285.885)",
  "sidebar-primary-foreground": "oklch(0.985 0 0)",
  "sidebar-accent": "oklch(0.967 0.001 286.375)",
  "sidebar-accent-foreground": "oklch(0.21 0.006 285.885)",
  "sidebar-border": "oklch(0.92 0.004 286.32)",
  "sidebar-ring": "oklch(0.705 0.015 286.067)",
  "glass-bg": "rgb(244 244 245 / 0.9)",
  "glass-bg-soft": "rgb(244 244 245 / 0.25)",
  "glass-border": "rgb(0 0 0 / 0.1)",
  "glass-glow":
    "radial-gradient(120% 140% at 0% 0%, rgb(255 255 255 / 0.95) 0%, rgb(255 255 255 / 0.7) 12%, rgb(255 255 255 / 0.4) 28%, rgb(255 255 255 / 0.15) 48%, rgb(255 255 255 / 0.04) 68%, transparent 85%)",
};

const DARK: Record<string, string> = {
  background: "oklch(0.141 0.005 285.823)",
  foreground: "oklch(0.985 0 0)",
  card: "oklch(0.21 0.006 285.885)",
  "card-foreground": "oklch(0.985 0 0)",
  popover: "oklch(0.21 0.006 285.885)",
  "popover-foreground": "oklch(0.985 0 0)",
  primary: "oklch(0.922 0.003 286.089)",
  "primary-foreground": "oklch(0.21 0.006 285.885)",
  secondary: "oklch(0.274 0.006 286.033)",
  "secondary-foreground": "oklch(0.985 0 0)",
  muted: "oklch(0.274 0.006 286.033)",
  "muted-foreground": "oklch(0.705 0.015 286.067)",
  accent: "oklch(0.274 0.006 286.033)",
  "accent-foreground": "oklch(0.985 0 0)",
  destructive: "oklch(0.704 0.191 22.216)",
  border: "oklch(1 0 0 / 10%)",
  input: "oklch(1 0 0 / 15%)",
  ring: "oklch(0.552 0.016 285.938)",
  "chart-1": "oklch(0.488 0.243 264.376)",
  "chart-2": "oklch(0.696 0.17 162.48)",
  "chart-3": "oklch(0.769 0.188 70.08)",
  "chart-4": "oklch(0.627 0.265 303.9)",
  "chart-5": "oklch(0.645 0.246 16.439)",
  sidebar: "oklch(0.21 0.006 285.885)",
  "sidebar-foreground": "oklch(0.985 0 0)",
  "sidebar-primary": "oklch(0.488 0.243 264.376)",
  "sidebar-primary-foreground": "oklch(0.985 0 0)",
  "sidebar-accent": "oklch(0.274 0.006 286.033)",
  "sidebar-accent-foreground": "oklch(0.985 0 0)",
  "sidebar-border": "oklch(1 0 0 / 10%)",
  "sidebar-ring": "oklch(0.552 0.016 285.938)",
  "glass-bg": "rgb(9 9 11 / 0.9)",
  "glass-bg-soft": "rgb(9 9 11 / 0.25)",
  "glass-border": "rgb(255 255 255 / 0.1)",
  "glass-glow":
    "radial-gradient(120% 140% at 0% 0%, rgb(255 255 255 / 0.17) 0%, rgb(255 255 255 / 0.12) 12%, rgb(255 255 255 / 0.07) 28%, rgb(255 255 255 / 0.03) 48%, rgb(255 255 255 / 0.01) 68%, transparent 85%)",
};

/** The same test the app's provider applies before writing a colour into a stylesheet. */
const SAFE_VALUE = (v: string) => !/[;{}\\"]|url\(/i.test(v);
const SAFE_TOKEN = (t: string) => /^[a-z-]+$/.test(t);

const MOCK_ICON_NAMES = new Set([
  "armchair", "bell", "bell-off", "crown", "hash", "headphones", "headphone-off", "mic", "mic-off", "monitor-up", "phone", "phone-off",
  "pin", "plus", "rss", "search", "send-horizontal", "settings", "smile", "users", "video", "video-off", "volume-2",
]);

function Message({ initials, name, time, tint, children }: { initials: string; name: string; time: string; tint: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ background: tint }}>
        {initials}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm">
          <span className="font-semibold">{name}</span> <span className="text-xs text-muted-foreground">{time}</span>
        </p>
        {children}
      </div>
    </div>
  );
}

function Channel({ icon, name, active, unread }: { icon: React.ReactNode; name: string; active?: boolean; unread?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
        active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground/70",
        unread && !active && "font-semibold text-sidebar-foreground",
      )}
    >
      {icon}
      <span className="truncate">{name}</span>
    </div>
  );
}

/**
 * How a theme pack will look against Crystal.
 *
 * A miniature of the real app — server rail, channels, a conversation, the composer, the call
 * bar and a few controls — built from the app's own components and classes, so the colours,
 * font and replaced icons land on the same things they will for someone who buys the pack.
 * Everything is scoped to this one box: the pack is written onto it as inline variables and a
 * style rule that only matches inside it, so nothing leaks into Studio around it, and it is
 * drawn exactly as the app's pack provider would write it.
 */
export function ThemePackPreview({
  data,
  assets,
  fontFamilyName,
  hasFont,
  scope,
}: {
  data: ThemePackData;
  assets: Map<string, LoadedAsset>;
  /** The family the editor has already declared with `@font-face` for the pack's files. */
  fontFamilyName: string;
  hasFont: boolean;
  /** A unique class for this preview, so icon rules can't match anywhere else. */
  scope: string;
}) {
  const [applied, setApplied] = useState(true);
  const [toggle, setToggle] = useState(true);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);

  const theme = data.theme;
  const pack = applied;

  // What the box wears. A pack that sets a theme decides light or dark and is drawn over that
  // palette; one that only brings a font and icons is drawn over whatever the app looks like now.
  const style = useMemo(() => {
    const vars: Record<string, string> = {};
    if (pack && theme) {
      const base = theme.isDark ? DARK : LIGHT;
      for (const [k, v] of Object.entries(base)) vars[`--${k}`] = v;
      for (const [token, value] of Object.entries(theme.colors)) {
        if (SAFE_TOKEN(token) && SAFE_VALUE(value)) vars[`--${token}`] = value;
      }
    }
    if (pack && hasFont) vars["--font-sans"] = `"${fontFamilyName}", "Blu Sans", system-ui, sans-serif`;
    return { ...vars, backgroundColor: "var(--background)", color: "var(--foreground)", fontFamily: "var(--font-sans)" } as React.CSSProperties;
  }, [pack, theme, hasFont, fontFamilyName]);

  // Icon replacements, written the way the app's provider writes them, but only matching inside
  // this box and using the creator's local files.
  const iconCss = useMemo(() => {
    if (!pack) return "";
    const rules: string[] = [];
    for (const [name, id] of Object.entries(data.icons)) {
      const a = assets.get(id);
      if (!a || !/^[a-z0-9-]+$/.test(name) || !a.url.startsWith("blob:")) continue;
      const href = a.url.replace(/["\\]/g, "");
      rules.push(
        `.${scope} svg.lucide-${name}>*{display:none!important}.${scope} svg.lucide-${name}{background-color:currentColor;-webkit-mask:url("${href}") center/contain no-repeat;mask:url("${href}") center/contain no-repeat}`,
      );
    }
    return rules.join("\n");
  }, [pack, data.icons, assets, scope]);

  const extraIcons = Object.keys(data.icons).filter((n) => !MOCK_ICON_NAMES.has(n));
  const sounds = Object.entries(data.sounds).filter(([, id]) => assets.get(id));
  const dark = pack && theme ? theme.isDark : false;

  const play = (id: string) => {
    const a = assets.get(id);
    if (!a) return;
    audio.current?.pause();
    const el = new Audio(a.url);
    audio.current = el;
    setPlaying(id);
    el.onended = () => setPlaying(null);
    void el.play().catch(() => setPlaying(null));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Preview</h2>
          <p className="text-xs text-muted-foreground">
            {theme
              ? `Drawn over Crystal's ${theme.isDark ? "dark" : "light"} palette, as your pack sets it.`
              : "Your pack sets no colours, so this is drawn over whatever theme you're wearing."}
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-border p-0.5 text-xs">
          {[
            [true, "With your pack"],
            [false, "Without"],
          ].map(([v, label]) => (
            <button key={String(v)} type="button" onClick={() => setApplied(v as boolean)} className={cn("rounded-md px-3 py-1 font-medium", applied === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              {label as string}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        {iconCss && <style>{iconCss}</style>}
        <div
          className={cn(scope, "flex h-[500px] min-w-[780px] select-none overflow-hidden", dark && "dark")}
          style={style}
          aria-label="Preview of Crystal with your theme pack"
        >
          {/* Server rail */}
          <div className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-sidebar-border bg-sidebar py-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground">C</div>
            <div className="h-px w-6 bg-sidebar-border" />
            {["HQ", "Dn", "Gm"].map((s, i) => (
              <div key={s} className={cn("flex size-10 items-center justify-center rounded-2xl text-xs font-semibold", i === 0 ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground")}>
                {s}
              </div>
            ))}
            <div className="flex size-10 items-center justify-center rounded-2xl border border-dashed border-border text-muted-foreground">
              <Plus className="size-4" />
            </div>
          </div>

          {/* Channel list + user card */}
          <div className="flex w-52 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
            <div className="flex h-12 items-center justify-between border-b border-sidebar-border px-3">
              <span className="truncate text-sm font-semibold">Crystal HQ</span>
              <Settings className="size-4 text-muted-foreground" />
            </div>
            <div className="flex-1 space-y-0.5 overflow-hidden p-2">
              <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Text</p>
              <Channel icon={<Hash className="size-4" />} name="general" active />
              <Channel icon={<Hash className="size-4" />} name="design" unread />
              <Channel icon={<Rss className="size-4" />} name="newsfeed" />
              <p className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Voice</p>
              <Channel icon={<Volume2 className="size-4" />} name="Hangout" />
              <Channel icon={<Armchair className="size-4" />} name="Lounge" />
              <div className="flex items-center gap-2 px-2 pt-3 text-xs text-muted-foreground">
                <Crown className="size-3.5" /> Priority
              </div>
            </div>
            <div className="p-2">
              <div className="flex h-14 items-center gap-2 rounded-lg border border-border/40 bg-card px-2.5 shadow-md">
                <div className="relative flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
                  You
                  <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card bg-emerald-500" />
                </div>
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="truncate text-sm font-medium text-card-foreground">You</p>
                  <p className="truncate text-[11px] text-muted-foreground">Online</p>
                </div>
                <Mic className="size-4 text-card-foreground" />
                <HeadphoneOff className="size-4 text-destructive" />
              </div>
            </div>
          </div>

          {/* Conversation */}
          <div className="flex min-w-0 flex-1 flex-col bg-background">
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
              <Hash className="size-4 text-muted-foreground" />
              <span className="text-sm font-semibold">general</span>
              <span className="truncate text-xs text-muted-foreground">Where the team hangs out</span>
              <div className="ml-auto flex items-center gap-3 text-muted-foreground">
                <Pin className="size-4" />
                <Bell className="size-4" />
                <BellOff className="size-4" />
                <Users className="size-4" />
                <Search className="size-4" />
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-hidden px-4 py-4">
              <Message initials="MA" name="Maya" time="Today at 4:12 PM" tint="#8b5cf6">
                <p className="text-sm">Has anyone tried the new lounge scenes yet? The cinema one is wild.</p>
              </Message>
              <Message initials="JO" name="Jordan" time="Today at 4:14 PM" tint="#0ea5e9">
                <p className="text-sm">
                  Yes! <span className="rounded bg-accent px-1 text-accent-foreground">@Maya</span> I put together a theme pack too, tell me what you think.
                </p>
                <div className="flex gap-1.5 pt-0.5">
                  <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">👍 3</span>
                  <span className="rounded-full border border-primary/60 bg-primary/15 px-2 py-0.5 text-xs">✨ 2</span>
                </div>
              </Message>
              <Message initials="SA" name="Sam" time="Today at 4:15 PM" tint="#f97316">
                <div className="max-w-sm rounded-lg border border-border bg-card p-3 text-card-foreground">
                  <p className="text-sm font-semibold">Friday game night</p>
                  <p className="text-xs text-muted-foreground">8:00 PM · Hangout voice channel</p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm">Going</Button>
                    <Button size="sm" variant="secondary">Maybe</Button>
                    <Button size="sm" variant="outline">Not me</Button>
                  </div>
                </div>
              </Message>
            </div>

            {/* Composer */}
            <div className="shrink-0 px-4 pb-3">
              <div className={cn(GLASS_BASE, GLASS_DARK, GLASS_SOFT, "flex h-14 items-center gap-2 px-3")}>
                <Plus className="size-5 text-muted-foreground" />
                <span className="flex-1 text-sm text-muted-foreground">Message #general</span>
                <Smile className="size-5 text-muted-foreground" />
                <SendHorizontal className="size-5" />
              </div>
            </div>

            {/* Call bar */}
            <div className="flex shrink-0 justify-center border-t border-border bg-card/60 py-2.5">
              <div className={cn(GLASS_BASE, GLASS_DARK, "flex items-center gap-1.5 rounded-2xl p-1.5")}>
                {[Mic, Headphones, Video].map((Icon, i) => (
                  <span key={i} className="flex size-9 items-center justify-center rounded-xl bg-foreground/10">
                    <Icon className="size-4" />
                  </span>
                ))}
                <span className="mx-0.5 h-6 w-px bg-border" />
                <span className="flex size-9 items-center justify-center rounded-xl bg-foreground/10"><MonitorUp className="size-4" /></span>
                <span className="flex size-9 items-center justify-center rounded-xl bg-foreground/10"><MicOff className="size-4 text-destructive" /></span>
                <span className="flex size-9 items-center justify-center rounded-xl bg-foreground/10"><VideoOff className="size-4 text-destructive" /></span>
                <span className="flex size-9 items-center justify-center rounded-xl bg-destructive text-white"><PhoneOff className="size-4" /></span>
                <span className="flex size-9 items-center justify-center rounded-xl bg-foreground/10"><Phone className="size-4" /></span>
              </div>
            </div>
          </div>

          {/* Controls: the tokens the screens above don't happen to use */}
          <div className="hidden w-56 shrink-0 flex-col gap-3 border-l border-border bg-card p-3 text-card-foreground lg:flex">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Controls</p>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm">Primary</Button>
              <Button size="sm" variant="secondary">Secondary</Button>
              <Button size="sm" variant="destructive">Delete</Button>
              <Button size="sm" variant="ghost">Ghost</Button>
            </div>
            <Input placeholder="Type something" readOnly />
            <label className="flex items-center justify-between text-sm">
              Notifications <Switch checked={toggle} onCheckedChange={setToggle} />
            </label>
            <div className="rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
              {["Reply", "Pin message", "Copy link"].map((t, i) => (
                <div key={t} className={cn("rounded px-2 py-1 text-sm", i === 1 && "bg-accent text-accent-foreground")}>{t}</div>
              ))}
            </div>
            <div className="flex h-12 items-end gap-1.5 rounded-md bg-muted p-2">
              {["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"].map((c, i) => (
                <div key={c} className="flex-1 rounded-sm" style={{ background: `var(--${c})`, height: `${40 + ((i * 37) % 55)}%` }} />
              ))}
            </div>
            <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">Muted text on a muted surface</p>
            <div className="rounded-md p-0.5 ring-2 ring-ring"><div className="rounded-sm bg-background px-2 py-1 text-xs">Focus ring</div></div>
          </div>
        </div>
      </div>

      {(extraIcons.length > 0 || sounds.length > 0) && (
        <div className="space-y-3 rounded-xl border border-border p-3">
          {extraIcons.length > 0 && (
            <div>
              <p className="mb-2 text-xs text-muted-foreground">Icons in your pack that the screen above doesn&apos;t use:</p>
              <div className={cn(scope, "flex flex-wrap gap-3")} style={style}>
                {extraIcons.map((name) => (
                  <span key={name} className="flex items-center gap-1.5 rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground">
                    {/* The same hook the app's rule matches; the stand-in strokes are hidden when the pack's icon is drawn. */}
                    <svg className={`lucide lucide-${name} size-4`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <rect x="4" y="4" width="16" height="16" rx="3" />
                    </svg>
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}
          {sounds.length > 0 && (
            <div>
              <p className="mb-2 text-xs text-muted-foreground">Sounds can&apos;t be shown, but you can hear them:</p>
              <div className="flex flex-wrap gap-2">
                {sounds.map(([key, id]) => (
                  <Button key={key} size="sm" variant="secondary" onClick={() => play(id)}>
                    {playing === id ? "Playing…" : (SOUND_LABELS[key] ?? key)}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
