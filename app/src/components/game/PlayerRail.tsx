import { useGameStore } from '../../store';

/** Player scores row in the top bar (team score in co-op). */
export function PlayerRail() {
  const myId = useGameStore((s) => s.myId);
  const players = useGameStore((s) => s.players);
  const currentTurnPlayerId = useGameStore((s) => s.currentTurnPlayerId);
  const settings = useGameStore((s) => s.settings);
  const sharedTimeline = useGameStore((s) => s.sharedTimeline);
  const turnOrder = useGameStore((s) => s.turnOrder);

  const playerList = turnOrder.length > 0
    ? turnOrder.map((id) => players[id]).filter(Boolean)
    : Object.values(players);
  const isCoop = settings.mode === 'coop';

  return (
    <div className="overflow-x-auto hide-scrollbar px-3 pb-1.5">
      <div className="flex gap-1.5 min-w-max mx-auto w-fit">
        {isCoop ? (
          <div className="flex items-center gap-2 bg-neon-cyan/10 border border-neon-cyan/30 rounded-xl px-4 py-1.5">
            <span className="font-display text-xl text-neon-cyan tabular-nums leading-none">
              {sharedTimeline.length}<span className="text-white/40 text-xs">/{settings.cardsToWin}</span>
            </span>
            <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/55">Team</span>
          </div>
        ) : (
          playerList.map((p) => (
            <div
              key={p.id}
              className={`score-pill ${p.id === currentTurnPlayerId ? 'is-active' : ''}`}
            >
              <span className="score-pill-name">
                {p.id === myId ? 'You' : p.name}
              </span>
              <span className="font-display tabular-nums text-white leading-none mt-0.5" style={{ fontSize: 16 }}>
                {p.timeline.length}<span className="text-white/40 text-[10px]">/{settings.cardsToWin}</span>
              </span>
              <span className="text-[10px] text-neon-amber font-bold tabular-nums leading-none" title="Tokens">
                ★ {p.tokens}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
