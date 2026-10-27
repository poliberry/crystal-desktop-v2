import type { Project } from "@/studio/model/types";

/** Whether a project's editor holds state that is lost if it is unmounted: a code project's open files and running terminals. */
export const holdsLiveState = (p: Pick<Project, "kind">): boolean => p.kind === "extension" || p.kind === "bot";

/**
 * The editors Studio keeps mounted: the active project's, and every other open project whose editor holds live state.
 *
 * A code project's terminals are real shells that are killed when the terminal unmounts, and its unsaved files exist
 * only in the editor, so switching to another tab (or to Explore) must hide its editor, not remove it. The designs
 * (canvas, timeline, packs) keep their state in the project and in a history that outlives the editor, so they are
 * unmounted as before and cost nothing while they are not on screen.
 */
export function editorsToMount<T extends Pick<Project, "id" | "kind">>(openTabs: T[], activeId: string | null): T[] {
  return openTabs.filter((p) => p.id === activeId || holdsLiveState(p));
}
