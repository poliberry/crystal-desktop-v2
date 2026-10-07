"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Where Twitch, YouTube or TikTok sends someone back to after they have said yes
 * or no to connecting their account.
 *
 * It only says how it went. The app notices on its own — the connected accounts
 * list is a live query — so there is nothing to hand back.
 */
function Result() {
  const params = useSearchParams();
  const ok = params.get("status") === "ok";
  const provider = params.get("provider");
  const message = params.get("message");
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-center text-foreground">
      <div className="max-w-sm space-y-2">
        <h1 className="text-2xl font-semibold">{ok ? "Connected" : "Couldn't connect"}</h1>
        <p className="text-sm text-muted-foreground">
          {ok
            ? `Your ${provider ?? "account"} is connected. You can close this tab and go back to Crystal.`
            : (message ?? "Something went wrong. Close this tab and try again from Crystal.")}
        </p>
      </div>
    </main>
  );
}

export default function OAuthReturnPage() {
  return (
    <Suspense fallback={null}>
      <Result />
    </Suspense>
  );
}
