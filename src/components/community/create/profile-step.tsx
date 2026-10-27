"use client";

import { Camera, ImagePlus, X } from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

function Picker({
  label,
  hint,
  previewUrl,
  onPick,
  onClear,
  className,
  shape,
}: {
  label: string;
  hint: string;
  previewUrl?: string;
  onPick: (file: File) => void;
  onClear: () => void;
  className?: string;
  shape: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onPick(file);
          event.target.value = "";
        }}
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => input.current?.click()}
          className={cn(
            "group relative flex shrink-0 items-center justify-center overflow-hidden border-2 border-dashed border-foreground/20 bg-foreground/5 text-muted-foreground transition-colors hover:border-primary/60",
            shape,
            className,
          )}
        >
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="" className="size-full object-cover" />
          ) : (
            <ImagePlus className="size-6" />
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100">
            <Camera className="size-5" />
          </span>
        </button>
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">{hint}</p>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => input.current?.click()}>
              {previewUrl ? "Change" : "Upload"}
            </Button>
            {previewUrl && (
              <Button type="button" size="sm" variant="ghost" onClick={onClear}>
                <X className="size-3.5" />
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The community's name, icon and banner. */
export function ProfileStep({
  name,
  onName,
  iconUrl,
  onIcon,
  bannerUrl,
  onBanner,
}: {
  name: string;
  onName: (name: string) => void;
  iconUrl?: string;
  onIcon: (file: File | null) => void;
  bannerUrl?: string;
  onBanner: (file: File | null) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <Label htmlFor="new-community-name">Name</Label>
        <Input
          id="new-community-name"
          value={name}
          onChange={(event) => onName(event.target.value)}
          placeholder="Silver Skies"
          maxLength={64}
          autoFocus
        />
      </div>
      <Picker
        label="Icon"
        hint="Square works best. You can change it any time in settings."
        previewUrl={iconUrl}
        onPick={onIcon}
        onClear={() => onIcon(null)}
        shape="size-24 rounded-2xl"
      />
      <Picker
        label="Banner"
        hint="Shown at the top of the sidebar and behind the overview."
        previewUrl={bannerUrl}
        onPick={onBanner}
        onClear={() => onBanner(null)}
        shape="h-24 w-48 rounded-xl"
      />
    </div>
  );
}
