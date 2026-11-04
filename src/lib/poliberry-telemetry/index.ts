/**
 * VENDORED from poliberry/axiom packages/telemetry/src/index.ts — do not edit here.
 * Update it from the Axiom repo with `npm run telemetry:install -- <this folder> --client`.
 */
/**
 * Client-side telemetry for Poliberry apps (web, Electron renderers, Tauri webviews).
 *
 * Every event carries `app` (and `app_version`, `platform`) as super properties.
 * Axiom groups, filters and charts by `app`, so use the ids below. Never invent new ones.
 *
 * PostHog never loads code from its own servers here (`disable_external_dependency_loading`), so
 * an app's Content-Security-Policy only needs `connect-src https://*.posthog.com`. Errors are
 * caught by this file's own listeners rather than PostHog's downloadable exception extension.
 *
 * Nothing sensitive leaves through the automatic properties: element text and attributes are masked,
 * and query strings and fragments are cut from every URL, since they can hold OAuth codes and tokens.
 *
 *   import { initTelemetry, identify, log } from "@poliberry/telemetry";
 *   initTelemetry({ app: "crystal", key: import.meta.env.VITE_POSTHOG_KEY, version: APP_VERSION, platform: "desktop" });
 *   identify(user.sub, { username: user.username });   // PoliberryConnect sub when the app has one
 *   log("warn", "voice reconnect", { attempt: 3 });
 */
import posthog from "posthog-js";

export type AppId = "crystal" | "poligame" | "pulse" | "mylearn" | "selfserve" | "techhub" | "access" | "mypoliberry" | "connect" | "axiom";
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface TelemetryOptions {
  app: AppId;
  key: string;
  host?: string;
  version?: string;
  platform?: "web" | "desktop" | "mobile";
  environment?: "production" | "staging" | "development";
  /** Session replay; off by default in internal tools that show personal data. */
  replay?: boolean;
  /** Logs below this level are dropped client-side (default `info`). */
  minLogLevel?: LogLevel;
  /** Automatic click capture (default on). Turn it off in apps that handle credentials. */
  autocapture?: boolean;
}

const LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];
let minLevel: LogLevel = "info";
let ready = false;

/** Cuts the query string and fragment from every URL-valued property, in place. */
function stripUrls(props: Record<string, unknown> | undefined) {
  if (!props) return;
  for (const [k, v] of Object.entries(props)) {
    if (typeof v === "string" && /(url|referrer)$/i.test(k)) props[k] = v.replace(/[?#].*$/, "");
  }
}

export function initTelemetry(o: TelemetryOptions) {
  if (ready || !o.key || typeof window === "undefined") return;
  minLevel = o.minLogLevel ?? "info";
  posthog.init(o.key, {
    api_host: o.host ?? "https://us.i.posthog.com",
    person_profiles: "identified_only",
    capture_pageview: "history_change",
    // Caught below instead: PostHog's own catcher is a script it downloads at runtime.
    capture_exceptions: false,
    disable_external_dependency_loading: true,
    disable_surveys: true,
    // No app uses feature flags, and that request sends the full entry URL without passing before_send.
    advanced_disable_flags: true,
    disable_session_recording: !o.replay,
    autocapture: o.autocapture ?? true,
    mask_all_text: true, // neither clicks nor replays (when on) carry what's on screen
    mask_all_element_attributes: true,
    before_send: (event) => {
      if (event) {
        stripUrls(event.properties);
        stripUrls(event.$set);
        stripUrls(event.$set_once);
      }
      return event;
    },
    persistence: "localStorage+cookie",
    loaded: (ph) => {
      if (o.environment === "development") ph.debug(false);
    },
  });
  posthog.register({
    app: o.app,
    app_version: o.version ?? "unknown",
    platform: o.platform ?? "web",
    environment: o.environment ?? "production",
  });
  ready = true;
  // Uncaught errors and unhandled promise rejections, into PostHog error tracking.
  window.addEventListener("error", (e) => {
    if (e.error) posthog.captureException(e.error, { mechanism: "onerror" });
    else if (e.message) posthog.captureException(new Error(e.message), { mechanism: "onerror", source: e.filename });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    posthog.captureException(r instanceof Error ? r : new Error(typeof r === "string" ? r : JSON.stringify(r) ?? "Unhandled rejection"), { mechanism: "onunhandledrejection" });
  });
}

/** Ties events to the PoliberryConnect (or app) user id. Call on sign-in. */
export function identify(distinctId: string, props?: Record<string, unknown>) {
  if (ready) posthog.identify(distinctId, props);
}

/** Call on sign-out so the next user on the machine starts clean. */
export function resetIdentity() {
  if (ready) posthog.reset();
}

export function track(event: string, props?: Record<string, unknown>) {
  if (ready) posthog.capture(event, props);
}

/** Structured log line. Shows in Axiom's Log Stream (event name `log`). */
export function log(level: LogLevel, message: string, props?: Record<string, unknown> & { logger?: string }) {
  if (!ready || LEVELS.indexOf(level) < LEVELS.indexOf(minLevel)) return;
  posthog.capture("log", { level, message: message.slice(0, 2000), ...props });
}

/** Reports a caught error to PostHog error tracking. */
export function captureError(error: unknown, props?: Record<string, unknown>) {
  if (ready) posthog.captureException(error instanceof Error ? error : new Error(String(error)), props);
}

export { posthog };
