/**
 * Turning an email into something a person can read.
 *
 * The User model has an email and nothing else — no display name, no avatar
 * URL — so both of these are DERIVED, never stored and never hard-coded. The
 * platform already turns an email into a name in exactly one way
 * (`username: user.email.split("@")[0]`, index.js); this follows it rather than
 * inventing a second convention. The email is always shown directly beneath a
 * derived name, so it can never mislead about who is signed in.
 */

/** "chhanda.prabal.das@x.com" -> "Chhanda Prabal Das". */
export function displayNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  const words = local.split(/[._\-+]+/).filter(Boolean);
  if (words.length === 0) return local;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Initials for the fallback avatar — at most two letters, always uppercase. */
export function initialsFromEmail(email: string): string {
  const words = displayNameFromEmail(email).split(' ').filter(Boolean);
  const letters = words.slice(0, 2).map((w) => w.charAt(0));
  return (letters.join('') || email.charAt(0) || '?').toUpperCase();
}
