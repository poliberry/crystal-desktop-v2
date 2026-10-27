"use client";

import { cn } from "@/lib/utils";

/**
 * A colour box that opens the system picker, drawn as Illustrator draws them: square, a thin
 * dark outline with a light inner one, and a red diagonal slash when there is no colour. With
 * `ring`, it is a stroke box — a frame with a hole, the other box showing through.
 */
export function Swatch({
  value,
  onChange,
  size = 20,
  ring = false,
  disabled = false,
  label,
  className,
}: {
  value: string | null;
  onChange?: (c: string) => void;
  size?: number;
  ring?: boolean;
  disabled?: boolean;
  label: string;
  className?: string;
}) {
  const hex = value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#ffffff";
  const none = value === null;
  const hole = Math.round(size * 0.3);
  return (
    <label
      className={cn("relative block shrink-0 cursor-pointer overflow-hidden", disabled && "cursor-default opacity-60", className)}
      style={{ width: size, height: size, border: "1px solid var(--ai-edge)", outline: "1px solid color-mix(in oklch, var(--foreground), transparent 70%)", outlineOffset: -2, background: none ? "#fff" : hex }}
    >
      {none && (
        <span aria-hidden className="absolute inset-0" style={{ background: "linear-gradient(to top right, transparent calc(50% - 1px), #e11 calc(50% - 1px), #e11 calc(50% + 1px), transparent calc(50% + 1px))" }} />
      )}
      {ring && <span aria-hidden className="absolute border bg-[var(--ai-body)]" style={{ inset: hole, borderColor: "var(--ai-edge)" }} />}
      <input
        type="color"
        aria-label={label}
        disabled={disabled}
        value={hex}
        onChange={(e) => onChange?.(e.target.value)}
        className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-default"
      />
    </label>
  );
}
