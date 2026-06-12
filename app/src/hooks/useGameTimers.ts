import { useState, useEffect } from 'react';
import { useGameStore } from '../store';

/**
 * Countdown timer effects for the game screen:
 * - challenge phase countdown
 * - turn (playing phase) countdown
 * - per-player disconnect countdowns
 */
export function useGameTimers() {
  const phase = useGameStore((s) => s.phase);
  const challengeDeadline = useGameStore((s) => s.challengeDeadline);
  const turnDeadline = useGameStore((s) => s.turnDeadline);
  const disconnectedPlayers = useGameStore((s) => s.disconnectedPlayers);

  // Countdown timer for challenge phase
  const [countdown, setCountdown] = useState<number | null>(null);
  useEffect(() => {
    if (phase !== 'challenge' || !challengeDeadline) {
      setCountdown(null);
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((challengeDeadline - Date.now()) / 1000));
      setCountdown(remaining);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [phase, challengeDeadline]);

  // Countdown timer for turn (playing phase)
  const [turnCountdown, setTurnCountdown] = useState<number | null>(null);
  useEffect(() => {
    if (phase !== 'playing' || !turnDeadline) {
      setTurnCountdown(null);
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((turnDeadline - Date.now()) / 1000));
      setTurnCountdown(remaining);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [phase, turnDeadline]);

  // Countdown for disconnected players
  const [disconnectCountdowns, setDisconnectCountdowns] = useState<Record<string, number>>({});
  useEffect(() => {
    const playerIds = Object.keys(disconnectedPlayers);
    if (playerIds.length === 0) {
      setDisconnectCountdowns({});
      return;
    }
    const tick = () => {
      const countdowns: Record<string, number> = {};
      for (const [pid, deadline] of Object.entries(disconnectedPlayers)) {
        countdowns[pid] = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      }
      setDisconnectCountdowns(countdowns);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [disconnectedPlayers]);

  return { countdown, turnCountdown, disconnectCountdowns };
}
