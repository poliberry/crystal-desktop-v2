import { getDesktopAPI } from "@/lib/desktop";

/**
 * Open Crystal, the chat app. From Studio's own application that launches (or brings forward) the installed Crystal;
 * from Studio as a window of Crystal it focuses Crystal's main window; on the web it is a new tab on the site.
 */
export function openCrystal(): void {
  const desktop = getDesktopAPI();
  if (desktop?.studio?.openCrystal) void desktop.studio.openCrystal();
  else window.open("/", "_blank", "noopener");
}
