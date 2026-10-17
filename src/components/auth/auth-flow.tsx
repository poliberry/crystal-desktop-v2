"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { useAction, useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  Fingerprint,
  Gavel,
  Mail,
  ShieldOff,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { SignInStep, SecondFactorMethods } from "../../../convex/lib/signInStep";
import { SignInBackdrop } from "@/components/auth/sign-in-backdrop";
import { SignUpPreview } from "@/components/auth/sign-up-preview";
import {
  AccountChip,
  CodeInput,
  FieldError,
  PasswordField,
  Spinner,
  StepHeader,
  StepSwitch,
  StrengthMeter,
  useCountdown,
} from "@/components/auth/auth-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AUTH_ERROR, errorCode, errorMessage } from "@/lib/auth-errors";
import { markNewAccount } from "@/lib/e2ee-onboarding";
import { formatDateTime } from "@/lib/locale";
import { safeReturnTo } from "@/lib/return-to";
import { cn } from "@/lib/utils";

/**
 * The one screen for getting in: signing in, signing up, choosing a password for an account that has
 * none yet, a code from the authenticator, a passkey, and a day as a guest.
 *
 * It starts with only an email address. What the server says about it decides the rest:
 *
 *   has a password    → welcome back (their name and picture), then the password
 *   has none (Clerk)  → the same welcome, then a code emailed to them, then a new password
 *   unknown           → offer to make an account → verify the address → name and username → password
 *   anything above, with two-step verification on the account → the code, or a passkey
 *   banned/suspended  → told so, with the reason, before any session exists
 *
 * Nothing here decides anything: every step asks the server and shows what it says. The screen's own
 * job is to make that feel like one place — steps slide, the account follows you, errors ease in.
 */

type Purpose = "setup" | "reset" | "signup";

type Step =
  | "email"
  | "password"
  | "setup_intro"
  | "code"
  | "new_password"
  | "second_factor"
  | "signup_prompt"
  | "profile"
  | "guest"
  | "blocked";

interface Known {
  username: string;
  name: string;
  imageUrl?: string;
}

type Blocked = Extract<SignInStep, { status: "blocked" }>;

const SIGNUP_STEPS: { id: Step; label: string }[] = [
  { id: "email", label: "Email" },
  { id: "code", label: "Verify" },
  { id: "profile", label: "Profile" },
  { id: "new_password", label: "Password" },
];

const CODE_LENGTH = 8;

