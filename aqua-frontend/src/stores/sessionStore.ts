import { create } from 'zustand';
import {
  clearPersistedAppData,
  getAccount,
  logoutSession,
  type AccountInfo,
} from '@/api/account';
import { APP_PATH, LOGIN_PATH, loginWithReturn } from '@/api/routes';
import { resetAllStores } from './resetAll';

/**
 * Who is signed in, and the two ways to stop being them.
 *
 * DELIBERATELY NOT PERSISTED. Every other store in this directory that survives
 * a reload does so through zustand's persist middleware; this one must not.
 * An identity read from localStorage is an identity that can be stale, and a
 * stale identity rendered in the sidebar is the exact failure this feature
 * exists to prevent. The signed-in user is whatever GET /api/account says on
 * this page load, and nothing else.
 */

export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated';

/** What, if anything, is currently tearing the session down. */
export type SessionPhase = 'idle' | 'signing-out' | 'switching';

/** Why we are ending the session — it decides where the browser lands. */
export type SignOutIntent = 'logout' | 'switch';

/**
 * The one full-page navigation in this store, behind an indirection so tests
 * can observe it. jsdom does not implement navigation, and a test that cannot
 * see where logout sent the user cannot prove logout sent them anywhere.
 */
export const sessionNavigation = {
  go(url: string) {
    // replace(), not assign(): the authenticated app must not be one Back
    // button away from a signed-out user.
    window.location.replace(url);
  },
};

interface SessionState {
  status: SessionStatus;
  account: AccountInfo | null;
  phase: SessionPhase;
  /** Last logout failure, already a human sentence. Never a stack trace. */
  error: string | null;
  /** A GET /api/account is in flight. */
  fetching: boolean;

  load: () => Promise<void>;
  signOut: (intent?: SignOutIntent) => Promise<void>;
  dismissError: () => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  status: 'loading',
  account: null,
  phase: 'idle',
  error: null,
  fetching: false,

  /**
   * Resolve the current identity. Starts at 'loading' and only ever moves to a
   * real answer, so the account control renders a placeholder rather than
   * guessing at a name it does not have yet.
   */
  load: async () => {
    if (get().fetching) return; // React StrictMode double-mounts; one call is enough
    set({ fetching: true });

    // getAccount() already swallows its own failures and returns null. A null
    // therefore means "no usable session" — 401, expired, or unreachable — and
    // all three are correctly rendered as signed out.
    const account = await getAccount();

    set({
      fetching: false,
      account,
      status: account ? 'authenticated' : 'unauthenticated',
    });
  },

  /**
   * End the session, then leave.
   *
   * ORDER IS THE SECURITY PROPERTY, not a detail:
   *
   *   1. server first   — nothing is claimed until the session is really gone
   *   2. in-memory next — cancels in-flight streams, empties every store
   *   3. on-disk next   — the persisted overlay, settings and UI keys
   *   4. navigate last  — a hard navigation, which also tears down module scope
   *
   * Doing 2 and 3 before 1 would leave a user with a live session and no data
   * on a failed request. Doing 4 before 2 would rely on the browser to do the
   * isolation for us, and would leave the previous account's conversations on
   * screen for as long as the navigation takes.
   */
  signOut: async (intent: SignOutIntent = 'logout') => {
    // Duplicate-submit guard. Not cosmetic: a second POST arriving after the
    // first destroyed the session is fine on its own, but a second teardown
    // racing the first navigation is not.
    if (get().phase !== 'idle') return;

    set({ phase: intent === 'switch' ? 'switching' : 'signing-out', error: null });

    const result = await logoutSession();

    if (!result.ok) {
      // Do NOT pretend. The session may still be live, so the user stays where
      // they are, with a sentence they can act on and a UI that still works.
      set({
        phase: 'idle',
        error: result.message ?? "We couldn't sign you out. Please try again.",
      });
      return;
    }

    resetAllStores();
    set({ status: 'unauthenticated', account: null });
    clearPersistedAppData();

    sessionNavigation.go(intent === 'switch' ? loginWithReturn(APP_PATH) : LOGIN_PATH);
  },

  dismissError: () => set({ error: null }),
}));
