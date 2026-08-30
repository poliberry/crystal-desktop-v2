"use client";

import { useMemo } from "react";

import {
  PROFILE_CSS_ATTRIBUTE,
  profileCssScope,
  scopeCss,
} from "@/lib/scoped-css";

/**
 * A profile's own stylesheet, confined to that profile's card.
 *
 * The difference between this and the app-wide custom CSS is who it runs for.
 * That one only ever affects the person who wrote it, so reaching anything on
 * screen is the whole feature. This one is written by one person and rendered
 * in everyone else's client — so a rule that escaped the card would be a way
 * to restyle, or hide, parts of a stranger's app by putting a selector on your
 * profile. Every rule is rewritten to sit under the card's own attribute
 * before it reaches the document (see `scopeCss`), and the at-rules that can't
 * be scoped are dropped.
 *
 * Rendered as an inline `<style>` next to the card rather than pushed into
 * `document.head`: it then lives and dies with the card, so closing a popover
 * takes its styles with it and nothing has to be cleaned up.
 */
export function ProfileCssLayer({
  css,
  scopeId,
}: {
  css?: string;
  /** Usually the user's id. Two cards for the same person share a scope, which
   * is correct — they'd have identical styles anyway. */
  scopeId: string;
}) {
  const scoped = useMemo(
    () => (css ? scopeCss(css, profileCssScope(scopeId)) : ""),
    [css, scopeId],
  );
  if (!scoped) return null;
  return <style>{scoped}</style>;
}

/** The attribute a card carries so the rules above can find it. Spread onto
 * the card's outermost element. */
export function profileCssAttributes(
  css: string | undefined,
  scopeId: string,
): Record<string, string> {
  return css ? { [PROFILE_CSS_ATTRIBUTE]: scopeId } : {};
}
