"use client";

import {
  Flag,
  Gamepad2,
  Hand,
  Hash,
  Lightbulb,
  type LucideIcon,
  Pizza,
  Plane,
  Search,
  Smile,
  Sprout,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { CustomEmojiImage } from "@/components/custom-emoji-image";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { useAccessibleEmojis } from "@/hooks/use-accessible-emojis";
import type { ServerEmoji } from "@/lib/custom-emoji";
import { SYSTEM_EMOJI_GROUPS, filterSystemEmoji, type SystemEmoji } from "@/lib/system-emoji";
import { useSmoothScroll } from "@/hooks/use-smooth-scroll";
import { cn } from "@/lib/utils";

/** Icon per Unicode emoji group, for the left rail. Keys are the group names
 * `unicode-emoji-json` uses verbatim. */
const GROUP_ICON: Record<string, LucideIcon> = {
  "Smileys & Emotion": Smile,
  "People & Body": Hand,
  "Animals & Nature": Sprout,
  "Food & Drink": Pizza,
  "Travel & Places": Plane,
  Activities: Gamepad2,
  Objects: Lightbulb,
  Symbols: Hash,
  Flags: Flag,
};

/** Cells per row — fixed so every section lines up. */
const COLUMNS = 8;

/** What the bottom preview bar is currently describing. */
interface Preview {
  shortcode: string;
  imageUrl?: string;
  emoji?: string;
}

/** Stable DOM ids so the rail can scroll to a section. */
const sectionId = (key: string) => `emoji-section-${key.replace(/[^a-zA-Z0-9]/g, "-")}`;

function RailButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
        "hover:bg-accent hover:text-foreground",
        active && "bg-accent text-foreground"
      )}
    >
      {children}
    </button>
  );
}

/**
 * One emoji button. Uses a native `title` rather than a Radix tooltip on
 * purpose: the grid holds ~1900 of these, and that many tooltip roots is a
 * great deal of machinery for a hover hint. The preview bar along the bottom
 * is the richer affordance.
 */
