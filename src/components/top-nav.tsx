"use client";

import { Radio } from "lucide-react";

export function TopNav() {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
      <Radio className="size-5 text-primary" />
      <span className="font-semibold">Crystal</span>
    </header>
  );
}
