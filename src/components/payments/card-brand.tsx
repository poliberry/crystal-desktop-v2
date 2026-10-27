import { FaCcAmex, FaCcDiscover, FaCcJcb, FaCcMastercard, FaCcVisa, FaCreditCard } from "react-icons/fa";

import { cn } from "@/lib/utils";

/** Stripe's lower-case brand slug as people write it. */
export function brandLabel(brand: string | null | undefined): string {
  if (!brand) return "Card";
  if (brand === "amex") return "American Express";
  if (brand === "jcb") return "JCB";
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

export function CardBrandIcon({ brand, className }: { brand: string | null | undefined; className?: string }) {
  const cls = cn("size-7 shrink-0", className);
  switch (brand) {
    case "visa":
      return <FaCcVisa className={cls} />;
    case "mastercard":
      return <FaCcMastercard className={cls} />;
    case "amex":
      return <FaCcAmex className={cls} />;
    case "discover":
      return <FaCcDiscover className={cls} />;
    case "jcb":
      return <FaCcJcb className={cls} />;
    default:
      return <FaCreditCard className={cls} />;
  }
}

/** `Visa •••• 4242`. */
export function cardSummary(card: { brand: string; last4: string }): string {
  return `${brandLabel(card.brand)} •••• ${card.last4}`;
}
