import type {
  GameSettings,
  GameStats,
  GameHistoryEntry,
  LeaderboardEntry,
  PlayedSong,
  Player,
  Room,
  RoundAction,
  CueAction,
  RoundReveal,
  MatchResult,
  PlaybackMode,
  SavedTable,
  SongCard,
  SongGuess,
} from './types';

export interface ClientToServerEvents {
  'create-room': (data: { playerName: string; spotifyAccessToken?: string; guestToken?: string; playbackMode?: PlaybackMode; packId?: string }) => void;
  'join-room': (data: { code: string; playerName: string; guestToken?: string }) => void;
  'rejoin-room': (data: { code: string; playerId: string; resumeToken: string }) => void;
  'leave-room': () => void;
  'update-settings': (settings: Partial<GameSettings> & { playbackMode?: PlaybackMode }) => void;
  'start-game': (data?: { spotifyAccessToken?: string }) => void;
  'place-card': (data: RoundAction & { position: number }) => void;
  'challenge': (data: RoundAction & { position: number }) => void;
  'pass-challenge': (data: RoundAction) => void;
  'name-song': (data: RoundAction & SongGuess) => void;
  'done-guessing': (data: RoundAction) => void;
  'play-anchor': (data: RoundAction & { index: number }) => void;
  'skip-anchors': (data: RoundAction) => void;
  'skip-song': (data: RoundAction) => void;
  'buy-card': (data: RoundAction) => void;
  'confirm-reveal': (data: RoundAction) => void;
  'end-match': (data: RoundAction) => void;
  'dinner-guess': (data: RoundAction & { position: number }) => void;
  'lock-guess': (data: RoundAction & { position?: number }) => void;
  'audio-ready': (data: CueAction) => void;
  'audio-interrupted': (data: CueAction) => void;
  'resume-audio': (data: CueAction) => void;
  'replace-song': (data: CueAction) => void;
  'assign-speaker': (data: RoundAction & { playerId: string }) => void;
  'rematch-consent': (data: RoundAction & { accept: boolean }) => void;
  'start-rematch': (data: { matchId: string }) => void;
  'flag-recording': (data: RoundAction) => void;
  'restart-game': () => void;
  'cancel-start': () => void;
  'buzz': () => void;
  'get-leaderboard': () => void;
  'get-my-stats': (data: { name?: string; guestToken?: string }) => void;
  'get-my-history': (data: { name?: string; guestToken?: string }) => void;
  'save-table': (data: { name?: string }) => void;
  'get-my-tables': (data: { guestToken?: string }) => void;
  'open-table': (data: { tableId: string; playerName: string; guestToken: string }) => void;
}

export interface ServerToClientEvents {
  'room-created': (data: { code: string; playerId: string; room: Room; resumeToken: string; guestToken: string }) => void;
  'room-joined': (data: { room: Room; playerId: string; resumeToken: string; guestToken?: string }) => void;
  'room-left': () => void;
  'player-joined': (player: Player) => void;
  'player-left': (playerId: string) => void;
  'settings-updated': (settings: GameSettings) => void;
  'game-started': (data: { gameState: Room['gameState']; anchorCards?: Record<string, SongCard> }) => void;
  'new-turn': (data: { turnPlayerId: string; songCard: Partial<SongCard> }) => void;
  'turn-started': (data: { turnPlayerId: string; turnDeadline: number }) => void;
  'play-song': (data: { spotifyTrackId: string; previewUrl?: string }) => void;
  'card-placed': (data: { playerId: string; position: number; challengeDeadline?: number }) => void;
  'challenge-made': (data: { challengerId: string; position?: number }) => void;
  'reveal': (data: RoundReveal) => void;
  'shared-timeline-updated': (data: { timeline: SongCard[] }) => void;
  'tokens-updated': (data: { playerId: string; tokens: number }) => void;
  'timeline-updated': (data: { playerId: string; timeline: SongCard[] }) => void;
  'song-named': (data: { playerId: string; correct: boolean; titleMatch?: boolean; artistMatch?: boolean }) => void;
  'game-over': (data: { winnerId: string; players: Record<string, Player>; result?: MatchResult }) => void;
  'resolving-tracks': () => void;
  'start-status': (data: { phase: 'preparing' | 'idle'; message?: string }) => void;
  'game-restarted': (data: { room: Room }) => void;
  'error': (data: { message: string; code?: string; action?: string }) => void;
  'server-config': (data: {
    previewSongsAvailable: boolean; dinnerAvailable?: boolean; licensedPacksAvailable?: boolean;
    licensedPacks?: { id: string; name: string; trackCount: number }[];
    revision?: string; protocolVersion?: number;
  }) => void;
  'state-sync': (room: Room) => void;
  'song-history': (data: { history: PlayedSong[] }) => void;
  'game-stats': (data: GameStats) => void;
  'player-disconnected': (data: { playerId: string; reconnectDeadline: number }) => void;
  'player-reconnected': (data: { playerId: string }) => void;
  'player-timed-out': (data: { playerId: string }) => void;
  'player-buzzed': (data: { playerId: string }) => void;
  'leaderboard': (data: { entries: LeaderboardEntry[] }) => void;
  'my-stats': (data: { stats: LeaderboardEntry | null }) => void;
  'my-history': (data: { games: GameHistoryEntry[] }) => void;
  'my-tables': (data: { tables: SavedTable[] }) => void;
  'table-saved': (data: { table: SavedTable }) => void;
}
