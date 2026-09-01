"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { SettingsShell } from "@/components/settings/settings-shell";

const SettingsDialogContext = createContext<(() => void) | null>(null);

/**
 * Makes Settings reachable from anywhere, as a dialog.
 *
 * It used to be a second Electron `BrowserWindow` on `/settings` for desktop
 * builds and a dialog only on the web, which meant two shells to keep in step:
 * a window has its own document, its own providers and its own copy of every
 * subscription, and anything the main window knew — an open call, the profile
 * being edited — had to be re-derived there or passed over IPC. The dialog is
 * the whole story now, on both platforms.
 */
export function SettingsDialogProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const openSettings = useCallback(() => setOpen(true), []);

  return (
    <SettingsDialogContext.Provider value={openSettings}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        {/* Wider than the old window (which was 840x600) because the profile
            editor inside is three panes across. `p-0` because the shell draws
            its own chrome down to the titlebar row. */}
        <DialogContent
          className="min-h-[calc(100vh-40px)] mt-5.25 min-w-full gap-0 rounded-none overflow-hidden p-0"
        >
          <SettingsShell onRequestClose={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </SettingsDialogContext.Provider>
  );
}

/**
 * Opens Settings.
 *
 * Falls back to a no-op outside the provider rather than to the old desktop
 * IPC call: there is no window to open any more, and a click that silently did
 * nothing was the bug this whole context exists to have fixed.
 */
export function useOpenSettings(): () => void {
  const openSettings = useContext(SettingsDialogContext);
  return useMemo(() => openSettings ?? (() => {}), [openSettings]);
}
