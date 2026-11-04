"use client";
/** Poliberry telemetry (PostHog, tagged `app: "crystal"`) so Axiom can see Crystal. Off without NEXT_PUBLIC_POSTHOG_KEY. */
import { useEffect } from "react";
import { useAuthUserId } from "@/components/auth/auth-state";
import { identify, initTelemetry, resetIdentity } from "@/lib/poliberry-telemetry";

export function startTelemetry() {
  initTelemetry({
    app: "crystal",
    key: process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "",
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    platform: /Electron/.test(navigator.userAgent) ? "desktop" : "web",
    environment: process.env.NODE_ENV === "production" ? "production" : "development",
  });
}

/** Ties events to the signed-in Crystal user. Must sit inside the Convex auth provider. */
export function TelemetryUser() {
  const userId = useAuthUserId();
  useEffect(() => {
    if (userId) identify(userId);
    else resetIdentity();
  }, [userId]);
  return null;
}
