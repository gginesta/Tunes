import { Check, AlertTriangle } from 'lucide-react';
import { motion } from 'motion/react';
import { CHALLENGE_COST } from '@tunes/shared';
import { useGameStore } from '../../store';

interface ChallengeBarProps {
  challengePosition: number | null;
  noChallengeClicked: boolean;
  onChallenge: () => void;
  onNoChallenge: () => void;
}

/** Challenge phase actions and status messages. */
export function ChallengeBar({
  challengePosition,
  noChallengeClicked,
  onChallenge,
  onNoChallenge,
}: ChallengeBarProps) {
  const myId = useGameStore((s) => s.myId);
  const players = useGameStore((s) => s.players);
  const currentTurnPlayerId = useGameStore((s) => s.currentTurnPlayerId);
  const phase = useGameStore((s) => s.phase);
  const challengers = useGameStore((s) => s.challengers);
  const settings = useGameStore((s) => s.settings);

  const isMyTurn = currentTurnPlayerId === myId;
  const me = players[myId];
  const activePlayer = currentTurnPlayerId ? players[currentTurnPlayerId] : null;
  const isCoop = settings.mode === 'coop';

  if (!me || !activePlayer) return null;

  return (
    <>
      {/* Challenge / No Challenge buttons for non-active players */}
      {!isMyTurn && phase === 'challenge' && !isCoop && !challengers.includes(myId) && !noChallengeClicked && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-5 text-center w-full max-w-sm"
        >
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5 mb-3">
            <p className="text-red-300 font-bold text-sm">
              {activePlayer.name} placed the card. Think it's wrong?
            </p>
            <p className="text-[11px] text-red-200/70 mt-0.5">
              Pick where YOU think it belongs, then challenge.
            </p>
          </div>
          <div className="flex gap-3 justify-center">
            <button
              onClick={onChallenge}
              disabled={me.tokens < CHALLENGE_COST || challengePosition === null}
              className="btn btn-danger flex-1"
            >
              <AlertTriangle className="w-5 h-5" />
              {challengePosition !== null ? `Challenge! (${CHALLENGE_COST}★)` : 'Pick a position'}
            </button>
            <button
              onClick={onNoChallenge}
              className="btn btn-ghost flex-1"
            >
              <Check className="w-5 h-5" />
              Looks Good
            </button>
          </div>
        </motion.div>
      )}

      {!isMyTurn && phase === 'challenge' && !isCoop && challengers.includes(myId) && (
        <p className="mt-5 text-neon-cyan font-bold flex items-center gap-2"><Check className="w-4 h-4" />Challenge submitted!</p>
      )}

      {!isMyTurn && phase === 'challenge' && !isCoop && noChallengeClicked && !challengers.includes(myId) && (
        <p className="mt-5 text-white/40 font-medium">No challenge — waiting for timer…</p>
      )}

      {/* Active player sees countdown too during challenge */}
      {isMyTurn && phase === 'challenge' && !isCoop && (
        <p className="mt-5 text-white/55 font-medium">
          Waiting for challenges…
        </p>
      )}

      {/* Challengers display */}
      {!isCoop && challengers.length > 0 && phase === 'challenge' && (
        <div className="mt-4 text-sm text-white/55">
          Challengers: {challengers.map((id) => players[id]?.name || 'Unknown').join(', ')}
        </div>
      )}
    </>
  );
}
