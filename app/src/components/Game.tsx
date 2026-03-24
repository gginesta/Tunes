import { useState, useEffect, useCallback } from 'react';
import { Disc, Coins, Check, X, SkipForward, AlertTriangle, ShoppingCart, Star, Play, Pause } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getSocket } from '../services/socket';
import { useGameStore } from '../store';
import { useSpotifyPlayer } from '../hooks/useSpotifyPlayer';
import { SKIP_COST, CHALLENGE_COST, BUY_CARD_COST } from '@hitster/shared';
import type { SongCard, GameMode } from '@hitster/shared';

const DECADE_COLORS: Record<number, string> = {
  1930: 'from-amber-900 to-yellow-900',
  1940: 'from-amber-800 to-orange-900',
  1950: 'from-rose-800 to-pink-900',
  1960: 'from-purple-700 to-violet-900',
  1970: 'from-orange-600 to-red-800',
  1980: 'from-pink-500 to-purple-700',
  1990: 'from-green-600 to-teal-800',
  2000: 'from-blue-500 to-indigo-700',
  2010: 'from-indigo-500 to-purple-700',
  2020: 'from-emerald-500 to-cyan-700',
};

function getCardColor(year: number): string {
  const decade = Math.floor(year / 10) * 10;
  return DECADE_COLORS[decade] || 'from-gray-600 to-gray-800';
}

const MODE_LABELS: Record<GameMode, string> = {
  original: 'Original',
  pro: 'Pro',
  expert: 'Expert',
  coop: 'Co-op',
};

const MODE_COLORS: Record<GameMode, string> = {
  original: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  pro: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  expert: 'bg-red-500/20 text-red-400 border-red-500/30',
  coop: 'bg-green-500/20 text-green-400 border-green-500/30',
};

function Equalizer({ animate }: { animate: boolean }) {
  return (
    <div className="flex items-end gap-[3px] h-6">
      {[0, 1, 2, 3, 4].map((i) => (
        <motion.div
          key={i}
          className="w-[3px] bg-[#1DB954] rounded-full"
          animate={animate ? {
            height: [6, 18, 10, 22, 8],
          } : { height: 6 }}
          transition={animate ? {
            duration: 0.8,
            repeat: Infinity,
            repeatType: 'reverse',
            delay: i * 0.1,
          } : {}}
        />
      ))}
    </div>
  );
}

