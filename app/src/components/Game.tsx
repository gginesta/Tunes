import { useState } from 'react';
import { Disc, Coins, Check, X, SkipForward, AlertTriangle, ShoppingCart } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getSocket } from '../services/socket';
import { useGameStore } from '../store';
import { SKIP_COST, CHALLENGE_COST, BUY_CARD_COST } from '@hitster/shared';
import type { SongCard } from '@hitster/shared';

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

export function Game() {
  const myId = useGameStore((s) => s.myId);
  const players = useGameStore((s) => s.players);
  const currentTurnPlayerId = useGameStore((s) => s.currentTurnPlayerId);
  const currentSong = useGameStore((s) => s.currentSong);
  const phase = useGameStore((s) => s.phase);
  const lastReveal = useGameStore((s) => s.lastReveal);
  const deckSize = useGameStore((s) => s.deckSize);
  const challengers = useGameStore((s) => s.challengers);
  const settings = useGameStore((s) => s.settings);

  const [guessTitle, setGuessTitle] = useState('');
  const [guessArtist, setGuessArtist] = useState('');
  const [songNameResult, setSongNameResult] = useState<boolean | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<number | null>(null);

  const socket = getSocket();
  const isMyTurn = currentTurnPlayerId === myId;
  const me = players[myId];
  const activePlayer = currentTurnPlayerId ? players[currentTurnPlayerId] : null;
  const playerList = Object.values(players);

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
    setSongNameResult(null);
  };

  const handleChallenge = () => {
    socket.emit('challenge');
  };

  const handleNameSong = () => {
    if (!guessTitle.trim() || !guessArtist.trim()) return;
    socket.emit('name-song', { title: guessTitle.trim(), artist: guessArtist.trim() });
    // We'll get the result via the song-named event
  };

  const handleBuyCard = () => {
    socket.emit('buy-card');
  };

  const handleConfirmReveal = () => {
    socket.emit('confirm-reveal');
    setGuessTitle('');
    setGuessArtist('');
    setSongNameResult(null);
    setSelectedPosition(null);
  };

  const revealedSong = lastReveal?.song;
  const isRevealed = phase === 'reveal' && revealedSong;

  return (
    <div className="flex flex-col h-screen text-white bg-[#1a1a2e] overflow-hidden">
      {/* Top Bar */}
      <div className="flex justify-between items-center p-4 bg-black/30 backdrop-blur-md border-b border-white/5 z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center font-bold">
            {activePlayer.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wider font-bold">
              {deckSize} cards left
            </p>
            <p className="font-bold text-[#1DB954]">
              {isMyTurn ? 'Your Turn' : `${activePlayer.name}'s Turn`}
            </p>
          </div>
        </div>

        {/* Player score chips */}
        <div className="flex gap-3 overflow-x-auto hide-scrollbar">
          {playerList.map((p) => (
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
          ))}
        </div>
      </div>

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

                <div className="mt-6">
                  {lastReveal!.correct ? (
                    <div className="flex items-center justify-center gap-2 text-white bg-black/20 px-4 py-2 rounded-full">
                      <Check className="w-5 h-5" /> Correct!
                    </div>
                  ) : lastReveal!.stolenBy ? (
                    <div className="flex items-center justify-center gap-2 text-white bg-black/20 px-4 py-2 rounded-full">
                      <AlertTriangle className="w-5 h-5" /> Stolen by{' '}
                      {players[lastReveal!.stolenBy]?.name || 'challenger'}!
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-2 text-white bg-black/20 px-4 py-2 rounded-full">
                      <X className="w-5 h-5" /> Wrong placement
                    </div>
                  )}
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
              <div className="absolute top-4 left-4 right-4 flex justify-between items-center">
                <div className="flex gap-1">
                  <span className="w-1 h-3 bg-[#1DB954] rounded-full animate-pulse" />
                  <span className="w-1 h-4 bg-[#1DB954] rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
                  <span className="w-1 h-2 bg-[#1DB954] rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-xs font-bold text-white/70 uppercase tracking-widest">
                  {phase === 'challenge' ? 'Challenge!' : 'Now Playing'}
                </span>
              </div>
              <h2 className="text-6xl font-black text-white/90 mt-4">?</h2>
              <p className="text-white/50 font-medium mt-2">
                {phase === 'challenge'
                  ? 'Waiting for challenges...'
                  : 'Guess the year'}
              </p>
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

        {/* Song naming inputs (for active player during playing phase) */}
        {isMyTurn && phase === 'playing' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-8 w-full max-w-xs space-y-3"
          >
            <input
              type="text"
              placeholder="Guess Title (Optional, +1 token)"
              value={guessTitle}
              onChange={(e) => setGuessTitle(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#1DB954]"
            />
            <input
              type="text"
              placeholder="Guess Artist (Optional)"
              value={guessArtist}
              onChange={(e) => setGuessArtist(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#1DB954]"
            />
            {guessTitle && guessArtist && (
              <button
                onClick={handleNameSong}
                className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 rounded-xl text-sm transition-all"
              >
                Submit Song Guess
              </button>
            )}
          </motion.div>
        )}

        {/* Challenge button for non-active players */}
        {!isMyTurn && phase === 'challenge' && !challengers.includes(myId) && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-8 text-center"
          >
            <p className="text-gray-400 mb-4">
              {activePlayer.name} placed the card. Challenge?
            </p>
            <button
              onClick={handleChallenge}
              disabled={me.tokens < CHALLENGE_COST}
              className="bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/50 font-bold py-3 px-6 rounded-2xl flex items-center gap-2 mx-auto transition-all disabled:opacity-50"
            >
              <AlertTriangle className="w-5 h-5" />
              Challenge! ({CHALLENGE_COST} Token)
            </button>
          </motion.div>
        )}

        {!isMyTurn && phase === 'challenge' && challengers.includes(myId) && (
          <p className="mt-8 text-[#1DB954] font-medium">Challenge submitted!</p>
        )}

        {!isMyTurn && phase === 'playing' && (
          <p className="mt-8 text-gray-400">
            Waiting for {activePlayer.name} to place the card...
          </p>
        )}

        {/* Challengers display */}
        {challengers.length > 0 && phase === 'challenge' && (
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
            {isMyTurn ? 'Your Timeline' : `${activePlayer.name}'s Timeline`}
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

          {me.timeline.map((card, idx) => (
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

          {me.timeline.length === 0 && !isMyTurn && (
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
