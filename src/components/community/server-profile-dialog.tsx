"use client";

import { useMutation, useQuery } from "convex/react";
import { Camera, Crop, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { JoinSoundPicker } from "@/components/settings/join-sound-picker";
import { GradientPicker } from "@/components/profile/gradient-picker";
import {
  AVATAR_CROP,
  BANNER_CROP,
  ImageCropDialog,
} from "@/components/profile/image-crop-dialog";
import { DialogMorph } from "@/components/ui/dialog-morph";
import { useSmoothScrollRef } from "@/hooks/use-smooth-scroll";
import { useProfileScope } from "@/hooks/use-profile-scope";

const BIO_MAX = 300;

interface ServerProfileDialogProps {
  communityId: Id<"communities">;
  communityName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ServerProfileDialog({
  communityId,
  communityName,
  open,
  onOpenChange,
}: ServerProfileDialogProps) {
  const smoothRef = useSmoothScrollRef<HTMLDivElement>();
  const me = useQuery(api.users.getCurrentUser);
  const serverProfile = useQuery(api.serverProfiles.getMyServerProfile, { communityId });

  const upsertServerProfile = useMutation(api.serverProfiles.upsertServerProfile);
  // Pictures go through the same path as the profile editor's — CDN first,
  // recorded in the recent list — rather than through a second set of mutations
  // that would replace a picture and delete the file its history points at.
  const scope = useProfileScope(communityId, communityName);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setServerGradient = useMutation((api.serverProfiles as any).setServerGradient);

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [gradientStart, setGradientStart] = useState("");
  const [gradientEnd, setGradientEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [bannerUploading, setBannerUploading] = useState(false);
  const [nameplateUploading, setNameplateUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  /** What the crop editor is open on — see the global profile tab. */
  const [cropping, setCropping] = useState<{
    kind: "avatar" | "banner";
    source: File | string;
  } | null>(null);

  const avatarFileInputRef = useRef<HTMLInputElement>(null);
  const bannerFileInputRef = useRef<HTMLInputElement>(null);
  const nameplateFileInputRef = useRef<HTMLInputElement>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    if (me === undefined || serverProfile === undefined || hydrated.current) return;
    hydrated.current = true;
    setDisplayName(serverProfile?.displayName ?? "");
    setBio(serverProfile?.bio ?? "");
    setGradientStart(serverProfile?.borderGradientStart ?? "");
    setGradientEnd(serverProfile?.borderGradientEnd ?? "");
  }, [me, serverProfile]);

  const mergedImageUrl = serverProfile?.imageUrl ?? me?.imageUrl;
  const mergedBannerUrl = serverProfile?.bannerUrl ?? me?.bannerUrl;
  const mergedNameplateUrl = serverProfile?.nameplateUrl ?? me?.nameplateUrl;
  const displayFallback = (displayName || (me?.name ?? "?")).slice(0, 2).toUpperCase();

  /**
   * Save a crop, plus the untouched original when this is a newly-picked
   * file, so the crop stays adjustable later.
   */
  const saveCrop = async (crop: Blob) => {
    const target = cropping;
    if (!target) return;
    const isAvatar = target.kind === "avatar";
    const original = target.source instanceof File ? target.source : undefined;
    const setLoading = isAvatar ? setAvatarUploading : setBannerUploading;

    setLoading(true);
    setError(null);
    try {
      if (isAvatar) await scope.setAvatar(crop, original);
      else await scope.setBanner(crop, original);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the image.");
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const handleNameplatePick = async (file: File | undefined) => {
    if (!file) return;
    setNameplateUploading(true);
    setError(null);
    try {
      await scope.setNameplate(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload nameplate.");
    } finally {
      setNameplateUploading(false);
      if (nameplateFileInputRef.current) nameplateFileInputRef.current.value = "";
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await upsertServerProfile({
        communityId,
        displayName: displayName || undefined,
        bio: bio || undefined,
      });
      await setServerGradient({
        communityId,
        borderGradientStart: gradientStart || undefined,
        borderGradientEnd: gradientEnd || undefined,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg overflow-hidden p-0">
        {/* Cropping is a view of this dialog, not a second one stacked on it:
            the profile slides out and the crop slides in, in the same frame. */}
        <DialogMorph
          view={cropping ? "crop" : "profile"}
          direction={cropping ? 1 : -1}
          padded={false}
          className={cropping ? "grid gap-4 p-6" : "flex max-h-[85vh] flex-col"}
        >
        {cropping ? (
          <ImageCropDialog
            inline
            open
            onOpenChange={(open) => !open && setCropping(null)}
            source={cropping.source}
            shape={cropping.kind === "banner" ? BANNER_CROP : AVATAR_CROP}
            title={
              cropping.kind === "banner"
                ? `Position your banner for ${communityName}`
                : `Position your avatar for ${communityName}`
            }
            onCropped={saveCrop}
          />
        ) : (
        <>
        <DialogHeader className="shrink-0 border-b px-6 pb-4 pt-6">
          <DialogTitle>Edit Server Profile</DialogTitle>
          <DialogDescription>Your profile for {communityName}.</DialogDescription>
        </DialogHeader>
        <div ref={smoothRef} className="min-h-0 flex-1 overflow-y-auto">
          <Card className="rounded-none border-0 shadow-none">
            <CardContent className="space-y-6 px-6 py-4">
              <div className="flex items-center gap-4">
                <div className="group relative">
                  <Avatar size="lg" className="size-16">
                    <AvatarImage src={mergedImageUrl} alt={displayName || me?.name} />
                    <AvatarFallback>{displayFallback}</AvatarFallback>
                  </Avatar>
                  <button
                    type="button"
                    onClick={() => avatarFileInputRef.current?.click()}
                    disabled={avatarUploading}
                    aria-label="Change avatar"
                    className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-100"
                  >
                    {avatarUploading ? (
                      <Loader2 className="size-5 animate-spin text-white" />
                    ) : (
                      <Camera className="size-5 text-white" />
                    )}
                  </button>
                </div>
                <input
                  ref={avatarFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setCropping({ kind: "avatar", source: file });
                    e.target.value = "";
                  }}
                />
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Click your avatar to change it.</p>
                  {serverProfile?.avatarOriginalUrl && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setCropping({
                          kind: "avatar",
                          source: serverProfile.avatarOriginalUrl as string,
                        })
                      }
                    >
                      <Crop className="size-3.5" />
                      Adjust crop
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sp-display-name">Display name</Label>
                <Input
                  id="sp-display-name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={64}
                  placeholder={me?.name}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sp-bio">Bio</Label>
                <Textarea
                  id="sp-bio"
                  value={bio}
                  onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
                  rows={3}
                  className="resize-none"
                  placeholder={me?.bio ?? undefined}
                />
                <p className="text-right text-xs text-muted-foreground">
                  {bio.length}/{BIO_MAX}
                </p>
              </div>

              {/* Saved immediately rather than with the rest of the form —
                  it's a single choice with no draft state to reconcile. */}
              <div className="space-y-1.5">
                <Label>Join sound in this server</Label>
                <JoinSoundPicker communityId={communityId} />
              </div>

              <div className="space-y-2">
                <Label>Profile banner</Label>
                <div
                  className={`h-24 rounded-md ${
                    mergedBannerUrl
                      ? "bg-cover bg-center"
                      : "flex items-center justify-center border-2 border-dashed bg-muted/40"
                  }`}
                  style={mergedBannerUrl ? { backgroundImage: `url(${mergedBannerUrl})` } : undefined}
                >
                  {!mergedBannerUrl && <Camera className="size-6 text-muted-foreground" />}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => bannerFileInputRef.current?.click()}
                    disabled={bannerUploading}
                  >
                    {bannerUploading ? <Loader2 className="size-4 animate-spin" /> : "Upload banner"}
                  </Button>
                  {serverProfile?.bannerOriginalUrl && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setCropping({
                          kind: "banner",
                          source: serverProfile.bannerOriginalUrl as string,
                        })
                      }
                    >
                      <Crop className="size-3.5" />
                      Adjust crop
                    </Button>
                  )}
                  {serverProfile?.bannerUrl && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => void scope.removeBanner()}
                    >
                      Remove
                    </Button>
                  )}
                </div>
                <input
                  ref={bannerFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setCropping({ kind: "banner", source: file });
                    e.target.value = "";
                  }}
                />
              </div>

              <GradientPicker
                start={gradientStart}
                end={gradientEnd}
                onStartChange={setGradientStart}
                onEndChange={setGradientEnd}
                bannerUrl={mergedBannerUrl}
              />

              <div className="space-y-2">
                <Label>Chat nameplate</Label>
                <div
                  className={`h-24 overflow-hidden rounded-md ${
                    mergedNameplateUrl
                      ? ""
                      : "flex items-center justify-center border-2 border-dashed bg-muted/40"
                  }`}
                >
                  {mergedNameplateUrl ? (
                    <img
                      src={mergedNameplateUrl}
                      alt="Nameplate"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Camera className="size-6 text-muted-foreground" />
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => nameplateFileInputRef.current?.click()}
                    disabled={nameplateUploading}
                  >
                    {nameplateUploading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      "Upload nameplate"
                    )}
                  </Button>
                  {serverProfile?.nameplateUrl && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => void scope.removeNameplate()}
                    >
                      Remove
                    </Button>
                  )}
                </div>
                <input
                  ref={nameplateFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void handleNameplatePick(e.target.files?.[0])}
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex items-center gap-2 pb-2">
                <Button onClick={() => void handleSave()} disabled={saving}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : "Save changes"}
                </Button>
                {saved && <span className="text-xs text-muted-foreground">Saved.</span>}
              </div>
            </CardContent>
          </Card>
        </div>
        </>
        )}
        </DialogMorph>
      </DialogContent>
    </Dialog>
  );
}