export default function AuthFlow({
  returnTo,
  bare,
  onWideChange,
}: {
  returnTo?: string;
  bare?: boolean;
  /** Told when the screen wants the whole window (making an account, with the live preview) and when it is done with it. */
  onWideChange?: (wide: boolean) => void;
} = {}) {
  const target = safeReturnTo(returnTo);
  const router = useRouter();
  const { signIn } = useAuthActions();

  const lookup = useMutation(api.authFlow.lookup);
  const startGuest = useMutation(api.authFlow.startGuest);
  const signInWithPassword = useAction(api.authFlow.signInWithPassword);
  const requestCode = useAction(api.authFlow.requestCode);
  const verifyCode = useAction(api.authFlow.verifyCode);
  const completeAction = useAction(api.authFlow.complete);
  const verifySecondFactor = useAction(api.authFlow.verifySecondFactor);
  const passkeySignInOptions = useAction(api.passkeys.signInOptions);
  const passkeySignInVerify = useAction(api.passkeys.signInVerify);
  const passkeySecondOptions = useAction(api.passkeys.secondFactorOptions);
  const passkeySecondVerify = useAction(api.passkeys.secondFactorVerify);

  // Where we are, and which way we got here (for the direction the next step slides from).
  const [step, setStep] = useState<Step>(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("username")) return "guest";
    return "email";
  });
  const [direction, setDirection] = useState<1 | -1>(1);
  const go = useCallback((next: Step, dir: 1 | -1 = 1) => {
    setDirection(dir);
    setStep(next);
    setError(null);
  }, []);

  const [email, setEmail] = useState("");
  const [known, setKnown] = useState<Known | null>(null);
  const [purpose, setPurpose] = useState<Purpose>("signup");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [proof, setProof] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [guestName, setGuestName] = useState(() => {
    if (typeof window === "undefined") return "";
    return (new URLSearchParams(window.location.search).get("username") ?? "").trim().toLowerCase().slice(0, 32);
  });
  const [second, setSecond] = useState<{ token: string; methods: SecondFactorMethods } | null>(null);
  const [secondCode, setSecondCode] = useState("");
  const [useBackup, setUseBackup] = useState(false);
  const [blocked, setBlocked] = useState<Blocked | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const locked = useCountdown(lockedUntil);
  const resendIn = useCountdown(resendAt);

  const signingUp = purpose === "signup" && (step === "code" || step === "profile" || step === "new_password" || step === "signup_prompt");
  const wide = !bare && signingUp && step !== "signup_prompt";

  useEffect(() => {
    onWideChange?.(wide);
  }, [wide, onWideChange]);
  useEffect(() => () => onWideChange?.(false), [onWideChange]);

  const fail = useCallback((message: string) => {
    setError(message);
    setShake((n) => n + 1);
  }, []);

  // --- Finishing -----------------------------------------------------------------------------

  /** Hand the server's ticket to the auth library, which starts the session, and leave. */
  const finish = useCallback(
    async (ticket: string) => {
      try {
        const result = await signIn("ticket", { ticket });
        if (!result.signingIn) {
          fail("That didn't work. Start again.");
          return;
        }
        setDone(true);
        // The page swaps to the signed-in app by itself; only a different destination needs a push.
        const here = window.location.pathname + window.location.search;
        if (target !== "/" && target !== here) router.push(target);
      } catch (cause) {
        const code = errorCode(cause);
        if (code === AUTH_ERROR.banned || code === AUTH_ERROR.suspended) {
          const data = (cause as { data: { reason?: string; until?: number; indefinite?: boolean } }).data;
          setBlocked(
            code === AUTH_ERROR.banned
              ? { status: "blocked", kind: "banned", reason: data.reason }
              : { status: "blocked", kind: "suspended", reason: data.reason, until: data.until, indefinite: data.indefinite },
          );
          go("blocked");
          return;
        }
        fail("We couldn't sign you in. Try again.");
      }
    },
    [fail, go, router, signIn, target],
  );

  /** Act on whatever the server says comes next. */
  const handle = useCallback(
    async (result: SignInStep, onInvalid?: () => void) => {
      switch (result.status) {
        case "signed_in":
          await finish(result.ticket);
          return;
        case "second_factor":
          setSecond({ token: result.token, methods: result.methods });
          setSecondCode("");
          setUseBackup(!result.methods.totp && !result.methods.passkey);
          go("second_factor");
          return;
        case "blocked":
          setBlocked(result);
          go("blocked");
          return;
        case "locked":
          setLockedUntil(result.until);
          fail("Too many wrong tries. Wait a moment, then try again.");
          return;
        case "expired":
          setProof(null);
          setCode("");
          go("email", -1);
          fail("That took too long. Start again.");
          return;
        case "invalid":
          onInvalid?.();
          fail(result.message ?? "That isn't right.");
          return;
      }
    },
    [fail, finish, go],
  );

  /** Run one step's work with the spinner and a safety net. */
  const run = useCallback(
    async (work: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await work();
      } catch (cause) {
        fail(errorMessage(cause, "Something went wrong. Try again."));
      } finally {
        setBusy(false);
      }
    },
    [fail],
  );

  // --- Email: the front door ----------------------------------------------------------------------

  const submitEmail = () =>
    run(async () => {
      const result = await lookup({ email });
      switch (result.state) {
        case "invalid_email":
          fail("Enter a valid email address.");
          return;
        case "throttled":
          fail("Too many tries from here. Wait a few minutes and try again.");
          return;
        case "password":
          setKnown(result.profile!);
          setPassword("");
          go("password");
          return;
        case "setup":
          setKnown(result.profile!);
          setPurpose("setup");
          go("setup_intro");
          return;
        case "signup":
          setKnown(null);
          setPurpose("signup");
          // Start the profile off with something sensible from the address.
          if (!name) setName((email.split("@")[0] ?? "").slice(0, 64));
          if (!usernameEdited) setUsername(suggestUsername(email));
          go("signup_prompt");
          return;
      }
    });

  // --- Password ------------------------------------------------------------------------------------

  const submitPassword = () =>
    run(async () => {
      const result = await signInWithPassword({ email, password });
      await handle(result, () => setPassword(""));
    });

  // --- Emailed code ---------------------------------------------------------------------------------

  const sendCode = (next: Purpose, then?: () => void) =>
    run(async () => {
      const result = await requestCode({ email });
      if (!result.ok) {
        fail(
          {
            invalid_email: "Enter a valid email address.",
            cooldown: "A code was just sent. Give it a minute before asking for another.",
            limit: "Too many codes for this address. Try again in a few minutes.",
            unavailable: "We can't send email right now. Try again in a little while.",
          }[result.reason],
        );
        // A code that was just sent is still good: carry on to the box for it.
        if (result.reason !== "cooldown") return;
      }
      setPurpose(next);
      setCode("");
      setProof(null);
      setResendAt(Date.now() + 45_000);
      then?.();
      go("code");
    });

  const submitCode = (value: string) =>
    run(async () => {
      const result = await verifyCode({ email, code: value });
      if (!result.ok) {
        setCode("");
        fail(result.message);
        return;
      }
      setProof(result.proof);
      go(purpose === "signup" ? "profile" : "new_password");
    });

  // --- Choosing a password ---------------------------------------------------------------------------

  const submitNewPassword = () =>
    run(async () => {
      if (!proof) {
        go("email", -1);
        return;
      }
      const result = await completeAction({
        email,
        proof,
        password,
        profile: purpose === "signup" ? { username: username.trim().toLowerCase(), name: name.trim() } : undefined,
      });
      // Encryption needs a session (the public key is registered as the signed-in account), so it is
      // set up in the app straight after this, not on this screen. This only tells that prompt to greet
      // a new account; nothing about keys is decided or stored here.
      if (purpose === "signup" && result.status === "signed_in") markNewAccount();
      await handle(result);
    });

  // --- The second step -----------------------------------------------------------------------------------

  const submitSecond = (value: string) =>
    run(async () => {
      if (!second) return;
      const result = await verifySecondFactor({ token: second.token, code: value });
      await handle(result, () => setSecondCode(""));
    });

  // --- Passkeys ------------------------------------------------------------------------------------------

  const [passkeysOk, setPasskeysOk] = useState(false);
  useEffect(() => setPasskeysOk(browserSupportsWebAuthn()), []);

  const passkeySignIn = () =>
    run(async () => {
      try {
        const options = await passkeySignInOptions({ origin: window.location.origin });
        const response = await startAuthentication({ optionsJSON: options as never });
        await handle(await passkeySignInVerify({ response }));
      } catch (cause) {
        // Closing the browser's own prompt isn't an error worth shouting about.
        if (cause instanceof Error && cause.name === "NotAllowedError") return;
        throw cause;
      }
    });

  const passkeySecond = () =>
    run(async () => {
      if (!second) return;
      try {
        const options = await passkeySecondOptions({ token: second.token, origin: window.location.origin });
        const response = await startAuthentication({ optionsJSON: options as never });
        await handle(await passkeySecondVerify({ token: second.token, response }));
      } catch (cause) {
        if (cause instanceof Error && cause.name === "NotAllowedError") return;
        throw cause;
      }
    });

  // --- Guest -------------------------------------------------------------------------------------------------

  const submitGuest = () =>
    run(async () => {
      await handle(await startGuest({ username: guestName }));
    });

  // --- Names, checked as they're typed ----------------------------------------------------------------------

  const profileHandle = useDebounced(username.trim().toLowerCase(), 350);
  const guestHandle = useDebounced(guestName.trim().toLowerCase(), 350);
  const profileCheck = useQuery(api.authFlow.usernameAvailable, step === "profile" && profileHandle ? { username: profileHandle } : "skip");
  const guestCheck = useQuery(api.authFlow.usernameAvailable, step === "guest" && guestHandle ? { username: guestHandle } : "skip");
  const profileTyped = username.trim().toLowerCase();
  const profileSettled = profileHandle === profileTyped;
  const guestSettled = guestHandle === guestName.trim().toLowerCase();

  // --- Going back ---------------------------------------------------------------------------------------------

  const back = useMemo<(() => void) | null>(() => {
    switch (step) {
      case "password":
      case "setup_intro":
      case "signup_prompt":
      case "guest":
        return () => go("email", -1);
      case "code":
        return () => go(purpose === "signup" ? "signup_prompt" : known ? (purpose === "setup" ? "setup_intro" : "password") : "email", -1);
      // The code is used up once it's accepted, so there is no stepping back into it: the address stays
      // proved for half an hour, and starting over is only for changing the email.
      case "profile":
        return () => go("email", -1);
      case "new_password":
        return () => go(purpose === "signup" ? "profile" : "email", -1);
      case "second_factor":
        return () => {
          setSecond(null);
          go("email", -1);
        };
      case "blocked":
        return () => {
          setBlocked(null);
          go("email", -1);
        };
      default:
        return null;
    }
  }, [step, purpose, known, go]);

  // --- The steps --------------------------------------------------------------------------------------------------

  const form = (onSubmit: () => void, children: React.ReactNode) => (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) onSubmit();
      }}
      className="space-y-5"
      noValidate
    >
      {children}
    </form>
  );

  const primary = (label: React.ReactNode, options: { disabled?: boolean; icon?: React.ReactNode } = {}) => (
    <Button type="submit" size="lg" className="h-11 w-full" disabled={busy || options.disabled}>
      {busy ? <Spinner /> : null}
      {label}
      {!busy && (options.icon ?? <ArrowRight className="size-4" />)}
    </Button>
  );

  const body: Record<Step, React.ReactNode> = {
    email: (
      <div className="space-y-6">
        <StepHeader
          title={bare ? "Sign in to Crystal" : "Welcome to Crystal"}
          description="Enter your email to sign in or create an account."
        />
        {form(
          submitEmail,
          <>
            <div className="space-y-1.5">
              <Label htmlFor="auth-email">Email</Label>
              <Input
                id="auth-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="username webauthn"
                autoFocus
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className="h-11"
                aria-invalid={!!error}
              />
              <FieldError message={error} />
            </div>
            {primary("Continue", { disabled: !email.trim() })}
          </>,
        )}
        <div className="space-y-2">
          <Divider>or</Divider>
          {passkeysOk && (
            <Button type="button" variant="outline" className="h-11 w-full" disabled={busy} onClick={passkeySignIn}>
              <Fingerprint className="size-4" />
              Sign in with a passkey
            </Button>
          )}
          <Button type="button" variant="ghost" className="h-11 w-full text-muted-foreground" disabled={busy} onClick={() => go("guest")}>
            <Sparkles className="size-4" />
            Try it as a guest
          </Button>
        </div>
      </div>
    ),

    password: (
      <div className="space-y-6">
        <StepHeader title={known ? `Welcome back, ${known.name}` : "Welcome back"} description="Enter your password to continue." />
        {known && <AccountChip name={known.name} username={known.username} imageUrl={known.imageUrl} detail={email} />}
        {form(
          submitPassword,
          <>
            <div className="space-y-1.5">
              <PasswordField id="auth-password" value={password} onChange={setPassword} autoComplete="current-password" autoFocus invalid={!!error} disabled={busy} />
              <FieldError message={error} />
              {locked > 0 && <p className="text-xs text-muted-foreground">You can try again in {formatWait(locked)}.</p>}
            </div>
            {primary("Sign in", { disabled: !password || locked > 0 })}
          </>,
        )}
        <div className="flex items-center justify-between text-sm">
          <button type="button" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={() => sendCode("reset")} disabled={busy}>
            Forgot your password?
          </button>
          {passkeysOk && (
            <button type="button" className="inline-flex items-center gap-1.5 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={passkeySignIn} disabled={busy}>
              <Fingerprint className="size-3.5" />
              Use a passkey
            </button>
          )}
        </div>
      </div>
    ),

    setup_intro: (
      <div className="space-y-6">
        <StepHeader
          title="Set up your password"
          description="Crystal now signs you in with an email and password. Since you don't have one yet, we'll email you a code to confirm it's you, then you can choose one."
        />
        {known && <AccountChip name={known.name} username={known.username} imageUrl={known.imageUrl} detail={email} />}
        <FieldError message={error} />
        <Button type="button" size="lg" className="h-11 w-full" disabled={busy} onClick={() => sendCode("setup")}>
          {busy ? <Spinner /> : <Mail className="size-4" />}
          Email me a code
        </Button>
      </div>
    ),

    code: (
      <div className="space-y-6">
        <StepHeader
          title="Check your email"
          description={
            <>
              We sent an {CODE_LENGTH}-digit code to <span className="font-medium text-foreground">{email}</span>.
              {purpose === "reset" && " Use it to choose a new password."}
            </>
          }
        />
        <div className="space-y-2">
          <CodeInput value={code} onChange={setCode} onComplete={submitCode} length={CODE_LENGTH} disabled={busy} invalid={!!error} label="Email code" key={shake} />
          <FieldError message={error} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={busy || resendIn > 0}
            onClick={() => sendCode(purpose)}
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:no-underline disabled:opacity-60"
          >
            {resendIn > 0 ? `Send a new code in ${resendIn}s` : "Send a new code"}
          </button>
          <Button type="button" disabled={busy || code.length < CODE_LENGTH} onClick={() => submitCode(code)}>
            {busy ? <Spinner /> : null}
            Verify
          </Button>
        </div>
      </div>
    ),

    new_password: (
      <div className="space-y-6">
        <StepHeader
          title={purpose === "signup" ? "Create a password" : purpose === "reset" ? "Choose a new password" : "Choose your password"}
          description={
            purpose === "signup"
              ? "Use something long that you don't use anywhere else. Once you're in, you'll get a recovery key that keeps your messages private."
              : "Use something long that you don't use anywhere else. It signs you out of other devices."
          }
        />
        {form(
          submitNewPassword,
          <>
            <div className="space-y-2">
              <PasswordField id="auth-new-password" value={password} onChange={setPassword} autoComplete="new-password" autoFocus invalid={!!error} disabled={busy} />
              <StrengthMeter password={password} />
              <FieldError message={error} />
            </div>
            {primary(purpose === "signup" ? "Create account" : "Save password and sign in", {
              disabled: password.length < 10,
              icon: purpose === "signup" ? <UserPlus className="size-4" /> : <Check className="size-4" />,
            })}
            <p className="text-xs text-muted-foreground">At least 10 characters. A few words together is easier to remember than symbols.</p>
          </>,
        )}
      </div>
    ),

    second_factor: (
      <div className="space-y-6">
        <StepHeader
          title="Two-step verification"
          description={
            useBackup
              ? "Enter one of your backup codes. Each works once."
              : second?.methods.totp
                ? "Enter the 6-digit code from your authenticator app."
                : "Use your passkey to finish signing in."
          }
        />
        {known && <AccountChip name={known.name} username={known.username} imageUrl={known.imageUrl} detail={email} />}
        {useBackup ? (
          form(
            () => submitSecond(secondCode),
            <>
              <div className="space-y-1.5">
                <Input
                  value={secondCode}
                  onChange={(event) => setSecondCode(event.target.value.toUpperCase())}
                  placeholder="XXXXX-XXXXX"
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  className="h-11 text-center font-mono tracking-widest"
                  aria-invalid={!!error}
                />
                <FieldError message={error} />
              </div>
              {primary("Verify", { disabled: secondCode.replace(/[^A-Z0-9]/gi, "").length < 10 })}
            </>,
          )
        ) : second?.methods.totp ? (
          <div className="space-y-2">
            <CodeInput value={secondCode} onChange={setSecondCode} onComplete={submitSecond} length={6} disabled={busy || locked > 0} invalid={!!error} key={shake} label="Authenticator code" />
            <FieldError message={error} />
            {locked > 0 && <p className="text-xs text-muted-foreground">You can try again in {formatWait(locked)}.</p>}
          </div>
        ) : (
          <FieldError message={error} />
        )}
        <div className="flex flex-col gap-2">
          {second?.methods.passkey && (
            <Button type="button" variant={second.methods.totp ? "outline" : "default"} className="h-11 w-full" disabled={busy} onClick={passkeySecond}>
              <Fingerprint className="size-4" />
              Use a passkey
            </Button>
          )}
          {second?.methods.backup && (second.methods.totp || second.methods.passkey) && (
            <button
              type="button"
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              onClick={() => {
                setUseBackup((b) => !b);
                setSecondCode("");
                setError(null);
              }}
            >
              {useBackup ? "Use my authenticator instead" : "Use a backup code instead"}
            </button>
          )}
        </div>
      </div>
    ),

    signup_prompt: (
      <div className="space-y-6">
        <StepHeader title="Create your account" description={<>There's no Crystal account for <span className="font-medium text-foreground">{email}</span> yet. Want to make one?</>} />
        <div className="space-y-2">
          <Button type="button" size="lg" className="h-11 w-full" disabled={busy} onClick={() => sendCode("signup")}>
            {busy ? <Spinner /> : <UserPlus className="size-4" />}
            Create account
          </Button>
          <FieldError message={error} />
          <Button type="button" variant="ghost" className="h-11 w-full text-muted-foreground" disabled={busy} onClick={() => go("email", -1)}>
            Use a different email
          </Button>
        </div>
      </div>
    ),

    profile: (
      <div className="space-y-6">
        <StepHeader title="Make it yours" description="Pick a display name and a username. People find you by your username, and you can change both later." />
        {form(
          () => go("new_password"),
          <>
            <div className="space-y-1.5">
              <Label htmlFor="auth-name">Display name</Label>
              <Input
                id="auth-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={64}
                autoFocus
                autoComplete="nickname"
                placeholder="Alex"
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="auth-username">Username</Label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">@</span>
                <Input
                  id="auth-username"
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value.toLowerCase());
                    setUsernameEdited(true);
                  }}
                  maxLength={32}
                  autoComplete="off"
                  spellCheck={false}
                  className="h-11 pl-7"
                  aria-invalid={profileSettled && profileCheck?.ok === false}
                />
              </div>
              <Availability typed={profileTyped} settled={profileSettled} result={profileCheck} />
            </div>
            <FieldError message={error} />
            {primary("Continue", { disabled: !name.trim() || !profileSettled || profileCheck?.ok !== true })}
          </>,
        )}
      </div>
    ),

    guest: (
      <div className="space-y-6">
        <StepHeader title="Try Crystal as a guest" description="Pick a username and look around. No email, no password." />
        <div className="space-y-2 rounded-xl border border-foreground/10 bg-foreground/5 p-3 text-sm">
          <p className="flex items-center gap-2">
            <Clock className="size-4 shrink-0 text-primary" />
            <span>Your guest account lasts <strong>24 hours</strong>, then it's wiped.</span>
          </p>
          <p className="flex items-center gap-2 text-muted-foreground">
            <ShieldOff className="size-4 shrink-0" />
            <span>Guests can't start communities, upload files or send friend requests.</span>
          </p>
        </div>
        {form(
          submitGuest,
          <>
            <div className="space-y-1.5">
              <Label htmlFor="auth-guest">Username</Label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">@</span>
                <Input
                  id="auth-guest"
                  value={guestName}
                  onChange={(event) => setGuestName(event.target.value.toLowerCase())}
                  maxLength={32}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="curious_cat"
                  className="h-11 pl-7"
                />
              </div>
              <Availability typed={guestName.trim().toLowerCase()} settled={guestSettled} result={guestCheck} />
              <FieldError message={error} />
            </div>
            {primary("Start exploring", { disabled: !guestSettled || guestCheck?.ok !== true, icon: <Sparkles className="size-4" /> })}
          </>,
        )}
        <Button type="button" variant="ghost" className="w-full text-muted-foreground" disabled={busy} onClick={() => { setPurpose("signup"); setEmail(""); go("email", -1); }}>
          Make this a permanent account
        </Button>
      </div>
    ),

    blocked: blocked ? <BlockedNotice blocked={blocked} /> : null,
  };

  // The signing-up flow has a progress bar and, given room, a live preview; every other step is one centred column.
  const progressIndex = SIGNUP_STEPS.findIndex((s) => s.id === (step === "signup_prompt" ? "email" : step));

  const stepView = (
    <StepSwitch id={step} direction={direction}>
      {body[step]}
    </StepSwitch>
  );

  const backButton = back && !done && (
    <Button type="button" variant="ghost" size="sm" className="-ml-2 text-muted-foreground" disabled={busy} onClick={back}>
      <ArrowLeft className="size-4" />
      Back
    </Button>
  );

  if (done) {
    return (
      <div className={cn("flex w-full items-center justify-center", bare ? "py-10" : "h-full p-8")}>
        <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 380, damping: 24 }} className="flex flex-col items-center gap-3">
          <div className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="size-7" />
          </div>
          <p className="text-sm text-muted-foreground">Signing you in…</p>
        </motion.div>
      </div>
    );
  }

  // Making an account, with room: the community wizard's layout, with a profile card taking shape on the right.
  if (wide) {
    return (
      <div className="relative h-full w-full overflow-hidden bg-[#06080c] text-foreground">
        <SignInBackdrop />
        <div className="relative z-10 mx-auto flex h-full max-w-6xl flex-col px-8 pb-8 pt-12">
          <SignUpProgress index={progressIndex} />
          <div className="grid min-h-0 flex-1 gap-12 pt-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
            <div className="flex min-h-0 flex-col justify-center gap-4">
              {backButton}
              {stepView}
            </div>
            <div className="hidden items-center justify-center lg:flex">
              <SignUpPreview name={name} username={username} step={step} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("relative flex w-full flex-col", bare ? "gap-3" : "h-full items-center justify-center p-8")}>
      <div className={cn("flex w-full flex-col gap-4", !bare && "max-w-sm")}>
        {bare && signingUp && <SignUpProgress index={progressIndex} />}
        {backButton}
        {stepView}
      </div>
    </div>
  );
}

