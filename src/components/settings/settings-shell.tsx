"use client";

import { Bell, Download, Info, KeyRound, Mic, User } from "lucide-react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AboutTab } from "@/components/settings/tabs/about-tab";
import { PlaceholderTab } from "@/components/settings/tabs/placeholder-tab";
import { VoiceVideoTab } from "@/components/settings/tabs/voice-video-tab";

const TABS = [
  { value: "profile", label: "Profile", icon: User },
  { value: "account", label: "Account", icon: KeyRound },
  { value: "voice", label: "Voice & Video", icon: Mic },
  { value: "notifications", label: "Notifications", icon: Bell },
  { value: "updates", label: "Updates", icon: Download },
  { value: "about", label: "About", icon: Info },
] as const;

export function SettingsShell() {
  return (
    <div className="flex h-full flex-col bg-background">
      <Tabs defaultValue="voice" className="h-full min-h-0 gap-0">
        <div className="flex justify-center border-b bg-background/60 px-4 pt-4 pb-2">
          <TabsList variant="line" className="h-auto gap-1">
            {TABS.map(({ value, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value} className="flex-col gap-1 px-3 py-2 text-xs">
                <Icon className="size-4" />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto w-full max-w-2xl px-6 py-6">
            <TabsContent value="profile">
              <PlaceholderTab
                title="Profile"
                description="Display name, username, avatar, and bio are coming soon."
              />
            </TabsContent>
            <TabsContent value="account">
              <PlaceholderTab
                title="Account"
                description="Email and password management are coming soon."
              />
            </TabsContent>
            <TabsContent value="voice">
              <VoiceVideoTab />
            </TabsContent>
            <TabsContent value="notifications">
              <PlaceholderTab
                title="Notifications"
                description="Notification preferences are coming soon."
              />
            </TabsContent>
            <TabsContent value="updates">
              <PlaceholderTab title="Updates" description="Update status and controls are coming soon." />
            </TabsContent>
            <TabsContent value="about">
              <AboutTab />
            </TabsContent>
          </div>
        </ScrollArea>
      </Tabs>
    </div>
  );
}
