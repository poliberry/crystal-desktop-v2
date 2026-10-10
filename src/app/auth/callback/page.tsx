"use client";

import { AuthenticateWithRedirectCallback } from "@clerk/react";

import { getDesktopAPI } from "@/lib/desktop";

export default function AuthCallbackPage() {
  // The standalone Crystal Studio app has only Studio to go back to.
  const home = getDesktopAPI()?.appKind === "studio" ? "/studio/" : "/";
  return (
    <div className="dark flex h-full items-center justify-center text-sm text-muted-foreground">
      <AuthenticateWithRedirectCallback
        signInForceRedirectUrl={home}
        signUpForceRedirectUrl={home}
      />
      <span>Completing sign in…</span>
    </div>
  );
}
