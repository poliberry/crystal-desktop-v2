/**
 * Polls, as plain functions: what a valid poll is, who may still vote, and how votes are counted.
 * A poll lives on a channel message (`channelMessages.poll`); the votes are `channelPollVotes`.
 */

export const POLL_LIMITS = {
  question: 300,
  option: 100,
  minOptions: 2,
  maxOptions: 10,
  /** Shortest and longest a poll can run for. Longer than a fortnight is a survey, not a poll. */
  minDurationMs: 60 * 1000,
  maxDurationMs: 14 * 24 * 60 * 60 * 1000,
} as const;

/** The durations the composer offers, in hours; `null` runs until it is ended. */
export const POLL_DURATIONS: { label: string; hours: number | null }[] = [
  { label: "1 hour", hours: 1 },
  { label: "4 hours", hours: 4 },
  { label: "8 hours", hours: 8 },
  { label: "24 hours", hours: 24 },
  { label: "3 days", hours: 72 },
  { label: "1 week", hours: 168 },
  { label: "2 weeks", hours: 336 },
  { label: "Until ended", hours: null },
];

/** What a sender submits. In an end-to-end encrypted room the words travel inside the ciphertext, so
 * only `optionCount` (and the settings) reach the server; otherwise `question` and `options` do. */
export interface PollInput {
  question?: string;
  options?: string[];
  optionCount?: number;
  multi?: boolean;
  durationMs?: number;
}

export interface StoredPoll {
  /** How many options there are; their ids are 0 to `optionCount - 1`. */
  optionCount: number;
  multi: boolean;
  expiresAt?: number;
  endedAt?: number;
  /** Present only when the message is not end-to-end encrypted. */
  question?: string;
  options?: { id: number; text: string }[];
}

const collapse = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u202a-\u202e\u2066-\u2069]/g, "").replace(/\s+/g, " ").trim();

/** Check a poll's words. Used by the server for a plaintext poll and by the sender's client before encrypting. */
export function cleanPollText(question: string, options: string[]): { question: string; options: string[] } {
  const q = collapse(question);
  if (!q) throw new Error("A poll needs a question.");
  if (q.length > POLL_LIMITS.question) throw new Error(`A poll's question is up to ${POLL_LIMITS.question} characters.`);
  const opts = options.map(collapse).filter(Boolean);
  if (opts.length < POLL_LIMITS.minOptions) throw new Error(`A poll needs at least ${POLL_LIMITS.minOptions} options.`);
  if (opts.length > POLL_LIMITS.maxOptions) throw new Error(`A poll has up to ${POLL_LIMITS.maxOptions} options.`);
  if (opts.some((o) => o.length > POLL_LIMITS.option)) throw new Error(`An option is up to ${POLL_LIMITS.option} characters.`);
  if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) throw new Error("Two of the options are the same.");
  return { question: q, options: opts };
}

/** A poll as submitted, rebuilt into what is stored. Throws, saying what is wrong. */
export function cleanPoll(input: PollInput, now: number, encrypted: boolean): StoredPoll {
  let optionCount: number;
  let words: { question: string; options: { id: number; text: string }[] } | undefined;
  if (encrypted) {
    if (input.question !== undefined || input.options !== undefined) throw new Error("In an encrypted channel a poll's words travel inside the encrypted message.");
    optionCount = input.optionCount ?? 0;
    if (!Number.isInteger(optionCount) || optionCount < POLL_LIMITS.minOptions || optionCount > POLL_LIMITS.maxOptions) {
      throw new Error(`A poll has ${POLL_LIMITS.minOptions} to ${POLL_LIMITS.maxOptions} options.`);
    }
  } else {
    const clean = cleanPollText(input.question ?? "", input.options ?? []);
    optionCount = clean.options.length;
    words = { question: clean.question, options: clean.options.map((text, id) => ({ id, text })) };
  }

  let expiresAt: number | undefined;
  if (input.durationMs !== undefined) {
    if (!Number.isFinite(input.durationMs) || input.durationMs < POLL_LIMITS.minDurationMs || input.durationMs > POLL_LIMITS.maxDurationMs) {
      throw new Error("A poll runs for between a minute and two weeks.");
    }
    expiresAt = Math.floor(now + input.durationMs);
  }
  return {
    optionCount,
    multi: input.multi === true,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(words ?? {}),
  };
}

/** Whether votes are still being taken. */
export function pollIsOpen(poll: Pick<StoredPoll, "expiresAt" | "endedAt">, now: number): boolean {
  if (poll.endedAt !== undefined) return false;
  return poll.expiresAt === undefined || now < poll.expiresAt;
}

/**
 * A voter's whole choice, checked: only options the poll has, none twice, and one at most unless the
 * poll allows several. Empty is allowed — it takes the vote back. Throws on a closed poll.
 */
export function validateVote(poll: StoredPoll, optionIds: number[], now: number): number[] {
  if (!pollIsOpen(poll, now)) throw new Error("This poll has ended.");
  const unique = [...new Set(optionIds)];
  if (unique.some((id) => !Number.isInteger(id) || id < 0 || id >= poll.optionCount)) throw new Error("That isn't one of the poll's options.");
  if (!poll.multi && unique.length > 1) throw new Error("This poll takes one answer.");
  return unique;
}

export interface PollResults {
  /** Votes per option id (every option present, 0 if none). */
  counts: Record<number, number>;
  /** People who voted at all. */
  voters: number;
  /** The viewer's own choices. */
  mine: number[];
  /** The option id(s) in front, none if nobody has voted. */
  leading: number[];
}

export function tallyVotes(poll: Pick<StoredPoll, "optionCount">, votes: { userId: string; optionId: number }[], me: string): PollResults {
  const counts: Record<number, number> = {};
  for (let id = 0; id < poll.optionCount; id++) counts[id] = 0;
  const voters = new Set<string>();
  const mine: number[] = [];
  for (const vote of votes) {
    if (!(vote.optionId in counts)) continue;
    counts[vote.optionId]++;
    voters.add(vote.userId);
    if (vote.userId === me) mine.push(vote.optionId);
  }
  const top = Math.max(0, ...Object.values(counts));
  const leading = top === 0 ? [] : Object.keys(counts).map(Number).filter((id) => counts[id] === top);
  return { counts, voters: voters.size, mine, leading };
}
