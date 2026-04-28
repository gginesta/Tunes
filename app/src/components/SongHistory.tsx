import { X, Check, ArrowRightLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useGameStore } from '../store';

interface SongHistoryProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SongHistory({ isOpen, onClose }: SongHistoryProps) {
  const songHistory = useGameStore((s) => s.songHistory);
  const players = useGameStore((s) => s.players);
  const finalPlayers = useGameStore((s) => s.finalPlayers);

  const allPlayers = Object.keys(finalPlayers).length > 0 ? finalPlayers : players;
  const getPlayerName = (id: string) => allPlayers[id]?.name ?? 'Unknown';
  const reversedHistory = [...songHistory].reverse();

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50"
            onClick={onClose}
          />

          {/* Bottom sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed inset-x-0 bottom-0 top-12 z-50 flex flex-col shadow-2xl"
            style={{
              borderTopLeftRadius: 'var(--radius-3xl)',
              borderTopRightRadius: 'var(--radius-3xl)',
              background: 'var(--color-bg-elev-2)',
              borderTop: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            {/* Drag pill */}
            <div className="flex justify-center pt-2 pb-1">
              <span className="block w-10 h-1.5 rounded-full bg-white/15" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 flex-shrink-0">
              <h2 className="font-heading text-lg font-bold text-white">Song History</h2>
              <button
                onClick={onClose}
                className="btn-icon"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Song list */}
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
              {reversedHistory.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-white/45 text-sm">
                  No songs played yet
                </div>
              ) : (
                reversedHistory.map((entry, idx) => (
                  <motion.div
                    key={`${entry.roundNumber}-${entry.song.id}`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.04] border border-white/[0.06]"
                  >
                    {/* Round chip */}
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-neon-pink/15 border border-neon-pink/30 flex items-center justify-center">
                      <span className="text-xs font-bold text-neon-pink tabular-nums">
                        {entry.roundNumber}
                      </span>
                    </div>

                    {/* Song info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-white truncate">
                        {entry.song.title}
                      </p>
                      <p className="text-xs text-white/55 truncate">
                        {entry.song.artist} · {entry.song.year}
                      </p>
                      <p className="text-[11px] text-white/40 mt-0.5">
                        {getPlayerName(entry.turnPlayerId)}
                        {entry.stolenBy && (
                          <span className="inline-flex items-center gap-1 ml-2 text-red-400">
                            <ArrowRightLeft className="w-3 h-3" />
                            Stolen by {getPlayerName(entry.stolenBy)}
                          </span>
                        )}
                      </p>
                    </div>

                    {/* Correct / Wrong pill */}
                    <div className="flex-shrink-0">
                      {entry.correct ? (
                        <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-green-500/20 text-green-400 border border-green-500/30">
                          <Check className="w-3 h-3" />
                          <span className="text-[10px] font-bold uppercase">Correct</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">
                          <X className="w-3 h-3" />
                          <span className="text-[10px] font-bold uppercase">Wrong</span>
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
