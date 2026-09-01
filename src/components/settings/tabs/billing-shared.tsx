import {
  FaCcAmex,
  FaCcDiscover,
  FaCcMastercard,
  FaCcVisa,
  FaCreditCard,
} from "react-icons/fa";

import { cn } from "@/lib/utils";

/**
 * Stripe reports money in the currency's minor unit (cents). Formatting with a
 * US locale gives the "A$14.99" / "US$5.00" style prefixes that match the
 * screenshots rather than a bare "$".
 */
export function formatMoney(
  amount: number | null | undefined,
  currency: string | null | undefined,
): string {
  const code = (currency ?? "usd").toUpperCase();
  const value = (amount ?? 0) / 100;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
    }).format(value);
  } catch {
    return `${code} ${value.toFixed(2)}`;
  }
}

const regionNames =
  typeof Intl !== "undefined" && "DisplayNames" in Intl
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;

const currencyNames =
  typeof Intl !== "undefined" && "DisplayNames" in Intl
    ? new Intl.DisplayNames(["en"], { type: "currency" })
    : null;

export function regionName(code: string | null | undefined): string | null {
  if (!code) return null;
  try {
    return regionNames?.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export function currencyName(code: string | null | undefined): string {
  if (!code) return "";
  try {
    return currencyNames?.of(code.toUpperCase()) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function monthName(month: number | null | undefined): string {
  if (!month || month < 1 || month > 12) return "";
  return MONTHS[month - 1];
}

/** Title-cases a Stripe brand slug ("mastercard" -> "Mastercard"). */
export function brandLabel(brand: string | null | undefined): string {
  if (!brand) return "Card";
  if (brand === "amex") return "American Express";
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

export function CardBrandIcon({
  brand,
  className,
}: {
  brand: string | null | undefined;
  className?: string;
}) {
  const cls = cn("size-6 shrink-0", className);
  switch (brand) {
    case "visa":
      return <FaCcVisa />;
    case "mastercard":
      return <FaCcMastercard />;
    case "amex":
      return <FaCcAmex />;
    case "discover":
      return <FaCcDiscover />;
    default:
      return <FaCreditCard />;
  }
}
