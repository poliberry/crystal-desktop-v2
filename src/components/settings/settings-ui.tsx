"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useRef } from "react";

import { cn } from "@/lib/utils";
import { GLASS_SETTINGS } from "@/components/sidebar/glass";

/**
 * The pieces a settings page is built from — Windows Settings' vocabulary in
 * this app's glass.
 *
 * A page is a large title, then groups: each a small heading over a stack of
 * cards, one setting to a card, with what it is called and what it does on the
 * left and the control on the right. Put them inside a `.settings-surface`
 * (see globals.css) for the tinted page they sit on.
 */

/** The page: its title and what it is for, over the content, in a column
 * three quarters of the page wide and centred. Anything wider than that
 * overflows the page's scroller, which scrolls sideways (see `ScrollArea`'s
 * `horizontal`). The content is deliberately not a scroller itself: a sticky
 * element inside it (the community profile card) sticks to the nearest
 * scroller, and that has to be the page's. */
export function SettingsPageLayout({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-3/4 min-w-0 space-y-6 pt-8 pb-12">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </header>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A heading over a stack of cards. */
export function SettingsGroup({
  title,
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-2", className)}>
      {title && <h2 className="px-1 text-sm font-semibold">{title}</h2>}
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

/** A glass card with nothing decided about what is inside it. */
export function SettingsCard({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return <div className={cn(GLASS_SETTINGS, className)} {...props} />;
}

/**
 * One setting: an icon, what it is called and what it does, and its control at
 * the right.
 */
export function SettingRow({
  icon: Icon,
  title,
  description,
  children,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  /** The control. */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <SettingsCard className={cn("flex min-h-[4.25rem] items-center gap-4 px-4 py-3", className)}>
      {Icon && <Icon className="size-5 shrink-0 text-muted-foreground" />}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </SettingsCard>
  );
}

/** A page-menu button: the active one carries a short accent bar at its left
 * edge, as Windows Settings marks the page you are on. */
export const SETTINGS_NAV_BUTTON =
  "relative data-[active=true]:before:absolute data-[active=true]:before:top-1/2 data-[active=true]:before:left-0 data-[active=true]:before:h-4 data-[active=true]:before:w-[3px] data-[active=true]:before:-translate-y-1/2 data-[active=true]:before:rounded-full data-[active=true]:before:bg-primary";

const SLIDE = 24;
const SLIDE_TRANSITION = { type: "spring" as const, stiffness: 420, damping: 34 };

const SECTION_VARIANTS = {
  enter: (direction: number) => ({ opacity: 0, y: SLIDE * direction }),
  center: { opacity: 1, y: 0 },
  exit: (direction: number) => ({ opacity: 0, y: -SLIDE * direction }),
};

/**
 * Switching between a settings page's sections: a short slide and a fade on
 * the sidebar's spring, up and down — the way the menu is laid out.
 *
 * Direction follows the menu: going to a section further down slides the new
 * one up from below and the old one out through the top, and going back up is
 * the reverse. `index` is the section's place in the menu.
 *
 * The leaving section stays exactly as it was — scroll position and all — while
 * it goes, which is why it is popped out of the flow rather than removed.
 */
export function SectionTransition({
  sectionKey,
  index,
  children,
}: {
  sectionKey: string;
  index: number;
  children: React.ReactNode;
}) {
  const last = useRef(index);
  const direction = useRef(1);
  if (index !== last.current) {
    direction.current = index > last.current ? 1 : -1;
    last.current = index;
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <AnimatePresence initial={false} custom={direction.current} mode="popLayout">
        <motion.div
          key={sectionKey}
          custom={direction.current}
          variants={SECTION_VARIANTS}
          initial="enter"
          animate="center"
          exit="exit"
          transition={SLIDE_TRANSITION}
          className="flex min-h-0 flex-1 flex-col"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
