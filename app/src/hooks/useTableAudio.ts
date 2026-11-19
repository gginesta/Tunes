import { useEffect } from 'react';
import { useGameStore } from '../store';
import { interruptSpeaker, stopSpeakerAudio, syncSpeakerAudio } from '../services/tableAudio';

export function useTableAudio() {
  const responsible = useGameStore(s => Boolean(s.connected && s.room?.gameState.audio?.kind === 'automatic' &&
    s.room.gameState.audio.operatorId === s.myId && !['lobby', 'game_over'].includes(s.room.gameState.phase)));

  useEffect(() => {
    const unsubscribe = useGameStore.subscribe((s, old) => {
      if (s.room !== old.room || s.connected !== old.connected || s.volume !== old.volume) syncSpeakerAudio();
    });
    const visibility = () => document.hidden ? interruptSpeaker() : syncSpeakerAudio();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', interruptSpeaker);
    syncSpeakerAudio();
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', interruptSpeaker);
      stopSpeakerAudio();
    };
  }, []);

  useEffect(() => {
    let closed = false;
    let pending = false;
    let retryOnForeground = false;
    let lock: WakeLockSentinel | null = null;
    async function acquire() {
      if (closed || pending || lock || !responsible || document.hidden) return;
      if (!('wakeLock' in navigator)) { useGameStore.setState({wakeLockStatus: 'unavailable'}); return; }
      pending = true;
      try {
        const newLock = await navigator.wakeLock.request('screen');
        if (closed || document.hidden) { await newLock.release(); return; }
        if (newLock.released) { useGameStore.setState({wakeLockStatus: 'unavailable'}); return; }
        lock = newLock;
        useGameStore.setState({wakeLockStatus: 'active'});
        newLock.addEventListener('release', () => {
          if (lock === newLock) {
            lock = null;
            if (!closed) useGameStore.setState({wakeLockStatus: 'unavailable'});
          }
        });
      } catch {
        if (!closed) useGameStore.setState({wakeLockStatus: 'unavailable'});
      } finally {
        pending = false;
        if (retryOnForeground) {
          retryOnForeground = false;
          void acquire();
        }
      }
    }
    const visibility = () => {
      if (document.hidden) return;
      if (pending) retryOnForeground = true;
      else void acquire();
    };
    void acquire();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      closed = true;
      document.removeEventListener('visibilitychange', visibility);
      if (lock) void lock.release().catch(() => {});
      useGameStore.setState({wakeLockStatus: 'off'});
    };
  }, [responsible]);
}
