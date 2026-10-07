"use client";

import { AlertTriangle, CheckCircle2, ExternalLink, Play, XCircle } from "lucide-react";
import { useMemo, useState } from "react";

import { normalizeSceneSpec, normalizeThemePackSpec, type SceneSpec, type ThemePackSpec } from "../../../../convex/lib/creationSpecs";
import { Panel } from "@/components/admin/admin-ui";
import { SkuPreview } from "@/components/marketplace/sku-preview";
import { ScenePropView } from "@/components/lounge/lounge-props";
import { SceneBackground } from "@/components/lounge/scene-background";
import { GRANT_KIND_META, type GrantKind } from "@/components/marketplace/sku-kinds";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isVideoUrl } from "@/lib/media";
import { cn } from "@/lib/utils";

interface Grant {
  kind: string;
  payload?: string;
  label?: string;
}

type Finding = { level: "ok" | "warn" | "bad"; text: string };

function Findings({ items }: { items: Finding[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((f, i) => (
        <li key={i} className="flex items-start gap-2 text-sm">
          {f.level === "ok" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : f.level === "warn" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-red-400" />}
          <span>{f.text}</span>
        </li>
      ))}
    </ul>
  );
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "?";
  }
};

function FileLink({ url, label }: { url: string; label?: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-sky-400 hover:underline">
      {label ?? hostOf(url)} <ExternalLink className="size-3" />
    </a>
  );
}

// --- Scenes --------------------------------------------------------------------------------------

