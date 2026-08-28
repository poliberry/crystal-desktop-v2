"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { ProfileEditor } from "@/components/profile/profile-editor";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * The profile editor, as a dialog of its own.
 *
 * Not a Settings tab: the editor is three panes wide and is opened to *do* one
 * thing, whereas Settings is a list of preferences you dip into. Sharing the
 * Settings frame would have meant either squeezing the editor into a column or
 * widening every other tab to fit it.
 *
 * Everything factual about the account — username, date of birth — lives in
 * Settings → Account instead. The split is by what the thing is, not where it
 * happens to be edited: this dialog is for what your profile looks like.
 */

const ProfileEditorContext = createContext<(() => void) | null>(null);

export function ProfileEditorProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const openEditor = useCallback(() => setOpen(true), []);

  return (
    <ProfileEditorContext.Provider value={openEditor}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="h-[min(90vh,760px)] w-[min(96vw,1240px)] gap-0 overflow-hidden p-0 sm:max-w-none"
          // The rail's first control would otherwise be focused and outlined
          // on open, which reads as having clicked it.
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogTitle className="sr-only">Edit profile</DialogTitle>
          <DialogDescription className="sr-only">
            Your avatar, banner, decorations, effects and profile board.
          </DialogDescription>
          <ProfileEditor onRequestClose={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </ProfileEditorContext.Provider>
  );
}

/** Opens the profile editor. A no-op outside the provider — the pop-out
 * window mounts neither. */
export function useOpenProfileEditor(): () => void {
  const open = useContext(ProfileEditorContext);
  return useMemo(() => open ?? (() => {}), [open]);
}
