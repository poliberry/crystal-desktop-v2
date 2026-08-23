"use client";

import { Minus, Plus, RotateCcw } from "lucide-react";

import {
  TEXT_SCALES,
  useAccessibility,
  type AccessibilityPreferences,
} from "@/components/accessibility-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

/** The preference keys that are a plain on/off — everything except the two
 * numeric scales. Derived rather than listed so adding a switch to the
 * preferences interface is enough to make it settable here. */
type BooleanPreference = {
  [K in keyof AccessibilityPreferences]: AccessibilityPreferences[K] extends boolean ? K : never;
}[keyof AccessibilityPreferences];

/** The on/off readability settings, in the order they're shown. */
const TOGGLES: {
  key: BooleanPreference;
  title: string;
  description: string;
}[] = [
  {
    key: "reducedMotion",
    title: "Reduce motion",
    description:
      "Skip animations and transitions — panels, popovers and the call grid change instantly.",
  },
  {
    key: "highContrast",
    title: "Increase contrast",
    description:
      "Stronger borders, brighter secondary text, and a visible outline on whatever has keyboard focus.",
  },
  {
    key: "readableFont",
    title: "Readable font",
    description:
      "Swap the interface font for one with wider, more distinguishable letterforms.",
  },
  {
    key: "underlineLinks",
    title: "Underline links",
    description: "Mark links with an underline instead of colour alone.",
  },
];

export function AccessibilityTab() {
  const {
    zoom,
    textScale,
    zoomIn,
    zoomOut,
    resetZoom,
    canZoomIn,
    canZoomOut,
    setPreference,
    reset,
    ...prefs
  } = useAccessibility();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Zoom</CardTitle>
          <CardDescription>
            Scale the whole app — text, avatars and video together. Ctrl/⌘ with +, − or 0 does
            the same thing from anywhere in the app.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">App zoom</p>
              <p className="text-xs text-muted-foreground">
                Applies to this window and the main window.
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="outline"
                onClick={zoomOut}
                disabled={!canZoomOut}
                aria-label="Zoom out"
              >
                <Minus className="size-4" />
              </Button>
              {/* Tabular width so stepping through 90% → 100% → 110% doesn't
                  shuffle the buttons sideways. */}
              <span className="w-14 text-center text-sm font-medium tabular-nums">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                size="icon"
                variant="outline"
                onClick={zoomIn}
                disabled={!canZoomIn}
                aria-label="Zoom in"
              >
                <Plus className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={resetZoom}
                disabled={zoom === 1}
                aria-label="Reset zoom"
              >
                <RotateCcw className="size-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Readability</CardTitle>
          <CardDescription>
            Text size scales words and the space around them without resampling avatars or
            video — unlike zoom, which scales everything.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-4 gap-2">
            {TEXT_SCALES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPreference("textScale", option.value)}
                className={`rounded-lg border-2 px-3 py-2 text-center transition-all ${
                  textScale === option.value
                    ? "border-primary"
                    : "border-border hover:border-border/80"
                }`}
              >
                {/* Previewed at its own scale, so the choice shows what it does. */}
                <span
                  className="block font-medium"
                  style={{ fontSize: `${option.value}rem` }}
                >
                  Aa
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">{option.label}</span>
              </button>
            ))}
          </div>

          {TOGGLES.map((toggle) => (
            <div
              key={toggle.key}
              className="flex items-center justify-between gap-4 rounded-lg border p-3"
            >
              <div className="space-y-0.5">
                <p className="text-sm font-medium">{toggle.title}</p>
                <p className="text-xs text-muted-foreground">{toggle.description}</p>
              </div>
              <Switch
                checked={prefs[toggle.key] === true}
                onCheckedChange={(checked) => setPreference(toggle.key, checked)}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={reset}>
          Reset accessibility settings
        </Button>
      </div>
    </div>
  );
}