// --- Pieces ---------------------------------------------------------------------------------------------------

function Divider({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-foreground/10" />
      {children}
      <span className="h-px flex-1 bg-foreground/10" />
    </div>
  );
}

/** The segmented bar the community wizard has, for the steps of making an account. */
function SignUpProgress({ index }: { index: number }) {
  return (
    <div className="flex w-full gap-1.5">
      {SIGNUP_STEPS.map((s, i) => (
        <div key={s.id} className="min-w-0 flex-1 space-y-1.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-foreground/15">
            <motion.div
              className="h-full rounded-full bg-primary"
              initial={false}
              animate={{ width: i <= index ? "100%" : "0%" }}
              transition={{ type: "spring", stiffness: 300, damping: 32 }}
            />
          </div>
          <p className={cn("truncate text-[11px] transition-colors", i === index ? "font-semibold text-foreground" : "text-muted-foreground")}>{s.label}</p>
        </div>
      ))}
    </div>
  );
}

/** "Is this username free?", said as it's typed. */
function Availability({
  typed,
  settled,
  result,
}: {
  typed: string;
  settled: boolean;
  result: { ok: true } | { ok: false; message: string } | undefined;
}) {
  let content: React.ReactNode = <span className="text-muted-foreground">3–32 letters, numbers, "." or "_".</span>;
  if (typed) {
    if (!settled || result === undefined) content = <span className="text-muted-foreground">Checking…</span>;
    else if (result.ok) {
      content = (
        <span className="inline-flex items-center gap-1 text-emerald-400">
          <Check className="size-3" /> @{typed} is yours to take
        </span>
      );
    } else content = <span className="text-destructive">{result.message}</span>;
  }
  return <p className="min-h-4 text-xs">{content}</p>;
}

