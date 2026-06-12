import { motion } from 'motion/react';
import { useGameStore } from '../../store';

interface RevealActionsProps {
  onContinue: () => void;
}

/** Reveal phase: challenge result feedback + Continue button. */
export function RevealActions({ onContinue }: RevealActionsProps) {
  const myId = useGameStore((s) => s.myId);
  const players = useGameStore((s) => s.players);
  const phase = useGameStore((s) => s.phase);
  const lastReveal = useGameStore((s) => s.lastReveal);
  const challengers = useGameStore((s) => s.challengers);

  return (
    <>
      {/* Challenge result feedback — based on outcome, not position validity */}
      {phase === 'reveal' && lastReveal && challengers.includes(myId) && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`mt-4 px-5 py-2.5 rounded-xl text-sm font-bold border ${
            lastReveal.stolenBy === myId
              ? 'bg-green-500/20 text-green-400 border-green-500/30'
              : 'bg-red-500/20 text-red-400 border-red-500/30'
          }`}
        >
          {lastReveal.stolenBy === myId
            ? 'You stole the card!'
            : lastReveal.correct
              ? 'Placement was correct — you lost your challenge token'
              : lastReveal.stolenBy
                ? `${players[lastReveal.stolenBy]?.name || 'Another challenger'} stole the card`
                : 'Wrong placement, but no one had the right spot — card discarded'}
        </motion.div>
      )}

      {/* Reveal: Continue button */}
      {phase === 'reveal' && (
        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={onContinue}
          className="btn btn-primary btn-lg mt-6"
        >
          Continue
        </motion.button>
      )}
    </>
  );
}
