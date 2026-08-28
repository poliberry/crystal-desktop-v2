"use client";

import { useMutation, useQuery } from "convex/react";
import { Camera, Crop, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { GradientPicker } from "@/components/profile/gradient-picker";
import {
  AVATAR_CROP,
  BANNER_CROP,
  ImageCropDialog,
} from "@/components/profile/image-crop-dialog";
import { getAvatarColor } from "@/lib/avatar-color";
import { uploadToStorage } from "@/lib/storage-upload";
import {
  DECORATION_PRESETS,
  isCustomDecoration,
} from "@/lib/avatar-decorations";
import { MAX_DECORATION_BYTES, MAX_DECORATION_LABEL } from "@/lib/upload-limits";
import {
  StatusBubble,
  STATUS_BUBBLE_KINDS,
  type StatusBubbleKind,
} from "@/components/profile/status-bubble";
import { cn } from "@/lib/utils";

const BIO_MAX = 300;

/**
 * One choice in the decoration picker: the user's own avatar wearing it, since
 * what a decoration looks like depends entirely on the picture inside it.
 *
 * The 132% overlay ratio is the one `AvatarDecoration` uses — this is a
 * standalone preview rather than an `Avatar`, so it carries its own copy.
 */
function DecorationSwatch({
  label,
  imageUrl,
  name,
  decorationSrc,
  selected,
  onSelect,
}: {
  label: string;
  imageUrl?: string;
  name: string;
  decorationSrc?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-20 flex-col items-center gap-1 rounded-md border p-2 transition-colors",
        selected ? "border-primary bg-accent/60" : "border-transparent hover:bg-accent/40",
      )}
    >
      <span className="relative flex size-10 shrink-0 items-center justify-center">
        {imageUrl ? (
          <img src={imageUrl} alt="" className="size-full rounded-md object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
            {name.slice(0, 2).toUpperCase()}
          </span>
        )}
        {decorationSrc && (
          <img
            src={decorationSrc}
            alt=""
            className="pointer-events-none absolute -inset-[16%] max-w-none object-contain"
          />
        )}
      </span>
      <span className="w-full truncate text-center text-[11px] text-muted-foreground">
        {label}
      </span>
    </button>
  );
}

