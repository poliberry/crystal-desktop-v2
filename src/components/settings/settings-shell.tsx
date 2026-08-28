"use client";

import {
  Accessibility,
  Bell,
  ChevronDown,
  Code2,
  Download,
  Info,
  KeyRound,
  LogOut,
  Mic,
  Palette,
  Server,
  User,
} from "lucide-react";

import { useOpenCustomCss } from "@/components/settings/custom-css-dialog";
import { useOpenProfileEditor } from "@/components/profile/profile-editor-dialog";

import { ActivityStatusIcon } from "@/components/rich-presence-card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AboutTab } from "@/components/settings/tabs/about-tab";
import { AccessibilityTab } from "@/components/settings/tabs/accessibility-tab";
import { AccountTab } from "@/components/settings/tabs/account-tab";
import { AppearanceTab } from "@/components/settings/tabs/appearance-tab";
import { NotificationsTab } from "@/components/settings/tabs/notifications-tab";
import { ServerProfilesTab } from "@/components/settings/tabs/server-profiles-tab";
import { UpdatesTab } from "@/components/settings/tabs/updates-tab";
import { VoiceVideoTab } from "@/components/settings/tabs/voice-video-tab";
import { WindowControls } from "@/components/window-controls";
import { SignOutButton } from "@clerk/react";
import { Button } from "../ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
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
  STATUS_DOT_CLASS,
  STATUS_LABEL,
  type FriendStatus,
  type ManualStatus,
} from "@/lib/presence";
import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from "../ui/avatar";
import { useMyPresence } from "@/hooks/use-presence";
import { useState } from "react";

const TABS = [
  { value: "appearance", label: "Appearance", icon: Palette },
  { value: "accessibility", label: "Accessibility", icon: Accessibility },
  { value: "servers", label: "Servers", icon: Server },
  { value: "account", label: "Account", icon: KeyRound },
  { value: "voice", label: "Voice & Video", icon: Mic },
  { value: "notifications", label: "Notifications", icon: Bell },
  { value: "updates", label: "Updates", icon: Download },
  { value: "about", label: "About", icon: Info },
] as const;

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
    label: "Customisation",
    children: [
      { value: "appearance", label: "Appearance", icon: Palette },
      { value: "accessibility", label: "Accessibility", icon: Accessibility },
      { value: "servers", label: "Server Profiles", icon: Server },
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
  const { status, manualStatus, activities } = useMyPresence();
  const openProfileEditor = useOpenProfileEditor();
  const openCustomCss = useOpenCustomCss();
  // Account rather than profile: the profile editor is a dialog of its own
  // now, so opening Settings can't land on it.
  const [section, setSection] = useState("account");

  const subtitle = me?.customStatus
    ? `${me?.customStatus}`
    : STATUS_LABEL[status];

  return (
    <div className="flex h-full flex-col bg-background">
      <div
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        className="flex h-9 absolute top-0 left-0 z-[99] w-full shrink-0 items-center justify-between pl-4"
      >
        <span className="text-xs font-medium text-muted-foreground">
          Settings
        </span>
      </div>
      {/* `min-h-0 h-full` overrides the provider's own `min-h-svh`. That
          default is right for a sidebar filling a page and wrong for one
          inside a dialog: it forces this subtree to be at least a viewport
          tall, so in a dialog capped at 90vh the last card sat below the
          bottom edge with nothing left to scroll. */}
      <SidebarProvider className="h-full min-h-0">
        <Sidebar>
          <SidebarHeader className="pt-9">
            <SidebarMenu>
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <div
                      className={`rounded-lg overflow-hidden border border-border/40 bg-card/80 shadow-md`}
                    >
                      <div className="relative flex items-center gap-2 px-3 py-2.5">
                        {me?.nameplateUrl && (
                          <img
                            src={me.nameplateUrl}
                            alt=""
                            className="fade-mask-l pointer-events-none absolute inset-0 h-full w-full object-cover opacity-20"
                          />
                        )}
                        <Avatar size="sm" className="shrink-0 cursor-pointer">
                          <AvatarImage src={me?.imageUrl} alt={me?.name} />
                          <AvatarFallback>
                            {me?.name.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                          <AvatarBadge className={STATUS_DOT_CLASS[status]} />
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
                              <ActivityStatusIcon activities={activities} />
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
                            className="flex flex-row gap-2 items-center"
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
          <SidebarFooter />
        </Sidebar>
        {/* `h-full min-h-0 overflow-hidden`: without a height and a
            min-height of zero, this flex child sizes to its content, the
            ScrollArea inside it never becomes shorter than the page, and the
            last card runs off the bottom of the dialog with nothing left to
            scroll. */}
        <main className="h-full min-h-0 w-full overflow-hidden pt-9">
          <ScrollArea className="h-[75%] min-h-0 flex-1 pb-20">
            {/* Extra padding under the last card, so it clears the dialog's
                own rounded corner rather than ending flush against it. */}
            <div className="mx-auto w-full px-6 pt-6 pb-30">
              {section === "appearance" && <AppearanceTab />}
              {section === "accessibility" && <AccessibilityTab />}
              {section === "servers" && <ServerProfilesTab />}
              {section === "account" && <AccountTab />}
              {section === "voice" && <VoiceVideoTab />}
              {section === "notifications" && <NotificationsTab />}
              {section === "updates" && <UpdatesTab />}
              {section === "about" && <AboutTab />}
            </div>
          </ScrollArea>
        </main>
      </SidebarProvider>
    </div>
  );
}