function SceneReview({ grant, name }: { grant: Grant; name: string }) {
  const [sharing, setSharing] = useState(false);
  const [showSeats, setShowSeats] = useState(true);
  const [on, setOn] = useState<Record<string, boolean>>({});

  const parsed = useMemo(() => {
    try {
      // The same validator the server ran; with no address check, since where the file lives was checked on submission.
      const spec = normalizeSceneSpec({ name, ...(JSON.parse(grant.payload ?? "") as object) }, (u) => u);
      return { spec, error: null as string | null };
    } catch (e) {
      return { spec: null as SceneSpec | null, error: e instanceof Error ? e.message : "Unreadable." };
    }
  }, [grant.payload, name]);

  if (!parsed.spec) {
    return <Findings items={[{ level: "bad", text: `This scene doesn't pass the spec checks: ${parsed.error}` }]} />;
  }
  const spec = parsed.spec;
  const dim = spec.lights.dimOnShare && sharing;
  const video = isVideoUrl(spec.backgroundUrl);
  const screenArea = (spec.screen.w * spec.screen.h) / 100;

  const findings: Finding[] = [{ level: "ok", text: "Passes the same spec checks the server runs." }];
  if (spec.seats.length === 0) findings.push({ level: "warn", text: "No seats — people can only stand." });
  if (spec.seats.some((s) => (s.y < spec.floorTop))) findings.push({ level: "warn", text: "Some seats are above the floor line, where people can't walk to." });
  if (screenArea > 60) findings.push({ level: "warn", text: `The screen takes up ${Math.round(screenArea)}% of the room.` });
  if (spec.screen.w / spec.screen.h < 1.2 || spec.screen.w / spec.screen.h > 3) findings.push({ level: "warn", text: "The screen's shape is far from 16:9, so streams will be letterboxed heavily." });
  if (video) findings.push({ level: "warn", text: "The room is a looping clip — check it loops cleanly, isn't flashing, and isn't heavy." });
  if (spec.props.some((p) => p.interactive)) findings.push({ level: "ok", text: `${spec.props.filter((p) => p.interactive).length} interactive prop(s): anyone in the lounge can switch them.` });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={sharing} onChange={(e) => setSharing(e.target.checked)} /> Someone is sharing
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showSeats} onChange={(e) => setShowSeats(e.target.checked)} /> Show seats
        </label>
        <Badge variant="secondary">{video ? "Animated room" : "Still room"}</Badge>
      </div>

      <div className="relative w-full overflow-hidden rounded-xl bg-neutral-900 shadow-lg" style={{ aspectRatio: "16 / 9", containerType: "inline-size" }}>
        <div className="absolute inset-0">
          <SceneBackground url={spec.backgroundUrl} />
        </div>
        <div className="absolute inset-0 bg-[#05030a] transition-opacity duration-1000" style={{ opacity: dim ? spec.lights.amount : 0 }} />
        <div className="absolute overflow-hidden rounded-[0.3cqw] bg-black" style={{ left: `${spec.screen.x}%`, top: `${spec.screen.y}%`, width: `${spec.screen.w}%`, height: `${spec.screen.h}%` }}>
          <div className={cn("flex size-full items-center justify-center text-[1.6cqw] text-white/70", sharing ? "bg-gradient-to-br from-indigo-700 via-fuchsia-600 to-orange-400" : "bg-neutral-950")}>{sharing ? "Live" : "No signal"}</div>
        </div>
        {spec.props.map((p) => (
          <ScenePropView key={p.id} prop={{ ...p, on: on[p.id] ?? p.on }} on={on[p.id] ?? p.on} onToggle={() => setOn((m) => ({ ...m, [p.id]: !(m[p.id] ?? p.on) }))} />
        ))}
        {showSeats &&
          spec.seats.map((s, i) => {
            const depth = Math.min(1, Math.max(0, (s.y - spec.floorTop) / (100 - spec.floorTop)));
            const size = 3.3 + depth * 1.5;
            return (
              <div key={i} className="pointer-events-none absolute flex items-center justify-center rounded-[24%] bg-emerald-400/50 text-[1.1cqw] font-bold text-white ring-1 ring-emerald-200" style={{ left: `${s.x}%`, top: `${s.y}%`, width: `${size}cqw`, aspectRatio: "1", transform: "translate(-50%, -88%)" }}>
                {i + 1}
              </div>
            );
          })}
        <div className="pointer-events-none absolute inset-x-0 h-px bg-amber-400/60" style={{ top: `${spec.floorTop}%` }} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Findings items={findings} />
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Background</dt>
          <dd><FileLink url={spec.backgroundUrl} /></dd>
          <dt className="text-muted-foreground">Screen</dt>
          <dd className="font-mono text-xs">{spec.screen.x}, {spec.screen.y} · {spec.screen.w}×{spec.screen.h}%</dd>
          <dt className="text-muted-foreground">Floor</dt>
          <dd className="font-mono text-xs">{spec.floorTop}% down</dd>
          <dt className="text-muted-foreground">Seats</dt>
          <dd>{spec.seats.length}</dd>
          <dt className="text-muted-foreground">Props</dt>
          <dd>{spec.props.length ? spec.props.map((p) => `${p.kind}${p.interactive ? " (interactive)" : ""}`).join(", ") : "none"}</dd>
          <dt className="text-muted-foreground">Lights</dt>
          <dd>{spec.lights.dimOnShare ? `dim to ${Math.round(spec.lights.amount * 100)}% while sharing` : "unchanged"}</dd>
        </dl>
      </div>
    </div>
  );
}

// --- Theme packs ---------------------------------------------------------------------------------

