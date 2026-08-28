"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { SettingsShell } from "@/components/settings/settings-shell";
import { getDesktopAPI } from "@/lib/desktop";

const SettingsDialogContext = createContext<(() => void) | null>(null);

/** Falls back to asking the desktop layer directly, which is what anything
 * mounted outside the provider gets — including the Electron Settings window,
 * whose whole document *is* the shell. */
function openDesktopSettings(): void {
  void getDesktopAPI()?.settings.open();
}

/**
 * Makes Settings reachable in both shells.
 *
 * On the desktop it's a real second window (`settings:open` → a frameless
 * BrowserWindow on /settings), which a browser has no equivalent for: the
 * call sites went through `getDesktopAPI()?.settings.open()`, so on the web
 * the optional chain swallowed the click and Settings simply never opened.
 * Here the same gesture renders the shell in a dialog instead — same
 * component, so the two stay in step by construction.
 */
export function SettingsDialogProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  const openSettings = useCallback(() => {
    // Presence of the desktop API — not the dialog — decides, so an Electron
    // build keeps its window even though this provider is mounted there too.
    if (getDesktopAPI()) {
      openDesktopSettings();
      return;
    }
    setOpen(true);
  }, []);

  return (
    <SettingsDialogContext.Provider value={openSettings}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        {/* Sized like the desktop window (840x600) but capped to the viewport.
            `p-0` because the shell draws its own chrome, right down to the
            titlebar row — WindowControls renders nothing off Electron, which
            is what leaves that row free for the dialog's own close button. */}
        <DialogContent
          className="h-[min(85vh,600px)] w-[min(94vw,840px)] gap-0 overflow-hidden p-0 sm:max-w-none"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogTitle className="sr-only">Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Your profile, appearance, devices and notification preferences.
          </DialogDescription>
          <SettingsShell onRequestClose={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </SettingsDialogContext.Provider>
  );
}

/** Opens Settings the way this shell does it — a window on the desktop, a
 * dialog on the web. */
export function useOpenSettings(): () => void {
  const openSettings = useContext(SettingsDialogContext);
  return useMemo(() => openSettings ?? openDesktopSettings, [openSettings]);
}
