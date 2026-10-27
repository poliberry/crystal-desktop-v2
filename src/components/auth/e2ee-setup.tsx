"use client";

import { AlertTriangle, Check, Copy, Download, KeyRound, Lock, LockOpen, RotateCcw, ShieldCheck } from "lucide-react";
import { useEffect, useReducer, useRef, useState } from "react";

import { FieldError, Spinner } from "@/components/auth/auth-ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/auth-errors";
import { keyring, useE2eeSnapshot } from "@/lib/e2ee";
import type { PendingIdentity } from "@/lib/e2ee/keyring";
import { initialSetup, setupReducer } from "@/lib/e2ee/state";
import { cn } from "@/lib/utils";

/**
 * Setting up, unlocking or resetting message encryption on this device. One component, used by the
 * prompt that follows sign-up (and sign-in on a new device) and by Settings → Security, so the
 * explanation and the safeguards are the same wherever it's done.
 *
 * What it guarantees, on top of the keyring's own rules (src/lib/e2ee/keyring.ts):
 *  - nothing is uploaded until the person has confirmed they stored the recovery key (the reducer in
 *    src/lib/e2ee/state.ts is the gate; for full accounts they also retype the key's last group);
 *  - only the public key and the backup sealed under the recovery key reach the server. The recovery
 *    key itself is only ever on screen, in the clipboard or in a file the person asks for;
 *  - a failed upload keeps the same key on screen, so retrying never needs a new secret;
 *  - resetting is a separate, explicit step that says what it costs before it is done.
 */

export type E2eeSetupPanelProps = {
  /** Copy for an account that was created moments ago. */
  newAccount?: boolean;
  /** Guest accounts are wiped after a day: the recovery key matters less, so there's no retype check. */
  isGuest?: boolean;
  /** Shown once encryption is ready and the person is done reading the result. */
  onDone?: () => void;
  /** Told while something must not be interrupted (an upload): a dialog should not close then. */
  onBusyChange?: (busy: boolean) => void;
  className?: string;
};

type Flow = null | { kind: "register" | "rotate" };

export function E2eeSetupPanel({ newAccount, isGuest, onDone, onBusyChange, className }: E2eeSetupPanelProps) {
  const snapshot = useE2eeSnapshot();
  const [flow, setFlow] = useState<Flow>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [finished, setFinished] = useState(false);

  // A key that was being shown belongs to the state it was made for; if the account's state moves on
  // underneath it (another device finished setup meanwhile), drop it rather than upload over it.
  const status = snapshot.status;
  useEffect(() => {
    if (flow?.kind === "register" && status === "needs-unlock") setFlow(null);
  }, [flow, status]);

  let body: React.ReactNode;
  if (flow) {
    body = (
      <KeyStep
        key={flow.kind}
        kind={flow.kind}
        isGuest={isGuest}
        onBusyChange={onBusyChange}
        onCancel={() => setFlow(null)}
        onCommitted={() => {
          setFlow(null);
          setFinished(true);
        }}
      />
    );
  } else if (confirmReset) {
    body = (
      <ResetConfirm
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false);
          setFlow({ kind: "rotate" });
        }}
      />
    );
  } else if (status === "loading") {
    body = (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Checking this device…
      </p>
    );
  } else if (status === "unavailable") {
    body = (
      <p className="text-sm text-muted-foreground">
        This device doesn&apos;t have the cryptography support encrypted messages need, so you can&apos;t send or read them here. Try
        the latest Crystal desktop app or an up-to-date browser.
      </p>
    );
  } else if (status === "ready") {
    body = <ReadyView fingerprint={snapshot.fingerprint} persistent={snapshot.persistent} justFinished={finished} onDone={onDone} />;
  } else if (status === "needs-setup") {
    body = <SetupIntro newAccount={newAccount} onStart={() => setFlow({ kind: "register" })} />;
  } else {
    body = <UnlockView onLostKey={() => setConfirmReset(true)} />;
  }

  return <div className={cn("space-y-4", className)}>{body}</div>;
}

// --- Steps --------------------------------------------------------------------------------------------------

function Explainer() {
  return (
    <ul className="space-y-2 text-sm text-muted-foreground">
      <li className="flex gap-2">
        <Lock className="mt-0.5 size-4 shrink-0 text-emerald-400" />
        <span>
          Messages in your DMs and communities are locked on your device before they&apos;re sent. Crystal&apos;s servers can&apos;t read
          them.
        </span>
      </li>
      <li className="flex gap-2">
        <KeyRound className="mt-0.5 size-4 shrink-0 text-primary" />
        <span>
          You&apos;ll get a <strong className="text-foreground">recovery key</strong>. It&apos;s how you read your messages on a new
          device or after reinstalling. Crystal never sees it and can&apos;t send it to you again.
        </span>
      </li>
      <li className="flex gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
        <span>
          If you lose it and aren&apos;t signed in anywhere else, you can start fresh, but messages from before stay unreadable.
        </span>
      </li>
    </ul>
  );
}

