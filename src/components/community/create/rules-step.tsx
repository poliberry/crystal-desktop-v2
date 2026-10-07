"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { type SetupRule, SETUP_LIMITS, SUGGESTED_RULES } from "@/lib/community-templates";

/** The community's rules — shown as a card on its overview. */
export function RulesStep({
  rules,
  onChange,
}: {
  rules: SetupRule[];
  onChange: (rules: SetupRule[]) => void;
}) {
  const update = (index: number, patch: Partial<SetupRule>) =>
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= rules.length) return;
    const next = [...rules];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const atLimit = rules.length >= SETUP_LIMITS.rules;
  const suggestions = SUGGESTED_RULES.filter((s) => !rules.some((r) => r.title === s.title));

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {rules.length === 0 && (
          <p className="rounded-lg border border-dashed border-foreground/15 p-4 text-sm text-muted-foreground">
            No rules yet. Rules appear on the community&apos;s overview, where everyone sees them
            first. You can skip this and add them later.
          </p>
        )}
        {rules.map((rule, index) => (
          <div
            key={index}
            className="flex gap-2 rounded-lg border border-foreground/10 bg-gradient-to-br from-foreground/[0.07] to-transparent p-3"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1 space-y-1.5">
              <Input
                value={rule.title}
                maxLength={120}
                placeholder="Be respectful"
                aria-label={`Rule ${index + 1}`}
                onChange={(event) => update(index, { title: event.target.value })}
              />
              <Textarea
                rows={2}
                value={rule.body ?? ""}
                maxLength={600}
                placeholder="Optional — a sentence of explanation"
                className="resize-none text-xs"
                onChange={(event) => update(index, { body: event.target.value })}
              />
            </div>
            <div className="flex shrink-0 flex-col items-center gap-0.5">
              <Button type="button" variant="ghost" size="icon" className="size-6" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)}>
                <ArrowUp className="size-3.5" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="size-6" aria-label="Move down" disabled={index === rules.length - 1} onClick={() => move(index, 1)}>
                <ArrowDown className="size-3.5" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="size-6 text-destructive" aria-label="Remove rule" onClick={() => onChange(rules.filter((_, i) => i !== index))}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={atLimit}
        onClick={() => onChange([...rules, { title: "" }])}
      >
        <Plus className="size-3.5" />
        Add a rule
      </Button>

      {suggestions.length > 0 && !atLimit && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Suggestions</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.title}
                type="button"
                onClick={() => onChange([...rules, { ...suggestion }])}
                className="rounded-full border border-foreground/15 px-2.5 py-1 text-xs transition-colors hover:bg-foreground/10"
              >
                + {suggestion.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
