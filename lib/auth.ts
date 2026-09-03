import { auth } from './firebase';
import { signInAnonymously } from 'firebase/auth';

/**
 * Ensures an authoritative identity UID for the current guest session.
 * Tries Firebase Anonymous Auth first; falls back to a persistent local UUID
 * if Anonymous Auth is restricted on the Firebase project.
 */
export async function ensureAuthUser(): Promise<string> {
  // If already authenticated via Firebase Auth
  if (auth.currentUser?.uid) {
    return auth.currentUser.uid;
  }

  try {
    const cred = await signInAnonymously(auth);
    if (cred.user?.uid) {
      localStorage.setItem('fotobareng_auth_uid', cred.user.uid);
      return cred.user.uid;
    }
  } catch (err) {
    // Graceful fallback for environments where Anonymous Auth provider is restricted
    console.warn('Anonymous auth unavailable, using persistent secure guest UID:', err);
  }

  // Persistent browser session UID
  let storedUid = typeof window !== 'undefined' ? localStorage.getItem('fotobareng_auth_uid') : null;
  if (!storedUid) {
    storedUid = 'usr_' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36));
    if (typeof window !== 'undefined') {
      localStorage.setItem('fotobareng_auth_uid', storedUid);
    }
  }

  return storedUid;
}

export function getCurrentGuestUid(): string | null {
  if (auth.currentUser?.uid) return auth.currentUser.uid;
  if (typeof window !== 'undefined') {
    return localStorage.getItem('fotobareng_auth_uid');
  }
  return null;
}
