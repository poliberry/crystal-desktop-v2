"use client";

import { useMutation, useQuery } from "convex/react";
import { Briefcase, Check, Coffee, Gamepad2, BookOpen, Loader2, Sparkles, Trash2, Wand2 } from "lucide-react";
import { useState } from "react";

import { api } from "../../../../convex/_generated/api";
import type { TemplateChoice } from "@/components/community/create/wizard";
import { SCRATCH_CHOICE } from "@/components/community/create/wizard";
import { Input } from "@/components/ui/input";
import {
  type CommunitySetup,
  PRESET_TEMPLATES,
  SCRATCH_SETUP,
  describeSetup,
} from "@/lib/community-templates";
import { cn } from "@/lib/utils";

const ICONS = {
  gamepad: Gamepad2,
  book: BookOpen,
  coffee: Coffee,
  sparkles: Sparkles,
  briefcase: Briefcase,
} as const;

function OptionCard({
  selected,
  icon: Icon,
  title,
  description,
  onClick,
  onDelete,
  trailing,
}: {
  selected: boolean;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  onClick: () => void;
  onDelete?: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "group relative flex items-start gap-3 rounded-lg border bg-gradient-to-br from-foreground/[0.07] via-foreground/[0.02] to-transparent p-3 text-left transition-colors",
        selected ? "border-primary" : "border-foreground/10 hover:border-foreground/25",
      )}
    >
      <button type="button" onClick={onClick} className="absolute inset-0 rounded-lg" aria-label={title} />
      <div className="pointer-events-none flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <Icon className="size-4" />
      </div>
      <div className="pointer-events-none min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
        {trailing}
      </div>
      {selected && <Check className="pointer-events-none size-4 shrink-0 text-primary" />}
      {onDelete && (
        <button
          type="button"
          aria-label={`Delete ${title}`}
          onClick={onDelete}
          className="relative z-10 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/**
 * Where the community starts: from nothing, from one of the presets, from a
 * template of your own, or from somebody else's code.
 */
export function TemplateStep({
  choice,
  onChoose,
}: {
  choice: TemplateChoice;
  onChoose: (choice: TemplateChoice, setup: CommunitySetup) => void;
}) {
  const mine = useQuery(api.communityTemplates.listMine) ?? [];
  const removeTemplate = useMutation(api.communityTemplates.remove);
  const [code, setCode] = useState("");
  const normalised = code.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const shared = useQuery(
    api.communityTemplates.getByCode,
    normalised.length === 8 ? { code: normalised } : "skip",
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-2 sm:grid-cols-2">
        <OptionCard
          selected={choice.kind === "scratch"}
          icon={Wand2}
          title="Start from scratch"
          description="A text channel and a voice channel. Build the rest yourself."
          onClick={() => onChoose(SCRATCH_CHOICE, SCRATCH_SETUP)}
        />
        {PRESET_TEMPLATES.map((preset) => {
          const Icon = ICONS[preset.icon];
          return (
            <OptionCard
              key={preset.id}
              selected={choice.kind === "preset" && choice.key === preset.id}
              icon={Icon}
              title={preset.name}
              description={preset.description}
              trailing={
                <p className="mt-1 text-[11px] text-muted-foreground/80">
                  {describeSetup(preset.setup)}
                </p>
              }
              onClick={() =>
                onChoose({ kind: "preset", key: preset.id, name: preset.name }, preset.setup)
              }
            />
          );
        })}
      </div>

      {mine.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Your templates</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {mine.map((template) => (
              <OptionCard
                key={template.id}
                selected={choice.kind === "saved" && choice.key === template.id}
                icon={Sparkles}
                title={template.name}
                description={template.description || describeSetup(template.setup)}
                trailing={
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground/80">
                    {template.code}
                  </p>
                }
                onClick={() =>
                  onChoose(
                    {
                      kind: "saved",
                      key: template.id,
                      name: template.name,
                      templateId: template.id,
                    },
                    template.setup,
                  )
                }
                onDelete={() => void removeTemplate({ templateId: template.id })}
              />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Have a template code?</h3>
        <Input
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder="ABCD2345"
          maxLength={12}
          className="max-w-xs font-mono tracking-widest"
          aria-label="Template code"
        />
        {normalised.length === 8 && shared === undefined && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> Looking that up…
          </p>
        )}
        {normalised.length === 8 && shared === null && (
          <p className="text-xs text-destructive">No template has that code.</p>
        )}
        {shared && (
          <OptionCard
            selected={choice.kind === "code" && choice.key === shared.code}
            icon={Sparkles}
            title={shared.name}
            description={
              shared.description ||
              `${describeSetup(shared.setup)}${shared.authorName ? ` · by ${shared.authorName}` : ""}`
            }
            onClick={() =>
              onChoose(
                {
                  kind: "code",
                  key: shared.code,
                  name: shared.name,
                  templateId: shared.id,
                },
                shared.setup,
              )
            }
          />
        )}
      </section>
    </div>
  );
}
