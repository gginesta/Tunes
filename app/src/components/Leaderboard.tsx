import { useEffect } from 'react';
import { Trophy, ArrowLeft, Flame } from 'lucide-react';
import { motion } from 'motion/react';
import { getSocket } from '../services/socket';
import { useGameStore } from '../store';

const RANK_TINTS = [
  'bg-gradient-to-r from-[#FFD700]/15 via-[#FFD700]/5 to-transparent border-[#FFD700]/35',
  'bg-gradient-to-r from-[#C0C0C0]/12 to-transparent border-[#C0C0C0]/25',
  'bg-gradient-to-r from-[#CD7F32]/12 to-transparent border-[#CD7F32]/25',
];

const RANK_LABEL = ['1st', '2nd', '3rd'];

export function Leaderboard() {
  const leaderboard = useGameStore((s) => s.leaderboard);
  const setScreen = useGameStore((s) => s.setScreen);
  const signedInAs = localStorage.getItem('tunes_username');

  useEffect(() => {
    const socket = getSocket();
    socket.emit('get-leaderboard');
  }, []);

  return (
    <div className="flex flex-col items-center min-h-screen p-6 text-white">
      <div className="w-full max-w-lg">
        <button
          onClick={() => setScreen('home')}
          className="flex items-center gap-2 text-white/60 hover:text-white transition-colors mb-6"
        >
          <ArrowLeft className="w-5 h-5" />
          Back
        </button>

        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="flex items-center gap-3 mb-8"
        >
          <Trophy className="w-8 h-8 text-neon-amber" />
          <h1 className="font-heading text-3xl font-black tracking-tight">Leaderboard</h1>
        </motion.div>

        {leaderboard.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="panel text-center py-16 px-6"
          >
            <div className="text-6xl mb-3">🏆</div>
            <p className="text-white/60 text-lg font-heading">No games played yet</p>
            <p className="text-white/40 text-sm mt-1">
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
            <div className="grid grid-cols-[32px_1fr_48px_48px_56px_48px] gap-2 px-4 py-2 text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">
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
              const tint = rank <= 3 ? RANK_TINTS[rank - 1] : 'bg-white/[0.03] border-white/[0.06]';
              const userBorder = isCurrentUser
                ? 'border-l-4 border-l-neon-pink'
                : '';
              const showFlame = entry.bestStreak >= 2;

              return (
                <motion.div
                  key={entry.username}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.03 }}
                  className={`grid grid-cols-[32px_1fr_48px_48px_56px_48px] gap-2 items-center px-4 py-3 rounded-xl border ${tint} ${userBorder}`}
                >
                  <span className="flex items-center">
                    {rank <= 3 ? (
                      <span className={`text-[10px] font-bold uppercase ${rank === 1 ? 'text-[#FFD700]' : rank === 2 ? 'text-[#C0C0C0]' : 'text-[#CD7F32]'}`}>
                        {RANK_LABEL[rank - 1]}
                      </span>
                    ) : (
                      <span className="text-sm text-white/45 font-bold tabular-nums">{rank}</span>
                    )}
                  </span>
                  <span className="truncate flex items-center gap-1.5">
                    <span className={`font-semibold ${isCurrentUser ? 'text-neon-pink' : 'text-white'} truncate`}>
                      {entry.displayName}
                    </span>
                    {showFlame && <Flame className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />}
                  </span>
                  <span className="text-right text-sm font-bold text-white tabular-nums">{entry.totalWins}</span>
                  <span className="text-right text-sm text-white/60 tabular-nums">{entry.totalGames}</span>
                  <span className="text-right text-sm text-white/75 tabular-nums">
                    {(entry.winRate * 100).toFixed(0)}%
                  </span>
                  <span className="text-right text-sm text-white/60 tabular-nums">{entry.bestStreak}</span>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </div>
    </div>
  );
}
