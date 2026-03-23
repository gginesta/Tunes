import { Trophy, Home, RotateCcw } from 'lucide-react';
import { motion } from 'motion/react';
import { getSocket } from '../services/socket';
import { useGameStore } from '../store';

export function Results() {
  const winnerId = useGameStore((s) => s.winnerId);
  const finalPlayers = useGameStore((s) => s.finalPlayers);
  const reset = useGameStore((s) => s.reset);

  const playerList = Object.values(finalPlayers);
  const sortedPlayers = [...playerList].sort(
    (a, b) => b.timeline.length - a.timeline.length
  );
  const winner = winnerId ? finalPlayers[winnerId] : sortedPlayers[0];

  const handlePlayAgain = () => {
    // Go back to lobby — server handles the reset
    useGameStore.setState({ screen: 'lobby', phase: 'lobby', lastReveal: null });
  };

  const handleHome = () => {
    const socket = getSocket();
    socket.emit('leave-room');
    reset();
  };

  if (!winner) return null;

  return (
    <div className="flex flex-col min-h-screen p-6 text-white bg-[#1a1a2e] overflow-y-auto">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="flex flex-col items-center mt-8 mb-12"
      >
        <div className="relative mb-6">
          <div className="absolute inset-0 bg-[#FFD700] blur-3xl opacity-30 rounded-full" />
          <Trophy className="w-32 h-32 text-[#FFD700] relative z-10" />
        </div>
        <h1 className="text-5xl font-black tracking-tighter text-center mb-2">
          {winner.name} WINS!
        </h1>
        <p className="text-[#1DB954] font-bold text-xl">
          {winner.timeline.length} Cards Collected
        </p>
      </motion.div>

      <div className="flex-1 w-full max-w-md mx-auto space-y-4">
        <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">
          Final Standings
        </h3>

        {sortedPlayers.map((player, index) => (
          <motion.div
            key={player.id}
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: index * 0.1 }}
            className={`flex items-center justify-between p-4 rounded-2xl border ${
              index === 0
                ? 'bg-gradient-to-r from-[#FFD700]/20 to-transparent border-[#FFD700]/50'
                : 'bg-white/5 border-white/10'
            }`}
          >
            <div className="flex items-center gap-4">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center font-black ${
                  index === 0
                    ? 'bg-[#FFD700] text-black'
                    : 'bg-black/50 text-gray-400'
                }`}
              >
                {index + 1}
              </div>
              <span className="font-bold text-lg">{player.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-black text-xl">{player.timeline.length}</span>
              <span className="text-xs text-gray-400 uppercase">Cards</span>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="mt-12 w-full max-w-md mx-auto space-y-4">
        <button
          onClick={handlePlayAgain}
          className="w-full bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold text-lg py-4 px-6 rounded-2xl flex items-center justify-center gap-3 transition-all transform active:scale-95 shadow-[0_0_20px_rgba(29,185,84,0.3)]"
        >
          <RotateCcw className="w-6 h-6" />
          Play Again
        </button>
        <button
          onClick={handleHome}
          className="w-full bg-white/10 hover:bg-white/15 text-white font-bold text-lg py-4 px-6 rounded-2xl flex items-center justify-center gap-3 transition-all transform active:scale-95"
        >
          <Home className="w-6 h-6" />
          Back to Home
        </button>
      </div>
    </div>
  );
}
