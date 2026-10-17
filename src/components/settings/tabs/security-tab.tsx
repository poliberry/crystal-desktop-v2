"use client";

import { startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { useAction, useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Download, Fingerprint, KeyRound, LogOut, ShieldAlert, ShieldCheck, Smartphone, Trash2 } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CodeInput, FieldError, Spinner } from "@/components/auth/auth-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/auth-errors";
import { formatDateTime } from "@/lib/locale";
import { E2eeSetupPanel } from "@/components/auth/e2ee-setup";

/**
 * Settings → Security: what protects the account beyond its password.
 *
 * Every change here is checked on the server, which asks for a fresh proof first (a code, or the
 * password if there is no second step yet). That prompt comes from the Convex client, not from this
 * file: each button just calls its function, and if the server wants a code the dialog appears and
 * the call is retried.
 */
export function SecurityTab() {
  const overview = useQuery(api.twoFactor.overview);
  if (overview === undefined) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        <Spinner />
      </div>
    );
  }
  if (overview === null) return null;

  return (
    <div className="w-full space-y-6">
      <E2eeCard />
      <StatusCard enrolled={overview.enrolled} staffMustEnrol={overview.staffMustEnrol} isStaff={overview.isStaff} />
      <AuthenticatorCard enabled={overview.totp} />
      <PasskeysCard passkeys={overview.passkeys} />
      {overview.enrolled && <BackupCodesCard left={overview.backupCodesLeft} />}
      <SessionsCard />
    </div>
  );
}

function E2eeCard() {
  const me = useQuery(api.users.getCurrentUser);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><KeyRound className="size-4" />Message encryption</CardTitle>
        <CardDescription>Private conversations and community messages are encrypted on your device. Attachments and older messages remain readable by the server until they are migrated or replaced.</CardDescription>
      </CardHeader>
      <CardContent>
        {/* The same setup, unlock and reset steps as the prompt after sign-up (components/auth/e2ee-setup.tsx). */}
        <E2eeSetupPanel isGuest={!!me?.isGuest} />
      </CardContent>
    </Card>
  );
}

