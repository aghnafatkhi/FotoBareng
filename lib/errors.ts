/**
 * Application Error Normalization & Timeout Utilities
 */

export type AppErrorCode =
  | 'AUTH_DISABLED'
  | 'AUTH_TIMEOUT'
  | 'NETWORK_ERROR'
  | 'FIRESTORE_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'FIRESTORE_TIMEOUT'
  | 'ROOM_FULL'
  | 'ROOM_EXPIRED'
  | 'ROOM_IN_SESSION'
  | 'UNKNOWN';

export class AppError extends Error {
  code: AppErrorCode;
  originalError?: any;

  constructor(code: AppErrorCode, message: string, originalError?: any) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.originalError = originalError;
  }
}

export const DEFAULT_NETWORK_TIMEOUT_MS = 12000;

/**
 * Wraps any promise with a timeout rejection to prevent infinite loading state.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = DEFAULT_NETWORK_TIMEOUT_MS,
  errorCode: AppErrorCode = 'FIRESTORE_TIMEOUT',
  customMessage?: string
): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const msg = customMessage || getUserFacingMessage(errorCode);
      reject(new AppError(errorCode, msg));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Returns clean Indonesian user-facing copy without exposing raw technical errors.
 */
export function getUserFacingMessage(code: AppErrorCode, fallback?: string): string {
  switch (code) {
    case 'NETWORK_ERROR':
      return 'Koneksi bermasalah. Coba lagi.';
    case 'AUTH_DISABLED':
      return 'Belum bisa membuat room. Coba lagi sebentar.';
    case 'PERMISSION_DENIED':
      return 'Room belum bisa dibuat.';
    case 'AUTH_TIMEOUT':
      return 'Belum bisa terhubung. Periksa koneksi lalu coba lagi.';
    case 'FIRESTORE_TIMEOUT':
      return 'Belum berhasil terhubung. Coba lagi.';
    case 'FIRESTORE_NOT_FOUND':
      return 'Room tidak ditemukan.';
    case 'ROOM_FULL':
      return 'Room sudah penuh.';
    case 'ROOM_EXPIRED':
      return 'Room sudah berakhir.';
    case 'ROOM_IN_SESSION':
      return 'Sesi sedang berlangsung.';
    default:
      return fallback || 'Room belum berhasil dibuat. Coba lagi.';
  }
}

/**
 * Normalizes Firebase Auth & Firestore errors into AppError with friendly Indonesian copy.
 */
export function normalizeFirebaseError(error: any): AppError {
  if (error instanceof AppError) {
    return error;
  }

  const code: string = error?.code || '';
  const message: string = error?.message || '';

  // 1. Auth disabled in Firebase console (operation-not-allowed)
  if (
    code === 'auth/operation-not-allowed' ||
    code === 'auth/admin-restricted-operation'
  ) {
    return new AppError('AUTH_DISABLED', getUserFacingMessage('AUTH_DISABLED'), error);
  }

  // 2. Auth or network timeouts
  if (
    code === 'auth/timeout' ||
    error?.name === 'TimeoutError' ||
    message.toLowerCase().includes('timeout')
  ) {
    return new AppError('AUTH_TIMEOUT', getUserFacingMessage('AUTH_TIMEOUT'), error);
  }

  // 3. Network connection issues / offline client
  if (
    code === 'auth/network-request-failed' ||
    code === 'unavailable' ||
    message.includes('the client is offline') ||
    message.includes('network') ||
    message.includes('Failed to fetch')
  ) {
    return new AppError('NETWORK_ERROR', getUserFacingMessage('NETWORK_ERROR'), error);
  }

  // 4. Firestore permission denied
  if (
    code === 'permission-denied' ||
    message.includes('Missing or insufficient permissions')
  ) {
    return new AppError('PERMISSION_DENIED', getUserFacingMessage('PERMISSION_DENIED'), error);
  }

  // 5. Document not found
  if (code === 'not-found') {
    return new AppError('FIRESTORE_NOT_FOUND', getUserFacingMessage('FIRESTORE_NOT_FOUND'), error);
  }

  // 6. Explicit domain errors passed from UI checks
  if (
    message === 'Room tidak ditemukan.' ||
    message === 'Room sudah berakhir.' ||
    message === 'Sesi sedang berlangsung.' ||
    message.includes('Room sudah penuh') ||
    message.includes('Nama belum diisi') ||
    message.includes('Kode room belum diisi') ||
    message.includes('Nama maksimal')
  ) {
    return new AppError('UNKNOWN', message, error);
  }

  return new AppError('UNKNOWN', getUserFacingMessage('UNKNOWN', 'Room belum berhasil dibuat. Coba lagi.'), error);
}
