import { useState, useEffect, useRef } from 'react';
import { SkipForward, AlertTriangle, ShoppingCart, Star, Play, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getSocket } from '../services/socket';
import { useGameStore } from '../store';
import { useSpotifyPlayer } from '../hooks/useSpotifyPlayer';
import { useGameTimers } from '../hooks/useGameTimers';
import { useGameSounds } from '../hooks/useGameSounds';
import { preUnlockAudio, activateElement, resume } from '../services/spotifyPlayer';
import { SKIP_COST, BUY_CARD_COST } from '@tunes/shared';
import { SongHistory } from './SongHistory';
import { WaitingState } from './WaitingState';
import { StopConfirmDialog } from './game/StopConfirmDialog';
import { BuzzAlert } from './game/BuzzAlert';
import { AnchorCardsOverlay } from './game/AnchorCardsOverlay';
import { GameTopBar } from './game/GameTopBar';
import { DisconnectBanners } from './game/DisconnectBanners';
import { RevealOverlay } from './game/RevealOverlay';
import { VinylDeck } from './game/VinylDeck';
import { RevealActions } from './game/RevealActions';
import { NamingForm } from './game/NamingForm';
import { ChallengeBar } from './game/ChallengeBar';
import { TimelineStrip } from './game/TimelineStrip';

