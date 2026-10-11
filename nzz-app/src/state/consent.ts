import { create } from "zustand";
import { SERVER_URL, CONSENT_TIMEOUT_MS } from "../config";

/**
 * Consent lifecycle.
 *
 * - `idle`     nothing asked yet.
 * - `waiting`  a request is in flight and the app has not decided yet.
 * - `resolved` the app knows the answer (a string, or that there is none).
 *
 * A request that fails or does not answer within {@link CONSENT_TIMEOUT_MS} resolves the
 * app to "no consent" so a page can load. If an answer arrives later it still counts: the
 * store moves from `resolved` to `resolved` with a string, and the app treats it as consent
 * arriving late (see `NewsWebView`).
 */
export type ConsentState = "idle" | "waiting" | "resolved";

interface ConsentStore {
  state: ConsentState;
  /** The newest consent string the app has, or null when there is none. */
  consentString: string | null;
  /** True once the app has an answer (a string or a definite "none"). */
  resolved: boolean;
  /** Bumped every time a *new* consent string arrives, so pages can react. */
  consentRevision: number;
  /** Ask `/consent` again. Safe to call repeatedly; a request already in flight is reused. */
  fetchConsent: () => Promise<void>;
  /** Force a value (used by tests). */
  setConsent: (consent: string | null) => void;
  reset: () => void;
}

let inFlight: Promise<void> | null = null;

export const useConsentStore = create<ConsentStore>((set, get) => ({
  state: "idle",
  consentString: null,
  resolved: false,
  consentRevision: 0,

  fetchConsent: async () => {
    if (inFlight) return inFlight;

    set({ state: "waiting" });

    inFlight = (async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        CONSENT_TIMEOUT_MS,
      );

      try {
        const response = await fetch(`${SERVER_URL}/consent`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = (await response.json()) as { consent?: string | null };
        const consent = typeof data.consent === "string" ? data.consent : null;

        applyAnswer(set, get, consent);
      } catch {
        // Timeout or failure: the app now knows there is no consent (yet).
        applyAnswer(set, get, null);
      } finally {
        clearTimeout(timeoutId);
        inFlight = null;
      }
    })();

    return inFlight;
  },

  setConsent: (consent: string | null) => {
    applyAnswer(set, get, consent);
  },

  reset: () => {
    inFlight = null;
    set({
      state: "idle",
      consentString: null,
      resolved: false,
      consentRevision: 0,
    });
  },
}));

function applyAnswer(
  set: (partial: Partial<ConsentStore>) => void,
  get: () => ConsentStore,
  consent: string | null,
): void {
  const previous = get().consentString;
  const isNewString = consent !== null && consent !== previous;

  set({
    state: "resolved",
    resolved: true,
    consentString: consent,
    consentRevision: isNewString
      ? get().consentRevision + 1
      : get().consentRevision,
  });
}

// Selectors
export const useConsentState = () => useConsentStore((state) => state.state);
export const useConsentString = () =>
  useConsentStore((state) => state.consentString);
export const useConsentResolved = () =>
  useConsentStore((state) => state.resolved);
export const useConsentRevision = () =>
  useConsentStore((state) => state.consentRevision);
export const useFetchConsent = () =>
  useConsentStore((state) => state.fetchConsent);
