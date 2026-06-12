import { useEffect, useRef } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { motion } from 'motion/react';
import type { SongCard } from '@tunes/shared';
import { useGameStore } from '../../store';
import { getDecadeClass } from './decade';

interface TimelineStripProps {
  viewingOwnTimeline: boolean;
  onToggleView: () => void;
  selectedPosition: number | null;
  onSelectPosition: (i: number) => void;
  challengePosition: number | null;
  onSelectChallengePosition: (i: number) => void;
  noChallengeClicked: boolean;
}

/** Timeline header + scrollable card strip with placement / challenge drop zones. */
export function TimelineStrip({
  viewingOwnTimeline,
  onToggleView,
  selectedPosition,
  onSelectPosition,
  challengePosition,
  onSelectChallengePosition,
  noChallengeClicked,
}: TimelineStripProps) {
  const myId = useGameStore((s) => s.myId);
  const players = useGameStore((s) => s.players);
  const currentTurnPlayerId = useGameStore((s) => s.currentTurnPlayerId);
  const phase = useGameStore((s) => s.phase);
  const challengers = useGameStore((s) => s.challengers);
  const settings = useGameStore((s) => s.settings);
  const sharedTimeline = useGameStore((s) => s.sharedTimeline);
  const pendingPlacement = useGameStore((s) => s.pendingPlacement);

  const isMyTurn = currentTurnPlayerId === myId;
  const me = players[myId];
  const activePlayer = currentTurnPlayerId ? players[currentTurnPlayerId] : null;
  const isCoop = settings.mode === 'coop';

  // Timeline scroll ref for auto-scroll
  const timelineRef = useRef<HTMLDivElement>(null);

  // Auto-scroll timeline when a card is placed or a position is selected
  useEffect(() => {
    const container = timelineRef.current;
    if (!container) return;
    const targetPos = pendingPlacement ?? selectedPosition ?? challengePosition;
    if (targetPos === null) return;
    const cardWidth = 120;
    const scrollTarget = targetPos * cardWidth - container.clientWidth / 2 + cardWidth / 2;
    container.scrollTo({ left: Math.max(0, scrollTarget), behavior: 'smooth' });
  }, [pendingPlacement, selectedPosition, challengePosition]);

  if (!me || !activePlayer) return null;

  // Timeline to display:
  // - Co-op: shared timeline always
  // - Your turn: your own timeline (to place cards)
  // - Not your turn: active player's timeline by default, togglable to your own
  const displayTimeline = isCoop
    ? sharedTimeline
    : isMyTurn
      ? me.timeline
      : viewingOwnTimeline
        ? me.timeline
        : activePlayer.timeline;

  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold text-white/75 uppercase tracking-widest text-xs">
          {isCoop
            ? 'Team Timeline'
            : isMyTurn
              ? 'Your Timeline'
              : viewingOwnTimeline
                ? 'Your Timeline'
                : `${activePlayer.name}'s Timeline`}
        </h3>
        {!isMyTurn && !isCoop && phase !== 'reveal' && (
          <button
            onClick={onToggleView}
            className="flex items-center gap-1.5 text-xs font-bold text-white/55 hover:text-white bg-white/5 hover:bg-white/10 px-2.5 py-1 rounded-lg transition-colors"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            {viewingOwnTimeline ? 'Show Theirs' : 'Show Mine'}
          </button>
        )}
      </div>

      {/* Timeline */}
      {(() => {
        const showPlacementDropZones = isMyTurn && phase === 'playing';
        const showChallengeDropZones = !isMyTurn && phase === 'challenge' && !isCoop && !challengers.includes(myId) && !noChallengeClicked && !viewingOwnTimeline;
        const showDropZones = showPlacementDropZones || showChallengeDropZones;
        const dropSelection = showPlacementDropZones ? selectedPosition : challengePosition;
        const dropOnClick = showPlacementDropZones
          ? (i: number) => onSelectPosition(i)
          : (i: number) => {
              // Don't allow challenging at the same position as the active player's placement
              if (pendingPlacement !== null && i === pendingPlacement) return;
              onSelectChallengePosition(i);
            };

        // During challenge, hide the drop zone at the active player's placement position
        const isBlockedPosition = (i: number) => showChallengeDropZones && pendingPlacement !== null && i === pendingPlacement;

        return (
          <div ref={timelineRef} className="flex overflow-x-auto pb-3 hide-scrollbar scroll-fade-x items-center min-h-[140px]">
            {showDropZones && !isBlockedPosition(0) && (
              <DropZone
                index={0}
                selected={dropSelection === 0}
                onClick={() => dropOnClick(0)}
                challenge={showChallengeDropZones}
              />
            )}

            {/* Show pending placement indicator at position 0 */}
            {phase === 'challenge' && pendingPlacement === 0 && <PendingCard />}

            {displayTimeline.map((card, idx) => (
              <div key={card.id} className="flex items-center">
                <TimelineCard card={card} />
                {showDropZones && !isBlockedPosition(idx + 1) && (
                  <DropZone
                    index={idx + 1}
                    selected={dropSelection === idx + 1}
                    onClick={() => dropOnClick(idx + 1)}
                    challenge={showChallengeDropZones}
                  />
                )}
                {/* Show pending placement indicator after this card */}
                {phase === 'challenge' && pendingPlacement === idx + 1 && <PendingCard />}
              </div>
            ))}

            {displayTimeline.length === 0 && !showDropZones && phase !== 'challenge' && (
              <p className="text-white/40 text-sm italic mx-auto">No cards yet</p>
            )}
          </div>
        );
      })()}
    </>
  );
}

function TimelineCard({ card }: { card: SongCard }) {
  const decade = getDecadeClass(card.year);
  const yearShort = `'${String(card.year).slice(-2)}`;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.85, y: -15 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      className={`sleeve ${decade}`}
    >
      <div className="sleeve-shade" />
      <div className="sleeve-inner">
        <span className="font-chunky text-2xl text-neon-amber leading-none drop-shadow-md">{yearShort}</span>
        <div className="text-white">
          <p className="text-[11px] font-bold leading-snug line-clamp-2 drop-shadow-sm">
            {card.title}
          </p>
          <p className="text-[10px] text-white/60 truncate mt-0.5">{card.artist}</p>
        </div>
      </div>
    </motion.div>
  );
}

function PendingCard() {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      className="drop-pending"
    >
      <span className="font-chunky text-4xl text-neon-amber">?</span>
      <span className="text-[10px] font-bold text-neon-amber/70 mt-1 uppercase tracking-wider">Placed here</span>
    </motion.div>
  );
}

function DropZone({
  index,
  selected,
  onClick,
  challenge,
}: {
  index: number;
  selected: boolean;
  onClick: () => void;
  challenge?: boolean;
}) {
  void index;
  const cls = challenge
    ? `drop drop-challenge ${selected ? 'drop-selected' : ''}`
    : `drop drop-cyan ${selected ? 'drop-selected' : ''}`;
  return (
    <motion.button
      layout
      onClick={onClick}
      whileTap={{ scale: 0.92 }}
      className={cls}
    >
      +
    </motion.button>
  );
}
