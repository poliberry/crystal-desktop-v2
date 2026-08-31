"use client";

import { Loader2 } from "lucide-react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import type { Id } from "../../../convex/_generated/dataModel";
import {
  DecorationEditor,
  ProfileFrameEditor,
} from "@/components/profile/cosmetic-dialogs";
import { WindowControls } from "@/components/window-controls";
import { useProfileScope } from "@/hooks/use-profile-scope";

/**
 * The canvas editor, popped out of its dialog into a window of its own — see
 * `PopOutButton` in cosmetic-dialogs.tsx, which is the only thing that opens
 * this.
 *
 * There is no IPC channel carrying a profile in: this is the same React tree
 * as the main window's, so it queries Convex itself, the same way the
 * dialog it replaces did. `useProfileScope` is what a dialog would have
 * called too — `scope`/`scopeName` in the query string are the only things
 * that had to cross the window boundary, because nothing else says *which*
 * profile this is.
 */
function EditorWindow() {
  const params = useSearchParams();
  const kind = params.get("kind") === "decoration" ? "decoration" : "frame";
  const scopeId = (params.get("scope") as Id<"communities"> | null) ?? undefined;
  const scopeName = params.get("scopeName") ?? undefined;

  const scope = useProfileScope(scopeId, scopeName);
  const values = scope.values;

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        className="flex h-9 shrink-0 items-center justify-between border-b border-border/50 pl-3"
      >
        <span className="truncate text-xs text-muted-foreground">
          {kind === "frame" ? "Profile frame" : "Avatar decoration"} — {scope.label}
        </span>
        <WindowControls />
      </header>

      {!values ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : kind === "frame" ? (
        <ProfileFrameEditor className="min-h-0 flex-1 p-3" scope={scope} />
      ) : (
        <DecorationEditor
          className="min-h-0 flex-1 p-3"
          imageUrl={values.imageUrl}
          name={values.name}
          current={values.avatarDecoration}
          scope={scope}
        />
      )}
    </div>
  );
}

export default function EditorPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center bg-background text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      }
    >
      <EditorWindow />
    </Suspense>
  );
}
