"use client";

import { Suspense } from "react";

import { AdminConsole } from "@/components/admin/admin-console";

export default function AdminPage() {
  return (
    <Suspense
      fallback={<div className="flex h-full items-center justify-center bg-background text-muted-foreground">Loading console…</div>}
    >
      <AdminConsole />
    </Suspense>
  );
}
