import { getDesktopAPI } from "@/lib/desktop";

/** Open Crystal Studio: its own window in the desktop app, a new tab on the web. */
export function openStudio(): void {
  const desktop = getDesktopAPI();
  if (desktop?.studio) void desktop.studio.open();
  else window.open("/studio/", "_blank", "noopener");
}
