"use client";

import { useMutation, useQuery } from "convex/react";
import { Camera, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const BIO_MAX = 300;

export function ProfileTab() {
  const me = useQuery(api.users.getCurrentUser);
  const updateProfile = useMutation(api.users.updateProfile);
  const generateAvatarUploadUrl = useMutation(api.users.generateAvatarUploadUrl);
  const setAvatar = useMutation(api.users.setAvatar);

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    if (!me || hydrated.current) return;
    hydrated.current = true;
    setName(me.name);
    setUsername(me.username);
    setBio(me.bio ?? "");
  }, [me]);

  const normalizedUsername = username.trim().toLowerCase();
  const usernameChanged = !!me && normalizedUsername !== me.username;
  const usernameCheck = useQuery(
    api.users.searchByUsername,
    usernameChanged && normalizedUsername ? { username: normalizedUsername } : "skip"
  );
  const usernameTaken = usernameChanged && !!usernameCheck;

  const dirty = !!me && (name !== me.name || username !== me.username || bio !== (me.bio ?? ""));

  const handleAvatarPick = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const uploadUrl = await generateAvatarUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed.");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await setAvatar({ storageId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload avatar.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await updateProfile({ name, username, bio });
      // Mirror exactly what got persisted (trimmed name/bio, trimmed +
      // lowercased username) — otherwise e.g. saving " Alice " leaves the
      // input showing " Alice " while the server stored "Alice", so `dirty`
      // never clears and Save stays enabled despite nothing left to save.
      setName(result.name);
      setUsername(result.username);
      setBio(result.bio);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile.");
    } finally {
      setSaving(false);
    }
  };

  if (me === undefined) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (me === null) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          Couldn&apos;t load your profile.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>How you appear to other people in Crystal.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center gap-4">
          <div className="group relative">
            <Avatar size="lg" className="size-16">
              <AvatarImage src={me.imageUrl} alt={me.name} />
              <AvatarFallback>{me.name.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              aria-label="Change avatar"
              className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-100"
            >
              {uploading ? (
                <Loader2 className="size-5 animate-spin text-white" />
              ) : (
                <Camera className="size-5 text-white" />
              )}
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void handleAvatarPick(e.target.files?.[0])}
          />
          <p className="text-sm text-muted-foreground">Click your avatar to change it.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="profile-name">Display name</Label>
          <Input
            id="profile-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={64}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="profile-username">Username</Label>
          <Input
            id="profile-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={32}
            aria-invalid={usernameTaken}
          />
          {usernameTaken && <p className="text-xs text-destructive">That username is taken.</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="profile-bio">Bio</Label>
          <Textarea
            id="profile-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
            rows={3}
            className="resize-none"
          />
          <p className="text-right text-xs text-muted-foreground">
            {bio.length}/{BIO_MAX}
          </p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex items-center gap-2">
          <Button onClick={() => void handleSave()} disabled={!dirty || saving || usernameTaken}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : "Save changes"}
          </Button>
          {saved && !dirty && <span className="text-xs text-muted-foreground">Saved.</span>}
        </div>
      </CardContent>
    </Card>
  );
}
