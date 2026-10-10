"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

import { Swatch } from "@/studio/editor/swatch";
import { round } from "@/studio/model/doc";
import { cn } from "@/lib/utils";

/**
 * The small controls every panel and the control bar are made of, drawn the way Illustrator's
 * are — a label beside a tight value field, 11px type — from the app's theme tokens, so they
 * follow dark, light and theme packs rather than carrying colours of their own.
 */

export function Row({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-[64px_1fr] items-center gap-2", className)}>
      <span className="text-[11px] text-[var(--ai-dim)]">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A panel section that folds, as the sections of Illustrator's Properties and Appearance panels do. */
export function Section({ title, children, defaultOpen = true, action }: { title: string; children: React.ReactNode; defaultOpen?: boolean; action?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="ai-edge-b">
      <div className="flex h-7 items-center pr-1.5">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex h-full min-w-0 flex-1 items-center gap-1 px-1.5 text-left text-[11px] font-semibold text-[var(--ai-text)] hover:text-foreground">
          {open ? <ChevronDown className="size-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3 shrink-0 text-muted-foreground" />}
          <span className="truncate">{title}</span>
        </button>
        {action}
      </div>
      {open && <div className="space-y-1.5 px-2.5 pb-2.5">{children}</div>}
    </section>
  );
}

/** A number you can type into, applied as you type and left alone while it is half-written. Arrow keys step it. */
export function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  suffix,
  className,
  disabled,
  title,
}: {
  label?: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const [text, setText] = useState(String(round(value)));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(round(value)));
  }, [value, focused]);
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  return (
    <label
      title={title}
      className={cn("ai-field gap-1", disabled && "pointer-events-none opacity-50", className)}
    >
      {label && <span className="w-3 shrink-0 text-center text-muted-foreground">{label}</span>}
      <input
        value={text}
        inputMode="decimal"
        disabled={disabled}
        onFocus={(e) => {
          setFocused(true);
          e.currentTarget.select();
        }}
        onBlur={() => {
          setFocused(false);
          setText(String(round(value)));
        }}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(n)) onChange(clamp(n));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            onChange(clamp(round(value + (e.key === "ArrowUp" ? step : -step) * (e.shiftKey ? 10 : 1))));
          }
        }}
        className="text-right tabular-nums"
      />
      {suffix && <span className="text-muted-foreground">{suffix}</span>}
    </label>
  );
}

/** A colour: a swatch that opens the system picker, and the value beside it. */
export function ColourField({ value, onChange, className }: { value: string; onChange: (c: string) => void; className?: string }) {
  const hex = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#ffffff";
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Swatch value={hex} onChange={onChange} size={20} label="Colour" />
      <label className="ai-field min-w-0 flex-1">
        <input value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} className="font-mono" />
      </label>
    </div>
  );
}

/** A slider with its value beside it, as Illustrator's opacity and effect sliders are. */
export function SliderField({ value, onChange, min, max, step = 1, suffix }: { value: number; onChange: (n: number) => void; min: number; max: number; step?: number; suffix?: string }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 min-w-0 flex-1 cursor-pointer accent-[var(--color-primary)]"
      />
      <NumberField value={value} onChange={onChange} min={min} max={max} step={step} suffix={suffix} className="w-16 shrink-0" />
    </div>
  );
}
