import { useState, useEffect, useCallback, useRef } from 'react';
import { Volume2, Volume1, VolumeX } from 'lucide-react';
import { useGameStore } from '../store';
import {
  playCorrectSound,
  playWrongSound,
  playChallengeSound,
  playStolenSound,
  playTickSound,
  playStartSound,
  isMuted,
  toggleMute,
} from '../services/sounds';

/**
 * Sound-effect side effects for the game screen (start / reveal / challenge /
 * countdown ticks) plus the volume mute toggle.
 */
export function useGameSounds(countdown: number | null) {
  const phase = useGameStore((s) => s.phase);
  const lastReveal = useGameStore((s) => s.lastReveal);
  const challengers = useGameStore((s) => s.challengers);

  // --- Volume & sound effects ---
  const volume = useGameStore((s) => s.volume);
  const setVolume = useGameStore((s) => s.setVolume);
  const [, setSoundMuted] = useState(() => isMuted());
  const prevVolumeRef = useRef(volume || 0.8);

  const handleToggleMute = useCallback(() => {
    if (volume > 0) {
      prevVolumeRef.current = volume;
      setVolume(0);
    } else {
      setVolume(prevVolumeRef.current || 0.8);
    }
    const nowMuted = toggleMute();
    setSoundMuted(nowMuted);
  }, [volume, setVolume]);

  const VolumeIcon = volume > 0.5 ? Volume2 : volume > 0 ? Volume1 : VolumeX;

  // Track first turn to play start sound
  const hasPlayedStartRef = useRef(false);
  const prevPhaseRef = useRef(phase);
  const prevChallengersLenRef = useRef(challengers.length);
  const prevCountdownRef = useRef<number | null>(null);

  // Play start sound when phase changes to 'playing' for the first turn
  useEffect(() => {
    if (phase === 'playing' && prevPhaseRef.current !== 'playing' && !hasPlayedStartRef.current) {
      playStartSound();
      hasPlayedStartRef.current = true;
    }
    prevPhaseRef.current = phase;
  }, [phase]);

  // Play correct/wrong/stolen sound on reveal
  useEffect(() => {
    if (phase === 'reveal' && lastReveal) {
      if (lastReveal.stolenBy) {
        playStolenSound();
      } else if (lastReveal.correct) {
        playCorrectSound();
      } else {
        playWrongSound();
      }
    }
  }, [phase, lastReveal]);

  // Play challenge sound when a new challenger is added
  useEffect(() => {
    if (challengers.length > prevChallengersLenRef.current) {
      playChallengeSound();
    }
    prevChallengersLenRef.current = challengers.length;
  }, [challengers.length]);

  // Play tick sound when countdown hits 5, 4, 3, 2, 1
  useEffect(() => {
    if (countdown !== null && countdown >= 1 && countdown <= 5 && countdown !== prevCountdownRef.current) {
      playTickSound();
    }
    prevCountdownRef.current = countdown;
  }, [countdown]);

  return { volume, handleToggleMute, VolumeIcon };
}
