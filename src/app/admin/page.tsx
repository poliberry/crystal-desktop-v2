"use client";

import { Suspense } from "react";

import { AdminConsole, PlainWindow } from "@/components/admin/admin-console";

export default function AdminPage() {
  return (
    <Suspense
      fallback={
        <PlainWindow>
          <p className="text-muted-foreground">Loading console…</p>
        </PlainWindow>
      }
    >
      <AdminConsole />
    </Suspense>
  );
}
