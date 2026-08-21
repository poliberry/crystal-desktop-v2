"use client";

import { useEffect, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { APP_VERSION } from "@/lib/app-info";
import { getDesktopAPI, isElectron } from "@/lib/desktop";
import type { AppInfo } from "@/types/desktop-api";

export function AboutTab() {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    const api = getDesktopAPI();
    if (!api) return;
    void api.appInfo().then(setInfo).catch(() => {});
  }, []);

  const rows: [string, string][] = [
    ["Version", APP_VERSION],
    ["Platform", info?.platform ?? (isElectron() ? "…" : "Browser")],
    ["Electron", info?.versions.electron ?? "—"],
    ["Chromium", info?.versions.chrome ?? "—"],
    ["Node", info?.versions.node ?? "—"],
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>About Crystal</CardTitle>
        <CardDescription>Version and runtime information for this build.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map(([label, value], i) => (
          <div key={label}>
            {i > 0 && <Separator className="mb-3" />}
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-medium">{value}</span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
