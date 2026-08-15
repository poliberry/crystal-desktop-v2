"use client";

import { useReverification, useUser } from "@clerk/clerk-react";
import type { EmailAddressResource } from "@clerk/shared/types";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
    <div className="space-y-6">
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
