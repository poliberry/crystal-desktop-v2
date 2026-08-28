"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FolderOpen, Loader2, Plus, RotateCcw } from "lucide-react";

import { useCustomCss } from "@/components/custom-css-provider";
import {
  CssEditor,
  CssReferencePanel,
  type EditorHandle,
} from "@/components/settings/css-editor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CSS_SELECTOR_GROUPS, CSS_SNIPPET_GROUPS } from "@/lib/css-snippets";
import { Switch } from "@/components/ui/switch";

/**
 * The custom-CSS editor.
 *
 * A real editor rather than a bare `<textarea>`, built the way editors were
 * before anyone shipped a megabyte of one: a transparent textarea sits exactly
 * on top of a highlighted `<pre>`, and the two are kept in perfect alignment by
 * using the same font metrics, padding and scroll offset. The textarea is what
 * has focus, a caret and a selection — all the parts that are miserable to
 * reimplement — while the `<pre>` underneath supplies the colour.
 *
 * That buys syntax highlighting, line numbers, bracket-aware indentation and
 * live preview without adding an editor dependency to a desktop app that is
 * already shipping a browser.
 */

const CustomCssContext = createContext<(() => void) | null>(null);

const STARTER = `/* Crystal — custom styles
 *
 * These rules are applied last, so they win ties against the app's own.
 * Inspect an element to find something to target.
 */

/* Example: soften every card
.bg-card {
  backdrop-filter: blur(6px);
}
*/
`;

function CustomCssBody({ onClose }: { onClose: () => void }) {
  const { css, enabled, filePath, save, preview, setEnabled, reveal } = useCustomCss();
  const [draft, setDraft] = useState(css);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const editorRef = useRef<EditorHandle | null>(null);

  // Seeded once per open. The provider's `css` also changes as we preview, so
  // following it here would fight the user's typing.
  useEffect(() => {
    setDraft(css || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Applied as you type, debounced.
   *
   * Live preview is the point — CSS is written by trying things — but applying
   * on every keystroke means the app restyles mid-selector, which flashes.
   * A short delay lands after a pause without ever feeling like a wait.
   */
  useEffect(() => {
    const timer = setTimeout(() => preview(draft), 250);
    return () => clearTimeout(timer);
  }, [draft, preview]);

  const dirty = draft !== css;

  return (
    <>
      <DialogHeader className="border-b border-border/40 px-5 py-4">
        <DialogTitle>Custom CSS</DialogTitle>
        <DialogDescription>
          Applied to the whole app, live as you type.{" "}
          {filePath
            ? "Saved to a file on this machine, so you can also edit it outside Crystal."
            : "Saved in this browser."}
        </DialogDescription>
      </DialogHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch id="css-enabled" checked={enabled} onCheckedChange={setEnabled} />
            <Label htmlFor="css-enabled" className="font-normal">
              Apply my styles
            </Label>
          </div>
          {!enabled && (
            <span className="text-xs text-muted-foreground">
              Turned off — the editor still works, nothing is applied.
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            {!draft.trim() && (
              <Button size="sm" variant="ghost" onClick={() => setDraft(STARTER)}>
                Insert starter
              </Button>
            )}
            {filePath && (
              <Button size="sm" variant="ghost" onClick={reveal} title={filePath}>
                <FolderOpen className="size-4" />
                Show file
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={!dirty}
              onClick={() => {
                setDraft(css);
                preview(css);
              }}
            >
              <RotateCcw className="size-4" />
              Revert
            </Button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[1fr_240px] gap-3">
          <CssEditor
            value={draft}
            handleRef={editorRef}
            onChange={(next) => {
              setDraft(next);
              setSaved(false);
            }}
          />
          <div className="min-h-0 border-l border-border/40 pl-3">
            <CssReferencePanel
              snippetGroups={CSS_SNIPPET_GROUPS}
              selectorGroups={CSS_SELECTOR_GROUPS}
              onInsert={(code) => {
                setSaved(false);
                // Through the editor's handle rather than by appending, so a
                // snippet lands where the cursor is.
                editorRef.current?.insert(code);
              }}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            disabled={!dirty || saving}
            onClick={async () => {
              setSaving(true);
              try {
                await save(draft);
                setSaved(true);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : "Save"}
          </Button>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {saved && !dirty && (
            <span className="text-xs text-muted-foreground">Saved.</span>
          )}
          {dirty && (
            <span className="text-xs text-muted-foreground">
              Previewing unsaved changes.
            </span>
          )}
        </div>
      </div>
    </>
  );
}

export function CustomCssProviderDialog({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const openEditor = useCallback(() => setOpen(true), []);

  return (
    <CustomCssContext.Provider value={openEditor}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[min(88vh,760px)] w-[min(94vw,980px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
          <CustomCssBody onClose={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </CustomCssContext.Provider>
  );
}

/** Opens the custom-CSS editor. */
export function useOpenCustomCss(): () => void {
  const open = useContext(CustomCssContext);
  return useMemo(() => open ?? (() => {}), [open]);
}