export function Game() {
  const myId = useGameStore((s) => s.myId);
  const hostId = useGameStore((s) => s.hostId);
  const players = useGameStore((s) => s.players);
  const currentTurnPlayerId = useGameStore((s) => s.currentTurnPlayerId);
  const phase = useGameStore((s) => s.phase);
  const lastReveal = useGameStore((s) => s.lastReveal);
  const settings = useGameStore((s) => s.settings);
  const isPlayingMusic = useGameStore((s) => s.isPlaying);
  const spotifyError = useGameStore((s) => s.spotifyError);
  const notice = useGameStore((s) => s.notice);
  const isHost = myId === hostId;

  // Stop game confirmation
  const [showStopConfirm, setShowStopConfirm] = useState(false);

  const [noChallengeClicked, setNoChallengeClicked] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const [guessTitle, setGuessTitle] = useState('');
  const [guessArtist, setGuessArtist] = useState('');
  const [guessYear, setGuessYear] = useState('');
  const [selectedPosition, setSelectedPosition] = useState<number | null>(null);
  const [buyCardToast, setBuyCardToast] = useState(false);
  const songNameResult = useGameStore((s) => s.songNameResult);

  // Timeline toggle: view own vs active player's timeline
  const [viewingOwnTimeline, setViewingOwnTimeline] = useState(false);
  // Auto-reset to active player's timeline on turn change
  useEffect(() => { setViewingOwnTimeline(false); }, [currentTurnPlayerId]);

  // Reset "no challenge" when phase changes
  useEffect(() => {
    if (phase !== 'challenge') setNoChallengeClicked(false);
  }, [phase]);

  // Countdown timers (challenge / turn / disconnect)
  const { countdown, turnCountdown, disconnectCountdowns } = useGameTimers();

  // Sound effects + volume mute toggle
  const { volume, handleToggleMute, VolumeIcon } = useGameSounds(countdown);

  const { isHost: isSpotifyHost, togglePlayback } = useSpotifyPlayer();

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
  const mode = settings.mode;
  const isCoop = mode === 'coop';

  const [challengePosition, setChallengePosition] = useState<number | null>(null);

  // Reset challenge position when phase changes
  useEffect(() => {
    if (phase !== 'challenge') setChallengePosition(null);
  }, [phase]);

  if (!me || !activePlayer) return null;

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

  return (
    <div className="flex flex-col h-screen text-white overflow-hidden">
      {/* Stop game confirmation dialog */}
      <StopConfirmDialog
        open={showStopConfirm}
        onCancel={() => setShowStopConfirm(false)}
        onConfirm={handleStopGame}
      />

      {/* Buzz flash overlay — shown to the active player when someone buzzes */}
      <BuzzAlert />

      {/* Anchor card dealing animation */}
      <AnchorCardsOverlay />

      {/* Top Bar — Row 1: Turn info + controls, Row 2: Player scores */}
      <GameTopBar
        volume={volume}
        VolumeIcon={VolumeIcon}
        onToggleMute={handleToggleMute}
        onShowHistory={() => setShowHistory(true)}
        onStopGame={() => setShowStopConfirm(true)}
      />

      {/* Big play button — shown when music hasn't started yet */}
      {needsPlayButton && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-black/40 border-b border-neon-pink/30 px-3 py-2"
        >
          <button
            onClick={handlePlayTap}
            className="btn btn-primary btn-lg w-full"
          >
            <Play className="w-5 h-5" fill="currentColor" />
            TAP TO PLAY MUSIC
          </button>
        </motion.div>
      )}

      {/* Turn timer bar — gradient stripe under top chrome */}
      {phase === 'playing' && turnCountdown !== null && turnCountdown > 0 && (() => {
        const total = 60;
        const pct = Math.min(100, Math.max(0, (turnCountdown / total) * 100));
        const tint = turnCountdown <= 5 ? '#f87171' : turnCountdown <= 10 ? 'var(--color-neon-amber)' : 'var(--color-neon-cyan)';
        return (
          <div className="relative h-[3px] bg-white/5 overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 transition-all duration-1000 ease-linear"
              style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${tint}, ${tint})` }}
            />
          </div>
        );
      })()}

      {/* Spotify error banner */}
      {spotifyError && (
        <div className="bg-red-500/15 border-b border-red-500/30 px-4 py-2 text-center text-xs text-red-300 font-bold flex items-center justify-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5" />
          {spotifyError}
        </div>
      )}

      {/* Transient info banner (e.g. late-join briefing) */}
      {notice && (
        <div className="bg-neon-cyan/10 border-b border-neon-cyan/30 px-4 py-2 text-center text-xs text-neon-cyan font-bold">
          {notice}
        </div>
      )}

      {/* Disconnected player banner(s) */}
      <DisconnectBanners countdowns={disconnectCountdowns} />

      {/* Center Area */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-2 relative overflow-y-auto">
        <AnimatePresence mode="wait">
          {isRevealed ? (
            <RevealOverlay key="reveal" reveal={lastReveal!} />
          ) : (
            <VinylDeck
              key="hidden"
              phase={phase}
              mode={mode}
              isCoop={isCoop}
              isMyTurn={isMyTurn}
              isPlayingMusic={isPlayingMusic}
              isSpotifyHost={isSpotifyHost}
              togglePlayback={togglePlayback}
            />
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

        {/* Reveal: challenge result feedback + continue button */}
        <RevealActions onContinue={handleConfirmReveal} />

        {/* Song naming inputs + guess result */}
        <NamingForm
          guessTitle={guessTitle}
          guessArtist={guessArtist}
          guessYear={guessYear}
          onTitleChange={setGuessTitle}
          onArtistChange={setGuessArtist}
          onYearChange={setGuessYear}
          onSubmit={handleNameSong}
        />

        {/* Challenge actions / status for the challenge phase */}
        <ChallengeBar
          challengePosition={challengePosition}
          noChallengeClicked={noChallengeClicked}
          onChallenge={handleChallenge}
          onNoChallenge={() => setNoChallengeClicked(true)}
        />
      </div>

      {/* Bottom: Timeline + Actions */}
      <div className="bg-black/60 border-t border-white/10 px-4 pt-3 pb-4">
        <TimelineStrip
          viewingOwnTimeline={viewingOwnTimeline}
          onToggleView={() => setViewingOwnTimeline((v) => !v)}
          selectedPosition={selectedPosition}
          onSelectPosition={setSelectedPosition}
          challengePosition={challengePosition}
          onSelectChallengePosition={setChallengePosition}
          noChallengeClicked={noChallengeClicked}
        />

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
