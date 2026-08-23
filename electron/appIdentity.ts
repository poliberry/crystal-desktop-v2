import { app } from "electron";
import * as path from "node:path";

import type { ChannelDefinition } from "./channels";

/**
 * Make a channel its own application as far as the OS is concerned.
 *
 * Every channel used to share Stable's identity, and that made the side
 * channels unusable rather than merely untidy:
 *
 *  - `app.getName()` came from the packaged package.json, which is the same
 *    for every channel, so they all resolved the *same* userData directory —
 *    one Chromium session, one set of preferences, and one single-instance
 *    lock between them. `requestSingleInstanceLock()` in a Canary launched
 *    while Stable was running therefore failed: Canary handed the command line
 *    to the *Stable* process (which focused its own window) and quit. From the
 *    outside that looks exactly like "Canary opens Crystal, then closes".
 *  - The App User Model ID was hardcoded to Stable's appId, so Windows filed
 *    every channel's toasts and taskbar buttons under Crystal.
 *
 * Stable is deliberately left alone. Its data directory is wherever existing
 * installs already keep it, and pointing it somewhere new would silently log
 * everyone out and lose their local settings. The side channels have no such
 * history — the builds that would have had one couldn't start.
 */
export function applyChannelIdentity(channel: ChannelDefinition): void {
  if (channel.id !== "stable") {
    // Sets the userData directory too (Electron derives it from the app name),
    // but only for paths not yet resolved — so this has to run before anything
    // touches app paths, and `setPath` is passed explicitly rather than left
    // to that ordering.
    app.setName(channel.productName);
    app.setPath("userData", path.join(app.getPath("appData"), channel.productName));
  }

  // Windows requires the App User Model ID to be set before the app is ready
  // for OS toast notifications to be supported (Notification.isSupported()).
  if (process.platform === "win32") {
    app.setAppUserModelId(channel.appId);
  }
}
