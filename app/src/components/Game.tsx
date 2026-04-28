import { useState, useEffect, useCallback, useRef } from 'react';
import { Disc, Check, X, SkipForward, AlertTriangle, ShoppingCart, Star, Play, Pause, Volume2, Volume1, VolumeX, Clock, Square, ArrowLeftRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getSocket } from '../services/socket';
import { useGameStore } from '../store';
import { useSpotifyPlayer } from '../hooks/useSpotifyPlayer';
import { preUnlockAudio, activateElement, resume } from '../services/spotifyPlayer';
import { SKIP_COST, CHALLENGE_COST, BUY_CARD_COST } from '@tunes/shared';
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
import type { SongCard, GameMode } from '@tunes/shared';
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

const MODE_CHIP_CLASS: Record<GameMode, string> = {
  original: 'chip chip-mode-original',
  pro: 'chip chip-mode-pro',
  expert: 'chip chip-mode-expert',
  coop: 'chip chip-mode-coop',
};

const DECADE_CLASS: Record<number, string> = {
  1930: 'dec-1930s',
  1940: 'dec-1940s',
  1950: 'dec-1950s',
  1960: 'dec-1960s',
  1970: 'dec-1970s',
  1980: 'dec-1980s',
  1990: 'dec-1990s',
  2000: 'dec-2000s',
  2010: 'dec-2010s',
  2020: 'dec-2020s',
};

function getDecadeClass(year: number): string {
  const decade = Math.floor(year / 10) * 10;
  return DECADE_CLASS[decade] || 'dec-1980s';
}

