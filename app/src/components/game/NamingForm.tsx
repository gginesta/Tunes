import { motion } from 'motion/react';
import { useGameStore } from '../../store';

interface NamingFormProps {
  guessTitle: string;
  guessArtist: string;
  guessYear: string;
  onTitleChange: (value: string) => void;
  onArtistChange: (value: string) => void;
  onYearChange: (value: string) => void;
  onSubmit: () => void;
}

/** Song naming inputs (playing + challenge phases) and the guess result. */
export function NamingForm({
  guessTitle,
  guessArtist,
  guessYear,
  onTitleChange,
  onArtistChange,
  onYearChange,
  onSubmit,
}: NamingFormProps) {
  const myId = useGameStore((s) => s.myId);
  const players = useGameStore((s) => s.players);
  const currentTurnPlayerId = useGameStore((s) => s.currentTurnPlayerId);
  const phase = useGameStore((s) => s.phase);
  const settings = useGameStore((s) => s.settings);
  const songNameResult = useGameStore((s) => s.songNameResult);

  const isMyTurn = currentTurnPlayerId === myId;
  const me = players[myId];
  const mode = settings.mode;

  // Whether song naming is required for the active player
  const songNamingRequired = mode === 'pro' || mode === 'expert';

  if (!me) return null;

  return (
    <>
      {/* Song naming inputs — visible during playing AND challenge phases */}
      {isMyTurn && (phase === 'playing' || phase === 'challenge') && !(songNameResult?.playerId === myId) && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-5 w-full max-w-xs space-y-3"
        >
          {songNamingRequired && (
            <div className={`text-center text-[11px] font-bold px-3 py-2 rounded-xl border uppercase tracking-[0.15em] ${
              mode === 'expert'
                ? 'bg-red-500/10 text-red-300 border-red-500/30'
                : 'bg-neon-violet/10 text-neon-violet border-neon-violet/30'
            }`}>
              {mode === 'expert'
                ? 'Required: Name the song + exact year'
                : 'Required: Name the song to keep the card'}
            </div>
          )}
          <input
            type="text"
            name="song-title-guess"
            placeholder={songNamingRequired ? 'Song Title (Required)' : 'Guess Title (Optional, +1 token)'}
            value={guessTitle}
            onChange={(e) => onTitleChange(e.target.value)}
            autoComplete="off"
            autoCorrect="on"
            autoCapitalize="sentences"
            spellCheck={true}
            enterKeyHint="next"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-base text-white placeholder-white/30 focus:outline-none focus:border-neon-pink focus:bg-neon-pink/5 transition-all"
          />
          <input
            type="text"
            name="song-artist-guess"
            placeholder={songNamingRequired ? 'Artist (Required)' : 'Guess Artist (Optional)'}
            value={guessArtist}
            onChange={(e) => onArtistChange(e.target.value)}
            autoComplete="off"
            autoCorrect="on"
            autoCapitalize="words"
            spellCheck={true}
            enterKeyHint="done"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-base text-white placeholder-white/30 focus:outline-none focus:border-neon-pink focus:bg-neon-pink/5 transition-all"
          />
          {mode === 'expert' && (
            <input
              type="number"
              placeholder="Exact Year (Required)"
              value={guessYear}
              onChange={(e) => onYearChange(e.target.value)}
              autoComplete="off"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-base text-white placeholder-white/30 tabular-nums focus:outline-none focus:border-neon-pink focus:bg-neon-pink/5 transition-all"
            />
          )}
          {guessTitle ? (
            <button
              onClick={onSubmit}
              className="btn btn-primary w-full"
              style={{ background: 'linear-gradient(135deg, var(--color-neon-violet), #c084fc)', boxShadow: '0 0 24px rgba(168,85,247,0.4)' }}
            >
              Submit Song Guess
            </button>
          ) : null}
        </motion.div>
      )}
      {/* Song guess result (shown after submission) */}
      {isMyTurn && songNameResult?.playerId === myId && (
        <div className={`mt-3 text-center py-2 px-4 rounded-xl text-sm font-bold ${
          songNameResult.correct
            ? 'bg-green-500/20 text-green-400 border border-green-500/30'
            : 'bg-red-500/20 text-red-400 border border-red-500/30'
        }`}>
          {songNameResult.correct
            ? me.tokens >= 5 ? 'Correct! (Max tokens reached)' : 'Correct! +1 Token'
            : `Wrong — ${!songNameResult.titleMatch ? 'title incorrect' : 'artist incorrect'} (one attempt per song)`}
        </div>
      )}
    </>
  );
}
