import { Trophy, Home, RotateCcw, Medal, Coins } from 'lucide-react';
import { motion } from 'motion/react';
import { getSocket } from '../services/socket';
import { clearSession } from '../services/socket';
import { useGameStore } from '../store';

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];

const MEDAL_STYLES: Record<number, { bg: string; border: string; badge: string; text: string }> = {
  0: {
    bg: 'bg-gradient-to-r from-[#FFD700]/15 via-[#FFD700]/5 to-transparent',
    border: 'border-[#FFD700]/40',
    badge: 'bg-gradient-to-br from-[#FFD700] to-[#FFA000] text-black',
    text: 'text-[#FFD700]',
  },
  1: {
    bg: 'bg-gradient-to-r from-[#C0C0C0]/10 to-transparent',
    border: 'border-[#C0C0C0]/30',
    badge: 'bg-gradient-to-br from-[#D0D0D0] to-[#A0A0A0] text-black',
    text: 'text-[#C0C0C0]',
  },
  2: {
    bg: 'bg-gradient-to-r from-[#CD7F32]/10 to-transparent',
    border: 'border-[#CD7F32]/30',
    badge: 'bg-gradient-to-br from-[#CD7F32] to-[#A0622A] text-black',
    text: 'text-[#CD7F32]',
  },
};

const DEFAULT_STYLE = {
  bg: 'bg-white/[0.03]',
  border: 'border-white/[0.06]',
  badge: 'bg-white/10 text-gray-500',
  text: 'text-gray-500',
};

export function Results() {
  const winnerId = useGameStore((s) => s.winnerId);
  const finalPlayers = useGameStore((s) => s.finalPlayers);
  const settings = useGameStore((s) => s.settings);
  const sharedTimeline = useGameStore((s) => s.sharedTimeline);
  const myId = useGameStore((s) => s.myId);
  const hostId = useGameStore((s) => s.hostId);
  const reset = useGameStore((s) => s.reset);

  const isCoop = settings.mode === 'coop';
  const isHost = myId === hostId;
  const playerList = Object.values(finalPlayers);
  const sortedPlayers = [...playerList].sort(
    (a, b) => b.timeline.length - a.timeline.length
  );
  const winner = winnerId ? finalPlayers[winnerId] : sortedPlayers[0];

  const handlePlayAgain = () => {
    const socket = getSocket();
    socket.emit('restart-game');
  };

  const handleHome = () => {
    const socket = getSocket();
    socket.emit('leave-room');
    clearSession();
    reset();
  };

  if (!winner) return null;

  return (
    <div className="flex flex-col min-h-screen p-6 text-white bg-[#1a1a2e] bg-pattern overflow-y-auto">
      {/* Winner announcement */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        className="flex flex-col items-center mt-8 mb-10"
      >
        <div className="relative mb-4">
          <div className="absolute inset-0 bg-[#FFD700] blur-3xl opacity-20 rounded-full scale-150" />
          <Trophy className="w-24 h-24 text-[#FFD700] relative z-10" />
        </div>
        <h1 className="text-4xl font-black tracking-tight text-center mb-1">
          {isCoop ? 'TEAM WINS!' : `${winner.name} WINS!`}
        </h1>
        <p className="text-[#1DB954] font-bold text-lg">
          {isCoop
            ? `${sharedTimeline.length} Cards Collected Together`
            : `${winner.timeline.length} Cards Collected`}
        </p>
      </motion.div>

      {/* Rankings */}
      <div className="flex-1 w-full max-w-md mx-auto space-y-3">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">
          {isCoop ? 'Team Result' : 'Final Rankings'}
        </h3>

        {isCoop ? (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="p-5 rounded-2xl border bg-gradient-to-r from-[#1DB954]/15 to-transparent border-[#1DB954]/30"
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-base font-bold text-[#1DB954]">Team Score</span>
              <div className="flex items-baseline gap-1.5">
                <span className="font-black text-2xl">{sharedTimeline.length}</span>
                <span className="text-xs text-gray-500 uppercase">Cards</span>
              </div>
            </div>
            <div className="space-y-2">
              {sortedPlayers.map((player, index) => (
                <motion.div
                  key={player.id}
                  initial={{ x: -10, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 0.3 + index * 0.08 }}
                  className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-white/[0.04]"
                >
                  <span className="font-medium text-sm">{player.name}</span>
                  <div className="flex items-center gap-1.5 text-sm text-[#FFD700]/80">
                    <Coins className="w-3.5 h-3.5" />
                    <span className="font-bold">{player.tokens}</span>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        ) : (
          sortedPlayers.map((player, index) => {
            const style = MEDAL_STYLES[index] || DEFAULT_STYLE;
            const ordinal = ORDINALS[index] || `${index + 1}th`;

            return (
              <motion.div
                key={player.id}
                initial={{ x: -20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.15 + index * 0.1, type: 'spring', stiffness: 200, damping: 22 }}
                className={`flex items-center justify-between p-4 rounded-2xl border ${style.bg} ${style.border}`}
              >
                <div className="flex items-center gap-3">
                  <div className="flex flex-col items-center gap-0.5">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-sm ${style.badge}`}
                    >
                      {index < 3 ? (
                        <Medal className="w-5 h-5" />
                      ) : (
                        index + 1
                      )}
                    </div>
                    <span className={`text-[9px] font-bold uppercase ${style.text}`}>
                      {ordinal}
                    </span>
                  </div>
                  <div>
                    <span className="font-bold text-base block">{player.name}</span>
                    {player.id === myId && (
                      <span className="text-[10px] text-gray-500 font-medium">You</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end">
                  <div className="flex items-baseline gap-1">
                    <span className="font-black text-xl tabular-nums">{player.timeline.length}</span>
                    <span className="text-[10px] text-gray-500 uppercase font-bold">Cards</span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-[#FFD700]/70 font-bold">
                    <Coins className="w-3 h-3" />
                    {player.tokens}
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      {/* Action buttons */}
      <div className="mt-8 w-full max-w-md mx-auto space-y-3 pb-4">
        {isHost ? (
          <button
            onClick={handlePlayAgain}
            className="w-full bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold text-lg py-4 rounded-2xl flex items-center justify-center gap-3 transition-all transform active:scale-[0.97] shadow-[0_4px_20px_rgba(29,185,84,0.3)]"
          >
            <RotateCcw className="w-5 h-5" />
            Play Again
          </button>
        ) : (
          <div className="w-full bg-white/[0.04] text-gray-500 font-bold py-4 rounded-2xl flex items-center justify-center gap-3 border border-white/[0.06]">
            <RotateCcw className="w-5 h-5 animate-spin" style={{ animationDuration: '3s' }} />
            Waiting for host...
          </div>
        )}
        <button
          onClick={handleHome}
          className="w-full bg-white/[0.06] hover:bg-white/[0.1] text-gray-400 hover:text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-3 transition-all transform active:scale-[0.97] border border-white/[0.06]"
        >
          <Home className="w-5 h-5" />
          Leave Game
        </button>
      </div>
    </div>
  );
}
