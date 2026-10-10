"use client";

import { CosmeticMedia } from "@/components/motion/cosmetic-media";
import {
  Accessibility,
  Bell,
  ChevronDown,
  Code2,
  CreditCard,
  Download,
  Gem,
  Info,
  KeyRound,
  LogOut,
  Mic,
  Palette,
  Server,
  Puzzle,
  Wallet,
  ShieldCheck,
  User,
} from "lucide-react";

import { useOpenCustomCss } from "@/components/settings/custom-css-dialog";
import { useOpenProfileEditor } from "@/components/pages/page-context";

import { PresenceBadge } from "@/components/presence-dot";
import { presenceHeadline, topActivity } from "@/components/rich-presence-card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AboutTab } from "@/components/settings/tabs/about-tab";
import { AccessibilityTab } from "@/components/settings/tabs/accessibility-tab";
import { AccountTab } from "@/components/settings/tabs/account-tab";
import { BillingTab } from "@/components/settings/tabs/billing-tab";
import { CreatorTab } from "@/components/settings/tabs/creator-tab";
import { ExtensionsTab } from "@/components/settings/tabs/extensions-tab";
import { SubscriptionsTab } from "@/components/settings/tabs/subscriptions-tab";
import { AppearanceTab } from "@/components/settings/tabs/appearance-tab";
import { NotificationsTab } from "@/components/settings/tabs/notifications-tab";
import { ServerProfilesTab } from "@/components/settings/tabs/server-profiles-tab";
import { UpdatesTab } from "@/components/settings/tabs/updates-tab";
import { VoiceVideoTab } from "@/components/settings/tabs/voice-video-tab";
import { WindowControls } from "@/components/window-controls";
import { SignOutButton, useAuth } from "@clerk/react";
import { Button } from "../ui/button";
import { PageSidebar } from "@/components/pages/page-sidebar";
import { SETTINGS_NAV_BUTTON, SectionTransition, SettingsPageLayout } from "@/components/settings/settings-ui";
import { cn } from "@/lib/utils";
import { getDesktopAPI } from "@/lib/desktop";
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import {
  STATUS_LABEL,
  type FriendStatus,
  type ManualStatus,
} from "@/lib/presence";
import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from "../ui/avatar";
import { useMyPresence } from "@/hooks/use-presence";
import { useEffect, useState } from "react";
import { onPageSection, takePageSection } from "@/lib/page-intent";

/** A row that opens something instead of switching the panel. The profile
 * editor is three panes wide and belongs in its own dialog, but this is still
 * where people come looking for it. */
type NavChild = {
  value: string;
  label: string;
  icon: typeof User;
  opens?: "profile-editor" | "custom-css";
};

const NAVIGATION: { label: string; children: NavChild[] }[] = [
  {
    label: "General",
    children: [
      { value: "profile", label: "Edit Profile", icon: User, opens: "profile-editor" },
      { value: "account", label: "Account", icon: KeyRound },
      { value: "updates", label: "Updates", icon: Download },
    ],
  },
  {
    label: "Billing",
    children: [
      { value: "billing", label: "Billing", icon: CreditCard },
      { value: "subscriptions", label: "Subscriptions", icon: Gem },
      { value: "creator", label: "Creator", icon: Wallet },
    ],
  },
  {
    label: "Customisation",
    children: [
      { value: "appearance", label: "Appearance", icon: Palette },
      { value: "accessibility", label: "Accessibility", icon: Accessibility },
      { value: "servers", label: "Server Profiles", icon: Server },
      { value: "extensions", label: "Extensions", icon: Puzzle },
      { value: "custom-css", label: "Custom CSS", icon: Code2, opens: "custom-css" },
    ],
  },
  {
    label: "App settings",
    children: [
      { value: "voice", label: "Voice & Video", icon: Mic },
      { value: "notifications", label: "Notifications", icon: Bell },
    ],
  },
];

/** The menu from top to bottom, which is what decides which way a change of
 * section slides. */
const SECTION_ORDER = [...NAVIGATION.flatMap((group) => group.children.map((c) => c.value)), "about"];

