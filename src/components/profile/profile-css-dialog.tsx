"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";

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
import {
  PROFILE_CSS_SELECTOR_GROUPS,
  PROFILE_CSS_SNIPPET_GROUPS,
} from "@/lib/css-snippets";
import { MAX_PROFILE_CSS_LENGTH } from "@/lib/scoped-css";
import type { ProfileScope } from "@/hooks/use-profile-scope";

/**
 * A stylesheet for your own profile card.
 *
 * The same editor as the app-wide one next door, with two differences that
 * both follow from who the CSS runs for. This one is rendered in *other
 * people's* clients, so it's confined to the card (see `scopeCss`) — which
 * means the reference panel lists only the parts of a card, because a selector
 * for the sidebar would never match and offering one would be an invitation to
 * write a rule and wonder why nothing happened.
 *
 * And there's no live preview toggle: the card behind this dialog is the
 * preview, and it updates on save.
 */
export function ProfileCssDialog({
  open,
  onOpenChange,
  scope,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: ProfileScope;
}) {
  const stored = scope.values?.profileCss ?? "";
  const [draft, setDraft] = useState(stored);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<EditorHandle | null>(null);

  // Seeded when the dialog opens. Following `stored` continuously would fight
  // the typing, since saving updates it.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (open && !seeded) {
      setSeeded(true);
      setDraft(stored);
      setSaved(false);
      setError(null);
    }
    if (!open && seeded) setSeeded(false);
  }, [open, seeded, stored]);

  const dirty = draft !== stored;
  const overLength = draft.length > MAX_PROFILE_CSS_LENGTH;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(88vh,720px)] w-[min(94vw,980px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="border-b border-border/40 px-5 py-4">
          <DialogTitle>Profile CSS</DialogTitle>
          <DialogDescription>
            Styles for your profile card, seen by everyone who opens it. They
            can only reach the card — nothing here can change anybody else&apos;s
            app.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[1fr_260px] gap-3 p-4">
          <div className="flex min-h-0 flex-col gap-2">
            <CssEditor
              value={draft}
              handleRef={editorRef}
              onChange={(next) => {
                setDraft(next);
                setSaved(false);
              }}
            />
            <div className="flex items-center gap-2">
              <Button
                disabled={!dirty || saving || overLength}
                onClick={async () => {
                  setSaving(true);
                  setError(null);
                  try {
                    await scope.setCss(draft);
                    setSaved(true);
                  } catch (err) {
                    setError(
                      err instanceof Error ? err.message : "Couldn't save that.",
                    );
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : "Save"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!dirty}
                onClick={() => setDraft(stored)}
              >
                <RotateCcw className="size-4" />
                Revert
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <span
                className={
                  overLength
                    ? "ml-auto text-xs text-destructive"
                    : "ml-auto text-xs text-muted-foreground"
                }
              >
                {draft.length}/{MAX_PROFILE_CSS_LENGTH}
              </span>
              {saved && !dirty && (
                <span className="text-xs text-muted-foreground">Saved.</span>
              )}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <div className="min-h-0 border-l border-border/40 pl-3">
            <CssReferencePanel
              snippetGroups={PROFILE_CSS_SNIPPET_GROUPS}
              selectorGroups={PROFILE_CSS_SELECTOR_GROUPS}
              onInsert={(code) => {
                setSaved(false);
                editorRef.current?.insert(code);
              }}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
