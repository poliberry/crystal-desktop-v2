"use client";

import { Loader2, Plus, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { MAX_FONT_FACES, PACK_SOUNDS, THEME_TOKENS } from "../../../convex/lib/creationSpecs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SubmitPanel } from "@/studio/shell/submit-panel";
import { COMMON_ICONS, SOUND_LABELS, WEIGHT_NAMES, fontOf, guessFace } from "@/studio/model/theme-pack";
import { emptyThemePack, type FontFaceData, type Project, type ThemePackData } from "@/studio/model/types";
import { ASSET_LIMITS, useProjectAssets, type LoadedAsset } from "@/studio/storage/assets";
import { cn } from "@/lib/utils";

type Tab = "theme" | "font" | "sounds" | "icons";

const FONT_EXTS = ["woff2", "woff", "ttf", "otf"];
const SOUND_EXTS = ["wav", "mp3", "ogg", "m4a"];
const extOf = (n: string) => (n.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** Theme tokens a creator is most likely to want first; the rest follow. */
const TOKEN_ORDER = ["background", "foreground", "card", "primary", "primary-foreground", "secondary", "accent", "muted", "muted-foreground", "border", "sidebar", "sidebar-accent", "destructive", "ring"];

function ThemeTab({ data, set }: { data: ThemePackData; set: (d: ThemePackData) => void }) {
  const theme = data.theme ?? { isDark: true, colors: {} };
  const tokens = [...TOKEN_ORDER, ...THEME_TOKENS.filter((t) => !TOKEN_ORDER.includes(t))];
  const setColour = (token: string, value: string) => {
    const colors = { ...theme.colors };
    if (value.trim()) colors[token] = value;
    else delete colors[token];
    set({ ...data, theme: { ...theme, colors } });
  };
  return (
    <Section title="Colours" hint="Any CSS colour — hex, rgb(), hsl() or oklch(). Leave a colour empty to keep the app's own.">
      <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
        This is a dark theme
        <Switch checked={theme.isDark} onCheckedChange={(isDark) => set({ ...data, theme: { ...theme, isDark } })} />
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        {tokens.map((token) => {
          const value = theme.colors[token] ?? "";
          const hex = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#808080";
          return (
            <div key={token} className="flex items-center gap-2">
              <input type="color" value={hex} onChange={(e) => setColour(token, e.target.value)} className="size-8 shrink-0 cursor-pointer rounded border border-input bg-transparent p-0.5" aria-label={token} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] text-muted-foreground">{token}</p>
                <Input value={value} placeholder="default" onChange={(e) => setColour(token, e.target.value)} className="h-7 font-mono text-xs" />
              </div>
              {value && (
                <button type="button" onClick={() => setColour(token, "")} className="text-muted-foreground hover:text-foreground" aria-label={`Reset ${token}`}>
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function useFilePicker(accept: string[], maxBytes: number, add: (f: File) => Promise<LoadedAsset>, onError: (m: string | null) => void) {
  return async (file: File | undefined): Promise<LoadedAsset | null> => {
    if (!file) return null;
    onError(null);
    if (!accept.includes(extOf(file.name))) {
      onError(`“${file.name}” has to be one of: ${accept.map((a) => "." + a).join(", ")}.`);
      return null;
    }
    if (file.size > maxBytes) {
      onError(`“${file.name}” is over ${(maxBytes / 1024 / 1024).toFixed(maxBytes < 1024 * 1024 ? 2 : 0)} MB.`);
      return null;
    }
    return add(file);
  };
}

/**
 * A theme pack: colours, a font, replacement sounds and icons. All of it is data —
 * a pack changes how Crystal looks and sounds and cannot change what it does.
 */
export function ThemePackEditor({ project, onChange }: { project: Project; onChange: (p: Project) => void }) {
  const data = project.themePack ?? emptyThemePack();
  const { assets, add, remove } = useProjectAssets(project.id);
  const [tab, setTab] = useState<Tab>("theme");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [iconName, setIconName] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const set = (next: ThemePackData) => onChange({ ...project, themePack: next });


  const pickFont = useFilePicker(FONT_EXTS, ASSET_LIMITS.font, add, setError);
  const pickSound = useFilePicker(SOUND_EXTS, ASSET_LIMITS.sound, add, setError);
  const pickIcon = useFilePicker(["svg"], ASSET_LIMITS.icon, add, setError);

  // The family is loaded here too, so the specimen is really set in it — every face
  // under one name, each with its own weight and style, as the app will have it.
  const family = fontOf(data.font);
  const fontFamilyName = `studio-${project.id}`;
  const fontCss = (family?.faces ?? [])
    .map((f) => {
      const a = assets.get(f.assetId);
      return a ? `@font-face{font-family:"${fontFamilyName}";src:url("${a.url}");font-weight:${f.weightMax !== undefined ? `${f.weight} ${f.weightMax}` : f.weight};font-style:${f.style};}` : "";
    })
    .join("");
  const setFont = (font: { family: string; faces: FontFaceData[] } | undefined) => set({ ...data, font });

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "theme", label: "Theme", count: Object.keys(data.theme?.colors ?? {}).length || undefined },
    { id: "font", label: "Font", count: family?.faces.length || undefined },
    { id: "sounds", label: "Sounds", count: Object.keys(data.sounds).length || undefined },
    { id: "icons", label: "Icons", count: Object.keys(data.icons).length || undefined },
  ];

  const play = (assetId: string) => {
    const a = assets.get(assetId);
    if (!a) return;
    audio.current?.pause();
    const el = new Audio(a.url);
    audio.current = el;
    setPlaying(assetId);
    el.onended = () => setPlaying(null);
    void el.play().catch(() => setPlaying(null));
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      {fontCss && <style>{fontCss}</style>}
      <div className="flex shrink-0 border-b border-border/60 px-2">
        {tabs.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} className={cn("flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium", tab === t.id ? "border-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t.label}
            {t.count ? <span className="rounded-full bg-primary/15 px-1.5 text-[10px] text-primary">{t.count}</span> : null}
          </button>
        ))}
      </div>

      <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
        {tab === "theme" && <ThemeTab data={data} set={set} />}

        {tab === "font" && (
          <Section title="Font family" hint="A family is one or more files — regular, bold, italic and so on — that the app picks between by weight and style. WOFF2 is smallest; WOFF, TTF and OTF work too. Up to 4 MB a file and 12 files. Make sure you have the right to distribute them.">
            <div className="space-y-4 rounded-xl border border-border p-4">
              <Input value={family?.family ?? ""} maxLength={40} placeholder="Family name, e.g. Inter" onChange={(e) => setFont({ family: e.target.value, faces: family?.faces ?? [] })} />

              {family && family.faces.length > 0 && (
                <ul className="divide-y divide-border/60 rounded-lg border border-border">
                  {family.faces.map((face, i) => {
                    const a = assets.get(face.assetId);
                    const variable = face.weightMax !== undefined;
                    const update = (patch: Partial<FontFaceData>) => setFont({ ...family, faces: family.faces.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
                    return (
                      <li key={face.assetId} className="flex flex-wrap items-center gap-2 px-3 py-2">
                        <span className="min-w-0 flex-1 truncate text-sm" title={a?.name}>{a?.name ?? "Missing file"}</span>
                        <Select value={String(face.weight)} onValueChange={(v) => update({ weight: Number(v), weightMax: face.weightMax !== undefined ? Math.max(Number(v) + 100, face.weightMax) : undefined })}>
                          <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Object.entries(WEIGHT_NAMES).map(([w, label]) => (
                              <SelectItem key={w} value={w}>{variable ? "From " : ""}{w} {label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {variable && (
                          <Select value={String(face.weightMax)} onValueChange={(v) => update({ weightMax: Number(v) })}>
                            <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Object.entries(WEIGHT_NAMES).filter(([w]) => Number(w) > face.weight).map(([w, label]) => (
                                <SelectItem key={w} value={w}>To {w} {label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        <label className="flex items-center gap-1.5 text-xs">
                          Variable
                          <Switch checked={variable} onCheckedChange={(v) => update({ weightMax: v ? 900 : undefined, weight: v ? 100 : face.weight })} />
                        </label>
                        <label className="flex items-center gap-1.5 text-xs">
                          Italic
                          <Switch checked={face.style === "italic"} onCheckedChange={(v) => update({ style: v ? "italic" : "normal" })} />
                        </label>
                        <Button size="icon" variant="ghost" className="size-8" aria-label="Remove this file" onClick={() => { void remove(face.assetId); setFont({ ...family, faces: family.faces.filter((_, j) => j !== i) }); }}>
                          <Trash2 className="size-4" />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}

              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground hover:border-foreground/40 hover:text-foreground">
                <Upload className="size-4" /> {family && family.faces.length ? "Add more files" : "Choose font files"} — pick several at once
                <input type="file" multiple accept=".woff2,.woff,.ttf,.otf" hidden onChange={async (e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  if (!files.length) return;
                  setBusy(true);
                  const added: FontFaceData[] = [];
                  const taken = new Set((family?.faces ?? []).map((f) => `${f.style}:${f.weight}:${f.weightMax ?? ""}`));
                  for (const file of files.slice(0, MAX_FONT_FACES - (family?.faces.length ?? 0))) {
                    const a = await pickFont(file);
                    if (!a) continue;
                    const guess = guessFace(a.name);
                    // Two files guessed to be the same face: the second is left for the
                    // person to describe rather than silently fighting the first.
                    let face: FontFaceData = { assetId: a.id, ...guess };
                    let key = `${face.style}:${face.weight}:${face.weightMax ?? ""}`;
                    if (taken.has(key)) {
                      const free = [400, 700, 300, 500, 600, 800, 200, 900, 100].find((w) => !taken.has(`${face.style}:${w}:`));
                      face = { ...face, weight: free ?? 400, weightMax: undefined };
                      key = `${face.style}:${face.weight}:`;
                      setError(`“${a.name}” looked like a duplicate of another file, so it was given a different weight — check it's right.`);
                    }
                    taken.add(key);
                    added.push(face);
                  }
                  setBusy(false);
                  if (added.length) {
                    const base = family ?? { family: files[0].name.replace(/\.[^.]+$/, "").replace(/[-_](regular|bold|italic|light|medium|semibold|black|thin|variable.*)$/i, "").replace(/[^A-Za-z0-9 _-]/g, " ").trim().slice(0, 40) || "Custom", faces: [] };
                    setFont({ ...base, faces: [...base.faces, ...added] });
                  }
                }} />
              </label>
              <p className="text-[11px] text-muted-foreground">Each file's weight and style are guessed from its name — check them. A variable font is one file that covers a range of weights.</p>

              {family && family.faces.length > 0 && (
                <div className="space-y-1 rounded-lg bg-card p-4" style={{ fontFamily: `"${fontFamilyName}", system-ui` }}>
                  {[...new Set(family.faces.flatMap((f) => (f.weightMax !== undefined ? [100, 300, 400, 500, 700, 900].filter((w) => w >= f.weight && w <= f.weightMax!) : [f.weight])))]
                    .sort((a, b) => a - b)
                    .flatMap((w) => (family.faces.some((f) => f.style === "italic" && f.weight <= w && (f.weightMax ?? f.weight) >= w) ? [[w, false], [w, true]] : [[w, false]]) as [number, boolean][])
                    .map(([w, italic]) => (
                      <p key={`${w}${italic}`} className="flex items-baseline gap-3 text-lg" style={{ fontWeight: w, fontStyle: italic ? "italic" : "normal" }}>
                        <span className="w-24 shrink-0 font-sans text-[11px] font-normal text-muted-foreground not-italic">{w} {WEIGHT_NAMES[w]}{italic ? " italic" : ""}</span>
                        The quick brown fox jumps over the lazy dog
                      </p>
                    ))}
                </div>
              )}
            </div>
          </Section>
        )}

        {tab === "sounds" && (
          <Section title="Sounds" hint="Replace any of Crystal's sounds. WAV, MP3, OGG or M4A, up to 2 MB each — short clips feel best.">
            <div className="divide-y divide-border/60 rounded-xl border border-border">
              {PACK_SOUNDS.map((key) => {
                const id = data.sounds[key];
                const a = id ? assets.get(id) : undefined;
                return (
                  <div key={key} className="flex items-center gap-3 px-3 py-2.5">
                    <span className="min-w-0 flex-1 text-sm">{SOUND_LABELS[key]}</span>
                    {a ? (
                      <>
                        <span className="max-w-32 truncate text-xs text-muted-foreground">{a.name}</span>
                        <Button size="sm" variant="secondary" onClick={() => play(a.id)}>{playing === a.id ? "Playing…" : "Play"}</Button>
                        <Button size="icon" variant="ghost" className="size-8" aria-label="Remove" onClick={() => { void remove(a.id); const s = { ...data.sounds }; delete s[key]; set({ ...data, sounds: s }); }}>
                          <Trash2 className="size-4" />
                        </Button>
                      </>
                    ) : (
                      <label className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent">
                        Choose…
                        <input type="file" accept=".wav,.mp3,.ogg,.m4a" hidden onChange={async (e) => {
                          const f = e.target.files?.[0];
                          e.target.value = "";
                          const asset = await pickSound(f);
                          if (asset) set({ ...data, sounds: { ...data.sounds, [key]: asset.id } });
                        }} />
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {tab === "icons" && (
          <Section title="Icons" hint="Replace any of the app's icons with your own SVG. Name the icon the way Lucide does (e.g. video, mic-off) — your artwork is drawn in the icon's colour and size, so use a single-colour SVG.">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
              }}
            >
              <Input list="studio-icon-names" placeholder="Icon name, e.g. video" value={iconName} onChange={(e) => setIconName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} />
              <datalist id="studio-icon-names">
                {COMMON_ICONS.filter((n) => !data.icons[n]).map((n) => <option key={n} value={n} />)}
              </datalist>
              <label className={cn("inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 text-sm text-primary-foreground", !iconName && "pointer-events-none opacity-50")}>
                <Plus className="size-4" /> Add SVG
                <input type="file" accept=".svg,image/svg+xml" hidden disabled={!iconName} onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  const a = await pickIcon(f);
                  if (!a) return;
                  const old = data.icons[iconName];
                  if (old) await remove(old);
                  set({ ...data, icons: { ...data.icons, [iconName]: a.id } });
                  setIconName("");
                }} />
              </label>
            </form>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {Object.entries(data.icons).map(([name, id]) => {
                const a = assets.get(id);
                return (
                  <div key={name} className="space-y-2 rounded-xl border border-border p-3 text-center">
                    <span
                      className="mx-auto block size-8 bg-foreground"
                      style={a ? { WebkitMask: `url("${a.url}") center / contain no-repeat`, mask: `url("${a.url}") center / contain no-repeat` } : undefined}
                    />
                    <p className="truncate font-mono text-[11px]">{name}</p>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-destructive hover:text-destructive" onClick={() => { void remove(id); const i = { ...data.icons }; delete i[name]; set({ ...data, icons: i }); }}>
                      Remove
                    </Button>
                  </div>
                );
              })}
            </div>
          </Section>
        )}
        {busy && <Loader2 className="size-4 animate-spin" />}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <div className="border-t border-border/60">
        <SubmitPanel project={project} onChange={onChange} />
      </div>
    </div>
  );
}
