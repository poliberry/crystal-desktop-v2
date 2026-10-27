"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** The spring every step in the sign-in screen moves with: the same feel as the community wizard's. */
export const STEP_SPRING = { type: "spring", stiffness: 420, damping: 34 } as const;

/**
 * One step of the screen. Steps slide in from the side they logically come from (forwards from the
 * right, back from the left) and the old one leaves the other way, so the screen reads as one
 * continuous place rather than a stack of pages. With reduced motion they only fade.
 */
export function StepSwitch({ id, direction, children, className }: { id: string; direction: 1 | -1; children: React.ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  const dx = reduced ? 0 : 28 * direction;
  return (
    <AnimatePresence mode="wait" initial={false} custom={dx}>
      <motion.div
        key={id}
        custom={dx}
        variants={{
          enter: (d: number) => ({ opacity: 0, x: d }),
          center: { opacity: 1, x: 0 },
          exit: (d: number) => ({ opacity: 0, x: -d }),
        }}
        initial="enter"
        animate="center"
        exit="exit"
        transition={reduced ? { duration: 0.12 } : STEP_SPRING}
        className={className}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/** The heading and line of explanation at the top of a step. */
export function StepHeader({ title, description }: { title: React.ReactNode; description?: React.ReactNode }) {
  return (
    <header className="space-y-1.5">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>}
    </header>
  );
}

/** An inline error that eases in rather than appearing, and a gentle shake the first time it does. */
export function FieldError({ message }: { message?: string | null }) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {message && (
        <motion.p
          key={message}
          role="alert"
          initial={{ opacity: 0, height: 0, x: 0 }}
          animate={{ opacity: 1, height: "auto", x: reduced ? 0 : [0, -5, 5, -3, 3, 0] }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.28 }}
          className="flex items-start gap-1.5 overflow-hidden text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{message}</span>
        </motion.p>
      )}
    </AnimatePresence>
  );
}

/** Who the screen is talking to, once it knows: their picture and names, carried from step to step. */
export function AccountChip({
  name,
  username,
  imageUrl,
  detail,
  layoutId = "auth-account-chip",
}: {
  name: string;
  username?: string;
  imageUrl?: string;
  detail?: string;
  layoutId?: string;
}) {
  return (
    <motion.div
      layout
      layoutId={layoutId}
      transition={STEP_SPRING}
      className="flex items-center gap-3 rounded-xl border border-foreground/10 bg-foreground/5 p-3"
    >
      <Avatar className="size-11">
        <AvatarImage src={imageUrl} alt="" />
        <AvatarFallback className="text-base">{name.slice(0, 1).toUpperCase() || "?"}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{name}</p>
        {username && <p className="truncate text-xs text-muted-foreground">@{username}</p>}
        {detail && <p className="truncate text-xs text-muted-foreground">{detail}</p>}
      </div>
    </motion.div>
  );
}

/** Password input with a show/hide toggle. */
export function PasswordField({
  id,
  value,
  onChange,
  label,
  autoComplete,
  autoFocus,
  invalid,
  disabled,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  label?: string;
  autoComplete: "current-password" | "new-password";
  autoFocus?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
      )}
      <div className="relative">
        <Input
          id={id}
          name={id}
          type={shown ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          aria-invalid={invalid}
          disabled={disabled}
          placeholder={placeholder}
          className="h-11 pr-11"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={shown ? "Hide password" : "Show password"}
          onClick={() => setShown((s) => !s)}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
        >
          {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </div>
  );
}

/** A rough read on a password, to nudge people past the minimum. Not a promise: the server only enforces length and a short denylist. */
export function passwordStrength(password: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!password) return { score: 0, label: "" };
  let score = 0;
  if (password.length >= 10) score++;
  if (password.length >= 14) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;
  // Spaces make a passphrase, which is long and easy to remember.
  if (/\s/.test(password) && password.length >= 16) score = Math.max(score, 3);
  const s = Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
  return { score: s, label: ["Too short", "Okay", "Good", "Strong", "Excellent"][s]! };
}

export function StrengthMeter({ password }: { password: string }) {
  const { score, label } = passwordStrength(password);
  const colors = ["bg-foreground/15", "bg-orange-500", "bg-yellow-500", "bg-emerald-500", "bg-emerald-400"];
  return (
    <div className="space-y-1" aria-live="polite">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-foreground/10">
            <motion.div
              className={cn("h-full rounded-full", colors[score])}
              initial={false}
              animate={{ width: score >= i ? "100%" : "0%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            />
          </div>
        ))}
      </div>
      <p className="h-4 text-xs text-muted-foreground">{password ? label : ""}</p>
    </div>
  );
}

/**
 * A code, one box per digit. A single real input sits invisibly over the boxes, so typing, pasting,
 * password-manager fill and the phone's "from messages" suggestion all work as they do on any input;
 * the boxes only draw what it holds.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  length,
  disabled,
  invalid,
  autoFocus = true,
  label = "Verification code",
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  length: number;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  label?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  // A wrong code is cleared, and focus returned, so the next try is just typing.
  useEffect(() => {
    if (invalid && !disabled) ref.current?.focus();
  }, [invalid, disabled]);

  const chars = value.split("");
  return (
    <motion.div
      animate={invalid && !reduced ? { x: [0, -8, 8, -5, 5, 0] } : { x: 0 }}
      transition={{ duration: 0.3 }}
      className="relative w-full"
      onClick={() => ref.current?.focus()}
    >
      <input
        ref={ref}
        value={value}
        aria-label={label}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={length + 4}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          const next = event.target.value.replace(/\D/g, "").slice(0, length);
          onChange(next);
          if (next.length === length) onComplete?.(next);
        }}
        className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0"
      />
      <div className="flex justify-between gap-1.5" aria-hidden>
        {Array.from({ length }, (_, i) => {
          const active = focused && (i === chars.length || (i === length - 1 && chars.length === length));
          return (
            <div
              key={i}
              className={cn(
                "relative flex h-12 min-w-0 flex-1 items-center justify-center rounded-lg border bg-foreground/5 text-xl font-semibold tabular-nums transition-colors",
                invalid ? "border-destructive" : active ? "border-primary" : "border-foreground/15",
                disabled && "opacity-50",
              )}
            >
              <AnimatePresence initial={false}>
                {chars[i] && (
                  <motion.span
                    key={chars[i]! + i}
                    initial={{ opacity: 0, scale: 0.6, y: 6 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ type: "spring", stiffness: 600, damping: 28 }}
                  >
                    {chars[i]}
                  </motion.span>
                )}
              </AnimatePresence>
              {active && !chars[i] && <span className="absolute h-5 w-px animate-pulse bg-primary" />}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

/** A spinner that fits inside a button. */
export function Spinner() {
  return <Loader2 className="size-4 animate-spin" />;
}

/** Counts down to `until` (ms since the epoch), re-rendering each second; 0 when there's nothing to wait for. */
export function useCountdown(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until || until <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}
