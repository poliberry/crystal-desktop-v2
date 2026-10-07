"use client";

import { useConvex, useMutation, useQuery } from "convex/react";
import { Camera, Loader2 } from "lucide-react";
import moment from "moment";
import { useEffect, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { GradientPicker } from "@/components/profile/gradient-picker";
import { SettingRow, SettingsCard, SettingsGroup } from "@/components/settings/settings-ui";
import { useSettingsDraft } from "@/components/settings/settings-save";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { uploadImage } from "@/lib/cdn-upload";
import { cn } from "@/lib/utils";

interface CommunitySettingsGeneralTabProps {
  communityId: Id<"communities">;
  canManage: boolean;
}

/** Ready-made themes, so a community can have colours without anyone choosing
 * a pair of them. */
const THEME_PRESETS: { name: string; start: string; end: string }[] = [
  { name: "Crystal", start: "#7c5cff", end: "#c084fc" },
  { name: "Ocean", start: "#0ea5e9", end: "#6366f1" },
  { name: "Sunset", start: "#f97316", end: "#ec4899" },
  { name: "Forest", start: "#10b981", end: "#14b8a6" },
  { name: "Rose", start: "#f43f5e", end: "#fb923c" },
  { name: "Slate", start: "#64748b", end: "#334155" },
];

/** A file's address while it is being previewed, released when it changes. */
function useObjectUrl(file: File | null): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!file) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

/**
 * The community's profile: name, icon, banner, whether it's invite-only, and its
 * theme.
 *
 * Every edit is a draft. The icon and banner are held as the file that was
 * picked and shown from it, and only uploaded — to the CDN — when the page's
 * save bar is used, along with everything else.
 */