function Equalizer({ animate }: { animate: boolean }) {
  return (
    <div className="flex items-end gap-[3px] h-6">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className={`w-[3px] bg-neon-pink rounded-full ${animate ? 'animate-equalizer' : ''}`}
          style={{
            height: animate ? undefined : 6,
            animationDelay: animate ? `${i * 0.12}s` : undefined,
          }}
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

  const anchorCards = useGameStore((s) => s.anchorCards);
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
  const [buyCardToast, setBuyCardToast] = useState(false);
  const buzzFlash = useGameStore((s) => s.buzzFlash);
  const [showBuzzAlert, setShowBuzzAlert] = useState(false);
  const prevBuzzFlashRef = useRef(buzzFlash);
  const songNameResult = useGameStore((s) => s.songNameResult);

  // Show buzz flash when active player gets buzzed
  useEffect(() => {
    if (buzzFlash > prevBuzzFlashRef.current) {
      setShowBuzzAlert(true);
      const t = setTimeout(() => setShowBuzzAlert(false), 2000);
      prevBuzzFlashRef.current = buzzFlash;
      return () => clearTimeout(t);
    }
    prevBuzzFlashRef.current = buzzFlash;
  }, [buzzFlash]);

  // Timeline toggle: view own vs active player's timeline
  const [viewingOwnTimeline, setViewingOwnTimeline] = useState(false);
  // Auto-reset to active player's timeline on turn change
  useEffect(() => { setViewingOwnTimeline(false); }, [currentTurnPlayerId]);

  // Timeline scroll ref for auto-scroll
  const timelineRef = useRef<HTMLDivElement>(null);

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
  const turnOrder = useGameStore((s) => s.turnOrder);
  const playerList = turnOrder.length > 0
    ? turnOrder.map((id) => players[id]).filter(Boolean)
    : Object.values(players);
  const mode = settings.mode;
  const isCoop = mode === 'coop';

  if (!me || !activePlayer) return null;

  // Timeline to display:
  // - Co-op: shared timeline always
  // - Your turn: your own timeline (to place cards)
  // - Not your turn: active player's timeline by default, togglable to your own
  const displayTimeline = isCoop
    ? sharedTimeline
    : isMyTurn
      ? me.timeline
      : viewingOwnTimeline
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

  // Auto-scroll timeline when a card is placed or a position is selected
  useEffect(() => {
    const container = timelineRef.current;
    if (!container) return;
    const targetPos = pendingPlacement ?? selectedPosition ?? challengePosition;
    if (targetPos === null) return;
    const cardWidth = 120;
    const scrollTarget = targetPos * cardWidth - container.clientWidth / 2 + cardWidth / 2;
    container.scrollTo({ left: Math.max(0, scrollTarget), behavior: 'smooth' });
  }, [pendingPlacement, selectedPosition, challengePosition]);

  const handleChallenge = () => {
    if (challengePosition === null) return;
    socket.emit('challenge', { position: challengePosition });
  };

  const handleNameSong = () => {
    if (!guessTitle.trim()) return;
    // Pro/Expert require both title and artist; Original/Coop allow title-only
    const needsArtist = mode === 'pro' || mode === 'expert';
    if (needsArtist && !guessArtist.trim()) return;
    const guess: { title: string; artist: string; year?: number } = {
      title: guessTitle.trim(),
      artist: guessArtist.trim() || '',
    };
    if (mode === 'expert' && guessYear.trim()) {
      guess.year = parseInt(guessYear.trim(), 10);
    }
    socket.emit('name-song', guess);
  };

  const handleBuyCard = () => {
    socket.emit('buy-card');
    setBuyCardToast(true);
    setTimeout(() => setBuyCardToast(false), 2500);
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
      className="flex flex-col h-screen text-white  overflow-hidden"
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
              className=" border border-white/10 rounded-2xl p-6 mx-4 max-w-sm w-full shadow-2xl"
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

      {/* Buzz flash overlay — shown to the active player when someone buzzes */}
      <AnimatePresence>
        {showBuzzAlert && (
          <motion.div
            key="buzz-alert"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.02 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 z-50 pointer-events-none flex items-start justify-center pt-20"
          >
            <div className="bg-neon-amber text-[#0a0318] font-black text-xl px-7 py-4 rounded-3xl shadow-[0_0_60px_rgba(255,190,61,0.8)] flex items-center gap-3 animate-pulse">
              <span className="text-3xl">⚡</span>
              <span>Someone knows this!</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Anchor card dealing animation */}
      <AnimatePresence>
        {anchorCards && Object.keys(anchorCards).length > 0 && (
          <motion.div
            key="anchor-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center gap-4 p-4"
          >
            <motion.h2
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="text-xl font-bold text-white mb-2"
            >
              Starting Cards
            </motion.h2>
            <div className="flex flex-wrap justify-center gap-3">
              {Object.entries(anchorCards).map(([key, card], i) => {
                const label = key === '__shared__'
                  ? 'Team'
                  : players[key]?.id === myId
                    ? 'You'
                    : players[key]?.name || 'Player';
                return (
                  <motion.div
                    key={key}
                    initial={{ scale: 0, rotateY: 180, opacity: 0 }}
                    animate={{ scale: 1, rotateY: 0, opacity: 1 }}
                    transition={{ delay: 0.3 + i * 0.3, type: 'spring', stiffness: 200, damping: 20 }}
                    className={`flex flex-col items-center gap-1.5 rounded-xl p-3 bg-gradient-to-b ${getCardColor(card.year)} border border-white/20 shadow-lg min-w-[100px]`}
                  >
                    <span className="text-[10px] font-bold text-white/70 uppercase tracking-wider">{label}</span>
                    <span className="text-sm font-bold text-white text-center leading-tight">{card.title}</span>
                    <span className="text-xs text-white/60">{card.artist}</span>
                    <span className="text-lg font-black text-white/90">{card.year}</span>
                  </motion.div>
                );
              })}
            </div>
            {isHost && (
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.5 }}
                onClick={() => getSocket().emit('skip-anchors')}
                className="mt-4 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white/70 text-sm font-medium transition-colors"
              >
                Skip
              </motion.button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Bar — Row 1: Turn info + controls */}
      <div className="bg-black/60 border-b border-white/5 z-10">
        <div className="flex justify-between items-center px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <p className="font-bold text-neon-pink text-base truncate">
              {isMyTurn ? 'Your Turn' : `${activePlayer.name}'s Turn`}
            </p>
            <span className={`${MODE_CHIP_CLASS[mode]} flex-shrink-0`}>
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
              title={volume > 0 ? 'Mute' : 'Unmute'}
            >
              <VolumeIcon className="w-4 h-4" />
            </button>
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

        {/* Row 2: Player scores */}
        <div className="overflow-x-auto hide-scrollbar px-3 pb-1.5">
          <div className="flex gap-1.5 min-w-max mx-auto w-fit">
            {isCoop ? (
              <div className="flex items-center gap-2 bg-white/5 rounded-xl px-4 py-1.5">
                <span className="text-lg font-black text-green-400 tabular-nums">
                  {sharedTimeline.length}/{settings.cardsToWin}
                </span>
                <span className="text-sm text-gray-400">Team</span>
              </div>
            ) : (
              playerList.map((p) => (
                <div
                  key={p.id}
                  className={`score-pill ${p.id === currentTurnPlayerId ? 'is-active' : ''}`}
                >
                  <span className="score-pill-name">
                    {p.id === myId ? 'You' : p.name}
                  </span>
                  <span className="font-display tabular-nums text-white leading-none mt-0.5" style={{ fontSize: 16 }}>
                    {p.timeline.length}<span className="text-white/40 text-[10px]">/{settings.cardsToWin}</span>
                  </span>
                  <span className="text-[10px] text-neon-amber font-bold tabular-nums leading-none" title="Tokens">
                    ★ {p.tokens}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Big play button + timer bar — shown when music hasn't started yet */}
      {needsPlayButton && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-black/60 border-b border-neon-pink/30 px-3 py-2"
        >
          <button
            onClick={handlePlayTap}
            className="w-full flex items-center justify-center gap-2 bg-neon-pink hover:bg-[#ff6bd1] text-black font-black text-base py-3 rounded-xl glow-pink transition-all active:scale-95"
          >
            <Play className="w-5 h-5" fill="currentColor" />
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
              <div className="flex items-center justify-center gap-2 animate-blink">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>
                  {dcPlayer.name} disconnected{isTheirTurn ? ' (their turn)' : ''} &mdash; waiting {secs}s...
                </span>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>

      {/* Center Area */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-2 relative overflow-y-auto">
        <AnimatePresence mode="wait">
          {isRevealed ? (
            <motion.div
              key="reveal"
              initial={{ scale: 0.8, opacity: 0, y: 50 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0, y: -50 }}
              className={`reveal-card ${lastReveal!.correct ? 'reveal-correct' : 'reveal-wrong'}`}
            >
              {revealedSong!.albumArtUrl ? (
                <img src={revealedSong!.albumArtUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-25 rounded-3xl" />
              ) : (
                <div className="absolute -right-12 -bottom-12 opacity-20">
                  <Disc className="w-48 h-48" />
                </div>
              )}
              <motion.div
                initial={{ rotateY: 90 }}
                animate={{ rotateY: 0 }}
                className="text-center z-10"
              >
                <h2 className="font-display text-5xl mb-2 drop-shadow-lg leading-none">{revealedSong!.year}</h2>
                <p className="text-lg font-bold leading-tight drop-shadow-md">{revealedSong!.title}</p>
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
          )}
        </AnimatePresence>

        {/* Challenge countdown timer — shown below the card */}
        {phase === 'challenge' && countdown !== null && countdown > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`timer-pill mt-5 ${countdown <= 3 ? 'timer-red' : 'timer-amber'}`}
          >
            <Clock className="w-4 h-4" />
            <span>{countdown}s to challenge</span>
          </motion.div>
        )}

        {/* Song named notification — visible to all players */}
        {songNameResult && songNameResult.playerId !== myId && songNameResult.correct && phase === 'playing' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="mt-3 flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30"
          >
            <Star className="w-4 h-4" />
            {players[songNameResult.playerId]?.name || 'Someone'} named the song! +1 Token
          </motion.div>
        )}

        {/* Challenge result feedback — based on outcome, not position validity */}
        {phase === 'reveal' && lastReveal && challengers.includes(myId) && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`mt-4 px-5 py-2.5 rounded-xl text-sm font-bold border ${
              lastReveal.stolenBy === myId
                ? 'bg-green-500/20 text-green-400 border-green-500/30'
                : 'bg-red-500/20 text-red-400 border-red-500/30'
            }`}
          >
            {lastReveal.stolenBy === myId
              ? 'You stole the card!'
              : lastReveal.correct
                ? 'Placement was correct — you lost your challenge token'
                : lastReveal.stolenBy
                  ? `${players[lastReveal.stolenBy]?.name || 'Another challenger'} stole the card`
                  : 'Wrong placement, but no one had the right spot — card discarded'}
          </motion.div>
        )}

        {/* Reveal: Continue button */}
        {phase === 'reveal' && (
          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={handleConfirmReveal}
            className="mt-6 bg-neon-pink hover:bg-[#ff6bd1] text-black font-bold py-3 px-8 rounded-2xl transition-all transform active:scale-95"
          >
            Continue
          </motion.button>
        )}

        {/* Song naming inputs — visible during playing AND challenge phases */}
        {isMyTurn && (phase === 'playing' || phase === 'challenge') && !(songNameResult?.playerId === myId) && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-5 w-full max-w-xs space-y-3"
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
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-pink"
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
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-pink"
            />
            {mode === 'expert' && (
              <input
                type="number"
                placeholder="Exact Year (Required)"
                value={guessYear}
                onChange={(e) => setGuessYear(e.target.value)}
                autoComplete="off"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-pink"
              />
            )}
            {guessTitle ? (
              <button
                onClick={handleNameSong}
                className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 rounded-xl text-sm transition-all"
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

        {/* Challenge / No Challenge buttons for non-active players */}
        {!isMyTurn && phase === 'challenge' && !isCoop && !challengers.includes(myId) && !noChallengeClicked && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-5 text-center w-full max-w-sm"
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
          <p className="mt-5 text-neon-pink font-medium">Challenge submitted!</p>
        )}

        {!isMyTurn && phase === 'challenge' && !isCoop && noChallengeClicked && !challengers.includes(myId) && (
          <p className="mt-5 text-gray-500 font-medium">No challenge — waiting for timer...</p>
        )}

        {/* Active player sees countdown too during challenge */}
        {isMyTurn && phase === 'challenge' && !isCoop && (
          <p className="mt-5 text-gray-400 font-medium">
            Waiting for challenges...
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
      <div className="bg-black/60 border-t border-white/10 px-4 pt-3 pb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-gray-300 uppercase tracking-widest text-xs">
            {isCoop
              ? 'Team Timeline'
              : isMyTurn
                ? 'Your Timeline'
                : viewingOwnTimeline
                  ? 'Your Timeline'
                  : `${activePlayer.name}'s Timeline`}
          </h3>
          {!isMyTurn && !isCoop && phase !== 'reveal' && (
            <button
              onClick={() => setViewingOwnTimeline((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-bold text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 px-2.5 py-1 rounded-lg transition-colors"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              {viewingOwnTimeline ? 'Show Theirs' : 'Show Mine'}
            </button>
          )}
        </div>

        {/* Timeline */}
        {(() => {
          const showPlacementDropZones = isMyTurn && phase === 'playing';
          const showChallengeDropZones = !isMyTurn && phase === 'challenge' && !isCoop && !challengers.includes(myId) && !noChallengeClicked && !viewingOwnTimeline;
          const showDropZones = showPlacementDropZones || showChallengeDropZones;
          const dropSelection = showPlacementDropZones ? selectedPosition : challengePosition;
          const dropOnClick = showPlacementDropZones
            ? (i: number) => setSelectedPosition(i)
            : (i: number) => {
                // Don't allow challenging at the same position as the active player's placement
                if (pendingPlacement !== null && i === pendingPlacement) return;
                setChallengePosition(i);
              };

          // During challenge, hide the drop zone at the active player's placement position
          const isBlockedPosition = (i: number) => showChallengeDropZones && pendingPlacement !== null && i === pendingPlacement;

          return (
            <div ref={timelineRef} className="flex overflow-x-auto pb-3 hide-scrollbar items-center min-h-[140px]">
              {showDropZones && !isBlockedPosition(0) && (
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
                  {showDropZones && !isBlockedPosition(idx + 1) && (
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
          <>
            <AnimatePresence>
              {buyCardToast && (
                <motion.div
                  key="buy-toast"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="mb-2 flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-neon-amber/20 border border-neon-amber/40 text-neon-amber text-sm font-bold"
                >
                  <ShoppingCart className="w-4 h-4" />
                  Card added to your timeline! (-{BUY_CARD_COST} tokens)
                </motion.div>
              )}
            </AnimatePresence>
            <div className="flex gap-3 mt-2">
              <button
                onClick={handleSkip}
                disabled={me.tokens < SKIP_COST}
                className="btn btn-ghost flex-1 text-xs"
              >
                <SkipForward className="w-4 h-4" />
                Skip · {SKIP_COST}★
              </button>
              <button
                onClick={handlePlaceCard}
                disabled={selectedPosition === null}
                className="btn btn-primary flex-[2]"
              >
                PLACE CARD
              </button>
              <button
                onClick={handleBuyCard}
                disabled={me.tokens < BUY_CARD_COST}
                className="btn btn-ghost flex-1 text-xs"
              >
                <ShoppingCart className="w-4 h-4" />
                Buy · {BUY_CARD_COST}★
              </button>
            </div>
          </>
        )}
      </div>

      {/* Compact waiting state below timeline when not your turn */}
      {!isMyTurn && phase === 'playing' && (
        <div className="px-4 pb-3">
          <WaitingState />
        </div>
      )}

      <SongHistory isOpen={showHistory} onClose={() => setShowHistory(false)} />
    </div>
  );
}

function TimelineCard({ card }: { card: SongCard }) {
  const decade = getDecadeClass(card.year);
  const yearShort = `'${String(card.year).slice(-2)}`;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.85, y: -15 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      className={`sleeve ${decade}`}
    >
      <div className="sleeve-shade" />
      <div className="sleeve-inner">
        <span className="font-chunky text-2xl text-neon-amber leading-none drop-shadow-md">{yearShort}</span>
        <div className="text-white">
          <p className="text-[11px] font-bold leading-snug line-clamp-2 drop-shadow-sm">
            {card.title}
          </p>
          <p className="text-[10px] text-white/60 truncate mt-0.5">{card.artist}</p>
        </div>
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
      className="drop-pending"
    >
      <span className="font-chunky text-4xl text-neon-amber">?</span>
      <span className="text-[10px] font-bold text-neon-amber/70 mt-1 uppercase tracking-wider">Placed here</span>
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
  void index;
  const cls = challenge
    ? `drop drop-challenge ${selected ? 'drop-selected' : ''}`
    : `drop drop-cyan ${selected ? 'drop-selected' : ''}`;
  return (
    <motion.button
      layout
      onClick={onClick}
      whileTap={{ scale: 0.92 }}
      className={cls}
    >
      +
    </motion.button>
  );
}