function SetupIntro({ newAccount, onStart }: { newAccount?: boolean; onStart: () => void }) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="font-semibold">{newAccount ? "One last step: protect your messages" : "Turn on message encryption"}</p>
        <p className="text-sm text-muted-foreground">
          You need this to send messages and to read encrypted ones. It takes a minute.
        </p>
      </div>
      <Explainer />
      <Button onClick={onStart} className="w-full sm:w-auto">
        <ShieldCheck className="size-4" />
        Set up encryption
      </Button>
    </div>
  );
}

/** Making a key, showing it, and uploading only once the person has stored it. */
function KeyStep({
  kind,
  isGuest,
  onBusyChange,
  onCancel,
  onCommitted,
}: {
  kind: "register" | "rotate";
  isGuest?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onCancel: () => void;
  onCommitted: () => void;
}) {
  const [state, dispatch] = useReducer(setupReducer, initialSetup);
  const [pending, setPending] = useState<PendingIdentity | null>(null);
  const [stored, setStored] = useState(false);
  const [retype, setRetype] = useState("");
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (kind === "register" ? keyring.prepareSetup() : keyring.prepareReset()).then(
      (identity) => {
        if (cancelled) return;
        setPending(identity);
        dispatch({ type: "generated" });
      },
      (cause) => {
        if (!cancelled) dispatch({ type: "failed", error: errorMessage(cause, "Couldn't make an encryption key on this device.") });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [kind, attempt]);

  const uploading = state.step === "uploading";
  useEffect(() => {
    onBusyChange?.(uploading);
    return () => onBusyChange?.(false);
  }, [uploading, onBusyChange]);

  const lastGroup = pending?.recoveryKey.split("-").pop() ?? "";
  const retyped = isGuest || retype.trim().toUpperCase() === lastGroup;
  const confirmed = stored && retyped;

  useEffect(() => {
    dispatch({ type: "ack", saved: confirmed });
  }, [confirmed]);

  const commit = async () => {
    // The reducer is the gate (state.ts): no confirmation on record, no upload.
    if (!pending || state.step !== "show" || !state.saved) return;
    dispatch({ type: "submit" });
    try {
      await pending.commit();
      if (!live.current) return;
      dispatch({ type: "uploaded" });
      setPending(null);
      onCommitted();
    } catch (cause) {
      if (!live.current) return;
      const message = errorMessage(cause, "Couldn't save encryption to your account. Check your connection and try again.");
      dispatch({
        type: "failed",
        error: /already exists/i.test(message)
          ? "Encryption was just set up for this account from another device. Close this and enter the recovery key from that device instead."
          : message,
      });
    }
  };

  const copy = async () => {
    if (!pending) return;
    try {
      await navigator.clipboard.writeText(pending.recoveryKey);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const download = () => {
    if (!pending) return;
    const text = [
      "Crystal recovery key",
      "",
      pending.recoveryKey,
      "",
      "This key unlocks your encrypted messages on a new device.",
      "Keep it private. Anyone with it and your account can read your messages.",
      "Crystal cannot recover it for you.",
      "",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "crystal-recovery-key.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  if (state.step === "generating") {
    return (
      <div className="space-y-3">
        {state.error ? (
          <>
            <FieldError message={state.error} />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </Button>
              <Button variant="ghost" onClick={onCancel}>
                Back
              </Button>
            </div>
          </>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Making your key on this device…
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="font-semibold">{kind === "rotate" ? "Your new recovery key" : "Your recovery key"}</p>
        <p className="text-sm text-muted-foreground">
          Store it in a password manager or somewhere private. This is the only time it&apos;s shown.
        </p>
      </div>

      <code
        aria-label="Recovery key"
        className="block select-all break-all rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-center font-mono text-sm leading-relaxed tracking-wider"
      >
        {pending?.recoveryKey}
      </code>

      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={() => void copy()} disabled={uploading}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button type="button" variant="outline" className="flex-1" onClick={download} disabled={uploading}>
          <Download className="size-4" />
          Download
        </Button>
      </div>

      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!uploading) void commit();
        }}
      >
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={stored} onCheckedChange={(value) => setStored(value === true)} disabled={uploading} className="mt-0.5" />
          <span>I&apos;ve stored my recovery key somewhere safe. I understand Crystal can&apos;t recover it for me.</span>
        </label>
        {!isGuest && (
          <div className="space-y-1.5">
            <Label htmlFor="e2ee-retype">Type the last 4 characters of the key to confirm</Label>
            <Input
              id="e2ee-retype"
              value={retype}
              onChange={(event) => setRetype(event.target.value)}
              maxLength={4}
              autoComplete="off"
              spellCheck={false}
              disabled={uploading}
              className="w-28 text-center font-mono uppercase tracking-widest"
              aria-invalid={retype.length === 4 && !retyped}
            />
            {retype.length === 4 && !retyped && <p className="text-xs text-destructive">That doesn&apos;t match the end of the key above.</p>}
          </div>
        )}
        <FieldError message={state.error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={!confirmed || !state.saved || uploading}>
            {uploading ? <Spinner /> : <ShieldCheck className="size-4" />}
            {kind === "rotate" ? "Reset and turn on encryption" : "Turn on encryption"}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={uploading}>
            Cancel
          </Button>
        </div>
        {!uploading && <p className="text-xs text-muted-foreground">Nothing is saved to your account until you turn it on.</p>}
      </form>
    </div>
  );
}

function UnlockView({ onLostKey }: { onLostKey: () => void }) {
  const [recoveryKey, setRecoveryKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unlock = async () => {
    setBusy(true);
    setError(null);
    try {
      await keyring.unlock(recoveryKey);
      setRecoveryKey("");
    } catch (cause) {
      setError(errorMessage(cause, "Couldn't unlock message encryption."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="font-semibold">Unlock your messages on this device</p>
        <p className="text-sm text-muted-foreground">
          Your account already uses encryption. Enter the recovery key you saved when you set it up to read and send messages here.
        </p>
      </div>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && recoveryKey.trim()) void unlock();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="e2ee-recovery">Recovery key</Label>
          <Input
            id="e2ee-recovery"
            value={recoveryKey}
            onChange={(event) => setRecoveryKey(event.target.value)}
            placeholder="ABCD-EFGH-…"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            aria-invalid={!!error}
          />
        </div>
        <FieldError message={error} />
        <Button type="submit" disabled={busy || !recoveryKey.trim()}>
          {busy ? <Spinner /> : <LockOpen className="size-4" />}
          Unlock
        </Button>
      </form>
      <button
        type="button"
        onClick={onLostKey}
        className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Lost your recovery key?
      </button>
    </div>
  );
}

function ResetConfirm({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const [understood, setUnderstood] = useState(false);
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="flex items-center gap-2 font-semibold">
          <RotateCcw className="size-4" />
          Reset encryption?
        </p>
        <p className="text-sm text-muted-foreground">
          If you&apos;re still signed in on another device, open Crystal there first: it may already be unlocked, and you can find your
          recovery key where you stored it.
        </p>
      </div>
      <ul className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
        <li>You get a new key and a new recovery key.</li>
        <li>Encrypted messages from before the reset stay unreadable for you, on every device. Crystal can&apos;t bring them back.</li>
        <li>Your other devices will ask for the new recovery key.</li>
        <li>New messages work as soon as people in your conversations next open Crystal.</li>
      </ul>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox checked={understood} onCheckedChange={(value) => setUnderstood(value === true)} className="mt-0.5" />
        <span>I understand my earlier encrypted messages will stay unreadable.</span>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button variant="destructive" disabled={!understood} onClick={onConfirm}>
          Reset encryption
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Back
        </Button>
      </div>
    </div>
  );
}

function ReadyView({
  fingerprint,
  persistent,
  justFinished,
  onDone,
}: {
  fingerprint: string | null;
  persistent: boolean | null;
  justFinished: boolean;
  onDone?: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-sm">
        <ShieldCheck className="size-4 shrink-0 text-emerald-400" />
        <span>{justFinished ? "Encryption is on. You're ready to chat." : "Encryption is ready on this device."}</span>
      </p>
      {fingerprint && (
        <p className="text-xs text-muted-foreground">
          Key fingerprint <code className="select-all font-mono">{fingerprint}</code>
        </p>
      )}
      {persistent === false && (
        <p className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>This device can&apos;t store the key securely, so Crystal will ask for your recovery key each time it starts. Keep it handy.</span>
        </p>
      )}
      {onDone && <Button onClick={onDone}>{justFinished ? "Start chatting" : "Done"}</Button>}
    </div>
  );
}
