"use client";

import { Show } from "@clerk/react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import AuthFlow from "@/components/auth/auth-flow";
import { InstallFlow, type InstallResult } from "@/components/oauth/install-flow";
import { OpenInAppButton, useOpenInApp } from "@/components/open-in-app";
import { Button } from "@/components/ui/button";

/**
 * Where a link to add a bot or an extension lands: `/oauth/authorize?client_id=…&scope=bot`.
 *
 * Signed out: sign in, and come back here with the link intact. Signed in: the install flow. When it
 * is done the browser goes to the bot's registered redirect address if there is one (carrying what
 * happened, and the `state` the link came with), and otherwise says so and offers the app.
 */
export default function AuthorizePage() {
  const [search, setSearch] = useState<string | null>(null);
  const [done, setDone] = useState<InstallResult | null>(null);
  const appLink = useOpenInApp();

  // After mount: the address doesn't exist while this is prerendered into a static file.
  useEffect(() => setSearch(window.location.search), []);

  return (
    <main className="dark flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6">
      {search === null ? (
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      ) : (
        <>
          <Show when="signed-out">
            <div className="w-full max-w-sm space-y-4">
              <p className="text-center text-sm text-muted-foreground">Sign in to continue.</p>
              <AuthFlow returnTo={window.location.pathname + window.location.search} />
            </div>
          </Show>
          <Show when="signed-in">
            {done ? (
              <div className="w-full max-w-sm space-y-4 rounded-xl border border-border/50 bg-card/60 p-6 text-center">
                <CheckCircle2 className="mx-auto size-10 text-emerald-500" />
                <h1 className="text-lg font-semibold">{done.kind === "bot" ? `${done.botName} was added to ${done.communityName}` : `${done.name} was added`}</h1>
                <p className="text-sm text-muted-foreground">{done.kind === "bot" ? "You can change what it can do any time in the community's settings, under Bots." : "You can turn it off in Settings."}</p>
                <Button className="w-full" onClick={() => window.location.assign("/")}>
                  Open Crystal
                </Button>
              </div>
            ) : (
              <InstallFlow
                search={search}
                onCancel={() => window.location.assign("/")}
                onDone={(result) => {
                  // The address came from the server's list of what the author registered, not from the link.
                  if (result.redirectTo) window.location.assign(result.redirectTo);
                  else setDone(result);
                }}
              />
            )}
          </Show>
          <OpenInAppButton link={appLink} className="w-full max-w-sm" />
        </>
      )}
    </main>
  );
}
