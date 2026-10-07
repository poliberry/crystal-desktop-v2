"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";

/**
 * One save bar for a whole settings page.
 *
 * A page's tabs used to save as they went — a switch flipped, a field blurred,
 * a button per card — so what was saved and what wasn't was anyone's guess and
 * every tab had its own idea of how to say so. Here each tab keeps its edits as
 * a draft and says how many there are; the page shows one bar for whichever tab
 * is open, and Save writes the lot. The community overview and the profile
 * editor work the same way.
 *
 * A tab registers with {@link useSettingsDraft}; the page puts a
 * {@link SettingsSaveProvider} around its tabs and a {@link SettingsSaveBar}
 * where the bar should float.
 */

export interface SettingsDraft {
  /** How many things have been changed. Zero hides the bar. */
  changes: number;
  /** Write them. Throwing keeps the draft and puts the message on the bar. */
  save: () => Promise<void>;
  /** Throw the edits away, back to what is stored. */
  discard: () => void;
}

interface SaveState {
  changes: number;
  saving: boolean;
  saved: boolean;
  error: string | null;
  save: () => void;
  discard: () => void;
  /** Whether the tab may be left: true when nothing is unsaved, or the user
   * agrees to lose it (which also discards it). */
  confirmLeave: () => boolean;
  /** For `useSettingsDraft`. */
  register: (draft: SettingsDraft | null) => void;
}

const SaveContext = createContext<SaveState | null>(null);

/** How long "Saved" stays on the bar after a save. */
const SAVED_FLASH_MS = 1800;

export function SettingsSaveProvider({ children }: { children: React.ReactNode }) {
  const draft = useRef<SettingsDraft | null>(null);
  const [changes, setChanges] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flash = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(flash.current), []);

  const register = useCallback((next: SettingsDraft | null) => {
    draft.current = next;
    setChanges(next?.changes ?? 0);
    // A tab with nothing to say has no error to show either.
    if (!next || next.changes === 0) setError(null);
  }, []);

  const save = useCallback(() => {
    const current = draft.current;
    if (!current || current.changes === 0) return;
    setSaving(true);
    setError(null);
    current
      .save()
      .then(() => {
        setSaved(true);
        window.clearTimeout(flash.current);
        flash.current = window.setTimeout(() => setSaved(false), SAVED_FLASH_MS);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Couldn't save those changes.");
      })
      .finally(() => setSaving(false));
  }, []);

  const discard = useCallback(() => {
    draft.current?.discard();
    setError(null);
  }, []);

  const confirmLeave = useCallback(() => {
    const current = draft.current;
    if (!current || current.changes === 0) return true;
    if (!window.confirm("Discard your unsaved changes?")) return false;
    current.discard();
    return true;
  }, []);

  const value = useMemo<SaveState>(
    () => ({ changes, saving, saved, error, save, discard, confirmLeave, register }),
    [changes, saving, saved, error, save, discard, confirmLeave, register],
  );

  return <SaveContext.Provider value={value}>{children}</SaveContext.Provider>;
}

function useSaveState(): SaveState {
  const ctx = useContext(SaveContext);
  if (!ctx) throw new Error("Settings save controls need a SettingsSaveProvider.");
  return ctx;
}

/** For the page: ask before moving off a tab that has unsaved edits. */
export function useConfirmLeave(): () => boolean {
  return useSaveState().confirmLeave;
}

/**
 * For a tab: report this tab's edits to the page's bar.
 *
 * Call it every render with the current draft. What the bar calls is always the
 * latest `save` and `discard` — closures over this render's state — while the
 * bar itself only re-renders when the count changes. The tab's draft is
 * unregistered when it unmounts, so a tab that is switched away from leaves
 * nothing on the bar.
 */
export function useSettingsDraft(draft: SettingsDraft) {
  const { register } = useSaveState();
  const latest = useRef(draft);
  latest.current = draft;

  // Re-registered on every change of count, so the bar's number follows; the
  // functions it holds forward to `latest`, so they never go stale in between.
  useEffect(() => {
    register({
      changes: draft.changes,
      save: () => latest.current.save(),
      discard: () => latest.current.discard(),
    });
  }, [draft.changes, register]);

  useEffect(() => () => register(null), [register]);
}

/** The bar. Float it over the bottom of the page: it positions itself. */
export function SettingsSaveBar() {
  const { changes, saving, saved, error, save, discard } = useSaveState();
  const visible = changes > 0 || saved;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="settings-save-bar"
          role="status"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
          className="absolute bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-popover/95 py-2 pr-2 pl-4 shadow-xl backdrop-blur-xl"
        >
          {changes === 0 ? (
            <span className="flex items-center gap-1.5 pr-2 text-sm">
              <Check className="size-4 text-emerald-500" />
              Saved
            </span>
          ) : (
            <>
              <span className="text-sm">
                {error ? (
                  <span className="text-destructive">{error}</span>
                ) : changes === 1 ? (
                  "1 unsaved change"
                ) : (
                  `${changes} unsaved changes`
                )}
              </span>
              <Button size="sm" variant="ghost" className="rounded-full" disabled={saving} onClick={discard}>
                Discard
              </Button>
              <Button size="sm" className="rounded-full" disabled={saving} onClick={save}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : "Save changes"}
              </Button>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