export function Game() {
  const myId = useGameStore((s) => s.myId);
  const players = useGameStore((s) => s.players);
  const currentTurnPlayerId = useGameStore((s) => s.currentTurnPlayerId);
  const phase = useGameStore((s) => s.phase);
  const lastReveal = useGameStore((s) => s.lastReveal);
  const deckSize = useGameStore((s) => s.deckSize);
  const challengers = useGameStore((s) => s.challengers);
  const settings = useGameStore((s) => s.settings);
  const sharedTimeline = useGameStore((s) => s.sharedTimeline);
  const isPlayingMusic = useGameStore((s) => s.isPlaying);
  const spotifyError = useGameStore((s) => s.spotifyError);

  const challengeDeadline = useGameStore((s) => s.challengeDeadline);
  const [noChallengeClicked, setNoChallengeClicked] = useState(false);

  const [guessTitle, setGuessTitle] = useState('');
  const [guessArtist, setGuessArtist] = useState('');
  const [guessYear, setGuessYear] = useState('');
  const [selectedPosition, setSelectedPosition] = useState<number | null>(null);
  const songNameResult = useGameStore((s) => s.songNameResult);

  // Reset "no challenge" when phase changes
  useEffect(() => {
    if (phase !== 'challenge') setNoChallengeClicked(false);
  }, [phase]);

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
    const interval = setInterval(tick, 100);
    return () => clearInterval(interval);
  }, [phase, challengeDeadline]);

  const { isHost: isSpotifyHost, spotifyReady, togglePlayback } = useSpotifyPlayer();

  const socket = getSocket();
  const isMyTurn = currentTurnPlayerId === myId;
  const me = players[myId];
  const activePlayer = currentTurnPlayerId ? players[currentTurnPlayerId] : null;
  const playerList = Object.values(players);
  const mode = settings.mode;
  const isCoop = mode === 'coop';

  if (!me || !activePlayer) return null;

  // Timeline to display: shared for co-op, personal otherwise
  const displayTimeline = isCoop ? sharedTimeline : me.timeline;

  const handlePlaceCard = () => {
    if (selectedPosition === null) return;
    socket.emit('place-card', { position: selectedPosition });
    setSelectedPosition(null);
  };

  const handleSkip = () => {
    socket.emit('skip-song');
    setGuessTitle('');
    setGuessArtist('');
    setGuessYear('');
    useGameStore.setState({ songNameResult: null });
  };

  const handleChallenge = () => {
    socket.emit('challenge');
  };

  const handleNameSong = () => {
    if (!guessTitle.trim() || !guessArtist.trim()) return;
    const guess: { title: string; artist: string; year?: number } = {
      title: guessTitle.trim(),
      artist: guessArtist.trim(),
    };
    if (mode === 'expert' && guessYear.trim()) {
      guess.year = parseInt(guessYear.trim(), 10);
    }
    socket.emit('name-song', guess);
  };

  const handleBuyCard = () => {
    socket.emit('buy-card');
  };

  const handleConfirmReveal = () => {
    socket.emit('confirm-reveal');
    setGuessTitle('');
    setGuessArtist('');
    setGuessYear('');
    setSelectedPosition(null);
    useGameStore.setState({ songNameResult: null });
  };

  const revealedSong = lastReveal?.song;
  const isRevealed = phase === 'reveal' && revealedSong;
  const modeResult = lastReveal?.modeResult;

  // Whether song naming is required for the active player
  const songNamingRequired = mode === 'pro' || mode === 'expert';

  return (
    <div className="flex flex-col h-screen text-white bg-[#1a1a2e] overflow-hidden">
      {/* Top Bar */}
      <div className="flex justify-between items-center p-4 bg-black/30 backdrop-blur-md border-b border-white/5 z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center font-bold">
            {activePlayer.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-xs text-gray-400 uppercase tracking-wider font-bold">
                {deckSize} cards left
              </p>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${MODE_COLORS[mode]}`}>
                {MODE_LABELS[mode]}
              </span>
            </div>
            <p className="font-bold text-[#1DB954]">
              {isMyTurn ? 'Your Turn' : `${activePlayer.name}'s Turn`}
            </p>
          </div>
        </div>

        {/* Player score chips */}
        <div className="flex gap-3 overflow-x-auto hide-scrollbar">
          {isCoop ? (
            <div className="flex flex-col items-center">
              <div className="flex items-center gap-1 text-xs font-bold">
                <div className="w-2 h-3 bg-green-400/40 rounded-sm" />
                {sharedTimeline.length}/{settings.cardsToWin}
              </div>
              <span className="text-[10px] text-green-400 font-bold">Team</span>
            </div>
          ) : (
            playerList.map((p) => (
              <div
                key={p.id}
                className={`flex flex-col items-center ${
                  p.id === currentTurnPlayerId ? 'opacity-100' : 'opacity-50'
                }`}
              >
                <div className="flex items-center gap-1 text-xs font-bold">
                  <div className="w-2 h-3 bg-white/20 rounded-sm" />
                  {p.timeline.length}/{settings.cardsToWin}
                </div>
                <div className="flex items-center gap-1 text-xs text-[#FFD700] font-bold">
                  <Coins className="w-3 h-3" />
                  {p.tokens}
                </div>
                <span className="text-[10px] text-gray-500 truncate max-w-[50px]">
                  {p.id === myId ? 'You' : p.name}
                </span>
              </div>
            ))
          )}
          {/* Show individual tokens in co-op too */}
          {isCoop && playerList.map((p) => (
            <div key={p.id} className="flex flex-col items-center opacity-80">
              <div className="flex items-center gap-1 text-xs text-[#FFD700] font-bold">
                <Coins className="w-3 h-3" />
                {p.tokens}
              </div>
              <span className="text-[10px] text-gray-500 truncate max-w-[50px]">
                {p.id === myId ? 'You' : p.name}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Spotify error banner */}
      {spotifyError && (
        <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-2 text-center text-sm text-red-400">
          {spotifyError}
        </div>
      )}

      {/* Center Area */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 relative overflow-y-auto">
        <AnimatePresence mode="wait">
          {isRevealed ? (
            <motion.div
              key="reveal"
              initial={{ scale: 0.8, opacity: 0, y: 50 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0, y: -50 }}
              className={`w-64 aspect-square rounded-3xl p-6 flex flex-col items-center justify-center relative overflow-hidden shadow-2xl bg-gradient-to-br ${
                lastReveal!.correct
                  ? 'from-green-500 to-emerald-700 shadow-[0_0_50px_rgba(34,197,94,0.5)]'
                  : 'from-red-500 to-rose-700 shadow-[0_0_50px_rgba(239,68,68,0.5)]'
              }`}
            >
              <div className="absolute -right-12 -bottom-12 opacity-20">
                <Disc className="w-48 h-48" />
              </div>
              <motion.div
                initial={{ rotateY: 90 }}
                animate={{ rotateY: 0 }}
                className="text-center z-10"
              >
                <h2 className="text-5xl font-black mb-2">{revealedSong!.year}</h2>
                <p className="text-lg font-bold leading-tight">{revealedSong!.title}</p>
                <p className="text-sm text-white/80">{revealedSong!.artist}</p>

                <div className="mt-4 space-y-2">
                  {/* Mode-specific result breakdown */}
                  {modeResult && (mode === 'pro' || mode === 'expert') && (
                    <div className="flex flex-col gap-1 text-xs">
                      <div className={`flex items-center justify-center gap-1 ${modeResult.placementCorrect ? 'text-green-300' : 'text-red-300'}`}>
                        {modeResult.placementCorrect ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                        Placement
                      </div>
                      <div className={`flex items-center justify-center gap-1 ${modeResult.songNamed ? 'text-green-300' : 'text-red-300'}`}>
                        {modeResult.songNamed ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                        Song Name
                      </div>
                      {mode === 'expert' && (
                        <div className={`flex items-center justify-center gap-1 ${modeResult.yearCorrect ? 'text-green-300' : 'text-red-300'}`}>
                          {modeResult.yearCorrect ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                          Exact Year
                        </div>
                      )}
                    </div>
                  )}

                  {/* Main result message */}
                  <div>
                    {lastReveal!.correct ? (
                      <div className="flex items-center justify-center gap-2 text-white bg-black/20 px-4 py-2 rounded-full">
                        <Check className="w-5 h-5" /> Correct!
                      </div>
                    ) : isCoop && modeResult?.coopPenalty ? (
                      <div className="flex items-center justify-center gap-2 text-white bg-black/20 px-4 py-2 rounded-full">
                        <X className="w-5 h-5" /> Wrong! -1 Token
                      </div>
                    ) : lastReveal!.stolenBy ? (
                      <div className="flex items-center justify-center gap-2 text-white bg-black/20 px-4 py-2 rounded-full">
                        <AlertTriangle className="w-5 h-5" /> Stolen by{' '}
                        {players[lastReveal!.stolenBy]?.name || 'challenger'}!
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-2 text-white bg-black/20 px-4 py-2 rounded-full">
                        <X className="w-5 h-5" /> {mode === 'pro' || mode === 'expert' ? 'Requirements not met' : 'Wrong placement'}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            </motion.div>
          ) : (
            <motion.div
              key="hidden"
              initial={{ scale: 0.8, opacity: 0, y: 50 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0, y: -50 }}
              className="w-64 aspect-square rounded-3xl p-6 flex flex-col items-center justify-center relative overflow-hidden shadow-2xl bg-gradient-to-br from-blue-600 to-indigo-900"
            >
              <div className="absolute -right-12 -bottom-12 opacity-20">
                <Disc className="w-48 h-48" />
              </div>

              {/* Top status */}
              <div className="absolute top-4 left-4 right-4 flex justify-between items-center">
                <Equalizer animate={isPlayingMusic && phase === 'playing'} />
                <span className="text-xs font-bold text-white/70 uppercase tracking-widest">
                  {phase === 'challenge' ? (isCoop ? 'Revealing...' : 'Challenge!') : isPlayingMusic ? 'Now Playing' : 'Paused'}
                </span>
              </div>

              {/* Center: Play/Pause for host, "?" for non-host */}
              {isSpotifyHost && phase === 'playing' ? (
                <button
                  onClick={togglePlayback}
                  className="w-20 h-20 rounded-full bg-[#1DB954] hover:bg-[#1ed760] flex items-center justify-center transition-all transform active:scale-90 shadow-[0_0_30px_rgba(29,185,84,0.4)]"
                >
                  {isPlayingMusic ? (
                    <Pause className="w-10 h-10 text-black" fill="black" />
                  ) : (
                    <Play className="w-10 h-10 text-black ml-1" fill="black" />
                  )}
                </button>
              ) : (
                <h2 className="text-6xl font-black text-white/90 mt-4">?</h2>
              )}

              {/* Countdown timer during challenge phase */}
              {phase === 'challenge' && countdown !== null && countdown > 0 && (
                <motion.div
                  key="countdown"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute inset-0 flex items-center justify-center z-20"
                >
                  <div className="relative">
                    <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
                      <circle
                        cx="50" cy="50" r="42"
                        fill="none"
                        stroke="rgba(255,255,255,0.1)"
                        strokeWidth="6"
                      />
                      <circle
                        cx="50" cy="50" r="42"
                        fill="none"
                        stroke={countdown <= 5 ? '#ef4444' : '#f59e0b'}
                        strokeWidth="6"
                        strokeLinecap="round"
                        strokeDasharray={`${2 * Math.PI * 42}`}
                        strokeDashoffset={`${2 * Math.PI * 42 * (1 - countdown / 15)}`}
                        className="transition-all duration-100"
                      />
                    </svg>
                    <span className={`absolute inset-0 flex items-center justify-center text-4xl font-black ${
                      countdown <= 5 ? 'text-red-400' : 'text-amber-400'
                    }`}>
                      {countdown}
                    </span>
                  </div>
                </motion.div>
              )}

              <p className="text-white/50 font-medium mt-3 text-sm">
                {phase === 'challenge'
                  ? (isCoop ? 'Checking placement...' : 'Waiting for challenges...')
                  : isPlayingMusic ? 'Listen and guess the year...' : 'Guess the year'}
              </p>

              {/* Mode requirement hint */}
              {isMyTurn && phase === 'playing' && (mode === 'pro' || mode === 'expert') && (
                <div className="mt-2 flex items-center gap-1 text-xs text-yellow-400">
                  <Star className="w-3 h-3" />
                  {mode === 'pro' ? 'Must name the song' : 'Must name song + exact year'}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Reveal: Continue button */}
        {phase === 'reveal' && (
          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={handleConfirmReveal}
            className="mt-6 bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold py-3 px-8 rounded-2xl transition-all transform active:scale-95"
          >
            Continue
          </motion.button>
        )}

        {/* Song naming inputs */}
        {isMyTurn && phase === 'playing' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-8 w-full max-w-xs space-y-3"
          >
            {songNamingRequired && (
              <div className={`text-center text-xs font-bold px-3 py-1.5 rounded-xl border ${
                mode === 'expert'
                  ? 'bg-red-500/10 text-red-400 border-red-500/20'
                  : 'bg-purple-500/10 text-purple-400 border-purple-500/20'
              }`}>
                {mode === 'expert'
                  ? 'Required: Name the song + guess the exact year'
                  : 'Required: Name the song to keep the card'}
              </div>
            )}
            <input
              type="text"
              placeholder={songNamingRequired ? 'Song Title (Required)' : 'Guess Title (Optional, +1 token)'}
              value={guessTitle}
              onChange={(e) => setGuessTitle(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#1DB954]"
            />
            <input
              type="text"
              placeholder={songNamingRequired ? 'Artist (Required)' : 'Guess Artist (Optional)'}
              value={guessArtist}
              onChange={(e) => setGuessArtist(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#1DB954]"
            />
            {mode === 'expert' && (
              <input
                type="number"
                placeholder="Exact Year (Required)"
                value={guessYear}
                onChange={(e) => setGuessYear(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#1DB954]"
              />
            )}
            {songNameResult && songNameResult.playerId === myId ? (
              <div className={`text-center py-2 px-4 rounded-xl text-sm font-bold ${
                songNameResult.correct
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                  : 'bg-red-500/20 text-red-400 border border-red-500/30'
              }`}>
                {songNameResult.correct ? 'Correct! +1 Token' : 'Wrong guess'}
              </div>
            ) : guessTitle && guessArtist ? (
              <button
                onClick={handleNameSong}
                className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 rounded-xl text-sm transition-all"
              >
                Submit Song Guess
              </button>
            ) : null}
          </motion.div>
        )}

        {/* Challenge / No Challenge buttons for non-active players */}
        {!isMyTurn && phase === 'challenge' && !isCoop && !challengers.includes(myId) && !noChallengeClicked && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-8 text-center"
          >
            <p className="text-gray-400 mb-4">
              {activePlayer.name} placed the card. Challenge?
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={handleChallenge}
                disabled={me.tokens < CHALLENGE_COST}
                className="bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/50 font-bold py-3 px-6 rounded-2xl flex items-center gap-2 transition-all disabled:opacity-50"
              >
                <AlertTriangle className="w-5 h-5" />
                Challenge! ({CHALLENGE_COST} Token)
              </button>
              <button
                onClick={() => setNoChallengeClicked(true)}
                className="bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white border border-white/10 font-bold py-3 px-6 rounded-2xl flex items-center gap-2 transition-all"
              >
                <Check className="w-5 h-5" />
                No Challenge
              </button>
            </div>
          </motion.div>
        )}

        {!isMyTurn && phase === 'challenge' && !isCoop && challengers.includes(myId) && (
          <p className="mt-8 text-[#1DB954] font-medium">Challenge submitted!</p>
        )}

        {!isMyTurn && phase === 'challenge' && !isCoop && noChallengeClicked && !challengers.includes(myId) && (
          <p className="mt-8 text-gray-500 font-medium">No challenge — waiting for timer...</p>
        )}

        {/* Active player sees countdown too during challenge */}
        {isMyTurn && phase === 'challenge' && !isCoop && (
          <p className="mt-8 text-gray-400 font-medium">
            Waiting for challenges...
          </p>
        )}

        {!isMyTurn && phase === 'playing' && (
          <p className="mt-8 text-gray-400">
            {isCoop
              ? `${activePlayer.name} is placing a card for the team...`
              : `Waiting for ${activePlayer.name} to place the card...`}
          </p>
        )}

        {/* Challengers display */}
        {!isCoop && challengers.length > 0 && phase === 'challenge' && (
          <div className="mt-4 text-sm text-gray-400">
            Challengers: {challengers.map((id) => players[id]?.name || 'Unknown').join(', ')}
          </div>
        )}
      </div>

      {/* Bottom: Timeline + Actions */}
      <div
        className={`bg-black/40 backdrop-blur-xl border-t border-white/10 p-4 transition-opacity duration-500 ${
          !isMyTurn && phase !== 'reveal' ? 'opacity-60' : ''
        }`}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-gray-300 uppercase tracking-widest text-sm">
            {isCoop
              ? 'Team Timeline'
              : isMyTurn
                ? 'Your Timeline'
                : `${activePlayer.name}'s Timeline`}
          </h3>
        </div>

        {/* Timeline */}
        <div className="flex overflow-x-auto pb-3 hide-scrollbar items-center min-h-[140px]">
          {isMyTurn && phase === 'playing' && (
            <DropZone
              index={0}
              selected={selectedPosition === 0}
              onClick={() => setSelectedPosition(0)}
            />
          )}

          {displayTimeline.map((card, idx) => (
            <div key={card.id} className="flex items-center">
              <TimelineCard card={card} />
              {isMyTurn && phase === 'playing' && (
                <DropZone
                  index={idx + 1}
                  selected={selectedPosition === idx + 1}
                  onClick={() => setSelectedPosition(idx + 1)}
                />
              )}
            </div>
          ))}

          {displayTimeline.length === 0 && !isMyTurn && (
            <p className="text-gray-500 text-sm italic mx-auto">No cards yet</p>
          )}
        </div>

        {/* Action buttons */}
        {isMyTurn && phase === 'playing' && (
          <div className="flex gap-3 mt-2">
            <button
              onClick={handleSkip}
              disabled={me.tokens < SKIP_COST}
              className="flex-1 flex items-center justify-center gap-1 text-sm font-bold text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 py-3 rounded-xl transition-colors disabled:opacity-50"
            >
              <SkipForward className="w-4 h-4" />
              Skip ({SKIP_COST})
            </button>
            <button
              onClick={handlePlaceCard}
              disabled={selectedPosition === null}
              className="flex-[2] bg-[#1DB954] hover:bg-[#1ed760] disabled:opacity-50 text-black font-bold py-3 rounded-xl transition-all transform active:scale-95 shadow-[0_0_20px_rgba(29,185,84,0.3)]"
            >
              Place Card
            </button>
            <button
              onClick={handleBuyCard}
              disabled={me.tokens < BUY_CARD_COST}
              className="flex-1 flex items-center justify-center gap-1 text-sm font-bold text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 py-3 rounded-xl transition-colors disabled:opacity-50"
            >
              <ShoppingCart className="w-4 h-4" />
              Buy ({BUY_CARD_COST})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function TimelineCard({ card }: { card: SongCard }) {
  const colorClass = getCardColor(card.year);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.8, y: -20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      className={`flex-shrink-0 w-28 h-36 rounded-2xl p-3 flex flex-col justify-between bg-gradient-to-br ${colorClass} shadow-lg relative`}
    >
      <div className="absolute inset-0 bg-black/20 rounded-2xl" />
      <div className="relative z-10">
        <h4 className="font-black text-2xl text-white/90">{card.year}</h4>
      </div>
      <div className="relative z-10">
        <p className="text-xs font-bold text-white leading-tight line-clamp-2">
          {card.title}
        </p>
        <p className="text-[10px] text-white/70 truncate">{card.artist}</p>
      </div>
    </motion.div>
  );
}

function DropZone({
  index,
  selected,
  onClick,
}: {
  index: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      layout
      onClick={onClick}
      className={`flex-shrink-0 w-12 h-24 mx-2 rounded-xl border-2 border-dashed flex items-center justify-center transition-all cursor-pointer ${
        selected
          ? 'border-[#1DB954] bg-[#1DB954]/20 shadow-[0_0_15px_rgba(29,185,84,0.3)]'
          : 'border-[#1DB954]/50 hover:border-[#1DB954] hover:bg-[#1DB954]/10'
      }`}
    >
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-sm ${
          selected
            ? 'bg-[#1DB954] text-black'
            : 'bg-[#1DB954]/20 text-[#1DB954]'
        }`}
      >
        +
      </div>
    </motion.button>
  );
}
