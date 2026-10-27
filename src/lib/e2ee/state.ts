/**
 * The decisions behind the end-to-end encryption lifecycle, kept free of React, Convex and the
 * keystore so they can be tested on their own (scripts/tests/e2ee-client.test.mts).
 */

export type E2eeStatus = "loading" | "needs-setup" | "needs-unlock" | "ready" | "unavailable";

/** What the server says about this account's identity. `undefined`: not answered yet. */
export type ServerIdentityFact = undefined | null | { publicKey: string };
/** What this device holds. `undefined`: the keystore has not been read yet. */
export type LocalIdentityFact = undefined | null | { publicKey: string };

export type StatusFacts = {
  /** WebCrypto (and so everything below) exists here. */
  cryptoAvailable: boolean;
  authenticated: boolean;
  server: ServerIdentityFact;
  local: LocalIdentityFact;
};

export function deriveStatus(f: StatusFacts): E2eeStatus {
  if (!f.cryptoAvailable) return "unavailable";
  if (!f.authenticated || f.server === undefined || f.local === undefined) return "loading";
  if (f.server === null) {
    // A key on this device that the server has never heard of is a setup that was interrupted before it
    // registered (or an identity the server has since dropped). It cannot decrypt anything, so start again.
    return "needs-setup";
  }
  if (f.local === null) return "needs-unlock";
  // Another device reset the identity: what is stored here is the old key and opens nothing new.
  return f.local.publicKey === f.server.publicKey ? "ready" : "needs-unlock";
}

// ---------------------------------------------------------------------------------------------
// The setup dialog
// ---------------------------------------------------------------------------------------------

export type SetupStep = "generating" | "show" | "uploading" | "done";

export type SetupState = {
  step: SetupStep;
  /** The person ticked "I saved it". Nothing is uploaded before this, so a key they never saw is never the only copy. */
  saved: boolean;
  error?: string;
};

export type SetupAction =
  | { type: "generated" }
  | { type: "ack"; saved: boolean }
  | { type: "submit" }
  | { type: "uploaded" }
  | { type: "failed"; error: string };

export const initialSetup: SetupState = { step: "generating", saved: false };

export function setupReducer(state: SetupState, action: SetupAction): SetupState {
  switch (action.type) {
    case "generated":
      return state.step === "generating" ? { step: "show", saved: false } : state;
    case "ack":
      return state.step === "show" ? { ...state, saved: action.saved, error: undefined } : state;
    case "submit":
      // The gate: no confirmation, no upload.
      return state.step === "show" && state.saved ? { step: "uploading", saved: true } : state;
    case "uploaded":
      return state.step === "uploading" ? { step: "done", saved: true } : state;
    case "failed":
      // An upload that failed goes back to the key, which is still on screen, so a retry needs no new secret.
      // A failure while generating stays put with the message; the dialog offers to try again.
      if (state.step === "uploading") return { step: "show", saved: true, error: action.error };
      if (state.step === "generating") return { ...state, error: action.error };
      return state;
  }
}

// ---------------------------------------------------------------------------------------------
// Waiting on other people's wraps
// ---------------------------------------------------------------------------------------------

/**
 * Whether the background loop should look for people waiting on us. Any trigger counts, but never
 * before we are ready (we have nothing to hand over) and never twice at once.
 */
export function shouldFulfil(status: E2eeStatus, running: boolean): boolean {
  return status === "ready" && !running;
}