/** What each section is called at the top of its page, and what it is for. */
const SECTION_META: Record<string, { title: string; description: string }> = {
  account: { title: "Account", description: "Your sign-in, username and personal details." },
  updates: { title: "Updates", description: "Keep Crystal up to date." },
  billing: { title: "Billing", description: "Payment methods, receipts and help with a payment." },
  subscriptions: { title: "Subscriptions", description: "Your Crystal plan and anything else that renews." },
  extensions: { title: "Extensions", description: "Add-ons written by others, running in a sandbox with only the powers you give them." },
  creator: { title: "Creator", description: "Get paid for what you sell in the shop, and see what you've earned." },
  appearance: { title: "Appearance", description: "Themes, colour and how the app is laid out." },
  accessibility: { title: "Accessibility", description: "Make the app easier to see and use." },
  servers: { title: "Server profiles", description: "How you appear in each community." },
  voice: { title: "Voice & video", description: "Devices, processing and call behaviour." },
  notifications: { title: "Notifications", description: "What gets your attention, and how." },
  about: { title: "About", description: "Version and runtime information." },
};

/**
 * One section's scrolling panel.
 *
 * A scroller per section rather than one shared by all of them. Sharing one
 * meant sharing a scroll offset: leaving Voice & Video halfway down and
 * opening About put you halfway down a page with three lines on it, and coming
 * back landed you somewhere arbitrary. Each section now has its own, and opens
 * at the top.
 */
function SettingsSection({
  section,
  children,
}: {
  section: string;
  children: React.ReactNode;
}) {
  return (
    // `key`: a new scroller per section, so one never inherits another's
    // offset. `min-h-0 flex-1` inside a flex column is what gives it a
    // definite height to overflow against — the pattern used by every other
    // scrolling panel in the app. A percentage height here does not work:
    // Radix's viewport is `height: 100%` of this root, and if this root's own
    // height resolves to `auto` the viewport grows with the content instead
    // of scrolling it, and `main`'s `overflow-hidden` quietly clips the rest.
    <ScrollArea key={section} horizontal className="min-h-0 w-full flex-1 [&>[data-slot=scroll-area-viewport]>div]:!block">
      {children}
    </ScrollArea>
  );
}

/**
 * @param onRequestClose How to dismiss whatever is hosting this. Omitted when
 *   the host is a window of its own (the Electron Settings window), where
 *   closing the window is the same thing as closing the browser tab.
 */
