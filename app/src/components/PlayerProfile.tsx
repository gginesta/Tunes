import { useEffect } from 'react';
import { ArrowLeft, Trophy, Target, Flame, Swords, Music, BarChart3 } from 'lucide-react';
import { motion } from 'motion/react';
import { getSocket } from '../services/socket';
import { useGameStore } from '../store';

export function PlayerProfile() {
  const myStats = useGameStore((s) => s.myStats);
  const myHistory = useGameStore((s) => s.myHistory);
  const setScreen = useGameStore((s) => s.setScreen);

  useEffect(() => {
    const socket = getSocket();
    socket.emit('get-my-stats');
    socket.emit('get-my-history');
  }, []);

  return (
    <div className="flex flex-col items-center min-h-screen p-6 text-white bg-[#1a1a2e] bg-pattern">
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
          <BarChart3 className="w-8 h-8 text-[#1DB954]" />
          <h1 className="text-3xl font-black tracking-tight">My Stats</h1>
        </motion.div>

        {!myStats ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-16"
          >
            <BarChart3 className="w-16 h-16 text-gray-700 mx-auto mb-4" />
            <p className="text-gray-500 text-lg">No stats yet</p>
            <p className="text-gray-600 text-sm mt-1">
              Play some games while signed in to track your stats!
            </p>
          </motion.div>
        ) : (
          <>
            {/* Stats cards */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="grid grid-cols-2 gap-3 mb-8"
            >
              <StatCard
                icon={<Music className="w-5 h-5 text-[#1DB954]" />}
                label="Total Games"
                value={String(myStats.totalGames)}
              />
              <StatCard
                icon={<Trophy className="w-5 h-5 text-yellow-400" />}
                label="Wins"
                value={String(myStats.totalWins)}
              />
              <StatCard
                icon={<Target className="w-5 h-5 text-blue-400" />}
                label="Win Rate"
                value={`${(myStats.winRate * 100).toFixed(0)}%`}
              />
              <StatCard
                icon={<Flame className="w-5 h-5 text-orange-400" />}
                label="Best Streak"
                value={String(myStats.bestStreak)}
              />
              <StatCard
                icon={<Target className="w-5 h-5 text-emerald-400" />}
                label="Accuracy"
                value={
                  myStats.totalPlacements > 0
                    ? `${((myStats.totalCorrect / myStats.totalPlacements) * 100).toFixed(0)}%`
                    : '0%'
                }
              />
              <StatCard
                icon={<Swords className="w-5 h-5 text-purple-400" />}
                label="Challenges Won"
                value={String(myStats.totalChallengesWon)}
              />
            </motion.div>

            {/* Recent games */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <h2 className="text-lg font-bold mb-4 text-gray-300">Recent Games</h2>
              {myHistory.length === 0 ? (
                <p className="text-gray-600 text-sm text-center py-8">No game history yet</p>
              ) : (
                <div className="space-y-2">
                  {myHistory.map((game) => (
                    <div
                      key={game.id}
                      className={`flex items-center justify-between px-4 py-3 rounded-xl border ${
                        game.isWinner
                          ? 'bg-[#1DB954]/5 border-[#1DB954]/20'
                          : 'bg-white/[0.03] border-white/[0.05]'
                      }`}
                    >
                      <div className="flex flex-col">
                        <span className="text-sm text-gray-400">
                          {formatDate(game.playedAt)}
                        </span>
                        <span className="text-xs text-gray-600 capitalize">{game.mode}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-xs text-gray-500">
                          {game.cardsWon} cards
                        </span>
                        <span
                          className={`text-sm font-bold px-3 py-1 rounded-lg ${
                            game.isWinner
                              ? 'bg-[#1DB954]/20 text-[#1DB954]'
                              : 'bg-white/5 text-gray-400'
                          }`}
                        >
                          {game.isWinner ? 'Win' : 'Loss'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.05] rounded-xl p-4 flex flex-col items-center gap-2">
      {icon}
      <span className="text-2xl font-black text-white">{value}</span>
      <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">{label}</span>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}