function StatusCard({ enrolled, isStaff, staffMustEnrol }: { enrolled: boolean; isStaff: boolean; staffMustEnrol: boolean }) {
  const warn = staffMustEnrol && !enrolled;
  return (
    <motion.div layout initial={false}>
      <Card className={warn ? "border-amber-500/40" : undefined}>
        <CardContent className="flex items-start gap-4 pt-6">
          <div className={`flex size-11 shrink-0 items-center justify-center rounded-full ${enrolled ? "bg-emerald-500/15 text-emerald-400" : warn ? "bg-amber-500/15 text-amber-400" : "bg-foreground/10 text-muted-foreground"}`}>
            {enrolled ? <ShieldCheck className="size-6" /> : <ShieldAlert className="size-6" />}
          </div>
          <div className="space-y-1">
            <p className="font-semibold">{enrolled ? "Two-step verification is on" : "Two-step verification is off"}</p>
            <p className="text-sm text-muted-foreground">
              {enrolled
                ? "Signing in, and anything administrative, asks for a code or passkey as well as your password."
                : "Add an authenticator app or a passkey so a stolen password isn't enough to get into your account."}
            </p>
            {warn && (
              <p className="text-sm text-amber-400">
                Crystal requires two-step verification for staff. You can't use the admin console until it's on.
              </p>
            )}
            {isStaff && enrolled && <Badge variant="secondary">Required for the admin console on this platform when enabled by an owner</Badge>}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// --- Authenticator app ---------------------------------------------------------------------------------

function AuthenticatorCard({ enabled }: { enabled: boolean }) {
  const begin = useMutation(api.twoFactor.beginTotpSetup);
  const confirm = useMutation(api.twoFactor.confirmTotpSetup);
  const disable = useMutation(api.twoFactor.disableTotp);

  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (!setup) {
      setQr(null);
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(setup.uri, { margin: 1, width: 192, color: { dark: "#0b0d12", light: "#ffffff" } }).then((url) => {
      if (!cancelled) setQr(url);
    });
    return () => {
      cancelled = true;
    };
  }, [setup]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setSetup(await begin({}));
      setCode("");
    } catch (cause) {
      setError(errorMessage(cause, "Couldn't start setup."));
    } finally {
      setBusy(false);
    }
  };

  const finish = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await confirm({ code: value });
      if (result.ok) {
        setSetup(null);
        if (result.backupCodes) setCodes(result.backupCodes);
        return;
      }
      setCode("");
      setError(result.reason === "locked" ? "Too many wrong codes. Wait a few minutes." : result.reason === "no_setup" ? "That setup expired. Start again." : "That code isn't right. Check your authenticator and try again.");
    } catch (cause) {
      setError(errorMessage(cause, "Couldn't confirm that code."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await disable({});
      setRemoving(false);
    } catch (cause) {
      setError(errorMessage(cause, "Couldn't remove it."));
      setRemoving(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="size-4" />
              Authenticator app
            </CardTitle>
            <CardDescription>Codes from an app like 1Password, Authy or Google Authenticator.</CardDescription>
          </div>
          {enabled && <Badge className="bg-emerald-500/15 text-emerald-400">On</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <AnimatePresence initial={false} mode="wait">
          {setup ? (
            <motion.div key="setup" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-4">
              <div className="flex flex-wrap items-start gap-5">
                <div className="flex size-48 items-center justify-center rounded-xl bg-white p-2">
                  {qr ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={qr} alt="QR code for your authenticator app" className="size-full" />
                  ) : (
                    <Spinner />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-3 text-sm">
                  <p>
                    <strong>1.</strong> Scan this with your authenticator app.
                  </p>
                  <p className="text-muted-foreground">Can't scan? Enter this key instead:</p>
                  <code className="block select-all break-all rounded-md bg-foreground/5 p-2 font-mono text-xs tracking-wider">{setup.secret.match(/.{1,4}/g)?.join(" ")}</code>
                  <p>
                    <strong>2.</strong> Enter the 6-digit code it shows.
                  </p>
                  <CodeInput value={code} onChange={setCode} onComplete={finish} length={6} disabled={busy} invalid={!!error} label="Authenticator code" />
                </div>
              </div>
              <FieldError message={error} />
              <Button variant="ghost" onClick={() => setSetup(null)} disabled={busy}>
                Cancel
              </Button>
            </motion.div>
          ) : (
            <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
              <FieldError message={error} />
              {enabled ? (
                <Button variant="outline" onClick={() => setRemoving(true)} disabled={busy}>
                  <Trash2 className="size-4" />
                  Remove authenticator
                </Button>
              ) : (
                <Button onClick={start} disabled={busy}>
                  {busy ? <Spinner /> : <KeyRound className="size-4" />}
                  Set up authenticator
                </Button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>

      <BackupCodesDialog codes={codes} onClose={() => setCodes(null)} />
      <Dialog open={removing} onOpenChange={setRemoving}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove the authenticator?</DialogTitle>
            <DialogDescription>Codes from your app will stop working. If it's your only second step, your account goes back to just a password.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setRemoving(false)}>
              Keep it
            </Button>
            <Button variant="destructive" onClick={remove} disabled={busy}>
              {busy && <Spinner />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// --- Passkeys -----------------------------------------------------------------------------------------------

function PasskeysCard({ passkeys }: { passkeys: { id: Id<"passkeys">; name: string; createdAt: number; lastUsedAt: number | null; backedUp: boolean }[] }) {
  const options = useAction(api.passkeys.registrationOptions);
  const verify = useAction(api.passkeys.registrationVerify);
  const remove = useMutation(api.twoFactor.removePasskey);
  const rename = useMutation(api.twoFactor.renamePasskey);

  const [supported, setSupported] = useState(true);
  useEffect(() => setSupported(browserSupportsWebAuthn()), []);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const creation = await options({ origin: window.location.origin });
      const response = await startRegistration({ optionsJSON: creation as never });
      const result = await verify({ response, name: name.trim() || defaultPasskeyName() });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setAdding(false);
      setName("");
      if (result.backupCodes) setCodes(result.backupCodes);
    } catch (cause) {
      if (cause instanceof Error && (cause.name === "NotAllowedError" || cause.name === "AbortError")) return;
      if (cause instanceof Error && cause.name === "InvalidStateError") setError("This device already has a passkey for your account.");
      else setError(errorMessage(cause, "Couldn't add that passkey."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Fingerprint className="size-4" />
          Passkeys
        </CardTitle>
        <CardDescription>Sign in with your fingerprint, face or device PIN. A passkey can replace the password entirely, and also counts as a second step.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {passkeys.map((passkey) => (
              <motion.li
                key={passkey.id}
                layout
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <PasskeyRow
                  passkey={passkey}
                  onRename={async (next) => {
                    try {
                      await rename({ id: passkey.id, name: next });
                    } catch (cause) {
                      setError(errorMessage(cause, "Couldn't rename that."));
                    }
                  }}
                  onRemove={async () => {
                    try {
                      await remove({ id: passkey.id });
                    } catch (cause) {
                      setError(errorMessage(cause, "Couldn't remove that."));
                    }
                  }}
                />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        {passkeys.length === 0 && <p className="text-sm text-muted-foreground">No passkeys yet.</p>}
        <FieldError message={error} />

        {!supported ? (
          <p className="text-sm text-muted-foreground">This browser doesn't support passkeys.</p>
        ) : adding ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy) void add();
            }}
            className="flex gap-2"
          >
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={defaultPasskeyName()} maxLength={40} autoFocus />
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner /> : null}
              Continue
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)} disabled={busy}>
              Cancel
            </Button>
          </form>
        ) : (
          <Button variant="outline" onClick={() => setAdding(true)}>
            <Fingerprint className="size-4" />
            Add a passkey
          </Button>
        )}
      </CardContent>
      <BackupCodesDialog codes={codes} onClose={() => setCodes(null)} />
    </Card>
  );
}

function PasskeyRow({
  passkey,
  onRename,
  onRemove,
}: {
  passkey: { id: Id<"passkeys">; name: string; createdAt: number; lastUsedAt: number | null; backedUp: boolean };
  onRename: (name: string) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(passkey.name);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-3 rounded-lg border border-foreground/10 bg-foreground/5 p-3">
      <Fingerprint className="size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        {editing ? (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (text.trim()) await onRename(text.trim());
              setEditing(false);
            }}
          >
            <Input value={text} onChange={(event) => setText(event.target.value)} maxLength={40} autoFocus onBlur={() => setEditing(false)} className="h-8" />
          </form>
        ) : (
          <button type="button" className="block max-w-full truncate text-left text-sm font-medium hover:underline" onClick={() => setEditing(true)} title="Rename">
            {passkey.name}
          </button>
        )}
        <p className="truncate text-xs text-muted-foreground">
          Added {formatDateTime(passkey.createdAt, { dateStyle: "medium" })}
          {passkey.lastUsedAt ? ` · last used ${formatDateTime(passkey.lastUsedAt, { dateStyle: "medium" })}` : " · never used"}
          {passkey.backedUp ? " · synced" : ""}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Remove ${passkey.name}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await onRemove();
          setBusy(false);
        }}
      >
        {busy ? <Spinner /> : <Trash2 className="size-4" />}
      </Button>
    </div>
  );
}

function defaultPasskeyName(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const device = /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows PC" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone or iPad" : /Linux/.test(ua) ? "Linux PC" : "this device";
  return `Passkey on ${device}`;
}

// --- Backup codes -------------------------------------------------------------------------------------------

function BackupCodesCard({ left }: { left: number }) {
  const regenerate = useMutation(api.twoFactor.regenerateBackupCodes);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Backup codes</CardTitle>
        <CardDescription>
          One-time codes for when you can't use your authenticator or passkey. You have{" "}
          <span className={left <= 2 ? "font-semibold text-amber-400" : "font-medium text-foreground"}>{left}</span> left.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <FieldError message={error} />
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              setCodes(await regenerate({}));
            } catch (cause) {
              setError(errorMessage(cause, "Couldn't make new codes."));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Spinner />}
          Generate new codes
        </Button>
        <p className="text-xs text-muted-foreground">Making new codes stops the old ones working.</p>
      </CardContent>
      <BackupCodesDialog codes={codes} onClose={() => setCodes(null)} />
    </Card>
  );
}

