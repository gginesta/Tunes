import { useEffect } from 'react';
import { ArrowLeft, BarChart3 } from 'lucide-react';
import { motion } from 'motion/react';
import { getSocket } from '../services/socket';
import { useGameStore } from '../store';

export function PlayerProfile() {
  const myStats = useGameStore((s) => s.myStats);
  const myHistory = useGameStore((s) => s.myHistory);
  const setScreen = useGameStore((s) => s.setScreen);
  const displayName = localStorage.getItem('tunes_display_name') || localStorage.getItem('tunes_username') || 'You';
  const monogram = displayName.charAt(0).toUpperCase();

  useEffect(() => {
    const socket = getSocket();
    socket.emit('get-my-stats');
    socket.emit('get-my-history');
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
          className="flex items-center gap-4 mb-8"
        >
          <div className="avatar avatar-lg">{monogram}</div>
          <div>
            <h2 className="font-heading text-2xl font-bold leading-tight">{displayName}</h2>
            <p className="text-xs text-white/45 tracking-[0.2em] mt-1 font-bold uppercase">My Stats</p>
          </div>
        </motion.div>

        {!myStats ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="panel text-center py-16 px-6"
          >
            <BarChart3 className="w-16 h-16 text-white/20 mx-auto mb-4" />
            <p className="text-white/60 text-lg font-heading">No stats yet</p>
            <p className="text-white/40 text-sm mt-1">
              Play some games while signed in to track your stats!
            </p>
          </motion.div>
        ) : (
          <>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="grid grid-cols-2 gap-3 mb-8"
            >
              <StatCard label="Games" value={String(myStats.totalGames)} color="cyan" />
              <StatCard label="Wins" value={String(myStats.totalWins)} color="pink" />
              <StatCard
                label="Win Rate"
                value={`${(myStats.winRate * 100).toFixed(0)}%`}
                color="cyan"
              />
              <StatCard label="Best Streak" value={String(myStats.bestStreak)} color="amber" />
              <StatCard
                label="Accuracy"
                value={
                  myStats.totalPlacements > 0
                    ? `${((myStats.totalCorrect / myStats.totalPlacements) * 100).toFixed(0)}%`
                    : '0%'
                }
                color="violet"
              />
              <StatCard label="Challenges Won" value={String(myStats.totalChallengesWon)} color="violet" />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <h2 className="text-[10px] tracking-[0.3em] font-bold mb-3 text-white/45 uppercase">Recent Games</h2>
              {myHistory.length === 0 ? (
                <p className="text-white/40 text-sm text-center py-8">No game history yet</p>
              ) : (
                <div className="space-y-2">
                  {myHistory.map((game) => (
                    <div
                      key={game.id}
                      className="panel flex items-center justify-between px-4 py-3"
                    >
                      <div className="flex flex-col">
                        <span className="text-sm text-white/75">
                          {formatDate(game.playedAt)}
                        </span>
                        <span className="text-xs text-white/40 capitalize">{game.mode}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-white/50 tabular-nums">
                          {game.cardsWon} cards
                        </span>
                        {game.isWinner ? (
                          <span className="px-3 py-1 rounded-lg bg-neon-pink text-[#0a0318] font-bold text-xs">
                            Win
                          </span>
                        ) : (
                          <span className="btn btn-ghost px-3 py-1 text-xs pointer-events-none">
                            Loss
                          </span>
                        )}
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

function StatCard({ label, value, color }: { label: string; value: string; color: 'pink' | 'cyan' | 'amber' | 'violet' }) {
  const colorClass = color === 'pink' ? 'text-neon-pink' : color === 'cyan' ? 'text-neon-cyan' : color === 'amber' ? 'text-neon-amber' : 'text-neon-violet';
  return (
    <div className="panel p-4 flex flex-col items-center gap-1.5">
      <span className={`font-display text-3xl tabular-nums ${colorClass}`}>{value}</span>
      <span className="text-[10px] text-white/45 font-bold uppercase tracking-[0.2em]">{label}</span>
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
