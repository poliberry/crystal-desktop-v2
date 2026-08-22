"use client";

import { SignedIn, SignedOut, SignIn } from "@clerk/clerk-react";

import { SettingsShell } from "@/components/settings/settings-shell";
import { Show } from "@clerk/react";

export default function SettingsPage() {
  return (
    <main className="h-full dark">
      <Show when="signed-out">
        <div className="flex h-full items-center justify-center">
          <SignIn />
        </div>
      </Show>

      <Show when="signed-in">
        <SettingsShell />
      </Show>
    </main>
  );
}