/** Said in place of a session when the account is banned or suspended. */
function BlockedNotice({ blocked }: { blocked: Blocked }) {
  const banned = blocked.kind === "banned";
  return (
    <div className="space-y-5">
      <motion.div
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 22 }}
        className="flex size-14 items-center justify-center rounded-full bg-destructive/15 text-destructive"
      >
        {banned ? <Gavel className="size-7" /> : <ShieldOff className="size-7" />}
      </motion.div>
      <StepHeader
        title={banned ? "Your account has been banned" : "Your account is suspended"}
        description={
          banned
            ? "You can no longer use Crystal with this account."
            : blocked.indefinite || !blocked.until
              ? "It stays suspended until Crystal staff lift it."
              : `It will be restored on ${formatDateTime(blocked.until, { dateStyle: "long", timeStyle: "short" })}.`
        }
      />
      {blocked.reason && <p className="rounded-lg bg-foreground/5 p-3 text-sm">{blocked.reason}</p>}
      <p className="text-xs text-muted-foreground">If you think this is a mistake, contact Crystal support by email.</p>
    </div>
  );
}

// --- Small helpers ------------------------------------------------------------------------------------------------------

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(timer.current);
  }, [value, ms]);
  return settled;
}

/** A starting username from the part of the address before the `@`. The server has the final say. */
function suggestUsername(email: string): string {
  const base = (email.split("@")[0] ?? "").toLowerCase().replace(/[^a-z0-9_.]/g, "").replace(/^[._]+|[._]+$/g, "").replace(/[._]{2,}/g, "_").slice(0, 28);
  return base.length >= 3 ? base : "";
}

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.ceil(seconds / 60)} min`;
}
