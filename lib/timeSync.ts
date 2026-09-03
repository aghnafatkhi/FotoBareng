/**
 * Time Synchronization Utility (SNTP-based clock offset estimation)
 * Synchronizes client device time with authoritative server timestamp.
 */

let estimatedClockOffset = 0; // serverNow - clientNow (in ms)
let isSynchronized = false;
let isSyncing = false;

export async function syncServerTime(): Promise<number> {
  if (isSyncing) return estimatedClockOffset;
  isSyncing = true;

  try {
    // Collect 3 samples and pick the one with minimal RTT for accuracy
    const samples: { offset: number; rtt: number }[] = [];

    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      const clientStart = Date.now();

      const res = await fetch('/api/time', { cache: 'no-store' });
      if (!res.ok) continue;

      const data = await res.json();
      const t1 = performance.now();
      const rtt = t1 - t0;

      // Server time midway through request
      const estimatedServerNow = data.serverTime + rtt / 2;
      const clientMidway = clientStart + rtt / 2;
      const offset = estimatedServerNow - clientMidway;

      samples.push({ offset, rtt });
      if (i < 2) {
        await new Promise((r) => setTimeout(r, 80));
      }
    }

    if (samples.length > 0) {
      // Sort by smallest RTT
      samples.sort((a, b) => a.rtt - b.rtt);
      estimatedClockOffset = Math.round(samples[0].offset);
      isSynchronized = true;
    }
  } catch (err) {
    console.warn('Server time sync failed, falling back to local clock:', err);
  } finally {
    isSyncing = false;
  }

  return estimatedClockOffset;
}

export function getSynchronizedNow(): number {
  return Date.now() + estimatedClockOffset;
}

export function getServerOffset(): number {
  return estimatedClockOffset;
}

export function isTimeSynchronized(): boolean {
  return isSynchronized;
}

// Auto-sync in browser environment
if (typeof window !== 'undefined') {
  syncServerTime();

  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      syncServerTime();
    }
  });

  window.addEventListener('online', () => {
    syncServerTime();
  });
}
