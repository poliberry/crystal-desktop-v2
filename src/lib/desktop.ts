import type { DesktopAPI } from "@/types/desktop-api";

/**
 * Access to the Electron desktop layer, injected by the preload script via
 * `contextBridge`. Falls back to `undefined` when running in a plain browser
 * (e.g. `next dev` without Electron).
 */
export function getDesktopAPI(): DesktopAPI | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { desktopAPI?: DesktopAPI }).desktopAPI;
}

export function isElectron(): boolean {
  return !!getDesktopAPI()?.isElectron;
}

export function getPlatform(): string {
  return getDesktopAPI()?.platform ?? (typeof navigator !== "undefined" ? navigator.platform.toLowerCase() : "");
}
