import { useEffect, useState } from 'react';
import { fetchIntroState, type IntroState } from '@/api/understanding';

/**
 * UUS — the first-run gate.
 *
 * Asks the server once at boot whether this account has ever done the intro.
 * The answer is DERIVED — a conversation marked `understanding_intro` plus a
 * coverage score — not a stored "has onboarded" flag that can end up
 * disagreeing with whether the conversation actually happened.
 *
 * Three rules, all deliberate:
 *
 * NEVER RE-OFFER. Someone who did the intro is never asked again, even if
 * their score is still low. Re-offering reads as "you failed"; understanding
 * grows from ordinary conversation afterwards, which is the design rather
 * than a fallback.
 *
 * DISMISSAL IS LOCAL AND IMMEDIATE. "Not now" hides the offer for this session
 * without a round-trip and without a stored refusal. Someone who declines
 * should not be marked in a database for declining.
 *
 * FAIL CLOSED. If the check fails — offline, cold server, a 500 — the offer
 * does not appear. Erring toward showing it means a returning user could be
 * dropped into an introduction they already did, which is worse than a new
 * user reaching an ordinary empty chat.
 */

const DISMISS_KEY = 'aqua.understanding.dismissed';

function readDismissed(): boolean {
  try { return sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
}

/**
 * Dismissal has to outlive the component that made it.
 *
 * The gate now decides whether to hand the screen to the intro, so the moment
 * someone declines, the component holding the refusal UNMOUNTS — and a
 * useState refusal dies exactly when it is needed. On the way back the gate
 * re-mounts, re-asks, gets the same answer, and sends them straight back in.
 * A person who said "skip" would be unable to leave.
 *
 * So the refusal lives at module scope, mirrored into sessionStorage so a
 * reload inside the same tab does not re-trap them. Still not a stored
 * refusal: it is per-tab, it is never sent to the server, and it is gone
 * tomorrow. Someone who skipped without saying anything has told us nothing
 * to remember — including that they skipped.
 */
let dismissedThisSession = readDismissed();

export function dismissIntroForSession(): void {
  dismissedThisSession = true;
  try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode — module flag still holds */ }
}

export function useUnderstandingGate(conversationId?: string | null) {
  const [state, setState] = useState<IntroState | null>(null);
  const [dismissed, setDismissed] = useState(dismissedThisSession);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchIntroState(conversationId)
      .then((s) => { if (alive) setState(s); })
      .catch(() => { /* fail closed — see above */ })
      .finally(() => { if (alive) setChecked(true); });
    return () => { alive = false; };
  }, [conversationId]);

  return {
    /** Show the offer? False until the check returns, so it never flashes. */
    shouldOffer: checked && !dismissed && !!state?.shouldOffer,
    score: state?.score ?? 0,
    hasIntro: state?.hasIntro ?? false,
    checked,
    dismiss: () => { dismissIntroForSession(); setDismissed(true); },
  };
}
