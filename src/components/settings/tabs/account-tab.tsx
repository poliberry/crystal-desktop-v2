"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CodeInput, FieldError, PasswordField, StrengthMeter } from "@/components/auth/auth-ui";
import { errorMessage } from "@/lib/auth-errors";

/**
 * Username and date of birth.
 *
 * These sit here rather than in the profile editor because they aren't
 * cosmetics: a username is a unique handle with a collision check attached,
 * and a date of birth is a fact about the account that is never displayed —
 * only the day and month are ever used, and only to wish someone a happy
 * birthday. The editor next door is for things you choose because of how they
 * look.
 */
function AccountDetailsCard() {
  const me = useQuery(api.users.getCurrentUser);
  const updateProfile = useMutation(api.users.updateProfile);
  const updateProfileExtended = useMutation(api.users.updateProfileExtended);

  const [username, setUsername] = useState("");
  const [dob, setDob] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Seeded once: the fields are being typed into, and re-seeding them from a
  // subscription update would overwrite what the user is in the middle of.
  const hydrated = useRef(false);

  useEffect(() => {
    if (!me || hydrated.current) return;
    hydrated.current = true;
    setUsername(me.username);
    setDob(me.dob ?? "");
  }, [me]);

  const normalized = username.trim().toLowerCase();
  const usernameChanged = !!me && normalized !== me.username;
  const usernameCheck = useQuery(
    api.users.searchByUsername,
    usernameChanged && normalized ? { username: normalized } : "skip",
  );
  const usernameTaken = usernameChanged && !!usernameCheck;

  const dirty = !!me && (usernameChanged || dob !== (me.dob ?? ""));

  if (!me) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your details</CardTitle>
        <CardDescription>
          How you&apos;re identified. Everything about how your profile{" "}
          <em>looks</em> lives in the profile editor.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="account-username">Username</Label>
          <Input
            id="account-username"
            value={username}
            maxLength={32}
            aria-invalid={usernameTaken}
            onChange={(e) => {
              setUsername(e.target.value);
              setSaved(false);
            }}
          />
          {usernameTaken && (
            <p className="text-xs text-destructive">That username is taken.</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="account-dob">Date of birth</Label>
          {/* `max` is today: a birthday in the future is always a mistake, and
              the native picker refuses it before the mutation has to. */}
          <Input
            id="account-dob"
            type="date"
            value={dob}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => {
              setDob(e.target.value);
              setSaved(false);
            }}
            className="w-fit [color-scheme:dark]"
          />
          <p className="text-xs text-muted-foreground">
            Only the day and month are used, to wish you a happy birthday. Leave
            it empty to opt out.
          </p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex items-center gap-2">
          <Button
            disabled={!dirty || saving || usernameTaken}
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                // Name and bio are the editor's to write; passing the current
                // ones through keeps this mutation from clearing them.
                await updateProfile({
                  name: me.name,
                  username,
                  bio: me.bio ?? "",
                });
                await updateProfileExtended({ dob });
                setSaved(true);
              } catch (err) {
                setError(
                  err instanceof Error ? err.message : "Couldn't save that.",
                );
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : "Save changes"}
          </Button>
          {saved && !dirty && (
            <span className="text-xs text-muted-foreground">Saved.</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function AccountTab() {
  const security = useQuery(api.twoFactor.overview);
  const me = useQuery(api.users.getCurrentUser);

  if (security === undefined || me === undefined) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      <AccountDetailsCard />
      {me?.isGuest ? (
        <GuestCard expiresAt={me.guestExpiresAt} />
      ) : (
        <>
          <EmailCard email={security?.email ?? null} verified={security?.emailVerified ?? false} />
          <PasswordCard hasPassword={security?.hasPassword ?? false} />
        </>
      )}
    </div>
  );
}

function GuestCard({ expiresAt }: { expiresAt?: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Guest account</CardTitle>
        <CardDescription>
          You're trying Crystal as a guest.{" "}
          {expiresAt ? `This account is wiped on ${new Date(expiresAt).toLocaleString()}.` : "This account has expired."} Guests can't
          start communities, upload files or send friend requests. Sign out and create a free account to keep going.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

function EmailCard({ email, verified }: { email: string | null; verified: boolean }) {
  const request = useAction(api.authFlow.requestEmailChange);
  const confirm = useAction(api.authFlow.confirmEmailChange);
  const [newEmail, setNewEmail] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const send = async () => {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const result = await request({ email: newEmail });
      if (!result.ok) setError(result.message);
      else {
        setPending(newEmail.trim().toLowerCase());
        setCode("");
      }
    } catch (cause) {
      setError(errorMessage(cause, "Couldn't send a code."));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value: string) => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const result = await confirm({ email: pending, code: value });
      if (!result.ok) {
        setCode("");
        setError(result.message);
      } else {
        setPending(null);
        setNewEmail("");
        setDone(true);
      }
    } catch (cause) {
      setError(errorMessage(cause, "Couldn't change your email."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email address</CardTitle>
        <CardDescription>
          Current: <span className="font-medium text-foreground">{email ?? "None"}</span>
          {email && !verified && " (not confirmed yet — it's confirmed when you next choose a password)"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!pending ? (
          <form
            className="space-y-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy && newEmail.trim()) void send();
            }}
          >
            <Label htmlFor="account-email">New email address</Label>
            <div className="flex gap-2">
              <Input id="account-email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="you@example.com" />
              <Button type="submit" disabled={!newEmail.trim() || busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : "Send code"}
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            <Label>Enter the code sent to {pending}</Label>
            <CodeInput value={code} onChange={setCode} onComplete={verify} length={8} disabled={busy} invalid={!!error} label="Email code" />
            <Button variant="ghost" onClick={() => { setPending(null); setError(null); }} disabled={busy}>
              Cancel
            </Button>
          </div>
        )}
        <FieldError message={error} />
        {done && <p className="text-sm text-muted-foreground">Email address updated.</p>}
      </CardContent>
    </Card>
  );
}

function PasswordCard({ hasPassword }: { hasPassword: boolean }) {
  const change = useAction(api.authFlow.changePassword);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!hasPassword) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>Your account doesn&apos;t have a password yet. Sign out and sign in again — you&apos;ll be asked to set one with a code sent to your email.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>Requires your current password. This signs you out of your other devices.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            setDone(false);
            try {
              const result = await change({ currentPassword, newPassword });
              if (!result.ok) setError(result.message);
              else {
                setCurrentPassword("");
                setNewPassword("");
                setDone(true);
              }
            } catch (cause) {
              setError(errorMessage(cause, "Couldn't change your password."));
            } finally {
              setBusy(false);
            }
          }}
        >
          <PasswordField id="account-current-password" label="Current password" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" disabled={busy} />
          <div className="space-y-2">
            <PasswordField id="account-new-password" label="New password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" disabled={busy} />
            <StrengthMeter password={newPassword} />
          </div>
          <FieldError message={error} />
          {done && <p className="text-sm text-muted-foreground">Password updated.</p>}
          <Button type="submit" disabled={busy || !currentPassword || newPassword.length < 10}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Update password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
