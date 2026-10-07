"use client";

import { PanelTop } from "lucide-react";
import { useState } from "react";

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