export function SettingsShell({
  onRequestClose,
}: {
  onRequestClose?: () => void;
  }) {
  const me = useQuery(api.users.getCurrentUser);
  const staff = useQuery(api.staff.me);
  const { status, manualStatus, activities } = useMyPresence();
  const openProfileEditor = useOpenProfileEditor();
  const openCustomCss = useOpenCustomCss();
  // Account rather than profile: the profile editor is a page of its own now,
  // so opening Settings can't land on it.
  const [section, setSection] = useState(() => {
    const asked = takePageSection("settings");
    return asked && SECTION_ORDER.includes(asked) ? asked : "account";
  });

  // Someone asked for a section while Settings was already open.
  useEffect(
    () =>
      onPageSection("settings", (asked) => {
        if (SECTION_ORDER.includes(asked)) setSection(asked);
      }),
    [],
  );

  // Both halves on one line, as everywhere else — see `presenceHeadline`.
  const subtitle =
    presenceHeadline(me?.customStatus, topActivity(activities)) ?? STATUS_LABEL[status];

  return (
    <div className="settings-surface flex h-full flex-col">
      {/* The menu lives in the unified sidebar while this page is open — see
          `PageSidebar`. */}
      <PageSidebar>
          <SidebarHeader className="pt-3">
            <SidebarMenu>
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <div
                      className={`rounded-lg overflow-hidden border border-border/40 bg-card/80 shadow-md`}
                    >
                      <div className="relative flex items-center gap-2 px-3 py-2.5">
                        {me?.nameplateUrl && (
                          <CosmeticMedia
                            src={me.nameplateUrl}
                            className="fade-mask-l pointer-events-none absolute inset-0 h-full w-full object-cover opacity-20"
                          />
                        )}
                        <Avatar size="sm" className="shrink-0 cursor-pointer">
                          <AvatarImage src={me?.imageUrl} alt={me?.name} />
                          <AvatarFallback>
                            {me?.name.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                          <PresenceBadge
                            status={status}
                            activities={activities}
                            accent={me?.borderGradientStart}
                          />
                        </Avatar>

                        <button
                          type="button"
                          className="group/name min-w-0 cursor-pointer flex-1 rounded-md px-1 py-0.5 text-left hover:bg-black/10"
                        >
                          <p className="truncate text-sm font-semibold flex flex-row items-center gap-1">
                            {me?.name} <ChevronDown size={12} />
                          </p>
                          <div className="relative h-4 overflow-hidden">
                            <p className="absolute inset-0 flex items-center gap-1 truncate text-xs text-muted-foreground transition-all duration-200 group-hover/name:translate-y-full group-hover/name:opacity-0">
                              <span className="truncate">{subtitle}</span>
                            </p>
                            <p className="absolute inset-0 -translate-y-full truncate text-xs text-muted-foreground opacity-0 transition-all duration-200 group-hover/name:translate-y-0 group-hover/name:opacity-100">
                              @{me?.username}
                            </p>
                          </div>
                        </button>
                      </div>
                    </div>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <SignOutButton>
                      <DropdownMenuItem
                        className="text-destructive"
                        // Signing out should leave Settings behind either way;
                        // `window.close()` only does that when this owns the
                        // window, and is a no-op in a browser tab.
                        onClick={() =>
                          onRequestClose ? onRequestClose() : window.close()
                        }
                      >
                        <LogOut />
                        <span>Log out</span>
                      </DropdownMenuItem>
                    </SignOutButton>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
          <SidebarContent>
            {staff && (
              <SidebarGroup>
                <SidebarGroupLabel>Staff</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        className={cn("flex flex-row items-center gap-2", SETTINGS_NAV_BUTTON)}
                        onClick={() => void getDesktopAPI()?.admin?.open?.()}
                      >
                        <ShieldCheck />
                        Administration console
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}
            {NAVIGATION.map((NAV_ITEM, NAV_ITEM_INDEX) => (
              <SidebarGroup key={NAV_ITEM_INDEX}>
                <SidebarGroupLabel>{NAV_ITEM.label}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {NAV_ITEM.children.map(
                      (NAV_CHILD_ITEM, NAV_CHILD_ITEM_INDEX) => (
                        <SidebarMenuItem
                          key={NAV_CHILD_ITEM_INDEX}
                          onClick={() => {
                            if (NAV_CHILD_ITEM.opens === "profile-editor") {
                              openProfileEditor();
                              return;
                            }
                            if (NAV_CHILD_ITEM.opens === "custom-css") {
                              openCustomCss();
                              return;
                            }
                            setSection(NAV_CHILD_ITEM.value);
                          }}
                        >
                          <SidebarMenuButton
                            // A row that opens a dialog is never the panel's
                            // current section, so it never reads as selected.
                            isActive={
                              !NAV_CHILD_ITEM.opens &&
                              section === NAV_CHILD_ITEM.value
                            }
                            className={cn("flex flex-row gap-2 items-center", SETTINGS_NAV_BUTTON)}
                          >
                            <NAV_CHILD_ITEM.icon />
                            {NAV_CHILD_ITEM.label}
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ),
                    )}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </SidebarContent>
      </PageSidebar>
        {/* A flex column with a definite height, so the scroller inside can
            take `flex-1` and become shorter than its contents. Without the
            column — or without `min-h-0`, which lets a flex child shrink below
            its content — the panel grows to fit and `overflow-hidden` clips
            the overflow with no way to reach it. */}
        <main className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
          {/* A scroller per section rather than one around all of them: see
              `SettingsSection`. */}
          <SectionTransition sectionKey={section} index={SECTION_ORDER.indexOf(section)}>
          <SettingsSection section={section}>
            <SettingsPageLayout
              title={SECTION_META[section]?.title ?? section}
              description={SECTION_META[section]?.description}
            >
              {section === "appearance" && <AppearanceTab />}
              {section === "accessibility" && <AccessibilityTab />}
              {section === "servers" && <ServerProfilesTab />}
              {section === "account" && <AccountTab />}
              {section === "billing" && <BillingTab />}
              {section === "subscriptions" && <SubscriptionsTab />}
              {section === "creator" && <CreatorTab />}
              {section === "extensions" && <ExtensionsTab />}
              {section === "voice" && <VoiceVideoTab />}
              {section === "notifications" && <NotificationsTab />}
              {section === "updates" && <UpdatesTab />}
              {section === "about" && <AboutTab />}
            </SettingsPageLayout>
          </SettingsSection>
          </SectionTransition>
        </main>
    </div>
  );
}
