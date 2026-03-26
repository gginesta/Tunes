import { useState, useEffect, useCallback, useRef } from 'react';
import { Disc, Check, X, SkipForward, AlertTriangle, ShoppingCart, Star, Play, Pause, Volume2, Volume1, VolumeX, Clock, Square } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getSocket } from '../services/socket';
import { useGameStore } from '../store';
import { useSpotifyPlayer } from '../hooks/useSpotifyPlayer';
import { preUnlockAudio, activateElement, resume } from '../services/spotifyPlayer';
import { SKIP_COST, CHALLENGE_COST, BUY_CARD_COST } from '@hitster/shared';
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
import type { SongCard, GameMode } from '@hitster/shared';
import { SongHistory } from './SongHistory';
import { WaitingState } from './WaitingState';

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
  const hostId = useGameStore((s) => s.hostId);
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
  const pendingPlacement = useGameStore((s) => s.pendingPlacement);

  const disconnectedPlayers = useGameStore((s) => s.disconnectedPlayers);
  const isHost = myId === hostId;

  // Stop game confirmation
  const [showStopConfirm, setShowStopConfirm] = useState(false);

  const challengeDeadline = useGameStore((s) => s.challengeDeadline);
  const turnDeadline = useGameStore((s) => s.turnDeadline);
  const [noChallengeClicked, setNoChallengeClicked] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

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
    const interval = setInterval(tick, 100);
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
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, [disconnectedPlayers]);

  // --- Volume & sound effects ---
  const volume = useGameStore((s) => s.volume);
  const setVolume = useGameStore((s) => s.setVolume);
  const [soundMuted, setSoundMuted] = useState(() => isMuted());
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

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (v > 0 && soundMuted) {
      const nowMuted = toggleMute();
      setSoundMuted(nowMuted);
    } else if (v === 0 && !soundMuted) {
      const nowMuted = toggleMute();
      setSoundMuted(nowMuted);
    }
  }, [setVolume, soundMuted]);

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

  const { isHost: isSpotifyHost, spotifyReady, togglePlayback } = useSpotifyPlayer();

  // Track whether music has actually started playing for the host.
  // Show a big play button until it does.
  const [musicStarted, setMusicStarted] = useState(false);
  useEffect(() => {
    if (isPlayingMusic) setMusicStarted(true);
  }, [isPlayingMusic]);
  // Reset when track changes (new turn)
  const prevTrackRef = useRef(currentTurnPlayerId);
  useEffect(() => {
    if (currentTurnPlayerId !== prevTrackRef.current) {
      prevTrackRef.current = currentTurnPlayerId;
      setMusicStarted(false);
    }
  }, [currentTurnPlayerId]);

  // Clear guess inputs when turn changes
  useEffect(() => {
    setGuessTitle('');
    setGuessArtist('');
    setGuessYear('');
    useGameStore.setState({ songNameResult: null });
  }, [currentTurnPlayerId]);

  const needsPlayButton = isHost && phase === 'playing' && !musicStarted && !isPlayingMusic;

  const handlePlayTap = () => {
    // Call everything synchronously from the gesture context:
    // 1. Pre-unlock a generic AudioContext
    preUnlockAudio();
    // 2. Unlock the SDK's internal AudioContext (can be called multiple times)
    activateElement();
    // 3. Resume the SDK player directly (goes through SDK's AudioContext)
    resume().catch(() => {});
    // 4. Then try the full playback flow (REST API + fallbacks)
    togglePlayback();
  };

  const socket = getSocket();
  const isMyTurn = currentTurnPlayerId === myId;
  const me = players[myId];
  const activePlayer = currentTurnPlayerId ? players[currentTurnPlayerId] : null;
  const playerList = Object.values(players);
  const mode = settings.mode;
  const isCoop = mode === 'coop';

  if (!me || !activePlayer) return null;

  // Timeline to display:
  // - Co-op: shared timeline always
  // - Your turn (playing): your own timeline (to place cards)
  // - Not your turn: always show active player's timeline so you can prepare to challenge
  const displayTimeline = isCoop
    ? sharedTimeline
    : isMyTurn
      ? me.timeline
      : activePlayer.timeline;

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

  const [challengePosition, setChallengePosition] = useState<number | null>(null);

  // Reset challenge position when phase changes
  useEffect(() => {
    if (phase !== 'challenge') setChallengePosition(null);
  }, [phase]);

  const handleChallenge = () => {
    if (challengePosition === null) return;
    socket.emit('challenge', { position: challengePosition });
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

  const handleStopGame = () => {
    socket.emit('restart-game');
    setShowStopConfirm(false);
  };

  const revealedSong = lastReveal?.song;
  const isRevealed = phase === 'reveal' && revealedSong;
  const modeResult = lastReveal?.modeResult;

  // Whether song naming is required for the active player
  const songNamingRequired = mode === 'pro' || mode === 'expert';

  return (
    <div
      className="flex flex-col h-screen text-white bg-[#1a1a2e] overflow-hidden"
    >
      {/* Stop game confirmation dialog */}
      <AnimatePresence>
        {showStopConfirm && (
          <motion.div
            key="stop-confirm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center"
            onClick={() => setShowStopConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[#1a1a2e] border border-white/10 rounded-2xl p-6 mx-4 max-w-sm w-full shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-white mb-2">Stop Game?</h3>
              <p className="text-sm text-gray-400 mb-6">This will end the current game and return everyone to the lobby.</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowStopConfirm(false)}
                  className="flex-1 py-2.5 rounded-xl bg-white/10 text-white font-bold text-sm hover:bg-white/15 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleStopGame}
                  className="flex-1 py-2.5 rounded-xl bg-red-500 text-white font-bold text-sm hover:bg-red-600 transition-colors"
                >
                  Stop Game
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Bar — Row 1: Turn info + controls */}
      <div className="bg-black/40 backdrop-blur-xl border-b border-white/5 z-10">
        <div className="flex justify-between items-center px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <p className="font-bold text-[#1DB954] text-base truncate">
              {isMyTurn ? 'Your Turn' : `${activePlayer.name}'s Turn`}
            </p>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border flex-shrink-0 ${MODE_COLORS[mode]}`}>
              {MODE_LABELS[mode]}
            </span>
            <span className="text-xs text-gray-500 flex-shrink-0">{deckSize} left</span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => setShowHistory(true)}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
              title="Song History"
            >
              <Clock className="w-4 h-4" />
            </button>
            <button
              onClick={handleToggleMute}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
            >
              <VolumeIcon className="w-4 h-4" />
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={handleVolumeChange}
              className="w-14 h-1 accent-[#1DB954] bg-white/10 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#1DB954]"
            />
            {isHost && (
              <button
                onClick={() => setShowStopConfirm(true)}
                className="p-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 hover:text-red-300 transition-colors border border-red-500/30"
                title="Stop Game"
              >
                <Square className="w-3.5 h-3.5" fill="currentColor" />
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Player scores with tokens */}
        <div className="flex justify-center gap-1 px-3 pb-2 overflow-x-auto hide-scrollbar">
          {isCoop ? (
            <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-1">
              <span className="text-sm font-black text-green-400 tabular-nums">
                {sharedTimeline.length}/{settings.cardsToWin}
              </span>
              <span className="text-xs text-gray-400">Team</span>
            </div>
          ) : (
            playerList.map((p) => (
              <div
                key={p.id}
                className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition-all ${
                  p.id === currentTurnPlayerId
                    ? 'bg-[#1DB954]/15 border border-[#1DB954]/30'
                    : 'bg-white/5'
                }`}
              >
                <span className={`font-bold truncate max-w-[60px] ${
                  p.id === currentTurnPlayerId ? 'text-[#1DB954]' : 'text-gray-400'
                }`}>
                  {p.id === myId ? 'You' : p.name}
                </span>
                <span className="font-black tabular-nums text-white">
                  {p.timeline.length}/{settings.cardsToWin}
                </span>
                <span className="text-yellow-400 tabular-nums" title="Tokens">
                  {p.tokens}T
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Big play button + timer bar — shown when music hasn't started yet */}
      {needsPlayButton && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-black/60 border-b border-[#1DB954]/30 px-4 py-4"
        >
          <button
            onClick={handlePlayTap}
            className="w-full flex items-center justify-center gap-3 bg-[#1DB954] hover:bg-[#1ed760] text-black font-black text-lg py-4 rounded-2xl shadow-[0_0_30px_rgba(29,185,84,0.4)] transition-all active:scale-95"
          >
            <Play className="w-7 h-7" fill="currentColor" />
            TAP TO PLAY MUSIC
          </button>
        </motion.div>
      )}

      {/* Turn timer bar — visible below top bar during playing phase */}
      {phase === 'playing' && turnCountdown !== null && turnCountdown > 0 && (
        <div className={`px-4 py-2 border-b flex items-center justify-center gap-2 text-sm font-bold ${
          turnCountdown <= 5 ? 'bg-red-500/20 border-red-500/30 text-red-400' :
          turnCountdown <= 10 ? 'bg-orange-500/20 border-orange-500/30 text-orange-400' :
          'bg-white/5 border-white/10 text-gray-300'
        }`}>
          <Clock className="w-4 h-4" />
          <span>{turnCountdown}s remaining</span>
        </div>
      )}

      {/* Spotify error banner */}
      {spotifyError && (
        <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-2 text-center text-xs text-red-400 font-medium">
          {spotifyError}
        </div>
      )}

      {/* Disconnected player banner(s) */}
      <AnimatePresence>
        {Object.entries(disconnectCountdowns).map(([pid, secs]) => {
          const dcPlayer = players[pid];
          if (!dcPlayer) return null;
          const isTheirTurn = currentTurnPlayerId === pid;
          return (
            <motion.div
              key={`dc-${pid}`}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className={`border-b px-4 py-2.5 text-center text-sm font-semibold ${
                isTheirTurn
                  ? 'bg-amber-500/20 border-amber-500/30 text-amber-300'
                  : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400'
              }`}
            >
              <motion.div
                animate={{ opacity: [1, 0.6, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="flex items-center justify-center gap-2"
              >
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>
                  {dcPlayer.name} disconnected{isTheirTurn ? ' (their turn)' : ''} &mdash; waiting {secs}s...
                </span>
              </motion.div>
            </motion.div>
          );
        })}
      </AnimatePresence>

      {/* Center Area */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 relative overflow-y-auto">
        <AnimatePresence mode="wait">
          {isRevealed ? (
            <motion.div
              key="reveal"
              initial={{ scale: 0.8, opacity: 0, y: 50 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0, y: -50 }}
              className={`w-60 aspect-square rounded-3xl p-6 flex flex-col items-center justify-center relative overflow-hidden shadow-2xl bg-gradient-to-br ${
                lastReveal!.correct
                  ? 'from-green-500 to-emerald-700 shadow-green-500/40'
                  : 'from-red-500 to-rose-700 shadow-red-500/40'
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
              className="w-60 aspect-square rounded-3xl p-6 flex flex-col items-center justify-center relative overflow-hidden shadow-2xl shadow-indigo-900/50 bg-gradient-to-br from-blue-600 to-indigo-900"
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
                <div className="flex flex-col items-center gap-2">
                  <button
                    onClick={togglePlayback}
                    className={`w-20 h-20 rounded-full bg-[#1DB954] hover:bg-[#1ed760] flex items-center justify-center transition-all transform active:scale-90 shadow-[0_0_30px_rgba(29,185,84,0.4)] ${!isPlayingMusic ? 'animate-pulse' : ''}`}
                  >
                    {isPlayingMusic ? (
                      <Pause className="w-10 h-10 text-black" fill="black" />
                    ) : (
                      <Play className="w-10 h-10 text-black ml-1" fill="black" />
                    )}
                  </button>
                  {!isPlayingMusic && (
                    <span className="text-xs text-[#1DB954] font-bold animate-pulse">
                      TAP TO PLAY
                    </span>
                  )}
                </div>
              ) : (
                <h2 className="text-6xl font-black text-white/90 mt-4">?</h2>
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

        {/* Challenge countdown timer — shown below the card */}
        {phase === 'challenge' && countdown !== null && countdown > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`mt-4 flex items-center justify-center gap-3 px-6 py-3 rounded-2xl font-bold text-lg ${
              countdown <= 3 ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
            }`}
          >
            <Clock className="w-5 h-5" />
            <span>{countdown}s to challenge</span>
          </motion.div>
        )}

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
              type="search"
              name="song-title-guess"
              placeholder={songNamingRequired ? 'Song Title (Required)' : 'Guess Title (Optional, +1 token)'}
              value={guessTitle}
              onChange={(e) => setGuessTitle(e.target.value)}
              autoComplete="off"
              autoCapitalize="sentences"
              enterKeyHint="next"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#1DB954]"
            />
            <input
              type="search"
              name="song-artist-guess"
              placeholder={songNamingRequired ? 'Artist (Required)' : 'Guess Artist (Optional)'}
              value={guessArtist}
              onChange={(e) => setGuessArtist(e.target.value)}
              autoComplete="off"
              autoCapitalize="sentences"
              enterKeyHint="done"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#1DB954]"
            />
            {mode === 'expert' && (
              <input
                type="number"
                placeholder="Exact Year (Required)"
                value={guessYear}
                onChange={(e) => setGuessYear(e.target.value)}
                autoComplete="off"
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
            className="mt-8 text-center w-full max-w-sm"
          >
            <p className="text-gray-400 mb-2">
              {activePlayer.name} placed the card. Think it's wrong?
            </p>
            <p className="text-xs text-gray-500 mb-4">
              Pick where YOU think it belongs in the timeline below, then challenge.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={handleChallenge}
                disabled={me.tokens < CHALLENGE_COST || challengePosition === null}
                className="bg-red-500/15 hover:bg-red-500/25 text-red-400 border border-red-500/30 font-bold py-3.5 px-6 rounded-2xl flex items-center gap-2 transition-all disabled:opacity-40 active:scale-[0.97]"
              >
                <AlertTriangle className="w-5 h-5" />
                {challengePosition !== null ? `Challenge! (${CHALLENGE_COST})` : 'Pick a position first'}
              </button>
              <button
                onClick={() => setNoChallengeClicked(true)}
                className="bg-white/[0.06] hover:bg-white/[0.1] text-gray-400 hover:text-white border border-white/[0.08] font-bold py-3.5 px-6 rounded-2xl flex items-center gap-2 transition-all active:scale-[0.97]"
              >
                <Check className="w-5 h-5" />
                Looks Good
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
          <WaitingState />
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
          !isMyTurn && phase !== 'reveal' && phase !== 'challenge' ? 'opacity-60' : ''
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
        {(() => {
          const showPlacementDropZones = isMyTurn && phase === 'playing';
          const showChallengeDropZones = !isMyTurn && phase === 'challenge' && !isCoop && !challengers.includes(myId) && !noChallengeClicked;
          const showDropZones = showPlacementDropZones || showChallengeDropZones;
          const dropSelection = showPlacementDropZones ? selectedPosition : challengePosition;
          const dropOnClick = showPlacementDropZones
            ? (i: number) => setSelectedPosition(i)
            : (i: number) => setChallengePosition(i);

          return (
            <div className="flex overflow-x-auto pb-3 hide-scrollbar items-center min-h-[140px]">
              {showDropZones && (
                <DropZone
                  index={0}
                  selected={dropSelection === 0}
                  onClick={() => dropOnClick(0)}
                  challenge={showChallengeDropZones}
                />
              )}

              {/* Show pending placement indicator at position 0 */}
              {phase === 'challenge' && pendingPlacement === 0 && <PendingCard />}

              {displayTimeline.map((card, idx) => (
                <div key={card.id} className="flex items-center">
                  <TimelineCard card={card} />
                  {showDropZones && (
                    <DropZone
                      index={idx + 1}
                      selected={dropSelection === idx + 1}
                      onClick={() => dropOnClick(idx + 1)}
                      challenge={showChallengeDropZones}
                    />
                  )}
                  {/* Show pending placement indicator after this card */}
                  {phase === 'challenge' && pendingPlacement === idx + 1 && <PendingCard />}
                </div>
              ))}

              {displayTimeline.length === 0 && !showDropZones && phase !== 'challenge' && (
                <p className="text-gray-500 text-sm italic mx-auto">No cards yet</p>
              )}
            </div>
          );
        })()}

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

      <SongHistory isOpen={showHistory} onClose={() => setShowHistory(false)} />
    </div>
  );
}

function TimelineCard({ card }: { card: SongCard }) {
  const colorClass = getCardColor(card.year);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.85, y: -15 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      className={`flex-shrink-0 w-[7rem] h-[8.5rem] rounded-2xl p-2.5 flex flex-col justify-between bg-gradient-to-br ${colorClass} shadow-lg shadow-black/30 relative overflow-hidden`}
    >
      <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-black/10 to-transparent rounded-2xl" />
      <div className="relative z-10">
        <h4 className="font-black text-[1.4rem] text-white drop-shadow-sm">{card.year}</h4>
      </div>
      <div className="relative z-10">
        <p className="text-[11px] font-bold text-white leading-snug line-clamp-2 drop-shadow-sm">
          {card.title}
        </p>
        <p className="text-[10px] text-white/60 truncate mt-0.5">{card.artist}</p>
      </div>
    </motion.div>
  );
}

function PendingCard() {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      className="flex-shrink-0 w-[7rem] h-[8.5rem] rounded-2xl flex flex-col items-center justify-center border-2 border-dashed border-amber-400/70 bg-amber-400/10 shadow-[0_0_25px_rgba(251,191,36,0.2)] relative overflow-hidden"
    >
      <div className="absolute inset-0 bg-gradient-to-t from-amber-500/10 to-transparent" />
      <span className="text-4xl font-black text-amber-400 relative z-10">?</span>
      <span className="text-[10px] font-bold text-amber-400/70 mt-1 uppercase tracking-wider relative z-10">Placed here</span>
    </motion.div>
  );
}

function DropZone({
  index,
  selected,
  onClick,
  challenge,
}: {
  index: number;
  selected: boolean;
  onClick: () => void;
  challenge?: boolean;
}) {
  return (
    <motion.button
      layout
      onClick={onClick}
      whileTap={{ scale: 0.9 }}
      className={`flex-shrink-0 w-10 h-28 mx-1 rounded-xl border-2 border-dashed flex items-center justify-center transition-all cursor-pointer ${
        selected
          ? challenge
            ? 'border-red-400 bg-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.3)]'
            : 'border-[#1DB954] bg-[#1DB954]/20 shadow-[0_0_15px_rgba(29,185,84,0.3)]'
          : challenge
            ? 'border-red-400/30 hover:border-red-400/70 hover:bg-red-500/10'
            : 'border-white/15 hover:border-[#1DB954]/70 hover:bg-[#1DB954]/5'
      }`}
    >
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs ${
          selected
            ? challenge
              ? 'bg-red-500 text-white'
              : 'bg-[#1DB954] text-black'
            : challenge
              ? 'bg-red-500/20 text-red-400'
              : 'bg-white/10 text-white/40'
        }`}
      >
        +
      </div>
    </motion.button>
  );
}
