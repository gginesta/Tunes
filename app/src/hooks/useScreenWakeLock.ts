import { useEffect } from 'react';

export function useScreenWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !navigator.wakeLock) return;

    let stopped = false;
    let acquiring = false;
    let lock: WakeLockSentinel | null = null;

    const acquire = async () => {
      if (stopped || acquiring || (lock && !lock.released) || document.hidden) return;
      acquiring = true;
      try {
        const requested = await navigator.wakeLock.request('screen');
        if (stopped || document.hidden) {
          await requested.release();
        } else {
          lock = requested;
        }
      } catch {
        // Safari and the OS can deny the lock. Gameplay remains available.
      } finally {
        acquiring = false;
      }
    };

    const release = () => {
      const held = lock;
      lock = null;
      if (held && !held.released) void held.release().catch(() => {});
    };
    const onVisibility = () => {
      if (document.hidden) release();
      else void acquire();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', release);
    window.addEventListener('pageshow', acquire);
    document.addEventListener('pointerdown', acquire, true);
    void acquire();

    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', release);
      window.removeEventListener('pageshow', acquire);
      document.removeEventListener('pointerdown', acquire, true);
      release();
    };
  }, [active]);
}
