"use client";

import {
  Accessibility,
  Bell,
  ChevronDown,
  Download,
  Info,
  KeyRound,
  LogOut,
  Mic,
  Palette,
  Server,
  User,
} from "lucide-react";

import { ActivityStatusIcon } from "@/components/rich-presence-card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AboutTab } from "@/components/settings/tabs/about-tab";
import { AccessibilityTab } from "@/components/settings/tabs/accessibility-tab";
import { AccountTab } from "@/components/settings/tabs/account-tab";
import { AppearanceTab } from "@/components/settings/tabs/appearance-tab";
import { NotificationsTab } from "@/components/settings/tabs/notifications-tab";
import { ProfileTab } from "@/components/settings/tabs/profile-tab";
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
  { value: "profile", label: "Profile", icon: User },
  { value: "appearance", label: "Appearance", icon: Palette },
  { value: "accessibility", label: "Accessibility", icon: Accessibility },
  { value: "servers", label: "Servers", icon: Server },
  { value: "account", label: "Account", icon: KeyRound },
  { value: "voice", label: "Voice & Video", icon: Mic },
  { value: "notifications", label: "Notifications", icon: Bell },
  { value: "updates", label: "Updates", icon: Download },
  { value: "about", label: "About", icon: Info },
] as const;

const NAVIGATION = [
  {
    label: "General",
    children: [
      { value: "profile", label: "Profile", icon: User },
      { value: "updates", label: "Updates", icon: Download },
    ],
  },
  {
    label: "Customisation",
    children: [
      { value: "appearance", label: "Appearance", icon: Palette },
      { value: "accessibility", label: "Accessibility", icon: Accessibility },
      { value: "servers", label: "Server Profiles", icon: Server },
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
export function SettingsShell({ onRequestClose }: { onRequestClose?: () => void }) {
  const me = useQuery(api.users.getCurrentUser);
  const { status, manualStatus, activities } = useMyPresence();
  const [section, setSection] = useState("profile");

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
        <WindowControls className="border-none" />
      </div>
      <SidebarProvider>
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
                            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-20"
                            style={{
                              WebkitMaskImage:
                                "linear-gradient(to left, black 0%, black 30%, transparent 100%)",
                              maskImage:
                                "linear-gradient(to left, black 0%, black 30%, transparent 100%)",
                            }}
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
                        onClick={() => (onRequestClose ? onRequestClose() : window.close())}
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
                          onClick={() => setSection(NAV_CHILD_ITEM.value)}
                        >
                          <SidebarMenuButton
                            isActive={section === NAV_CHILD_ITEM.value}
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
        <main className="w-full pt-9">
          <ScrollArea className="min-h-0 h-full flex-1">
            <div className="mx-auto w-full px-6 py-6">
              {section === "profile" && <ProfileTab />}
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

      <Tabs defaultValue="profile" className="h-full min-h-0 gap-0">
        <div className="flex flex-row gap-8 w-full min-h-0 h-full">
          <div className="flex flex-col justify-center border-b bg-background/60">
            <TabsList
              variant="line"
              className="min-h-full flex flex-col justify-start rounded-none gap-4"
            >
              {TABS.map(({ value, label, icon: Icon }) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="flex-row gap-1 justify-start px-3 py-2 max-h-fit w-full text-xs"
                >
                  <Icon className="size-4" />
                  {label}
                </TabsTrigger>
              ))}
              <SignOutButton>
                <Button
                  variant="ghost"
                  className="flex-row gap-1 w-full text-xs"
                >
                  <LogOut className="size-4" />
                  Sign out
                </Button>
              </SignOutButton>
            </TabsList>
          </div>
        </div>
      </Tabs>
    </div>
  );
}
