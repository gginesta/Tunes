import { AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useGameStore } from '../../store';

interface DisconnectBannersProps {
  countdowns: Record<string, number>;
}

/** Disconnected player banner(s) with reconnection countdowns. */
export function DisconnectBanners({ countdowns }: DisconnectBannersProps) {
  const players = useGameStore((s) => s.players);
  const currentTurnPlayerId = useGameStore((s) => s.currentTurnPlayerId);

  return (
    <AnimatePresence>
      {Object.entries(countdowns).map(([pid, secs]) => {
        const dcPlayer = players[pid];
        if (!dcPlayer) return null;
        const isTheirTurn = currentTurnPlayerId === pid;
        return (
          <motion.div
            key={`dc-${pid}`}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className={`border-b px-4 py-2.5 text-center text-sm font-bold ${
              isTheirTurn
                ? 'bg-neon-amber/20 border-neon-amber/40 text-neon-amber'
                : 'bg-neon-amber/10 border-neon-amber/25 text-neon-amber/85'
            }`}
          >
            <div className="flex items-center justify-center gap-2 animate-blink">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>
                {dcPlayer.name} disconnected{isTheirTurn ? ' (their turn)' : ''} — waiting {secs}s…
              </span>
            </div>
          </motion.div>
        );
      })}
    </AnimatePresence>
  );
}
