import { Clock, Square } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useGameStore } from '../../store';
import type { GameMode } from '@tunes/shared';
import { PlayerRail } from './PlayerRail';

const MODE_LABELS: Record<GameMode, string> = {
  original: 'Original',
  pro: 'Pro',
  expert: 'Expert',
  coop: 'Co-op',
};

const MODE_CHIP_CLASS: Record<GameMode, string> = {
  original: 'chip chip-mode-original',
  pro: 'chip chip-mode-pro',
  expert: 'chip chip-mode-expert',
  coop: 'chip chip-mode-coop',
};

interface GameTopBarProps {
  volume: number;
  VolumeIcon: LucideIcon;
  onToggleMute: () => void;
  onShowHistory: () => void;
  onStopGame: () => void;
}

/** Top bar: turn info + controls (row 1) and player scores (row 2). */
export function GameTopBar({ volume, VolumeIcon, onToggleMute, onShowHistory, onStopGame }: GameTopBarProps) {
  const myId = useGameStore((s) => s.myId);
  const hostId = useGameStore((s) => s.hostId);
  const players = useGameStore((s) => s.players);
  const currentTurnPlayerId = useGameStore((s) => s.currentTurnPlayerId);
  const deckSize = useGameStore((s) => s.deckSize);
  const settings = useGameStore((s) => s.settings);

  const isHost = myId === hostId;
  const isMyTurn = currentTurnPlayerId === myId;
  const activePlayer = currentTurnPlayerId ? players[currentTurnPlayerId] : null;
  const mode = settings.mode;

  if (!activePlayer) return null;

  return (
    <div className="bg-black/40 border-b border-white/[0.06] z-10 backdrop-blur-sm">
      <div className="flex justify-between items-center px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="eq flex-shrink-0"><i /><i /><i /><i /><i /></span>
          <p className="font-chunky text-neon-pink text-sm truncate text-glow-pink">
            {isMyTurn ? 'YOUR TURN' : `${activePlayer.name.toUpperCase()}'S TURN`}
          </p>
          <span className={`${MODE_CHIP_CLASS[mode]} flex-shrink-0`}>
            {MODE_LABELS[mode]}
          </span>
          <span className="text-[10px] text-white/40 flex-shrink-0 tabular-nums uppercase tracking-wider">{deckSize} left</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onShowHistory}
            className="btn-icon"
            title="Song History"
            aria-label="Song History"
          >
            <Clock className="w-4 h-4" />
          </button>
          <button
            onClick={onToggleMute}
            className="btn-icon"
            title={volume > 0 ? 'Mute' : 'Unmute'}
            aria-label="Toggle mute"
            aria-pressed={volume === 0}
          >
            <VolumeIcon className="w-4 h-4" />
          </button>
          {isHost && (
            <button
              onClick={onStopGame}
              className="btn-icon text-red-400 border-red-500/30 bg-red-500/10 hover:bg-red-500/20"
              title="Stop Game"
              aria-label="Stop Game"
            >
              <Square className="w-3.5 h-3.5" fill="currentColor" />
            </button>
          )}
        </div>
      </div>

      {/* Row 2: Player scores */}
      <PlayerRail />
    </div>
  );
}
