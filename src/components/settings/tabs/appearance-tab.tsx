"use client";

import { useMutation, useQuery } from "convex/react";
import { Check, Loader2, Palette, PanelTop } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "../../../../convex/_generated/api";
import { SkuPreview } from "@/components/marketplace/sku-preview";
import { useOpenMarketplace } from "@/components/pages/page-context";
import { useUiPreferences } from "@/components/ui-preferences-provider";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SettingRow, SettingsGroup } from "@/components/settings/settings-ui";
import { ThemePicker } from "@/components/settings/theme-picker";
import { type Theme, PRESET_THEMES, getPresetById } from "@/lib/themes";

/**
 * The theme packs the person owns, with the one in force marked. A pack is a font, colours, sounds and icons for the whole
 * app (see theme-pack-provider.tsx); one is on at a time, and taking it off goes back to the theme chosen above.
 * Shown whenever there is something to show, and a way to the shop when there isn't, so the section is findable.
 */
function ThemePacksCard() {
  const entitlements = useQuery(api.marketplace.myEntitlements);
  const active = useQuery(api.marketplace.activeThemePack);
  const equip = useMutation(api.marketplace.equip);
  const unequip = useMutation(api.marketplace.unequipThemePack);
  const openMarketplace = useOpenMarketplace();
  const [busy, setBusy] = useState<string | null>(null);

  if (entitlements === undefined) return null;
  const packs = entitlements.filter((e) => e.kind === "themePack");

  const run = async (id: string, action: () => Promise<unknown>, done: string) => {
    setBusy(id);
    try {
      await action();
      toast.success(done);
    } catch (e) {
      toast.error(e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "") : "That didn't work.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Theme packs</CardTitle>
        <CardDescription>
          A pack changes the font, colours, sounds and icons together. One is on at a time; turning it off returns to the theme above.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {packs.length === 0 ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            <span>You don&apos;t have any theme packs yet.</span>
            <Button size="sm" variant="outline" onClick={() => openMarketplace()}>
              Browse the Marketplace
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-4">
            {packs.map((pack) => {
              const on = active?.entitlementId === pack.id;
              return (
                <div key={pack.id} className={`flex flex-col overflow-hidden rounded-xl border-2 bg-card/60 ${on ? "border-primary" : "border-border"}`}>
                  <SkuPreview grants={[{ kind: pack.kind, payload: pack.payload, label: pack.label }]} size="md" className="aspect-[4/3.4] w-full" />
                  <div className="flex flex-1 flex-col gap-2 p-3">
                    <p className="truncate text-sm font-semibold">{pack.skuName}</p>
                    {on ? (
                      <Button size="sm" variant="outline" disabled={busy === pack.id} onClick={() => void run(pack.id, () => unequip({}), "Theme pack removed.")}>
                        {busy === pack.id ? <Loader2 className="animate-spin" /> : <Check />} Applied — remove
                      </Button>
                    ) : (
                      <Button size="sm" disabled={busy === pack.id} onClick={() => void run(pack.id, () => equip({ entitlementId: pack.id }), "Theme pack applied.")}>
                        {busy === pack.id ? <Loader2 className="animate-spin" /> : <Palette />} Apply
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AppearanceTab() {
  const {
    theme,
    mode,
    setMode,
    applyTheme,
    systemThemeIds,
    setSystemThemeIds,
    dynamicSupported,
    accentColor,
    prefersDark,
  } = useTheme();
  const { communityNavStyle, setCommunityNavStyle, tabsEnabled, setTabsEnabled } = useUiPreferences();
  const [editingPreset, setEditingPreset] = useState<string | null>(null);
  const [jsonValue, setJsonValue] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Only a picked theme has a card of its own to be marked; in `system` and
  // `dynamic` mode the theme in effect belongs to the card for the mode.
  const activeId = mode === "fixed" ? (theme?.id ?? "dark") : "";
  // What the active theme belongs to, so a family's tile reads as selected for
  // whichever of its styles is on. Looked up by id because a theme edited from
  // JSON is stored without its family.
  const activeFamily =
    mode === "fixed" ? (theme?.family ?? getPresetById(activeId)?.family)?.id : undefined;

  const openEditor = (t: Theme) => {
    setJsonValue(JSON.stringify({ name: t.name, isDark: t.isDark, font: t.font ?? "", colors: t.colors }, null, 2));
    setEditingPreset(t.id);
    setJsonError(null);
  };

  const openCustomEditor = () => {
    const base = theme ?? PRESET_THEMES[0];
    setJsonValue(JSON.stringify({ name: "Custom", isDark: base.isDark, font: base.font ?? "", colors: base.colors }, null, 2));
    setEditingPreset("custom");
    setJsonError(null);
  };

  const applyJson = () => {
    setJsonError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonValue);
    } catch {
      setJsonError("Invalid JSON — check for syntax errors.");
      return;
    }
    if (typeof parsed !== "object" || parsed === null || !("colors" in parsed)) {
      setJsonError('Missing required "colors" field.');
      return;
    }
    const raw = parsed as Record<string, unknown>;
    const newTheme: Theme = {
      id: editingPreset === "custom" ? "custom" : (editingPreset ?? "custom"),
      name: typeof raw.name === "string" ? raw.name : "Custom",
      isDark: raw.isDark === true,
      font: typeof raw.font === "string" && raw.font ? raw.font : undefined,
      previewBg: "#141414",
      previewAccent: "#ebebeb",
      colors: raw.colors as Theme["colors"],
    };
    applyTheme(newTheme);
    setEditingPreset(null);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Theme</CardTitle>
          <CardDescription>Follow your system, pick a preset — themes with several styles have a dropdown — or build your own with JSON.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ThemePicker
            mode={mode}
            activeId={activeId}
            activeFamily={activeFamily}
            systemThemeIds={systemThemeIds}
            resolvedTheme={theme ?? PRESET_THEMES[0]}
            dynamic={dynamicSupported && accentColor ? { accentColor, prefersDark } : null}
            onApply={applyTheme}
            onEdit={openEditor}
            onCustom={openCustomEditor}
            onSelectSystem={() => setMode("system")}
            onSelectDynamic={() => setMode("dynamic")}
            onSystemThemeIds={setSystemThemeIds}
          />

          {editingPreset !== null && (
            <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
              <Label>Theme JSON</Label>
              <Textarea
                value={jsonValue}
                onChange={(e) => setJsonValue(e.target.value)}
                className="font-mono text-xs"
                rows={20}
              />
              <p className="text-xs text-muted-foreground">
                Set colors using any valid CSS color value (oklch, hex, hsl, rgb). Set{" "}
                <code className="rounded bg-muted px-1">isDark</code> to true for dark themes.
                Optionally set <code className="rounded bg-muted px-1">font</code> to a CSS
                font-family string.
              </p>
              {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
              <div className="flex gap-2">
                <Button size="sm" onClick={applyJson}>
                  Apply theme
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingPreset(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <ThemePacksCard />

      <Card>
        <CardHeader>
          <CardTitle>Community navigation</CardTitle>
          <CardDescription>Choose how you switch between communities.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setCommunityNavStyle("rail")}
              className={`space-y-1.5 rounded-lg border-2 p-3 text-left transition-all ${
                communityNavStyle === "rail" ? "border-primary" : "border-border hover:border-border/80"
              }`}
            >
              <p className="text-sm font-medium">Rail</p>
              <p className="text-xs text-muted-foreground">
                A persistent icon column on the left edge of the app, always visible.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setCommunityNavStyle("popover")}
              className={`space-y-1.5 rounded-lg border-2 p-3 text-left transition-all ${
                communityNavStyle === "popover" ? "border-primary" : "border-border hover:border-border/80"
              }`}
            >
              <p className="text-sm font-medium">Popover</p>
              <p className="text-xs text-muted-foreground">
                A button in the top bar that opens a switcher when clicked.
              </p>
            </button>
          </div>
        </CardContent>
      </Card>

      <SettingsGroup title="Tabs">
        <SettingRow
          icon={PanelTop}
          title="Tabbed interface"
          description="Open DMs and channels as tabs in the top bar. When off, each replaces the current view."
        >
          <Switch checked={tabsEnabled} onCheckedChange={setTabsEnabled} />
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}