function EmojiButton({
  shortcode,
  onClick,
  onPreview,
  children,
}: {
  shortcode: string;
  onClick: () => void;
  onPreview: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={shortcode}
      onClick={onClick}
      onMouseEnter={onPreview}
      onFocus={onPreview}
      className="flex size-8 shrink-0 items-center justify-center rounded-md text-xl leading-none transition-colors hover:bg-accent"
    >
      {children}
    </button>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="sticky top-0 z-10 bg-popover px-1 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

function EmojiGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-8 justify-items-center gap-0.5">{children}</div>;
}

/**
 * The emoji picker body, shared by the composers and the message react button.
 *
 * Custom emoji come from *every* community the user is in, not just the one
 * they're looking at — a reaction or message can carry any of them.
 */
export function ReactionPickerContent({
  onSelect,
}: {
  /**
   * `text` is the readable form to type into a composer — `:name:` for a
   * custom emoji, the character itself for a Unicode one. `custom` is set
   * only for custom emoji, for callers that need the stored `<:name:id>`
   * form instead (reactions, which must resolve without a name lookup).
   */
  onSelect: (text: string, custom?: ServerEmoji) => void;
}) {
  const { groups } = useAccessibleEmojis();
  const [query, setQuery] = useState("");
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  // A plain scroll container rather than Radix's ScrollArea: that one wraps
  // children in a `display: table` element, which shrink-wraps to content and
  // gives the grid a spurious horizontal scrollbar.
  const scrollRef = useRef<HTMLDivElement>(null);
  useSmoothScroll(scrollRef);

  const searchResults = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return null;
    const custom: ServerEmoji[] = [];
    for (const group of groups) {
      for (const emoji of group.emojis) {
        if (emoji.name.toLowerCase().includes(needle)) custom.push(emoji);
      }
    }
    return { custom, system: filterSystemEmoji(needle) };
  }, [query, groups]);

  const scrollTo = (key: string) => {
    setActiveSection(key);
    const container = scrollRef.current;
    const target = container?.querySelector<HTMLElement>(`#${sectionId(key)}`);
    if (!container || !target) return;
    container.scrollTo({ top: target.offsetTop, behavior: "smooth" });
  };

  const customButton = (emoji: ServerEmoji) => (
    <EmojiButton
      key={emoji.id}
      shortcode={`:${emoji.name}:`}
      onClick={() => onSelect(`:${emoji.name}:`, emoji)}
      onPreview={() => setPreview({ shortcode: `:${emoji.name}:`, imageUrl: emoji.imageUrl })}
    >
      <CustomEmojiImage src={emoji.imageUrl} name={emoji.name} className="size-6 object-contain" />
    </EmojiButton>
  );

  const systemButton = (emoji: SystemEmoji) => (
    <EmojiButton
      key={emoji.slug}
      shortcode={`:${emoji.slug}:`}
      onClick={() => onSelect(emoji.emoji)}
      onPreview={() => setPreview({ shortcode: `:${emoji.slug}:`, emoji: emoji.emoji })}
    >
      {emoji.emoji}
    </EmojiButton>
  );

  return (
    <div className="flex h-[26rem] w-[21rem] overflow-hidden rounded-md bg-popover">
      {/* Rail: one entry per server with emoji, then the Unicode categories. */}
      <div className="flex w-11 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r py-2">
        {groups.map((group) => (
          <RailButton
            key={group.communityId}
            label={group.communityName}
            active={activeSection === group.communityId}
            onClick={() => scrollTo(group.communityId)}
          >
            <Avatar className="size-6 rounded-md">
              <AvatarImage src={group.communityImageUrl} alt="" className="rounded-md" />
              <AvatarFallback className="rounded-md text-[9px]">
                {group.communityName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </RailButton>
        ))}

        {groups.length > 0 && <div className="my-1 h-px w-6 shrink-0 bg-border" />}

        {SYSTEM_EMOJI_GROUPS.map(({ group }) => {
          const Icon = GROUP_ICON[group] ?? Smile;
          return (
            <RailButton
              key={group}
              label={group}
              active={activeSection === group}
              onClick={() => scrollTo(group)}
            >
              <Icon className="size-4" />
            </RailButton>
          );
        })}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative shrink-0 p-2">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search emoji…"
            className="h-8 pl-7 text-sm"
          />
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2">
          {searchResults ? (
            <>
              {searchResults.custom.length === 0 && searchResults.system.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">No emoji found.</p>
              )}
              {searchResults.custom.length > 0 && (
                <>
                  <SectionHeader>Custom</SectionHeader>
                  <EmojiGrid>{searchResults.custom.map(customButton)}</EmojiGrid>
                </>
              )}
              {searchResults.system.length > 0 && (
                <>
                  <SectionHeader>Emoji</SectionHeader>
                  <EmojiGrid>{searchResults.system.map(systemButton)}</EmojiGrid>
                </>
              )}
            </>
          ) : (
            <>
              {groups.map((group) => (
                <section key={group.communityId} id={sectionId(group.communityId)}>
                  <SectionHeader>{group.communityName}</SectionHeader>
                  <EmojiGrid>{group.emojis.map(customButton)}</EmojiGrid>
                </section>
              ))}

              {SYSTEM_EMOJI_GROUPS.map(({ group, emojis }) => (
                <section
                  key={group}
                  id={sectionId(group)}
                  // Lets the browser skip laying out off-screen categories —
                  // without it, mounting ~1900 buttons is a visible stall when
                  // the picker opens. The intrinsic size keeps the scrollbar
                  // and `offsetTop` (which the rail scrolls to) stable.
                  style={{
                    contentVisibility: "auto",
                    containIntrinsicSize: `auto ${Math.ceil(emojis.length / COLUMNS) * 34 + 28}px`,
                  }}
                >
                  <SectionHeader>{group}</SectionHeader>
                  <EmojiGrid>{emojis.map(systemButton)}</EmojiGrid>
                </section>
              ))}
            </>
          )}
        </div>

        {/* One bar showing whatever the pointer is over — including how to
            type it — instead of a tooltip per emoji. */}
        <div className="flex h-10 shrink-0 items-center gap-2 border-t px-3">
          {preview ? (
            <>
              {preview.imageUrl ? (
                <CustomEmojiImage
                  src={preview.imageUrl}
                  name={preview.shortcode.replace(/:/g, "")}
                  className="size-5 shrink-0 object-contain"
                />
              ) : (
                <span className="shrink-0 text-lg leading-none">{preview.emoji}</span>
              )}
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{preview.shortcode}</span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">Pick an emoji…</span>
          )}
        </div>
      </div>
    </div>
  );
}
