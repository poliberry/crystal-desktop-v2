"use client";

import { AuthenticateWithRedirectCallback } from "@clerk/react";

export default function AuthCallbackPage() {
  return (
    <div className="dark flex h-full items-center justify-center text-sm text-muted-foreground">
      <AuthenticateWithRedirectCallback
        signInForceRedirectUrl="/"
        signUpForceRedirectUrl="/"
      />
      <span>Completing sign in…</span>
    </div>
  );
}
