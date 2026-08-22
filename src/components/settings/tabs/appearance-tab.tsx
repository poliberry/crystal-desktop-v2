"use client";

import { useState } from "react";

import { useUiPreferences } from "@/components/ui-preferences-provider";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { type Theme, PRESET_THEMES } from "@/lib/themes";

export function AppearanceTab() {
  const { theme, applyTheme } = useTheme();
  const { communityNavStyle, setCommunityNavStyle, tabsEnabled, setTabsEnabled } = useUiPreferences();
  const [editingPreset, setEditingPreset] = useState<string | null>(null);
  const [jsonValue, setJsonValue] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  const activeId = theme?.id ?? "dark";

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
          <CardDescription>Pick a preset or build your own with JSON.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {PRESET_THEMES.map((preset) => {
              const isActive = activeId === preset.id;
              return (
                <div key={preset.id} className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => applyTheme(preset)}
                    className={`relative w-full overflow-hidden rounded-lg border-2 transition-all ${
                      isActive ? "border-primary" : "border-border hover:border-border/80"
                    }`}
                  >
                    <div
                      className="h-16 w-full"
                      style={{ background: preset.previewBg }}
                    >
                      <div className="flex h-full flex-col justify-end p-2 gap-1">
                        <div
                          className="h-2 w-3/4 rounded-full"
                          style={{ background: preset.previewAccent }}
                        />
                        <div
                          className="h-1.5 w-1/2 rounded-full opacity-50"
                          style={{ background: preset.previewAccent }}
                        />
                      </div>
                    </div>
                    {isActive && (
                      <div className="absolute right-1.5 top-1.5 size-3 rounded-full bg-primary" />
                    )}
                  </button>
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium">{preset.name}</p>
                    <button
                      type="button"
                      onClick={() => openEditor(preset)}
                      className="text-[10px] text-muted-foreground underline-offset-2 hover:underline"
                    >
                      Edit
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Custom slot */}
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={openCustomEditor}
                className={`relative w-full overflow-hidden rounded-lg border-2 border-dashed transition-all ${
                  activeId === "custom" ? "border-primary" : "border-border hover:border-border/80"
                }`}
              >
                <div className="flex h-16 items-center justify-center bg-muted/30">
                  <p className="text-xs text-muted-foreground">Custom…</p>
                </div>
                {activeId === "custom" && (
                  <div className="absolute right-1.5 top-1.5 size-3 rounded-full bg-primary" />
                )}
              </button>
              <p className="text-xs font-medium">Custom</p>
            </div>
          </div>

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

      <Card>
        <CardHeader>
          <CardTitle>Tabbed interface</CardTitle>
          <CardDescription>
            Open DMs and channels as tabs in the top bar, instead of each one replacing the current view.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Enable tabs</p>
              <p className="text-xs text-muted-foreground">
                When off, clicking a DM or channel replaces the current view like before.
              </p>
            </div>
            <Switch checked={tabsEnabled} onCheckedChange={setTabsEnabled} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
