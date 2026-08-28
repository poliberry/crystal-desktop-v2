"use client";

import { ProfileEditor } from "@/components/profile/profile-editor";

/**
 * Settings → Profile.
 *
 * The whole tab is the profile editor, which owns its own three-pane layout
 * (see `ProfileEditor`) and wants the full height of the panel rather than the
 * padded, scrolling column every other tab sits in — hence `SettingsShell`
 * rendering this one full-bleed.
 *
 * The old form that lived here — a stack of labelled fields and upload
 * buttons — is gone rather than kept alongside: every field it edited is
 * reachable from the rail or the details panel, and two editors writing the
 * same profile is how they end up disagreeing.
 */
export function ProfileTab() {
  return <ProfileEditor />;
}
