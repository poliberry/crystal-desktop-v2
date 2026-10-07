/**
 * Money, the way a person reads it: `$4.99`, `£2.00`, `Free`.
 *
 * Amounts are always whole cents in the currency's smallest unit — the form the
 * server stores and Stripe takes — and are only turned into text here, at the
 * last moment. None of the currencies the store sells in (USD, AUD, EUR, GBP)
 * is a zero-decimal one, so dividing by a hundred is right for all of them.
 */
export function formatMoney(cents: number, currency: string, options: { free?: boolean } = {}): string {
  if (cents === 0 && options.free !== false) return "Free";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/** `Mar 4, 2026`. */
export function formatDate(at: number | Date, withTime = false): string {
  return new Date(at).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

/** `3 days ago`, `in 2 hours`. */
export function formatRelative(at: number): string {
  const diff = at - Date.now();
  const abs = Math.abs(diff);
  if (abs < 60_000) return "just now";
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [
    [60_000, "minute"],
    [3_600_000, "hour"],
    [86_400_000, "day"],
    [2_592_000_000, "month"],
    [31_536_000_000, "year"],
  ];
  let unit = steps[0];
  for (const step of steps) if (abs >= step[0]) unit = step;
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(Math.round(diff / unit[0]), unit[1]);
}
