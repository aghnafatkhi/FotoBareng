import { auth } from './firebase';
import { signInAnonymously } from 'firebase/auth';
import { withTimeout, normalizeFirebaseError } from './errors';

const CLIENT_UID_KEY = 'fotobareng_client_uid';

function getOrCreateClientUid(): string {
  if (typeof window !== 'undefined') {
    let saved = localStorage.getItem(CLIENT_UID_KEY);
    if (!saved) {
      saved = 'guest_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
      localStorage.setItem(CLIENT_UID_KEY, saved);
    }
    return saved;
  }
  return 'guest_' + Math.random().toString(36).substring(2, 12);
}

// Singleton promise to prevent concurrent race conditions during anonymous sign-in
let inFlightAuthPromise: Promise<string> | null = null;

/**
 * Resolves the authoritative Firebase Auth UID for the current user.
 * 1. Checks if Firebase Auth session already exists.
 * 2. Attempts signInAnonymously().
 * 3. If Anonymous Auth is disabled in Firebase Console (auth/admin-restricted-operation),
 *    gracefully falls back to a persistent client session ID so room creation and joining
 *    never fail or freeze.
 */
export async function ensureAuthUser(): Promise<string> {
  // 1. If currentUser is already populated in memory, return immediately
  if (auth.currentUser?.uid) {
    if (typeof window !== 'undefined') {
      localStorage.setItem(CLIENT_UID_KEY, auth.currentUser.uid);
    }
    return auth.currentUser.uid;
  }

  // 2. Prevent duplicate concurrent auth requests
  if (inFlightAuthPromise) {
    return inFlightAuthPromise;
  }

  inFlightAuthPromise = (async () => {
    try {
      // 3. Wait for Firebase Auth initial state resolution (from IndexedDB / local storage)
      if (typeof auth.authStateReady === 'function') {
        try {
          await withTimeout(auth.authStateReady(), 4000, 'AUTH_TIMEOUT');
          if (auth.currentUser?.uid) {
            if (typeof window !== 'undefined') {
              localStorage.setItem(CLIENT_UID_KEY, auth.currentUser.uid);
            }
            return auth.currentUser.uid;
          }
        } catch {
          // If authStateReady took too long, continue to signInAnonymously
        }
      }

      // Check once more after auth state resolution
      if (auth.currentUser?.uid) {
        if (typeof window !== 'undefined') {
          localStorage.setItem(CLIENT_UID_KEY, auth.currentUser.uid);
        }
        return auth.currentUser.uid;
      }

      // 4. Attempt anonymous authentication with timeout (6 seconds)
      try {
        const cred = await withTimeout(
          signInAnonymously(auth),
          6000,
          'AUTH_TIMEOUT',
          'Belum bisa terhubung. Periksa koneksi lalu coba lagi.'
        );

        if (cred.user?.uid) {
          if (typeof window !== 'undefined') {
            localStorage.setItem(CLIENT_UID_KEY, cred.user.uid);
          }
          return cred.user.uid;
        }
      } catch (authErr: any) {
        const errCode = authErr?.code || '';
        const errMsg = authErr?.message || '';

        // Check if Anonymous Auth is disabled in Firebase Console
        const isAuthDisabled =
          errCode === 'auth/admin-restricted-operation' ||
          errCode === 'auth/operation-not-allowed' ||
          errMsg.includes('admin-restricted-operation') ||
          errMsg.includes('operation-not-allowed');

        if (isAuthDisabled) {
          console.warn(
            '[Auth] Firebase Anonymous sign-in is disabled in Firebase Console (auth/admin-restricted-operation). Using resilient guest session identifier.'
          );
          return getOrCreateClientUid();
        }

        // For other errors (e.g. transient network or timeout), if we already have a persistent client UID, fallback to it
        if (typeof window !== 'undefined') {
          const cached = localStorage.getItem(CLIENT_UID_KEY);
          if (cached) {
            console.warn('[Auth] Firebase Auth unavailable, using cached client UID:', cached);
            return cached;
          }
        }

        // Re-throw normalized error if no fallback is viable
        const normalized = normalizeFirebaseError(authErr);
        console.error('[Auth] Failed to ensure authenticated user:', {
          code: normalized.code,
          message: authErr?.message || normalized.message,
        });
        throw normalized;
      }

      return getOrCreateClientUid();
    } finally {
      inFlightAuthPromise = null;
    }
  })();

  return inFlightAuthPromise;
}

export function getCurrentGuestUid(): string | null {
  if (auth.currentUser?.uid) {
    return auth.currentUser.uid;
  }
  if (typeof window !== 'undefined') {
    return localStorage.getItem(CLIENT_UID_KEY);
  }
  return null;
}
