"use client";

import { Loader2, Plus, X } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cleanPollText, POLL_DURATIONS, POLL_LIMITS } from "../../../convex/lib/pollPure";
import { errorText } from "./poll-format";

export interface NewPoll {
  question: string;
  options: string[];
  multi: boolean;
  durationMs?: number;
}

/** "Until ended" has no hours, so it gets a name of its own to use as the Select's value. */
const durationKey = (hours: number | null) => (hours === null ? "none" : String(hours));
const DEFAULT_DURATION = durationKey(24);

let nextOptionKey = 0;
const newOption = () => ({ key: nextOptionKey++, text: "" });

/**
 * The "Create a poll" dialog. It only gathers and checks the words and settings; sending the poll
 * (and encrypting it in a private channel) is up to `onCreate`, whose failure is shown here.
 */
export function PollComposerDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (poll: NewPoll) => Promise<void>;
}) {
  // The form is its own component so it starts blank every time the dialog opens: Radix unmounts
  // the content on close, taking this state with it.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <PollForm onClose={() => onOpenChange(false)} onCreate={onCreate} />
      </DialogContent>
    </Dialog>
  );
}

function PollForm({ onClose, onCreate }: { onClose: () => void; onCreate: (poll: NewPoll) => Promise<void> }) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(() => [newOption(), newOption()]);
  const [multi, setMulti] = useState(false);
  const [duration, setDuration] = useState(DEFAULT_DURATION);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputs = useRef(new Map<number, HTMLInputElement>());
  // The option just added, so its input takes focus the moment it mounts.
  const focusNext = useRef<number | null>(null);

  const filled = options.filter((o) => o.text.trim()).length;
  const canSubmit = !pending && question.trim().length > 0 && filled >= POLL_LIMITS.minOptions;

  const setOptionText = (key: number, text: string) => {
    setOptions((all) => all.map((o) => (o.key === key ? { ...o, text } : o)));
    setError(null);
  };

  const addOption = () => {
    if (options.length >= POLL_LIMITS.maxOptions) return;
    const option = newOption();
    focusNext.current = option.key;
    setOptions((all) => [...all, option]);
  };

  const removeOption = (key: number) => {
    setOptions((all) => (all.length > POLL_LIMITS.minOptions ? all.filter((o) => o.key !== key) : all));
    setError(null);
  };

  const submit = async () => {
    if (!canSubmit) return;
    let clean: { question: string; options: string[] };
    try {
      clean = cleanPollText(question, options.map((o) => o.text));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That poll isn't valid.");
      return;
    }
    const hours = POLL_DURATIONS.find((d) => durationKey(d.hours) === duration)?.hours ?? null;
    setPending(true);
    setError(null);
    try {
      await onCreate({ ...clean, multi, ...(hours !== null ? { durationMs: hours * 3_600_000 } : {}) });
      onClose();
    } catch (e) {
      setError(errorText(e, "Couldn't create the poll."));
      setPending(false);
    }
  };

  return (
    <div
      className="grid gap-4"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void submit();
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Create a poll</DialogTitle>
        <DialogDescription>Ask the channel a question and let everyone vote.</DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor="poll-question">Question</Label>
        <Input
          id="poll-question"
          value={question}
          maxLength={POLL_LIMITS.question}
          placeholder="What do you want to ask?"
          autoFocus
          disabled={pending}
          onChange={(e) => {
            setQuestion(e.target.value);
            setError(null);
          }}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="poll-option-0">Options</Label>
        <div className="grid gap-2">
          {options.map((option, index) => (
            <div key={option.key} className="flex items-center gap-1.5">
              <Input
                id={`poll-option-${index}`}
                ref={(el) => {
                  if (el) {
                    inputs.current.set(option.key, el);
                    if (focusNext.current === option.key) {
                      focusNext.current = null;
                      el.focus();
                    }
                  } else {
                    inputs.current.delete(option.key);
                  }
                }}
                value={option.text}
                maxLength={POLL_LIMITS.option}
                placeholder={`Option ${index + 1}`}
                aria-label={`Option ${index + 1}`}
                disabled={pending}
                onChange={(e) => setOptionText(option.key, e.target.value)}
                onKeyDown={(e) => {
                  // Enter in the last row starts the next one, the way a list is typed out. It never
                  // submits: that is Cmd/Ctrl+Enter, so a stray Enter can't send half a poll.
                  if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  if (index === options.length - 1) addOption();
                }}
              />
              {options.length > POLL_LIMITS.minOptions && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground shrink-0"
                  aria-label={`Remove option ${index + 1}`}
                  disabled={pending}
                  onClick={() => removeOption(option.key)}
                >
                  <X />
                </Button>
              )}
            </div>
          ))}
        </div>
        {options.length < POLL_LIMITS.maxOptions && (
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground w-fit" disabled={pending} onClick={addOption}>
            <Plus />
            Add option
          </Button>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="poll-multi" className="flex-col items-start gap-0.5">
          Allow multiple answers
          <span className="text-muted-foreground text-xs font-normal">Voters can pick more than one option.</span>
        </Label>
        <Switch id="poll-multi" checked={multi} disabled={pending} onCheckedChange={setMulti} />
      </div>

      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="poll-duration">Duration</Label>
        <Select value={duration} onValueChange={setDuration} disabled={pending}>
          <SelectTrigger id="poll-duration" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {POLL_DURATIONS.map((d) => (
              <SelectItem key={durationKey(d.hours)} value={durationKey(d.hours)}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" disabled={!canSubmit} onClick={() => void submit()}>
          {pending && <Loader2 className="animate-spin" />}
          {pending ? "Creating…" : "Create poll"}
        </Button>
      </DialogFooter>
    </div>
  );
}
