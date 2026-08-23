"use client";

import { useMutation, useQuery } from "convex/react";
import { Camera, Loader2 } from "lucide-react";
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
import { getAvatarColor } from "@/lib/avatar-color";

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
  const me = useQuery(api.users.getCurrentUser);
  const serverProfile = useQuery(api.serverProfiles.getMyServerProfile, { communityId });

  const upsertServerProfile = useMutation(api.serverProfiles.upsertServerProfile);
  const generateServerAvatarUploadUrl = useMutation(api.serverProfiles.generateServerAvatarUploadUrl);
  const setServerAvatar = useMutation(api.serverProfiles.setServerAvatar);
  const setServerAvatarAccent = useMutation(api.serverProfiles.setServerAvatarAccent);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const generateServerBannerUploadUrl = useMutation((api.serverProfiles as any).generateServerBannerUploadUrl);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setServerBanner = useMutation((api.serverProfiles as any).setServerBanner);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const removeServerBanner = useMutation((api.serverProfiles as any).removeServerBanner);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const generateServerNameplateUploadUrl = useMutation((api.serverProfiles as any).generateServerNameplateUploadUrl);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setServerNameplate = useMutation((api.serverProfiles as any).setServerNameplate);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const removeServerNameplate = useMutation((api.serverProfiles as any).removeServerNameplate);
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

  const uploadMedia = async (
    file: File,
    generateUrl: () => Promise<string>,
    setLoading: (b: boolean) => void,
    save: (id: Id<"_storage">) => Promise<unknown>,
    ref: { current: HTMLInputElement | null },
    errMsg: string,
  ) => {
    setLoading(true);
    setError(null);
    try {
      const url = await generateUrl();
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed.");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await save(storageId);
    } catch (err) {
      setError(err instanceof Error ? err.message : errMsg);
    } finally {
      setLoading(false);
      if (ref.current) ref.current.value = "";
    }
  };

  const handleAvatarPick = (file: File | undefined) =>
    file &&
    void uploadMedia(
      file,
      () => generateServerAvatarUploadUrl({ communityId }),
      setAvatarUploading,
      // Sample the avatar's dominant colour here, once, rather than in every
      // client that later renders it in a call tile — see useAvatarAccent.
      async (storageId) => {
        const url = await setServerAvatar({ communityId, storageId });
        const accent = await getAvatarColor(url);
        if (accent) await setServerAvatarAccent({ communityId, accent, sourceUrl: url });
      },
      avatarFileInputRef,
      "Failed to upload avatar.",
    );

  const handleBannerPick = (file: File | undefined) =>
    file &&
    void uploadMedia(
      file,
      () => generateServerBannerUploadUrl({ communityId }),
      setBannerUploading,
      (storageId) => setServerBanner({ communityId, storageId }),
      bannerFileInputRef,
      "Failed to upload banner.",
    );

  const handleNameplatePick = (file: File | undefined) =>
    file &&
    void uploadMedia(
      file,
      () => generateServerNameplateUploadUrl({ communityId }),
      setNameplateUploading,
      (storageId) => setServerNameplate({ communityId, storageId }),
      nameplateFileInputRef,
      "Failed to upload nameplate.",
    );

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
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 pb-4 pt-6">
          <DialogTitle>Edit Server Profile</DialogTitle>
          <DialogDescription>Your profile for {communityName}.</DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto">
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
                  onChange={(e) => handleAvatarPick(e.target.files?.[0])}
                />
                <p className="text-sm text-muted-foreground">Click your avatar to change it.</p>
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
                  {serverProfile?.bannerUrl && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => void removeServerBanner({ communityId })}
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
                  onChange={(e) => handleBannerPick(e.target.files?.[0])}
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
                      onClick={() => void removeServerNameplate({ communityId })}
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
                  onChange={(e) => handleNameplatePick(e.target.files?.[0])}
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
      </DialogContent>
    </Dialog>
  );
}
