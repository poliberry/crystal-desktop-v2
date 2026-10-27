/**
 * Where Stripe sends a creator back to after its payout set-up page.
 *
 * The set-up happens in the browser, and Stripe needs an address to return to;
 * this is it. It does nothing but say so — the app notices on its own, because
 * the Creator settings page asks Stripe again whenever the window is focused.
 */
export default function CreatorReturnPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-center text-foreground">
      <div className="max-w-sm space-y-2">
        <h1 className="text-2xl font-semibold">You&apos;re all set</h1>
        <p className="text-sm text-muted-foreground">
          You can close this tab and go back to Crystal. Your payout status updates there automatically.
        </p>
      </div>
    </main>
  );
}
