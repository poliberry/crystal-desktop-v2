"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

export interface SavedAuthAccount { id: string; name: string; username: string; imageUrl?: string }
interface AccountContextValue {
  namespace: string;
  accounts: SavedAuthAccount[];
  remember: (account: SavedAuthAccount) => Promise<void>;
  switchTo: (id: string) => void;
  addAccount: () => void;
}
const AccountContext = createContext<AccountContextValue | null>(null);
const DEFAULT = "default";
const ACTIVE_KEY = "crystal-auth-active";
const ACCOUNTS_KEY = "crystal-auth-accounts";
const tokenKeys = ["__convexAuthJWT", "__convexAuthRefreshToken", "__convexAuthServerStateFetchTime"];
const storageKey = (key: string, namespace: string) => `${key}_crystal${namespace.replace(/[^a-zA-Z0-9]/g, "")}`;

function initialNamespace() {
  if (typeof window === "undefined") return DEFAULT;
  const selected = window.localStorage.getItem(ACTIVE_KEY);
  if (selected) return selected;
  // Preserve sessions created before account namespaces were introduced. Convex Auth used the
  // deployment URL as its storage namespace when the prop was omitted.
  const legacySuffix = (process.env.NEXT_PUBLIC_CONVEX_URL ?? "").replace(/[^a-zA-Z0-9]/g, "");
  if (legacySuffix) {
    for (const key of tokenKeys) {
      const legacyKey = `${key}_${legacySuffix}`;
      const newKey = storageKey(key, DEFAULT);
      const value = window.localStorage.getItem(legacyKey);
      if (value !== null && window.localStorage.getItem(newKey) === null) window.localStorage.setItem(newKey, value);
      window.localStorage.removeItem(legacyKey);
    }
  }
  window.localStorage.setItem(ACTIVE_KEY, DEFAULT);
  return DEFAULT;
}
function readAccounts(): SavedAuthAccount[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(window.localStorage.getItem(ACCOUNTS_KEY) ?? "[]") as SavedAuthAccount[]; } catch { return []; }
}

/** Keeps a separate Convex Auth refresh token for every locally remembered account. */
export function MultiAccountSession({ children }: { children: React.ReactNode }) {
  const [namespace, setNamespace] = useState(initialNamespace);
  const [accounts, setAccounts] = useState(readAccounts);
  const remember = useCallback(async (account: SavedAuthAccount) => {
    const next = [account, ...readAccounts().filter((a) => a.id !== account.id)];
    window.localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(next));
    setAccounts(next);
    // First sign-in uses the temporary namespace. Move its fresh token pair into the account's
    // bucket before switching providers; account-specific sign-ins replace the temporary bucket.
    if (namespace === DEFAULT) {
      for (const key of tokenKeys) {
        const from = storageKey(key, DEFAULT);
        const value = window.localStorage.getItem(from);
        if (value !== null) window.localStorage.setItem(storageKey(key, account.id), value);
        window.localStorage.removeItem(from);
      }
    }
    if (namespace !== account.id) {
      window.localStorage.setItem(ACTIVE_KEY, account.id);
      setNamespace(account.id);
    }
  }, [namespace]);
  const switchTo = useCallback((id: string) => {
    if (!readAccounts().some((account) => account.id === id)) return;
    window.localStorage.setItem(ACTIVE_KEY, id);
    setNamespace(id);
  }, []);
  const addAccount = useCallback(() => {
    // Drop only the temporary bucket. The selected account's server session and refresh token stay live.
    for (const key of tokenKeys) window.localStorage.removeItem(storageKey(key, DEFAULT));
    window.localStorage.setItem(ACTIVE_KEY, DEFAULT);
    setNamespace(DEFAULT);
  }, []);
  const value = useMemo(() => ({ namespace, accounts, remember, switchTo, addAccount }), [namespace, accounts, remember, switchTo, addAccount]);
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccountSessions() {
  const value = useContext(AccountContext);
  if (!value) throw new Error("useAccountSessions must be used inside MultiAccountSession");
  return value;
}
