"use client";

import { startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { useAction, useMutation, useQuery } from "convex/react";
import { Fingerprint, LockKeyhole, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../../convex/_generated/api";
import { CodeInput, FieldError, PasswordField, Spinner } from "@/components/auth/auth-ui";
import { useAuthUserId } from "@/components/auth/auth-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/auth-errors";
import { settlePrompt, usePrompt } from "@/lib/step-up";

/** The event Settings listens for to open itself at Security. Fired by the "turn it on" button below. */
export const OPEN_SECURITY_EVENT = "crystal:open-security";

/**
 * Asks for a verification code when the server wants one.
 *
 * Opened by the Convex client (see src/lib/convex-client.ts) when an administrative function is
 * refused, wherever in the app that was; closing it without answering leaves the refusal standing.
 * Entering a code unlocks the session for a few minutes — the server remembers it, so nothing here
 * has to — and whatever was refused is run again.
 */
export function StepUpDialog() {
  const prompt = usePrompt();
  const signedIn = useAuthUserId() !== null;
  // Nobody to ask when nobody is signed in (a refusal that arrives while signing out).
  const open = prompt !== null && signedIn;

  useEffect(() => {
    if (prompt && !signedIn) settlePrompt(false);
  }, [prompt, signedIn]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && settlePrompt(false)}>
      <DialogContent className="sm:max-w-sm" onInteractOutside={(event) => event.preventDefault()}>
        {prompt?.kind === "code" && <CodePrompt />}
        {prompt?.kind === "password" && <PasswordPrompt />}
        {prompt?.kind === "enroll" && <EnrollPrompt scope={prompt.scope} />}
      </DialogContent>
    </Dialog>
  );
}

function CodePrompt() {
  const gate = useQuery(api.twoFactor.gate);
  const stepUp = useMutation(api.twoFactor.stepUp);
  const passkeyOptions = useAction(api.passkeys.stepUpOptions);
  const passkeyVerify = useAction(api.passkeys.stepUpVerify);
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passkeysOk, setPasskeysOk] = useState(false);
  useEffect(() => setPasskeysOk(browserSupportsWebAuthn()), []);

  const methods = gate?.methods;
  const useTotp = !backup && (methods?.totp ?? true);

  const submit = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await stepUp({ code: value });
      if (result.ok) {
        settlePrompt(true);
        return;
      }
      setCode("");
      setError(
        result.reason === "locked"
          ? "Too many wrong codes. Wait a few minutes and try again."
          : result.reason === "not_enrolled"
            ? "Two-step verification isn't switched on for this account."
            : "That code isn't right.",
      );
    } catch (cause) {
      setError(errorMessage(cause, "Couldn't check that code."));
    } finally {
      setBusy(false);
    }
  };

  const usePasskey = async () => {
    setBusy(true);
    setError(null);
    try {
      const options = await passkeyOptions({ origin: window.location.origin });
      const response = await startAuthentication({ optionsJSON: options as never });
      const result = await passkeyVerify({ response });
      if (result.ok) settlePrompt(true);
      else setError("That passkey didn't work.");
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === "NotAllowedError")) setError(errorMessage(cause, "That passkey didn't work."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-primary/15 text-primary">
          <LockKeyhole className="size-5" />
        </div>
        <DialogTitle>Confirm it's you</DialogTitle>
        <DialogDescription>
          {useTotp
            ? "Enter the 6-digit code from your authenticator app to continue. You won't be asked again for a few minutes."
            : backup
              ? "Enter one of your backup codes. Each works once."
              : "Use your passkey to continue. You won't be asked again for a few minutes."}
        </DialogDescription>
      </DialogHeader>

      {useTotp ? (
        <CodeInput value={code} onChange={setCode} onComplete={submit} length={6} disabled={busy} invalid={!!error} label="Authenticator code" />
      ) : backup ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit(code);
          }}
          className="space-y-3"
        >
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="XXXXX-XXXXX"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            className="h-11 text-center font-mono tracking-widest"
          />
          <Button type="submit" className="w-full" disabled={busy || code.replace(/[^A-Z0-9]/gi, "").length < 10}>
            {busy && <Spinner />}
            Verify
          </Button>
        </form>
      ) : null}
      <FieldError message={error} />

      <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
        {passkeysOk && methods?.passkey && (
          <Button type="button" variant={useTotp ? "outline" : "default"} className="w-full" disabled={busy} onClick={usePasskey}>
            <Fingerprint className="size-4" />
            Use a passkey
          </Button>
        )}
        {methods?.backup && (methods.totp || methods.passkey) && (
          <button
            type="button"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            onClick={() => {
              setBackup((b) => !b);
              setCode("");
              setError(null);
            }}
          >
            {backup ? "Use my authenticator instead" : "Use a backup code instead"}
          </button>
        )}
        <Button type="button" variant="ghost" className="w-full text-muted-foreground" onClick={() => settlePrompt(false)}>
          Cancel
        </Button>
      </DialogFooter>
    </>
  );
}

function PasswordPrompt() {
  const confirm = useAction(api.authFlow.confirmPassword);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await confirm({ password });
      if (result.ok) {
        settlePrompt(true);
        return;
      }
      setPassword("");
      setError(result.reason === "locked" ? "Too many wrong passwords. Try again in a few minutes." : "That password isn't right.");
    } catch (cause) {
      setError(errorMessage(cause, "Couldn't check that password."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && password) void submit();
      }}
      className="space-y-4"
    >
      <DialogHeader>
        <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-primary/15 text-primary">
          <LockKeyhole className="size-5" />
        </div>
        <DialogTitle>Confirm your password</DialogTitle>
        <DialogDescription>This changes how your account is protected, so we need to be sure it's you.</DialogDescription>
      </DialogHeader>
      <PasswordField id="step-up-password" value={password} onChange={setPassword} autoComplete="current-password" autoFocus invalid={!!error} disabled={busy} />
      <FieldError message={error} />
      <DialogFooter className="gap-2 sm:gap-2">
        <Button type="button" variant="ghost" onClick={() => settlePrompt(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !password}>
          {busy && <Spinner />}
          Continue
        </Button>
      </DialogFooter>
    </form>
  );
}

function EnrollPrompt({ scope }: { scope: "platform" | "server" }) {
  return (
    <>
      <DialogHeader>
        <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-amber-500/15 text-amber-400">
          <ShieldAlert className="size-5" />
        </div>
        <DialogTitle>Turn on two-step verification</DialogTitle>
        <DialogDescription>
          {scope === "platform"
            ? "Crystal requires two-step verification on staff accounts before the admin console can be used."
            : "This server requires two-step verification to manage it."}{" "}
          It takes a minute with an authenticator app or a passkey.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter className="gap-2 sm:gap-2">
        <Button type="button" variant="ghost" onClick={() => settlePrompt(false)}>
          Not now
        </Button>
        <Button
          type="button"
          onClick={() => {
            settlePrompt(false);
            window.dispatchEvent(new Event(OPEN_SECURITY_EVENT));
          }}
        >
          <ShieldCheck className="size-4" />
          Set it up
        </Button>
      </DialogFooter>
    </>
  );
}
