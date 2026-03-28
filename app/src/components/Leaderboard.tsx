import { useEffect } from 'react';
import { Trophy, ArrowLeft, Medal } from 'lucide-react';
import { motion } from 'motion/react';
import { getSocket } from '../services/socket';
import { useGameStore } from '../store';

export function Leaderboard() {
  const leaderboard = useGameStore((s) => s.leaderboard);
  const setScreen = useGameStore((s) => s.setScreen);
  const signedInAs = localStorage.getItem('tunes_username');

  useEffect(() => {
    const socket = getSocket();
    socket.emit('get-leaderboard');
  }, []);

  return (
    <div className="flex flex-col items-center min-h-screen p-6 text-white bg-[#1a1a2e] bg-pattern">
      {/* Header */}
      <div className="w-full max-w-lg">
        <button
          onClick={() => setScreen('home')}
          className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-6"
        >
          <ArrowLeft className="w-5 h-5" />
          Back
        </button>

        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="flex items-center gap-3 mb-8"
        >
          <Trophy className="w-8 h-8 text-yellow-400" />
          <h1 className="text-3xl font-black tracking-tight">Leaderboard</h1>
        </motion.div>

        {leaderboard.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-16"
          >
            <Trophy className="w-16 h-16 text-gray-700 mx-auto mb-4" />
            <p className="text-gray-500 text-lg">No games played yet</p>
            <p className="text-gray-600 text-sm mt-1">
              Play some games to see the leaderboard!
            </p>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="space-y-2"
          >
            {/* Table header */}
            <div className="grid grid-cols-[2.5rem_1fr_3.5rem_3.5rem_4rem_3.5rem] gap-2 px-4 py-2 text-xs font-bold text-gray-500 uppercase tracking-wider">
              <span>#</span>
              <span>Player</span>
              <span className="text-right">Wins</span>
              <span className="text-right">Games</span>
              <span className="text-right">Win %</span>
              <span className="text-right">Streak</span>
            </div>

            {leaderboard.map((entry, index) => {
              const rank = index + 1;
              const isCurrentUser = signedInAs && entry.username.toLowerCase() === signedInAs.toLowerCase();
              const medalColor =
                rank === 1
                  ? 'text-yellow-400'
                  : rank === 2
                    ? 'text-gray-300'
                    : rank === 3
                      ? 'text-amber-600'
                      : 'text-gray-600';
              const rowBg = isCurrentUser
                ? 'bg-[#1DB954]/10 border-[#1DB954]/30'
                : 'bg-white/[0.03] border-white/[0.05]';

              return (
                <motion.div
                  key={entry.username}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.03 }}
                  className={`grid grid-cols-[2.5rem_1fr_3.5rem_3.5rem_4rem_3.5rem] gap-2 items-center px-4 py-3 rounded-xl border ${rowBg} transition-colors`}
                >
                  <span className="flex items-center">
                    {rank <= 3 ? (
                      <Medal className={`w-5 h-5 ${medalColor}`} />
                    ) : (
                      <span className="text-sm text-gray-500 font-bold pl-0.5">{rank}</span>
                    )}
                  </span>
                  <span className="truncate">
                    <span className={`font-semibold ${isCurrentUser ? 'text-[#1DB954]' : 'text-white'}`}>
                      {entry.displayName}
                    </span>
                  </span>
                  <span className="text-right text-sm font-bold text-white">{entry.totalWins}</span>
                  <span className="text-right text-sm text-gray-400">{entry.totalGames}</span>
                  <span className="text-right text-sm text-gray-300">
                    {(entry.winRate * 100).toFixed(0)}%
                  </span>
                  <span className="text-right text-sm text-gray-400">{entry.bestStreak}</span>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </div>
    </div>
  );
}
