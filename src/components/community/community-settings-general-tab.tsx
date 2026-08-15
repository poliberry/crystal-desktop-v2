"use client";

import { useMutation, useQuery } from "convex/react";
import { Camera, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

interface CommunitySettingsGeneralTabProps {
  communityId: Id<"communities">;
  canManage: boolean;
  isOwner: boolean;
  onDeleted: () => void;
}

export function CommunitySettingsGeneralTab({
  communityId,
  canManage,
  isOwner,
  onDeleted,
}: CommunitySettingsGeneralTabProps) {
  const community = useQuery(api.communities.get, { communityId });
  const updateSettings = useMutation(api.communities.updateSettings);
  const generateIconUploadUrl = useMutation(api.communities.generateIconUploadUrl);
  const setIcon = useMutation(api.communities.setIcon);
  const generateBannerUploadUrl = useMutation(api.communities.generateBannerUploadUrl);
  const setBanner = useMutation(api.communities.setBanner);
  const removeBanner = useMutation(api.communities.removeBanner);
  const leave = useMutation(api.communities.leave);
  const remove = useMutation(api.communities.remove);

  const [name, setName] = useState("");
  const hydrated = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bannerFileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [bannerUploading, setBannerUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!community || hydrated.current) return;
    hydrated.current = true;
    setName(community.name);
  }, [community]);

  if (!community) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  const handleIconPick = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const uploadUrl = await generateIconUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed.");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await setIcon({ communityId, storageId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload icon.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleBannerPick = async (file: File | undefined) => {
    if (!file) return;
    setBannerUploading(true);
    setError(null);
    try {
      const uploadUrl = await generateBannerUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed.");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await setBanner({ communityId, storageId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload banner.");
    } finally {
      setBannerUploading(false);
      if (bannerFileInputRef.current) bannerFileInputRef.current.value = "";
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateSettings({ communityId, name });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Overview</CardTitle>
          <CardDescription>Name and icon shown in the community rail.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="group relative">
              <Avatar size="lg" className="size-16">
                <AvatarImage src={community.imageUrl} alt={community.name} />
                <AvatarFallback>{community.name.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              {canManage && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  aria-label="Change icon"
                  className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-100"
                >
                  {uploading ? (
                    <Loader2 className="size-5 animate-spin text-white" />
                  ) : (
                    <Camera className="size-5 text-white" />
                  )}
                </button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void handleIconPick(e.target.files?.[0])}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="community-settings-name">Name</Label>
            <Input
              id="community-settings-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canManage}
              maxLength={64}
            />
          </div>

          <div className="space-y-2">
            <Label>Server banner</Label>
            <div
              className={`h-24 rounded-md ${community.bannerUrl ? "bg-cover bg-center" : "flex items-center justify-center border-2 border-dashed bg-muted/40"}`}
              style={community.bannerUrl ? { backgroundImage: `url(${community.bannerUrl})` } : undefined}
            >
              {!community.bannerUrl && <Camera className="size-6 text-muted-foreground" />}
            </div>
            {canManage && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={bannerUploading} onClick={() => bannerFileInputRef.current?.click()}>
                  {bannerUploading ? <Loader2 className="size-4 animate-spin" /> : "Upload banner"}
                </Button>
                {community.bannerUrl && (
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void removeBanner({ communityId })}>
                    Remove
                  </Button>
                )}
              </div>
            )}
            <input
              ref={bannerFileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void handleBannerPick(e.target.files?.[0])}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {canManage && (
            <Button disabled={!name.trim() || saving} onClick={() => void handleSave()}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : "Save changes"}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>Danger zone</CardTitle>
        </CardHeader>
        <CardContent>
          <Separator className="mb-4" />
          {isOwner ? (
            <Button
              variant="destructive"
              onClick={() => {
                if (confirm(`Delete "${community.name}"? This can't be undone.`)) {
                  void remove({ communityId }).then(onDeleted);
                }
              }}
            >
              Delete community
            </Button>
          ) : (
            <Button
              variant="destructive"
              onClick={() => {
                if (confirm(`Leave "${community.name}"?`)) {
                  void leave({ communityId }).then(onDeleted);
                }
              }}
            >
              Leave community
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
