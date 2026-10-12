import { cn } from "@/lib/utils";

/**
 * A "GIF" glyph: the three letters inside a rounded frame, drawn on Lucide's 24px grid with its stroke, so it sits among
 * the other icons in the composer as if it were one of them (Lucide has no GIF icon).
 *
 * It carries Lucide's `lucide-gif` class, which is what a theme pack's icon replacement matches on, so a pack can restyle
 * this like any other icon.
 */
export function GifIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn("lucide lucide-gif", className)}
      {...props}
    >
      <rect x="2" y="5" width="20" height="14" rx="3" />
      {/* G */}
      <path d="M10.2 10.9a2.2 2.2 0 1 0 0 2.2V12H9" strokeWidth={1.6} />
      {/* I */}
      <path d="M12.7 10v4" strokeWidth={1.6} />
      {/* F */}
      <path d="M17.4 10h-2.4v4M15 12h1.8" strokeWidth={1.6} />
    </svg>
  );
}
