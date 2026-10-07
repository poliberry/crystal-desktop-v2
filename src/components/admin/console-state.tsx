"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";

/**
 * The console's working state: which things are open, and where.
 *
 * Modelled on Dynamics 365's multi-session workspace, because the work is the
 * same shape. A staff member is rarely doing one thing: a report leads to a
 * user, the user to an order, the order to a support ticket — and then someone
 * else needs an answer and the first thread has to wait without being lost.
 *
 *   - **Home** is always there: the site map and its lists and queues.
 *   - A **session** is one piece of work, begun by opening a record from a list.
 *     Opening the same record again goes to its session rather than starting a
 *     second one.
 *   - A session has **tabs**: the record it began with, and any related record
 *     opened from inside it — so the report, the person it is about and their
 *     order sit together under one heading, and closing the session closes the
 *     lot.
 *
 * Every open session stays mounted (see `Workspace`), so what was half-typed in
 * one is still there when you come back. The list of sessions is remembered per
 * staff member, so reopening the console picks up where it was left.
 */

export type EntityKind = "report" | "user" | "community" | "ticket" | "order" | "sku" | "submission" | "extension";

export interface EntityRef {
  kind: EntityKind;
  /** The record's id — or `new:<anything>` for a draft that doesn't exist yet. */
  id: string;
  title: string;
  subtitle?: string;
}

export interface ConsoleTab {
  id: string;
  ref: EntityRef;
}

export interface Session {
  id: string;
  tabs: ConsoleTab[];
  activeTabId: string;
}

export const HOME = "home" as const;

export interface ConsoleState {
  sessions: Session[];
  /** A session's id, or `"home"`. */
  active: string;
  /** Which part of the site map Home is showing. */
  section: string;
}

/** Past this many open, the oldest is closed to make room — each is a live set
 * of subscriptions, and nobody works on twenty things at once. */
export const MAX_SESSIONS = 12;
const MAX_TABS = 8;

export const entityKey = (ref: Pick<EntityRef, "kind" | "id">) => `${ref.kind}:${ref.id}`;

type Action =
  | { type: "open"; ref: EntityRef; where: "session" | "tab" }
  | { type: "closeTab"; sessionId: string; tabId: string }
  | { type: "closeSession"; sessionId: string }
  | { type: "activate"; id: string }
  | { type: "activateTab"; sessionId: string; tabId: string }
  | { type: "section"; section: string }
  | { type: "retitle"; ref: Pick<EntityRef, "kind" | "id">; title: string; subtitle?: string }
  | { type: "reorder"; from: number; to: number }
  | { type: "replace"; state: ConsoleState };

function reducer(state: ConsoleState, action: Action): ConsoleState {
  switch (action.type) {
    case "open": {
      const key = entityKey(action.ref);
      // Already open somewhere: go there.
      for (const session of state.sessions) {
        const tab = session.tabs.find((t) => t.id === key);
        if (tab) {
          return {
            ...state,
            active: session.id,
            sessions: state.sessions.map((s) => (s.id === session.id ? { ...s, activeTabId: tab.id } : s)),
          };
        }
      }
      // As a tab of the session being worked in, when there is one.
      if (action.where === "tab" && state.active !== HOME) {
        return {
          ...state,
          sessions: state.sessions.map((s) =>
            s.id === state.active
              ? {
                  ...s,
                  tabs: [...s.tabs, { id: key, ref: action.ref }].slice(-MAX_TABS),
                  activeTabId: key,
                }
              : s,
          ),
        };
      }
      const fresh: Session = { id: key, tabs: [{ id: key, ref: action.ref }], activeTabId: key };
      const sessions = [...state.sessions, fresh].slice(-MAX_SESSIONS);
      return { ...state, sessions, active: fresh.id };
    }

    case "closeTab": {
      const session = state.sessions.find((s) => s.id === action.sessionId);
      if (!session) return state;
      const tabs = session.tabs.filter((t) => t.id !== action.tabId);
      // The last tab closing is the session closing.
      if (tabs.length === 0) return reducer(state, { type: "closeSession", sessionId: session.id });
      const idx = session.tabs.findIndex((t) => t.id === action.tabId);
      const activeTabId =
        session.activeTabId === action.tabId ? tabs[Math.max(0, idx - 1)].id : session.activeTabId;
      return {
        ...state,
        sessions: state.sessions.map((s) => (s.id === session.id ? { ...s, tabs, activeTabId } : s)),
      };
    }

    case "closeSession": {
      const idx = state.sessions.findIndex((s) => s.id === action.sessionId);
      if (idx === -1) return state;
      const sessions = state.sessions.filter((s) => s.id !== action.sessionId);
      // Closing the one you are in goes to its neighbour, or Home.
      const active =
        state.active === action.sessionId ? (sessions[Math.max(0, idx - 1)]?.id ?? HOME) : state.active;
      return { ...state, sessions, active };
    }

    case "activate":
      return state.active === action.id ? state : { ...state, active: action.id };

    case "activateTab":
      return {
        ...state,
        sessions: state.sessions.map((s) => (s.id === action.sessionId ? { ...s, activeTabId: action.tabId } : s)),
      };

    case "section":
      return { ...state, section: action.section, active: HOME };

    case "retitle": {
      const key = entityKey(action.ref);
      let changed = false;
      const sessions = state.sessions.map((s) => ({
        ...s,
        tabs: s.tabs.map((t) => {
          if (t.id !== key) return t;
          if (t.ref.title === action.title && t.ref.subtitle === action.subtitle) return t;
          changed = true;
          return { ...t, ref: { ...t.ref, title: action.title, subtitle: action.subtitle } };
        }),
      }));
      return changed ? { ...state, sessions } : state;
    }

    case "reorder": {
      if (action.from === action.to) return state;
      const sessions = [...state.sessions];
      const [moved] = sessions.splice(action.from, 1);
      if (!moved) return state;
      sessions.splice(action.to, 0, moved);
      return { ...state, sessions };
    }

    case "replace":
      return action.state;
  }
}

