import { Star, Play, Pause } from 'lucide-react';
import { motion } from 'motion/react';
import type { GameMode, GamePhase } from '@tunes/shared';

interface VinylDeckProps {
  phase: GamePhase;
  mode: GameMode;
  isCoop: boolean;
  isMyTurn: boolean;
  isPlayingMusic: boolean;
  isSpotifyHost: boolean;
  togglePlayback: () => void;
}

/** Spinning vinyl shown while the current song is hidden. */
export function VinylDeck({
  phase,
  mode,
  isCoop,
  isMyTurn,
  isPlayingMusic,
  isSpotifyHost,
  togglePlayback,
}: VinylDeckProps) {
  return (
    <motion.div
      key="hidden"
      initial={{ scale: 0.8, opacity: 0, y: 50 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      exit={{ scale: 0.8, opacity: 0, y: -50 }}
      className="flex flex-col items-center"
    >
      <div className="text-[10px] tracking-[0.3em] text-white/40 mb-3 font-bold">
        {phase === 'challenge' ? (isCoop ? 'REVEALING…' : 'CHALLENGE!') : isPlayingMusic ? 'NOW SPINNING · ???' : 'PAUSED · ???'}
      </div>
      <div className="relative" style={{ width: 200, height: 200 }}>
        <div className={`vinyl ${isCoop ? 'vinyl-cyan' : ''} ${!isPlayingMusic && phase === 'playing' ? 'vinyl-paused' : ''}`}>
          <div className="vinyl-label">
            {isSpotifyHost && phase === 'playing' && !isPlayingMusic ? (
              <button
                onClick={togglePlayback}
                className="w-full h-full rounded-full flex items-center justify-center text-[#0a0318] animate-pulse"
                aria-label="Play"
              >
                <Play className="w-10 h-10" fill="currentColor" />
              </button>
            ) : isSpotifyHost && phase === 'playing' && isPlayingMusic ? (
              <button
                onClick={togglePlayback}
                className="w-full h-full rounded-full flex items-center justify-center text-[#0a0318]"
                aria-label="Pause"
              >
                <Pause className="w-10 h-10" fill="currentColor" />
              </button>
            ) : (
              <span className="font-chunky text-5xl leading-none">?</span>
            )}
          </div>
          <div className="vinyl-hole" />
        </div>
        <div className="tonearm" />
        <span className="eq absolute top-2 left-2"><i /><i /><i /><i /><i /></span>
      </div>

      <p className="text-white/50 font-medium mt-4 text-sm">
        {phase === 'challenge'
          ? (isCoop ? 'Checking placement…' : 'Waiting for challenges…')
          : isPlayingMusic ? 'Listen and guess the year…' : 'Tap to play'}
      </p>

      {/* Mode requirement hint */}
      {isMyTurn && phase === 'playing' && (mode === 'pro' || mode === 'expert') && (
        <div className="mt-2 flex items-center gap-1 text-xs text-neon-amber">
          <Star className="w-3 h-3" />
          {mode === 'pro' ? 'Must name the song' : 'Must name song + exact year'}
        </div>
      )}
    </motion.div>
  );
}
