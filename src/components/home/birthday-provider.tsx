"use client";

import { useMutation, useQuery } from "convex/react";
import { AnimatePresence } from "framer-motion";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { api } from "../../../convex/_generated/api";
import { BirthdayCelebration } from "@/components/home/birthday-gift-dialog";

/** No birthday today, or none stored. */
const NO_BIRTHDAY = { inWindow: false, isToday: false, endsAt: undefined };

/** How long after midnight on the day the celebration stays replayable. */
const WINDOW_HOURS = 72;

/** Remembers the birthday already auto-played, so a reload on the day doesn't
 * take the whole window over again. Holds the year of that birthday. */
const SEEN_KEY = "crystal.birthday-celebrated";

interface BirthdayContextValue {
  /** Whether the replay affordance belongs on screen at all. */
  inWindow: boolean;
  /** True only on the day itself, for wording that shouldn't say "today" on
   * the third day after. */
  isToday: boolean;
  /** Play the whole thing again from the unopened box. */
  celebrate: () => void;
}

const BirthdayContext = createContext<BirthdayContextValue>({
  inWindow: false,
  isToday: false,
  celebrate: () => {},
});

export function useBirthday(): BirthdayContextValue {
  return useContext(BirthdayContext);
}

/**
 * When the birthday stored as `dob` last came round, if it was recently
 * enough to still be celebrating.
 *
 * Both this year's and last year's occurrence are checked, because a birthday
 * on the 31st of December is still inside its window on the 1st of January —
 * comparing day-and-month alone would call that a miss.
 *
 * A 29th of February birthday lands on the 1st of March in common years,
 * which is `Date`'s own rollover rather than a decision made here.
 */
function birthdayWindow(dob: string | undefined, now: Date) {
  if (!dob) return NO_BIRTHDAY;

  const [, month, day] = dob.split("-");
  // A stored value in some other shape would compare as "NaN" forever, so
  // treat it as no birthday rather than as one that never arrives.
  if (!month || !day) return NO_BIRTHDAY;

  const monthIndex = Number(month) - 1;
  const dayOfMonth = Number(day);
  if (Number.isNaN(monthIndex) || Number.isNaN(dayOfMonth)) {
    return NO_BIRTHDAY;
  }

  const year = now.getFullYear();
  for (const candidateYear of [year, year - 1]) {
    // Local midnight: the window should start when the day starts for the
    // person having the birthday, not at some shared UTC instant.
    const start = new Date(candidateYear, monthIndex, dayOfMonth);
    const elapsedHours = (now.getTime() - start.getTime()) / 3_600_000;
    if (elapsedHours >= 0 && elapsedHours < WINDOW_HOURS) {
      return {
        inWindow: true,
        isToday: elapsedHours < 24,
        // Local midnight at the end of the birthday, which is the one piece
        // of this the server cannot work out for itself — see claimBirthday.
        endsAt: start.getTime() + 24 * 3_600_000,
      };
    }
  }

  return NO_BIRTHDAY;
}

/**
 * Decides whether it's someone's birthday, plays the celebration once when it
 * is, and keeps it replayable for three days afterwards.
 *
 * Separate from the celebration itself so the top nav can trigger a replay
 * without either component having to reach into the other.
 */
export function BirthdayProvider({ children }: { children: React.ReactNode }) {
  const me = useQuery(api.users.getCurrentUser);
  const dob = me?.dob;

  const [open, setOpen] = useState(false);
  /** Bumped on every replay, and used as the celebration's `key`: remounting
   * is what rewinds it to the unopened box. */
  const [run, setRun] = useState(0);

  // Evaluated once per change of birthday rather than on a timer. Someone who
  // leaves the app open across midnight gets the greeting on their next
  // navigation, which is a fair trade for not running a clock all year.
  const { inWindow, isToday, endsAt } = useMemo(
    () => birthdayWindow(dob, new Date()),
    [dob]
  );

  /**
   * Tell the server it is this user's birthday, and until when.
   *
   * Their timezone lives here and nowhere else, so this is what everything
   * else keys off: the cake in place of their presence dot, the decoration
   * around their avatar, and the prompt a friend gets above the composer. The
   * mutation mints the decoration and is a no-op once the day is claimed, so
   * running it again on a reload costs a round trip and changes nothing.
   */
  const claimBirthday = useMutation(api.users.claimBirthday);
  useEffect(() => {
    if (!isToday || endsAt === undefined) return;
    void claimBirthday({ expiresAt: endsAt });
  }, [isToday, endsAt, claimBirthday]);

  const celebrate = useCallback(() => {
    setRun((n) => n + 1);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    if (dob) {
      // Keyed by the birthday's own year, so the entry written on the 1st of
      // January for last December's birthday doesn't also suppress this
      // year's.
      localStorage.setItem(SEEN_KEY, String(birthdayYear(dob, new Date())));
    }
  }, [dob]);

  // The one automatic showing. Everything after it is on the cake button.
  useEffect(() => {
    if (!inWindow || !dob) return;
    if (localStorage.getItem(SEEN_KEY) === String(birthdayYear(dob, new Date()))) return;
    celebrate();
  }, [inWindow, dob, celebrate]);

  const value = useMemo(
    () => ({ inWindow, isToday, celebrate }),
    [inWindow, isToday, celebrate]
  );

  return (
    <BirthdayContext.Provider value={value}>
      {children}
      <AnimatePresence>
        {open && (
          <BirthdayCelebration key={run} name={me?.name} onDone={close} />
        )}
      </AnimatePresence>
    </BirthdayContext.Provider>
  );
}

/** Which year's birthday the current window belongs to — this one, or last
 * one for a birthday that has rolled over the new year. */
function birthdayYear(dob: string, now: Date): number {
  const [, month, day] = dob.split("-");
  const start = new Date(now.getFullYear(), Number(month) - 1, Number(day));
  return start.getTime() > now.getTime() ? now.getFullYear() - 1 : now.getFullYear();
}