// --- Remembering it --------------------------------------------------------------------

const STORAGE_PREFIX = "crystal-admin-workspace:";
const KINDS: EntityKind[] = ["report", "user", "community", "ticket", "order", "sku", "submission", "extension"];

function isRef(value: unknown): value is EntityRef {
  const ref = value as Partial<EntityRef> | null;
  return (
    !!ref &&
    typeof ref.id === "string" &&
    typeof ref.title === "string" &&
    KINDS.includes(ref.kind as EntityKind)
  );
}

/** What was saved, or nothing if it isn't something this version can read. */
function load(userId: string): ConsoleState | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + userId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConsoleState>;
    if (!Array.isArray(parsed.sessions)) return null;
    const sessions: Session[] = [];
    for (const s of parsed.sessions.slice(0, MAX_SESSIONS)) {
      const tabs = (Array.isArray(s?.tabs) ? s.tabs : [])
        .filter((t): t is ConsoleTab => !!t && isRef(t.ref))
        // A draft that never got saved has nothing to come back to.
        .filter((t) => !t.ref.id.startsWith("new:"))
        .map((t) => ({ id: entityKey(t.ref), ref: t.ref }));
      if (tabs.length === 0) continue;
      sessions.push({
        id: tabs[0].id,
        tabs,
        activeTabId: tabs.some((t) => t.id === s.activeTabId) ? (s.activeTabId as string) : tabs[0].id,
      });
    }
    const active =
      parsed.active === HOME || sessions.some((s) => s.id === parsed.active) ? (parsed.active as string) : HOME;
    return { sessions, active, section: typeof parsed.section === "string" ? parsed.section : "dashboard" };
  } catch {
    return null;
  }
}

// --- Context -----------------------------------------------------------------------------

interface ConsoleApi extends ConsoleState {
  /** Open a record. From a list this starts a session; from inside one it adds
   * a tab to it (`where` overrides). Opening what's already open goes to it. */
  open: (ref: EntityRef, where?: "session" | "tab") => void;
  closeTab: (sessionId: string, tabId: string) => void;
  closeSession: (sessionId: string) => void;
  activate: (id: string) => void;
  activateTab: (sessionId: string, tabId: string) => void;
  goHome: (section?: string) => void;
  /** A record knows its own name better than whoever opened it did. */
  retitle: (ref: Pick<EntityRef, "kind" | "id">, title: string, subtitle?: string) => void;
  reorder: (from: number, to: number) => void;
  /** The session being worked in, if it isn't Home. */
  current: Session | null;
}

const ConsoleContext = createContext<ConsoleApi | null>(null);

export function ConsoleProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { sessions: [], active: HOME, section: "dashboard" });
  const loaded = useRef(false);

  // Restored after mount rather than in the initial state: this renders on the
  // server too (static export), where there is no storage to read.
  useEffect(() => {
    const saved = load(userId);
    if (saved) dispatch({ type: "replace", state: saved });
    loaded.current = true;
  }, [userId]);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify(state));
    } catch {
      // Storage full or blocked: the workspace just isn't remembered.
    }
  }, [state, userId]);

  const open = useCallback<ConsoleApi["open"]>(
    (ref, where = "tab") => dispatch({ type: "open", ref, where }),
    [],
  );

  const api = useMemo<ConsoleApi>(
    () => ({
      ...state,
      current: state.sessions.find((s) => s.id === state.active) ?? null,
      open,
      closeTab: (sessionId, tabId) => dispatch({ type: "closeTab", sessionId, tabId }),
      closeSession: (sessionId) => dispatch({ type: "closeSession", sessionId }),
      activate: (id) => dispatch({ type: "activate", id }),
      activateTab: (sessionId, tabId) => dispatch({ type: "activateTab", sessionId, tabId }),
      goHome: (section) => (section ? dispatch({ type: "section", section }) : dispatch({ type: "activate", id: HOME })),
      retitle: (ref, title, subtitle) => dispatch({ type: "retitle", ref, title, subtitle }),
      reorder: (from, to) => dispatch({ type: "reorder", from, to }),
    }),
    [state, open],
  );

  return <ConsoleContext.Provider value={api}>{children}</ConsoleContext.Provider>;
}

export function useConsole(): ConsoleApi {
  const ctx = useContext(ConsoleContext);
  if (!ctx) throw new Error("useConsole must be used inside <ConsoleProvider>");
  return ctx;
}

/** What a list row calls to open a record: from Home it starts a session, from
 * inside a session it adds a tab, and holding Ctrl/⌘ always starts a new one. */
export function useOpenEntity() {
  const { open, active } = useConsole();
  return useCallback(
    (ref: EntityRef, event?: { metaKey?: boolean; ctrlKey?: boolean }) => {
      const forceNew = !!(event?.metaKey || event?.ctrlKey);
      open(ref, forceNew || active === HOME ? "session" : "tab");
    },
    [open, active],
  );
}
