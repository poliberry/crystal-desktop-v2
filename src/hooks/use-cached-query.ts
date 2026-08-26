"use client";

import { useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useEffect } from "react";

import { readCache, writeCache } from "@/lib/persistent-cache";

/**
 * `useQuery`, but the last known answer stands in until the live one arrives.
 *
 * Convex keeps queries warm for as long as the window lives, so this changes
 * nothing once the app is running — `data` is defined on the first render and
 * the cache is only ever written to. It matters on a cold start, where every
 * `useQuery` in the tree is `undefined` until the websocket connects and the
 * whole app renders as empty shells for the duration.
 *
 * The value returned is still `undefined` on a genuine miss, so callers keep
 * their existing "haven't loaded yet" branch and nothing has to distinguish
 * cached data from live data. That's deliberate: a cached value is a real
 * previous answer to this exact query, and treating it as second-class would
 * mean every call site growing a state it doesn't need.
 */
export function useCachedQuery<Query extends FunctionReference<"query">>(
  query: Query,
  args: Query["_args"] | "skip",
  cacheKey: string | null
): Query["_returnType"] | undefined {
  const live = useQuery(query, args);

  useEffect(() => {
    if (cacheKey && live !== undefined) writeCache(cacheKey, live);
  }, [cacheKey, live]);

  if (live !== undefined) return live;
  if (args === "skip" || !cacheKey) return undefined;
  return readCache<Query["_returnType"]>(cacheKey);
}
