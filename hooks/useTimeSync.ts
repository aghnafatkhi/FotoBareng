'use client';

import { useState, useEffect } from 'react';
import { syncServerTime, getSynchronizedNow, getServerOffset, isTimeSynchronized } from '@/lib/timeSync';

export function useTimeSync() {
  const [offset, setOffset] = useState<number>(getServerOffset());
  const [isSynced, setIsSynced] = useState<boolean>(isTimeSynchronized());

  useEffect(() => {
    let isMounted = true;

    async function doSync() {
      const calculatedOffset = await syncServerTime();
      if (isMounted) {
        setOffset(calculatedOffset);
        setIsSynced(true);
      }
    }

    doSync();

    // Re-sync every 45 seconds to correct drift
    const interval = setInterval(doSync, 45000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        doSync();
      }
    };

    window.addEventListener('visibilitychange', handleVisibility);

    return () => {
      isMounted = false;
      clearInterval(interval);
      window.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  return {
    offset,
    isSynced,
    getNow: getSynchronizedNow,
  };
}
