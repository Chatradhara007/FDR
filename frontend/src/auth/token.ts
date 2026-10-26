import type { SessionUser } from '@fdr/shared';

// Session lives in sessionStorage: closing the tab signs the user out (shared government machines).
const TOKEN_KEY = 'fdr.token';
const USER_KEY = 'fdr.user';

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return read(TOKEN_KEY);
}

export function getStoredUser(): SessionUser | null {
  const raw = read(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: SessionUser): void {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
}

/** Clears token and user (also called by the api client on any 401). */
export function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
  } catch {
    // storage unavailable — nothing to clear
  }
}

const REASON_KEY = 'fdr.signOutReason';

/** Why the user was signed out, shown once on the login page ("Demo data was reset, sign in again"). */
export function setSignOutReason(message: string): void {
  try {
    sessionStorage.setItem(REASON_KEY, message);
  } catch {
    // storage unavailable — the login page simply shows no reason
  }
}

export function getSignOutReason(): string | null {
  return read(REASON_KEY);
}

export function clearSignOutReason(): void {
  try {
    sessionStorage.removeItem(REASON_KEY);
  } catch {
    // ignore
  }
}
