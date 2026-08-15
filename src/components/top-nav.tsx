"use client";

import { Radio } from "lucide-react";

import { UpdateIndicator } from "@/components/update-indicator";

export function TopNav() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-4">
      <div className="flex items-center gap-2">
        <Radio className="size-5 text-primary" />
        <span className="font-semibold">Crystal</span>
      </div>
      <UpdateIndicator />
    </header>
  );
}
