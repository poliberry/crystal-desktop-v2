"use client";

import { Plus, Trash2 } from "lucide-react";
import { useMemo } from "react";

import { ChannelGlyph, channelKindLabel } from "@/components/community/channel-glyph";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type SetupChannel, SETUP_LIMITS } from "@/lib/community-templates";
import { cn } from "@/lib/utils";

interface Group {
  category: string | undefined;
  /** Where its first channel is in the flat list: a key that survives its
   * category being renamed. */
  firstIndex: number;
  items: { channel: SetupChannel; index: number }[];
}

/** The channels, grouped under their categories in the order they appear. */
export function ChannelsStep({
  channels,
  onChange,
}: {
  channels: SetupChannel[];
  onChange: (channels: SetupChannel[]) => void;
}) {
  const groups = useMemo(() => {
    const result: Group[] = [];
    channels.forEach((channel, index) => {
      let group = result.find((g) => g.category === channel.category);
      if (!group) {
        group = { category: channel.category, firstIndex: index, items: [] };
        result.push(group);
      }
      group.items.push({ channel, index });
    });
    return result;
  }, [channels]);

  const atLimit = channels.length >= SETUP_LIMITS.channels;

  const update = (index: number, patch: Partial<SetupChannel>) =>
    onChange(channels.map((channel, i) => (i === index ? { ...channel, ...patch } : channel)));

  const renameCategory = (from: string | undefined, to: string) =>
    onChange(
      channels.map((channel) =>
        channel.category === from ? { ...channel, category: to || undefined } : channel,
      ),
    );

  /** A new channel at the end of a group, rather than the end of the list. */
  const addTo = (group: Group, type: "text" | "voice") => {
    const last = group.items[group.items.length - 1]?.index ?? channels.length - 1;
    const next = [...channels];
    next.splice(last + 1, 0, {
      name: type === "text" ? "new-channel" : "New voice",
      type,
      category: group.category,
    });
    onChange(next);
  };

  const addCategory = () => {
    const taken = new Set(channels.map((c) => c.category));
    let name = "New category";
    for (let n = 2; taken.has(name); n++) name = `New category ${n}`;
    onChange([...channels, { name: "new-channel", type: "text", category: name }]);
  };

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section
          key={group.firstIndex}
          className="space-y-1.5 rounded-lg border border-foreground/10 bg-gradient-to-br from-foreground/[0.07] to-transparent p-3"
        >
          <Input
            value={group.category ?? ""}
            placeholder="No category"
            aria-label="Category name"
            maxLength={64}
            onChange={(event) => renameCategory(group.category, event.target.value)}
            className="h-7 border-transparent bg-transparent px-1 text-[11px] font-semibold tracking-wide uppercase shadow-none focus-visible:border-input"
          />
          {group.items.map(({ channel, index }) => (
            <div key={index} className="flex items-center gap-1.5">
              {channel.surface ? (
                // A special channel keeps what it is: a feed turned into a voice
                // channel would be neither.
                <span
                  title={`${channelKindLabel(channel.type, channel.surface)} — a special channel`}
                  className="flex size-8 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary"
                >
                  <ChannelGlyph type={channel.type} surface={channel.surface} className="size-4" />
                </span>
              ) : (
                <button
                  type="button"
                  title={channel.type === "text" ? "Text — click for voice" : "Voice — click for text"}
                  aria-label={channel.type === "text" ? "Text channel" : "Voice channel"}
                  onClick={() => update(index, { type: channel.type === "text" ? "voice" : "text" })}
                  className="flex size-8 shrink-0 items-center justify-center rounded-md border border-foreground/10 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                >
                  <ChannelGlyph type={channel.type} className="size-4" />
                </button>
              )}
              <Input
                value={channel.name}
                maxLength={64}
                aria-label="Channel name"
                onChange={(event) => update(index, { name: event.target.value })}
                className="h-8"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                aria-label="Remove channel"
                disabled={channels.length <= 1}
                onClick={() => onChange(channels.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
          <div className="flex gap-1.5 pt-1">
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" disabled={atLimit} onClick={() => addTo(group, "text")}>
              <Plus className="size-3" /> Text
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" disabled={atLimit} onClick={() => addTo(group, "voice")}>
              <Plus className="size-3" /> Voice
            </Button>
          </div>
        </section>
      ))}
      <Button type="button" variant="outline" size="sm" disabled={atLimit} onClick={addCategory} className={cn(atLimit && "opacity-50")}>
        <Plus className="size-3.5" />
        Add a category
      </Button>
    </div>
  );
}
