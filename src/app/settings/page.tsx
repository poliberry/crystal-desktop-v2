"use client";

import { SignedIn, SignedOut, SignIn } from "@clerk/clerk-react";

import { SettingsShell } from "@/components/settings/settings-shell";

export default function SettingsPage() {
  return (
    <main className="h-full dark">
      <SignedOut>
        <div className="flex h-full items-center justify-center">
          <SignIn />
        </div>
      </SignedOut>

      <SignedIn>
        <SettingsShell />
      </SignedIn>
    </main>
  );
}
