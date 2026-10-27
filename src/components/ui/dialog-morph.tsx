"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The inside of a dialog that has more than one view — a dialog and the
 * sub-dialog it would otherwise close itself to open.
 *
 * Opening a second dialog means the first goes away and the second appears,
 * which reads as two unrelated things and, worse, loses whatever was holding
 * the first one up (a hover card that unmounts when its dialog closes takes the
 * second dialog with it). Here there is one dialog for the whole trip: the
 * views swap inside it — the old one slides and fades out, the new one in — and
 * the frame eases to the new view's height as it does. Width is the frame's
 * business, since that is the `DialogContent`'s `max-w-*`; give it
 * `transition-[max-width]` (see `DIALOG_MORPH_FRAME`) and switch the class with
 * the view.
 *
 * `direction` is which way forward is: 1 slides new views in from the right
 * (drilling in), -1 from the left (coming back).
 */
export function DialogMorph({
  view,
  direction = 1,
  className,
  padded = true,
  children,
}: {
  view: string;
  direction?: 1 | -1;
  /** Room around the views for their focus rings. Turn off for a dialog with
   * no padding of its own (`p-0`), whose views run to the edge. */
  padded?: boolean;
  /** For the view's own layout — `grid gap-4` to match a plain dialog. */
  className?: string;
  children: React.ReactNode;
}) {
  const [height, setHeight] = useState<number>();

  return (
    // The negative margin and matching padding keep the focus rings of the
    // fields at the edge from being clipped by the overflow the height
    // animation needs.
    <motion.div
      className={cn("overflow-hidden", padded && "-m-1 p-1")}
      initial={false}
      // The frame is border-box, so its own 4px of padding a side comes out of the
      // height it is given: without adding it back the last 8px of the view —
      // the bottom of the buttons — is cut off.
      animate={{ height: height === undefined ? "auto" : height + (padded ? FRAME_PADDING * 2 : 0) }}
      transition={{ type: "spring", stiffness: 420, damping: 42 }}
    >
      <AnimatePresence mode="wait" initial={false} custom={direction}>
        <motion.div
          key={view}
          custom={direction}
          variants={VIEW}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.16, ease: "easeOut" }}
        >
          <Measured onHeight={setHeight} className={className}>
            {children}
          </Measured>
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

/** The `p-1` the frame carries when `padded`, in px. */
const FRAME_PADDING = 4;

const VIEW = {
  enter: (direction: number) => ({ opacity: 0, x: 24 * direction }),
  center: { opacity: 1, x: 0 },
  exit: (direction: number) => ({ opacity: 0, x: -24 * direction }),
};

/** Reports the height of what it holds as it changes — the view being typed
 * into grows and shrinks (an error line, a row added) and the frame follows. */
function Measured({
  onHeight,
  className,
  children,
}: {
  onHeight: (height: number) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => onHeight(el.offsetHeight);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [onHeight]);
  return (
    <div ref={ref} className={cn(className)}>
      {children}
    </div>
  );
}

/** Classes for the `DialogContent` of a morphing dialog, so its width eases
 * between views instead of jumping. */
export const DIALOG_MORPH_FRAME = "transition-[max-width] duration-300 ease-out";