export function CommunitySettingsGeneralTab({
  communityId,
  canManage,
}: CommunitySettingsGeneralTabProps) {
  const convex = useConvex();
  const community = useQuery(api.communities.get, { communityId });
  const communityMembers = useQuery(api.communities.listMembers, { communityId });
  const updateSettings = useMutation(api.communities.updateSettings);
  const generateIconUploadUrl = useMutation(api.communities.generateIconUploadUrl);
  const setIcon = useMutation(api.communities.setIcon);
  const generateBannerUploadUrl = useMutation(api.communities.generateBannerUploadUrl);
  const setBanner = useMutation(api.communities.setBanner);
  const removeBanner = useMutation(api.communities.removeBanner);

  const [name, setName] = useState("");
  const [inviteOnly, setInviteOnly] = useState(true);
  const [themeStart, setThemeStart] = useState("");
  const [themeEnd, setThemeEnd] = useState("");
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [bannerRemoved, setBannerRemoved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bannerFileInputRef = useRef<HTMLInputElement>(null);
  const hydrated = useRef(false);

  const iconPreview = useObjectUrl(iconFile);
  const bannerPreview = useObjectUrl(bannerFile);

  const reset = () => {
    if (!community) return;
    setName(community.name);
    setInviteOnly(community.inviteOnly);
    setThemeStart(community.themeStart ?? "");
    setThemeEnd(community.themeEnd ?? "");
    setIconFile(null);
    setBannerFile(null);
    setBannerRemoved(false);
  };

  useEffect(() => {
    if (!community || hydrated.current) return;
    hydrated.current = true;
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [community]);

  const storedStart = community?.themeStart ?? "";
  const storedEnd = community?.themeEnd ?? "";
  const themeChanged = themeStart !== storedStart || themeEnd !== storedEnd;
  const bannerChanged = !!bannerFile || bannerRemoved;

  const changed = {
    name: !!community && name.trim() !== community.name,
    inviteOnly: !!community && inviteOnly !== community.inviteOnly,
    theme: !!community && themeChanged,
    icon: !!iconFile,
    banner: bannerChanged,
  };

  useSettingsDraft({
    changes: community && canManage ? Object.values(changed).filter(Boolean).length : 0,
    discard: reset,
    save: async () => {
      if (!community) return;
      if (!name.trim()) throw new Error("Community name can't be empty.");
      // Both colours or neither: a lone one is a colour, not a theme.
      if (!!themeStart !== !!themeEnd) throw new Error("A theme needs both of its colours.");

      if (iconFile) {
        const uploaded = await uploadImage(convex, iconFile, "icons", generateIconUploadUrl);
        await setIcon({ communityId, ...uploaded });
      }
      if (bannerFile) {
        const uploaded = await uploadImage(convex, bannerFile, "banners", generateBannerUploadUrl);
        await setBanner({ communityId, ...uploaded });
      } else if (bannerRemoved) {
        await removeBanner({ communityId });
      }
      if (changed.name || changed.inviteOnly || changed.theme) {
        await updateSettings({
          communityId,
          ...(changed.name ? { name } : {}),
          ...(changed.inviteOnly ? { inviteOnly } : {}),
          ...(changed.theme ? { themeStart, themeEnd } : {}),
        });
      }
      setIconFile(null);
      setBannerFile(null);
      setBannerRemoved(false);
    },
  });

  if (!community) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  const shownIcon = iconPreview ?? community.imageUrl;
  const shownBanner = bannerRemoved ? undefined : (bannerPreview ?? community.bannerUrl);
  const themed = !!(themeStart && themeEnd);

  return (
    <div className="flex items-start gap-6">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) setIconFile(file);
        }}
      />
      <input
        ref={bannerFileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) {
            setBannerFile(file);
            setBannerRemoved(false);
          }
        }}
      />

      {/* What the community looks like with the draft applied. */}
      <div className="order-2 w-92 shrink-0 sticky top-4 self-start">
        <Card data-flush className="relative h-fit w-full overflow-hidden rounded-xl p-0">
          {/* The theme, as the tint it puts behind the community's pages. */}
          {themed && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-30"
              style={{ background: `linear-gradient(160deg, ${themeStart}, ${themeEnd})` }}
            />
          )}
          <div className="group relative">
            <div
              className={cn(
                "h-32 rounded-t-xl",
                shownBanner
                  ? "bg-cover bg-center"
                  : "flex items-center justify-center border-2 border-dashed bg-muted/40",
              )}
              style={shownBanner ? { backgroundImage: `url(${shownBanner})` } : undefined}
            >
              {!shownBanner && <Camera className="size-6 text-muted-foreground" />}
            </div>
            {canManage && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-lg bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => bannerFileInputRef.current?.click()}
                >
                  <Camera className="size-4" />
                  {shownBanner ? "Change" : "Add banner"}
                </Button>
                {shownBanner && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setBannerFile(null);
                      setBannerRemoved(true);
                    }}
                  >
                    Remove
                  </Button>
                )}
              </div>
            )}
          </div>
          <CardContent className="relative p-4">
            <div className="flex flex-col gap-2">
              <div className="group relative -mt-18">
                <Avatar className="size-18">
                  <AvatarImage
                    src={shownIcon}
                    alt={name}
                    className="rounded-lg border-4 border-card"
                  />
                  <AvatarFallback>{(name || community.name).slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Change icon"
                    className="absolute inset-0 flex size-18 items-center justify-center rounded-lg bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <Camera className="size-5 text-white" />
                  </button>
                )}
              </div>
              <div>
                <h1 className="font-bold">{name || community.name}</h1>
                <p className="text-sm text-muted-foreground">{communityMembers?.length} members</p>
              </div>
            </div>
            <div className="pt-2">
              <p className="text-sm text-muted-foreground">
                Joined the Crystal family in {moment(community.createdAt).format("MMM yyyy")}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="order-1 min-w-0 flex-1 space-y-6">
        <SettingsGroup title="Community profile">
          <p className="px-1 pb-1 text-xs text-muted-foreground">
            Customise how your community appears across Crystal, in invite links, and in
            Discovery - if you have it enabled.
          </p>
          <SettingsCard className="space-y-1.5 px-4 py-3">
            <Label htmlFor="community-settings-name">Name</Label>
            <Input
              id="community-settings-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canManage}
              maxLength={64}
              className="w-full"
            />
          </SettingsCard>
          <SettingRow
            title="Invite-only"
            description="When on, the server is hidden from Discovery and can only be joined with an invite link — including from an emoji card."
          >
            <Switch
              id="community-settings-invite-only"
              aria-label="Invite-only"
              checked={inviteOnly}
              onCheckedChange={setInviteOnly}
              disabled={!canManage}
            />
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup title="Theme">
          <p className="px-1 pb-1 text-xs text-muted-foreground">
            A pair of colours that tints the community&apos;s overview and channels for everyone
            in it.
          </p>
          <SettingsCard className="space-y-4 px-4 py-3">
            <div className="space-y-1.5">
              <Label>Presets</Label>
              <div className="flex flex-wrap gap-2">
                {THEME_PRESETS.map((preset) => {
                  const active = themeStart === preset.start && themeEnd === preset.end;
                  return (
                    <button
                      key={preset.name}
                      type="button"
                      disabled={!canManage}
                      title={preset.name}
                      onClick={() => {
                        setThemeStart(preset.start);
                        setThemeEnd(preset.end);
                      }}
                      className={cn(
                        "h-9 w-16 rounded-lg border transition-transform hover:scale-105 disabled:opacity-50",
                        active && "ring-2 ring-ring ring-offset-2 ring-offset-background",
                      )}
                      style={{ background: `linear-gradient(135deg, ${preset.start}, ${preset.end})` }}
                    />
                  );
                })}
              </div>
            </div>

            <GradientPicker
              label="Your own colours"
              noun="theme"
              source="banner"
              start={themeStart}
              end={themeEnd}
              // A colour on its own isn't a theme: picking the first one gives the
              // gradient a second end to start from, which can then be changed.
              onStartChange={(colour) => {
                setThemeStart(colour);
                if (!themeEnd) setThemeEnd(colour);
              }}
              onEndChange={(colour) => {
                setThemeEnd(colour);
                if (!themeStart) setThemeStart(colour);
              }}
              bannerUrl={shownBanner}
            />

            {themed && canManage && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setThemeStart("");
                  setThemeEnd("");
                }}
              >
                Remove theme
              </Button>
            )}
          </SettingsCard>
        </SettingsGroup>
      </div>
    </div>
  );
}