/** Relative luminance of a hex or rgb() colour; null for anything else (oklch, hsl…). */
function luminance(css: string): number | null {
  let r: number, g: number, b: number;
  const hex = css.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  const rgb = css.trim().match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  } else if (rgb) {
    [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  } else return null;
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const PAIRS: [string, string][] = [
  ["foreground", "background"],
  ["card-foreground", "card"],
  ["primary-foreground", "primary"],
  ["secondary-foreground", "secondary"],
  ["muted-foreground", "background"],
  ["sidebar-foreground", "sidebar"],
];

function PackReview({ grant, name, id }: { grant: Grant; name: string; id: string }) {
  const [loadFont, setLoadFont] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);

  const parsed = useMemo(() => {
    try {
      const spec = normalizeThemePackSpec({ name, ...(JSON.parse(grant.payload ?? "") as object) }, (u) => u);
      return { spec, error: null as string | null };
    } catch (e) {
      return { spec: null as ThemePackSpec | null, error: e instanceof Error ? e.message : "Unreadable." };
    }
  }, [grant.payload, name]);

  if (!parsed.spec) return <Findings items={[{ level: "bad", text: `This theme pack doesn't pass the spec checks: ${parsed.error}` }]} />;
  const spec = parsed.spec;
  const colours = spec.theme?.colors ?? {};
  const family = `review-${id.replace(/[^a-z0-9]/gi, "").slice(-8)}`;

  const findings: Finding[] = [{ level: "ok", text: "Passes the same spec checks the server runs." }];
  for (const [fg, bg] of PAIRS) {
    const c = colours[fg as keyof typeof colours] && colours[bg as keyof typeof colours] ? contrast(colours[fg as keyof typeof colours]!, colours[bg as keyof typeof colours]!) : null;
    if (c !== null && c < 3) findings.push({ level: "bad", text: `${fg} on ${bg} has a contrast of ${c.toFixed(1)}:1 — text will be hard to read.` });
    else if (c !== null && c < 4.5) findings.push({ level: "warn", text: `${fg} on ${bg} is ${c.toFixed(1)}:1, below the 4.5:1 guideline.` });
  }
  if (spec.theme && !colours.background) findings.push({ level: "warn", text: "No background colour is set, so this theme mixes with whichever the person already has." });
  if (spec.theme && !colours.foreground) findings.push({ level: "warn", text: "No text colour is set." });
  if (spec.icons) findings.push({ level: "warn", text: `Replaces ${Object.keys(spec.icons).length} icon(s) — check each is recognisable and means what the original does.` });
  if (spec.sounds) findings.push({ level: "warn", text: `Replaces ${Object.keys(spec.sounds).length} sound(s) — listen to each for volume and content.` });
  if (spec.font) {
    findings.push({ level: "warn", text: `Replaces the app's font with “${spec.font.family}” (${spec.font.faces.length} file${spec.font.faces.length === 1 ? "" : "s"}) — check it is legible at small sizes and licensed for distribution.` });
    if (!spec.font.faces.some((f) => f.style === "normal" && f.weight <= 400 && (f.weightMax ?? f.weight) >= 400)) findings.push({ level: "warn", text: "No regular upright face: ordinary text will fall back to another weight." });
    if (!spec.font.faces.some((f) => f.weight >= 700 || (f.weightMax ?? 0) >= 700)) findings.push({ level: "warn", text: "No bold face: bold text will be synthesised." });
  }

  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(colours)) vars[`--${k}`] = v;

  return (
    <div className="space-y-4">
      {loadFont && spec.font && (
        <style>
          {spec.font.faces
            .map((f) => `@font-face{font-family:"${family}";src:url("${f.url}");font-weight:${f.weightMax ? `${f.weight} ${f.weightMax}` : f.weight};font-style:${f.style};}`)
            .join("")}
        </style>
      )}

      {spec.theme && (
        <div className="grid gap-3 md:grid-cols-[1.2fr_1fr]">
          {/* The colours applied to a little app, scoped to this box — nothing global changes. */}
          <div className="overflow-hidden rounded-xl border border-border text-sm" style={{ ...(vars as React.CSSProperties), background: "var(--background)", color: "var(--foreground)", fontFamily: loadFont && spec.font ? `"${family}", system-ui` : undefined }}>
            <div className="flex h-56">
              <div className="w-1/4 space-y-1 p-2" style={{ background: "var(--sidebar)", color: "var(--sidebar-foreground)" }}>
                {["Home", "Friends", "Shop"].map((n, i) => (
                  <div key={n} className="rounded px-2 py-1 text-xs" style={i === 1 ? { background: "var(--sidebar-accent)", color: "var(--sidebar-accent-foreground)" } : undefined}>{n}</div>
                ))}
              </div>
              <div className="flex-1 space-y-2 p-3">
                <div className="rounded-lg p-3" style={{ background: "var(--card)", color: "var(--card-foreground)", border: "1px solid var(--border)" }}>
                  <p className="font-semibold">A message from someone</p>
                  <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>The quick brown fox jumps over the lazy dog.</p>
                </div>
                <div className="flex gap-2">
                  <span className="rounded-md px-3 py-1 text-xs" style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>Primary</span>
                  <span className="rounded-md px-3 py-1 text-xs" style={{ background: "var(--secondary)", color: "var(--secondary-foreground)" }}>Secondary</span>
                  <span className="rounded-md px-3 py-1 text-xs" style={{ background: "var(--destructive)", color: "#fff" }}>Delete</span>
                </div>
                <div className="rounded-md px-2 py-1.5 text-xs" style={{ background: "var(--input)", border: "1px solid var(--border)" }}>Message #general</div>
              </div>
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto rounded-xl border border-border">
            <table className="w-full text-xs">
              <tbody>
                {Object.entries(colours).map(([k, v]) => (
                  <tr key={k} className="border-b border-border/50 last:border-0">
                    <td className="p-1.5"><span className="block size-4 rounded border border-white/20" style={{ background: v }} /></td>
                    <td className="p-1.5">{k}</td>
                    <td className="p-1.5 font-mono text-muted-foreground">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {spec.font && (
        <div className="space-y-2 rounded-xl border border-border p-3">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>Font family “{spec.font.family}”</span>
            <Button size="sm" variant="secondary" onClick={() => setLoadFont(true)} disabled={loadFont}>{loadFont ? "Loaded" : "Load the font"}</Button>
          </div>
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {spec.font.faces.map((f, i) => (
              <li key={i}>
                {f.weightMax ? `${f.weight}–${f.weightMax} variable` : f.weight} {f.style} · <FileLink url={f.url} />
              </li>
            ))}
          </ul>
          {loadFont && (
            <div className="space-y-0.5" style={{ fontFamily: `"${family}", system-ui` }}>
              {[100, 300, 400, 500, 700, 900].map((w) => (
                <p key={w} className="text-lg" style={{ fontWeight: w }}>{w} — The quick brown fox jumps over the lazy dog <i className="text-sm">italic</i> <span className="text-[11px]">small: Pack my box with five dozen liquor jugs.</span></p>
              ))}
            </div>
          )}
        </div>
      )}

      {spec.sounds && (
        <div className="rounded-xl border border-border">
          {Object.entries(spec.sounds).map(([k, url]) => (
            <div key={k} className="flex items-center gap-3 border-b border-border/50 px-3 py-2 text-sm last:border-0">
              <span className="flex-1">{k}</span>
              <FileLink url={url} />
              <Button size="sm" variant="secondary" onClick={() => { const a = new Audio(url); a.volume = 0.4; setPlaying(k); a.onended = () => setPlaying(null); void a.play().catch(() => setPlaying(null)); }}>
                <Play /> {playing === k ? "Playing…" : "Play"}
              </Button>
            </div>
          ))}
        </div>
      )}

      {spec.icons && (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {Object.entries(spec.icons).map(([k, url]) => (
            <div key={k} className="space-y-1.5 rounded-lg border border-border p-2 text-center">
              <span className="mx-auto block size-7 bg-foreground" style={{ WebkitMask: `url("${url}") center / contain no-repeat`, mask: `url("${url}") center / contain no-repeat` }} />
              <p className="truncate font-mono text-[10px]">{k}</p>
            </div>
          ))}
        </div>
      )}
      <Findings items={findings} />
    </div>
  );
}

/** The detail staff need to review things made of more than one picture: scenes, theme
 * packs, and packs of several cosmetics. */
export function CreationReview({ grants, name, id }: { grants: Grant[]; name: string; id: string }) {
  const special = grants.filter((g) => g.kind === "loungeScene" || g.kind === "themePack");
  const multi = grants.length > 1;
  if (special.length === 0 && !multi) return null;
  return (
    <>
      {multi && (
        <Panel title={`In this pack (${grants.length})`} description="Each piece, on your own avatar and profile." flush>
          <div className="grid gap-px bg-border/50 sm:grid-cols-2">
            {grants.map((g, i) => (
              <div key={i} className="bg-card">
                <SkuPreview grants={[g]} size="md" className="min-h-48" />
                <p className="px-3 pb-3 text-center text-xs text-muted-foreground">{GRANT_KIND_META[g.kind as GrantKind]?.label ?? g.kind}</p>
              </div>
            ))}
          </div>
        </Panel>
      )}
      {special.map((g, i) => (
        <Panel key={i} title={g.kind === "loungeScene" ? "Scene review" : "Theme pack review"} description="Everything the buyer's client would draw or play — nothing here is applied to your own app.">
          {g.kind === "loungeScene" ? <SceneReview grant={g} name={name} /> : <PackReview grant={g} name={name} id={`${id}${i}`} />}
        </Panel>
      ))}
    </>
  );
}