export function ProfileTab() {
  const me = useQuery(api.users.getCurrentUser);
  const updateProfile = useMutation(api.users.updateProfile);
  const updateProfileExtended = useMutation(api.users.updateProfileExtended);
  const generateAvatarUploadUrl = useMutation(api.users.generateAvatarUploadUrl);
  const generateUploadUrl = useMutation(api.users.generateUploadUrl);
  const setAvatar = useMutation(api.users.setAvatar);
  const setBanner = useMutation(api.users.setBanner);
  const removeBanner = useMutation(api.users.removeBanner);
  const setAvatarAccent = useMutation(api.users.setAvatarAccent);
  const setNameplate = useMutation(api.users.setNameplate);
  const removeNameplate = useMutation(api.users.removeNameplate);
  const setAvatarDecoration = useMutation(api.users.setAvatarDecoration);
  const setCustomAvatarDecoration = useMutation(api.users.setCustomAvatarDecoration);
  const removeAvatarDecoration = useMutation(api.users.removeAvatarDecoration);

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [customStatus, setCustomStatus] = useState("");
  const [dob, setDob] = useState("");
  const [statusBubble, setStatusBubble] = useState<StatusBubbleKind>("speech");
  const [gradientStart, setGradientStart] = useState("");
  const [gradientEnd, setGradientEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [bannerUploading, setBannerUploading] = useState(false);
  const [nameplateUploading, setNameplateUploading] = useState(false);
  const [decorationUploading, setDecorationUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  /** What the crop editor is open on: a just-picked file, or the stored
   * original of an image already on the profile being repositioned. */
  const [cropping, setCropping] = useState<{
    kind: "avatar" | "banner";
    source: File | string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bannerFileInputRef = useRef<HTMLInputElement>(null);
  const nameplateFileInputRef = useRef<HTMLInputElement>(null);
  const decorationFileInputRef = useRef<HTMLInputElement>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    if (!me || hydrated.current) return;
    hydrated.current = true;
    setName(me.name);
    setUsername(me.username);
    setBio(me.bio ?? "");
    setCustomStatus(me.customStatus ?? "");
    setStatusBubble(me.statusBubble ?? "speech");
    setDob(me.dob ?? "");
    setGradientStart(me.borderGradientStart ?? "");
    setGradientEnd(me.borderGradientEnd ?? "");
  }, [me]);

  const normalizedUsername = username.trim().toLowerCase();
  const usernameChanged = !!me && normalizedUsername !== me.username;
  const usernameCheck = useQuery(
    api.users.searchByUsername,
    usernameChanged && normalizedUsername ? { username: normalizedUsername } : "skip"
  );
  const usernameTaken = usernameChanged && !!usernameCheck;

  const dirty =
    !!me &&
    (name !== me.name ||
      username !== me.username ||
      bio !== (me.bio ?? "") ||
      customStatus !== (me.customStatus ?? "") ||
      statusBubble !== (me.statusBubble ?? "speech") ||
      dob !== (me.dob ?? "") ||
      gradientStart !== (me.borderGradientStart ?? "") ||
      gradientEnd !== (me.borderGradientEnd ?? ""));

  /**
   * Save a crop, and — when it came from a newly-picked file — the untouched
   * original alongside it, so the crop can be adjusted later without asking
   * for the file again. Repositioning an existing image re-crops the stored
   * original and leaves it in place.
   */
  const saveCrop = async (crop: Blob) => {
    const target = cropping;
    if (!target) return;
    const isNewFile = target.source instanceof File;
    const setLoading = target.kind === "avatar" ? setUploading : setBannerUploading;

    setLoading(true);
    setError(null);
    try {
      const generate =
        target.kind === "avatar" ? generateAvatarUploadUrl : generateUploadUrl;
      const storageId = (await uploadToStorage(await generate(), crop)) as Id<"_storage">;
      const originalStorageId = isNewFile
        ? ((await uploadToStorage(await generate(), target.source as File)) as Id<"_storage">)
        : undefined;

      if (target.kind === "avatar") {
        const url = await setAvatar({ storageId, originalStorageId });
        // Sample the tint here, once, rather than in every client that later
        // renders this avatar in a call tile — see useAvatarAccent.
        const accent = await getAvatarColor(url);
        if (accent) await setAvatarAccent({ accent, sourceUrl: url });
      } else {
        await setBanner({ storageId, originalStorageId });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the image.");
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const uploadMedia = async (
    file: File,
    setLoading: (b: boolean) => void,
    save: (id: Id<"_storage">) => Promise<unknown>,
    ref: { current: HTMLInputElement | null },
    errMsg: string,
  ) => {
    setLoading(true);
    setError(null);
    try {
      const url = await generateUploadUrl();
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
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

  const handleNameplatePick = (file: File | undefined) =>
    file && void uploadMedia(file, setNameplateUploading, (id) => setNameplate({ storageId: id }), nameplateFileInputRef, "Failed to upload nameplate.");

  const handleDecorationPick = (file: File | undefined) => {
    if (!file) return;
    // Checked before the transfer as a courtesy — the mutation enforces it
    // once the bytes have landed, which is the only place the real size is
    // knowable. See src/lib/upload-limits.ts.
    if (file.size > MAX_DECORATION_BYTES) {
      setError(`Decorations must be smaller than ${MAX_DECORATION_LABEL}.`);
      if (decorationFileInputRef.current) decorationFileInputRef.current.value = "";
      return;
    }
    void uploadMedia(
      file,
      setDecorationUploading,
      (id) => setCustomAvatarDecoration({ storageId: id }),
      decorationFileInputRef,
      "Failed to upload decoration.",
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const trimmedStatus = customStatus.trim();
      const result = await updateProfile({ name, username, bio });
      await updateProfileExtended({
        customStatus: trimmedStatus,
        statusBubble,
        dob,
        borderGradientStart: gradientStart || undefined,
        borderGradientEnd: gradientEnd || undefined,
      });
      setName(result.name);
      setUsername(result.username);
      setBio(result.bio);
      setCustomStatus(trimmedStatus);
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
              {uploading ? <Loader2 className="size-5 animate-spin text-white" /> : <Camera className="size-5 text-white" />}
            </button>
          </div>
          <input
            ref={fileInputRef}
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
            {me.avatarOriginalUrl && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setCropping({ kind: "avatar", source: me.avatarOriginalUrl as string })
                }
              >
                <Crop className="size-3.5" />
                Adjust crop
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="profile-name">Display name</Label>
          <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="profile-username">Username</Label>
          <Input id="profile-username" value={username} onChange={(e) => setUsername(e.target.value)} maxLength={32} aria-invalid={usernameTaken} />
          {usernameTaken && <p className="text-xs text-destructive">That username is taken.</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="profile-bio">Bio</Label>
          <Textarea id="profile-bio" value={bio} onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))} rows={3} className="resize-none" />
          <p className="text-right text-xs text-muted-foreground">{bio.length}/{BIO_MAX}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="profile-status">Custom status</Label>
          <Input id="profile-status" value={customStatus} onChange={(e) => setCustomStatus(e.target.value.slice(0, 128))} maxLength={128} placeholder="What are you up to?" />
        </div>

        <div className="space-y-2">
          <Label>Status bubble</Label>
          <p className="text-xs text-muted-foreground">
            The shape your status is drawn in beside your avatar, on your
            profile card.
          </p>
          <div className="flex flex-wrap gap-2">
            {STATUS_BUBBLE_KINDS.map((option) => (
              <button
                key={option.kind}
                type="button"
                aria-pressed={statusBubble === option.kind}
                onClick={() => setStatusBubble(option.kind)}
                className={cn(
                  "flex flex-1 min-w-52 flex-col items-start gap-2 rounded-md border p-3 text-left transition-colors",
                  statusBubble === option.kind
                    ? "border-primary bg-accent/60"
                    : "border-border hover:bg-accent/40",
                )}
              >
                {/* Shown against an avatar-sized square, because the tail is
                    the difference between the two and it only reads as one
                    when there's something for it to point at. */}
                <span className="flex items-center gap-3">
                  <span className="size-8 shrink-0 rounded-md bg-muted" />
                  <StatusBubble
                    text={customStatus.trim() || "What are you up to?"}
                    kind={option.kind}
                    className="max-w-32"
                  />
                </span>
                <span className="text-xs font-medium">{option.label}</span>
                <span className="text-xs text-muted-foreground">{option.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="profile-dob">Date of birth</Label>
          {/* `max` is today, since a birthday in the future is always a
              mistake, and the native picker enforces it before the mutation
              has to. */}
          <Input
            id="profile-dob"
            type="date"
            value={dob}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setDob(e.target.value)}
            className="w-fit [color-scheme:dark]"
          />
          <p className="text-xs text-muted-foreground">
            Only the day and month are used, to wish you a happy birthday. Leave it
            empty to opt out.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Profile banner</Label>
          <div
            className={`h-24 rounded-md ${me.bannerUrl ? "bg-cover bg-center" : "flex items-center justify-center border-2 border-dashed bg-muted/40"}`}
            style={me.bannerUrl ? { backgroundImage: `url(${me.bannerUrl})` } : undefined}
          >
            {!me.bannerUrl && <Camera className="size-6 text-muted-foreground" />}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => bannerFileInputRef.current?.click()} disabled={bannerUploading}>
              {bannerUploading ? <Loader2 className="size-4 animate-spin" /> : "Upload banner"}
            </Button>
            {me.bannerOriginalUrl && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setCropping({ kind: "banner", source: me.bannerOriginalUrl as string })
                }
              >
                <Crop className="size-3.5" />
                Adjust crop
              </Button>
            )}
            {me.bannerUrl && (
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void removeBanner()}>Remove</Button>
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
          bannerUrl={me.bannerUrl}
        />

        <div className="space-y-2">
          <Label>Chat nameplate</Label>
          <div className={`h-24 overflow-hidden rounded-md ${me.nameplateUrl ? "" : "flex items-center justify-center border-2 border-dashed bg-muted/40"}`}>
            {me.nameplateUrl
              ? <img src={me.nameplateUrl} alt="Nameplate" className="h-full w-full object-cover" />
              : <Camera className="size-6 text-muted-foreground" />}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => nameplateFileInputRef.current?.click()} disabled={nameplateUploading}>
              {nameplateUploading ? <Loader2 className="size-4 animate-spin" /> : "Upload nameplate"}
            </Button>
            {me.nameplateUrl && (
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void removeNameplate()}>Remove</Button>
            )}
          </div>
          <input ref={nameplateFileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleNameplatePick(e.target.files?.[0])} />
        </div>

        <div className="space-y-2">
          <Label>Avatar decoration</Label>
          <p className="text-xs text-muted-foreground">
            A frame drawn around your avatar wherever you appear. On your
            birthday you&apos;ll wear one made for the day instead, and get this
            one back the morning after.
          </p>
          <div className="flex flex-wrap items-start gap-2">
            <DecorationSwatch
              label="None"
              imageUrl={me.imageUrl}
              name={me.name}
              selected={!me.avatarDecoration}
              onSelect={() => void setAvatarDecoration({ value: "" })}
            />
            {DECORATION_PRESETS.map((preset) => (
              <DecorationSwatch
                key={preset.key}
                label={preset.name}
                imageUrl={me.imageUrl}
                name={me.name}
                decorationSrc={preset.src}
                selected={me.avatarDecoration === preset.value}
                onSelect={() => void setAvatarDecoration({ value: preset.value })}
              />
            ))}
            {/* Only shown once there is one: an empty "yours" slot would look
                like a preset that failed to load. */}
            {isCustomDecoration(me.avatarDecoration) && (
              <DecorationSwatch
                label="Yours"
                imageUrl={me.imageUrl}
                name={me.name}
                decorationSrc={me.avatarDecoration}
                selected
                onSelect={() => {}}
              />
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => decorationFileInputRef.current?.click()}
              disabled={decorationUploading}
            >
              {decorationUploading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Upload your own"
              )}
            </Button>
            {me.avatarDecoration && (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={() => void removeAvatarDecoration()}
              >
                Remove
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            A square, transparent PNG or GIF works best — it isn&apos;t cropped,
            it&apos;s drawn over and around your avatar. Up to{" "}
            {MAX_DECORATION_LABEL}.
          </p>
          <input
            ref={decorationFileInputRef}
            type="file"
            accept="image/png,image/gif,image/webp,image/svg+xml"
            className="hidden"
            onChange={(e) => handleDecorationPick(e.target.files?.[0])}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex items-center gap-2">
          <Button onClick={() => void handleSave()} disabled={!dirty || saving || usernameTaken}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : "Save changes"}
          </Button>
          {saved && !dirty && <span className="text-xs text-muted-foreground">Saved.</span>}
        </div>

        <ImageCropDialog
          open={!!cropping}
          onOpenChange={(open) => !open && setCropping(null)}
          source={cropping?.source ?? null}
          shape={cropping?.kind === "banner" ? BANNER_CROP : AVATAR_CROP}
          title={cropping?.kind === "banner" ? "Position your banner" : "Position your avatar"}
          onCropped={saveCrop}
        />
      </CardContent>
    </Card>
  );
}
