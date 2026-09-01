"use client";

import { useReverification, useUser } from "@clerk/react";
import type { EmailAddressResource } from "@clerk/shared/types";
import { useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  const { user, isLoaded } = useUser();
  // useReverification wraps one specific fetcher and returns an "enhanced"
  // version of that same fetcher (not a generic reverify-anything helper) —
  // one call per sensitive action. `user` can still be null/undefined here
  // (before the isLoaded/user guard below), so each closure re-checks it;
  // by the time these are actually invoked from the handlers below, the
  // guard has already passed and user is guaranteed non-null.
  const createEmailAddress = useReverification((email: string) => {
    if (!user) throw new Error("Not signed in.");
    return user.createEmailAddress({ email });
  });
  const updatePassword = useReverification(
    (params: { newPassword: string; currentPassword?: string }) => {
      if (!user) throw new Error("Not signed in.");
      return user.updatePassword(params);
    }
  );

  const [newEmail, setNewEmail] = useState("");
  const [pendingEmail, setPendingEmail] = useState<EmailAddressResource | null>(null);
  const [pendingEmailId, setPendingEmailId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSuccess, setEmailSuccess] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  if (!isLoaded || !user) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  const handleSendCode = async () => {
    const trimmed = newEmail.trim();
    if (!trimmed) return;
    setEmailBusy(true);
    setEmailError(null);
    setEmailSuccess(false);
    try {
      const email = await createEmailAddress(trimmed);
      // Set as soon as the address exists (not after prepareVerification
      // succeeds) so a failure below — or the user hitting Cancel — can
      // still find and destroy it instead of leaking an unverified address
      // on the Clerk account.
      setPendingEmail(email);
      setPendingEmailId(email.id);
      try {
        await email.prepareVerification({ strategy: "email_code" });
      } catch (err) {
        await email.destroy().catch(() => {});
        setPendingEmail(null);
        setPendingEmailId(null);
        throw err;
      }
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : "Failed to send verification code.");
    } finally {
      setEmailBusy(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!pendingEmailId) return;
    setEmailBusy(true);
    setEmailError(null);
    try {
      if (!pendingEmail) throw new Error("Verification session expired — start again.");
      await pendingEmail.attemptVerification({ code: code.trim() });
      await user.update({ primaryEmailAddressId: pendingEmail.id });

      // Keep the account down to a single email address, matching what the
      // old <UserProfile /> flow presented. Not caught per-address: if a
      // stale address fails to delete, the account isn't actually down to
      // one email yet, so that should surface as an error, not a false
      // "Email address updated."
      const stale = user.emailAddresses.filter((e) => e.id !== pendingEmail.id);
      await Promise.all(stale.map((e) => e.destroy()));

      setPendingEmail(null);
      setPendingEmailId(null);
      setNewEmail("");
      setCode("");
      setEmailSuccess(true);
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : "Invalid or expired code.");
    } finally {
      setEmailBusy(false);
    }
  };

  const handleCancelEmailChange = () => {
    // Best-effort: the unverified address created by handleSendCode
    // shouldn't linger on the account just because the user gave up.
    const email = pendingEmail;
    setPendingEmail(null);
    setPendingEmailId(null);
    setCode("");
    setEmailError(null);
    void email?.destroy().catch(() => {});
  };

  const handleChangePassword = async () => {
    setPasswordError(null);
    setPasswordSuccess(false);
    if (newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords don't match.");
      return;
    }
    setPasswordBusy(true);
    try {
      await updatePassword({
        newPassword,
        currentPassword: user.passwordEnabled ? currentPassword : undefined,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSuccess(true);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Failed to update password.");
    } finally {
      setPasswordBusy(false);
    }
  };

  return (
    <div className="space-y-6 w-4xl">
      <AccountDetailsCard />

      <Card>
        <CardHeader>
          <CardTitle>Email address</CardTitle>
          <CardDescription>
            Current:{" "}
            <span className="font-medium text-foreground">
              {user.primaryEmailAddress?.emailAddress ?? "None"}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!pendingEmailId ? (
            <div className="space-y-1.5">
              <Label htmlFor="account-email">New email address</Label>
              <div className="flex gap-2">
                <Input
                  id="account-email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="you@example.com"
                />
                <Button onClick={() => void handleSendCode()} disabled={!newEmail.trim() || emailBusy}>
                  {emailBusy ? <Loader2 className="size-4 animate-spin" /> : "Send code"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="account-email-code">Enter the code sent to {newEmail}</Label>
              <div className="flex gap-2">
                <Input
                  id="account-email-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                />
                <Button onClick={() => void handleVerifyCode()} disabled={!code.trim() || emailBusy}>
                  {emailBusy ? <Loader2 className="size-4 animate-spin" /> : "Verify"}
                </Button>
                <Button variant="ghost" onClick={handleCancelEmailChange} disabled={emailBusy}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {emailError && <p className="text-sm text-destructive">{emailError}</p>}
          {emailSuccess && !pendingEmailId && (
            <p className="text-sm text-muted-foreground">Email address updated.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{user.passwordEnabled ? "Change password" : "Set a password"}</CardTitle>
          <CardDescription>
            {user.passwordEnabled
              ? "Requires your current password."
              : "Your account doesn't have a password yet."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {user.passwordEnabled && (
            <div className="space-y-1.5">
              <Label htmlFor="account-current-password">Current password</Label>
              <Input
                id="account-current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="account-new-password">New password</Label>
            <Input
              id="account-new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="account-confirm-password">Confirm new password</Label>
            <Input
              id="account-confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}
          {passwordSuccess && <p className="text-sm text-muted-foreground">Password updated.</p>}
          <Button
            onClick={() => void handleChangePassword()}
            disabled={
              passwordBusy || !newPassword || !confirmPassword || (user.passwordEnabled && !currentPassword)
            }
          >
            {passwordBusy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : user.passwordEnabled ? (
              "Update password"
            ) : (
              "Set password"
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