/** The codes, shown once. They can't be shown again: only a hash of each is kept. */
function BackupCodesDialog({ codes, onClose }: { codes: string[] | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (codes) {
      setCopied(false);
      setSaved(false);
    }
  }, [codes]);
  const text = codes?.join("\n") ?? "";
  return (
    <Dialog open={!!codes} onOpenChange={(open) => !open && saved && onClose()}>
      <DialogContent className="sm:max-w-sm" onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => !saved && event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Save your backup codes</DialogTitle>
          <DialogDescription>Each code works once. Keep them somewhere safe — they won't be shown again.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-foreground/5 p-3 font-mono text-sm">
          {codes?.map((code, i) => (
            <motion.span key={code} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="select-all text-center tracking-wider">
              {code}
            </motion.span>
          ))}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={async () => {
              await navigator.clipboard.writeText(text);
              setCopied(true);
            }}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => {
              const url = URL.createObjectURL(new Blob([`Crystal backup codes\n\n${text}\n`], { type: "text/plain" }));
              const link = document.createElement("a");
              link.href = url;
              link.download = "crystal-backup-codes.txt";
              link.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download className="size-4" />
            Download
          </Button>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} className="size-4 accent-primary" />
          I've saved these codes
        </label>
        <DialogFooter>
          <Button onClick={onClose} disabled={!saved}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Sessions -----------------------------------------------------------------------------------------------

function SessionsCard() {
  const signOutOthers = useMutation(api.twoFactor.signOutOtherSessions);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LogOut className="size-4" />
          Signed-in devices
        </CardTitle>
        <CardDescription>Lost a device, or signed in somewhere you shouldn't have? Sign out everywhere else. This device stays signed in.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <FieldError message={error} />
        {result && <p className="text-sm text-muted-foreground">{result}</p>}
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            setResult(null);
            try {
              const n = await signOutOthers({});
              setResult(n === 0 ? "No other devices were signed in." : `Signed out of ${n} other ${n === 1 ? "device" : "devices"}.`);
            } catch (cause) {
              setError(errorMessage(cause, "Couldn't sign the other devices out."));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Spinner />}
          Sign out other devices
        </Button>
      </CardContent>
    </Card>
  );
}
