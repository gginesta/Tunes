import { motion, AnimatePresence } from 'motion/react';
import { getSocket } from '../../services/socket';
import { useGameStore } from '../../store';
import { getDecadeClass } from './decade';

/** Anchor card dealing animation shown when starting cards are dealt. */
export function AnchorCardsOverlay() {
  const anchorCards = useGameStore((s) => s.anchorCards);
  const players = useGameStore((s) => s.players);
  const myId = useGameStore((s) => s.myId);
  const hostId = useGameStore((s) => s.hostId);
  const isHost = myId === hostId;

  return (
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
            className="font-heading text-xl font-bold text-white mb-2"
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
              const decade = getDecadeClass(card.year);
              const yearShort = `'${String(card.year).slice(-2)}`;
              return (
                <motion.div
                  key={key}
                  initial={{ scale: 0, rotateY: 180, opacity: 0 }}
                  animate={{ scale: 1, rotateY: 0, opacity: 1 }}
                  transition={{ delay: 0.3 + i * 0.3, type: 'spring', stiffness: 200, damping: 20 }}
                  className={`sleeve ${decade}`}
                >
                  <div className="sleeve-shade" />
                  <div className="sleeve-inner">
                    <span className="font-chunky text-2xl text-neon-amber leading-none drop-shadow-md">{yearShort}</span>
                    <div className="text-white">
                      <p className="text-[9px] uppercase tracking-[0.2em] font-bold text-white/70 mb-0.5">{label}</p>
                      <p className="text-[11px] font-bold leading-snug line-clamp-2 drop-shadow-sm">{card.title}</p>
                      <p className="text-[10px] text-white/60 truncate mt-0.5">{card.artist}</p>
                    </div>
                  </div>
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
              className="btn btn-ghost mt-4"
            >
              Skip
            </motion.button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
