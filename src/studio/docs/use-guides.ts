"use client";

import { useQuery } from "convex/react";
import { useMemo } from "react";

import { api } from "../../../convex/_generated/api";
import { BUILT_IN_GUIDES } from "@/studio/docs/built-in.generated";
import { mergePages, type GuidePage } from "@/studio/docs/pages";

/**
 * Every written guide as it should be shown now: the pages that ship with the app, with whatever
 * staff have saved in the Admin Console laid over them. While the saved pages load (or if they
 * can't, offline) the shipped ones are shown, so the guides are always there.
 */
export function useGuidePages(): GuidePage[] {
  const saved = useQuery(api.studioDocs.published, {});
  return useMemo(() => mergePages(BUILT_IN_GUIDES, saved ?? []), [saved]);
}
