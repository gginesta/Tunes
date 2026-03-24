import type {
  GameSettings,
  Player,
  Room,
  SongCard,
  SongGuess,
} from './types';

export interface ClientToServerEvents {
  'create-room': (data: { playerName: string; spotifyAccessToken?: string }) => void;
  'join-room': (data: { code: string; playerName: string }) => void;
  'leave-room': () => void;
  'update-settings': (settings: Partial<GameSettings>) => void;
  'start-game': () => void;
  'place-card': (data: { position: number }) => void;
  'challenge': () => void;
  'name-song': (guess: SongGuess) => void;
  'skip-song': () => void;
  'buy-card': () => void;
  'confirm-reveal': () => void;
  'restart-game': () => void;
  'register': (data: { username: string; password: string; displayName: string }) => void;
  'login': (data: { username: string; password: string }) => void;
}

export interface ServerToClientEvents {
  'room-created': (data: { code: string; playerId: string; room: Room }) => void;
  'room-joined': (data: { room: Room; playerId: string }) => void;
  'player-joined': (player: Player) => void;
  'player-left': (playerId: string) => void;
  'settings-updated': (settings: GameSettings) => void;
  'game-started': (data: { gameState: Room['gameState'] }) => void;
  'new-turn': (data: { turnPlayerId: string; songCard: Partial<SongCard> }) => void;
  'play-song': (data: { spotifyTrackId: string; previewUrl?: string }) => void;
  'card-placed': (data: { playerId: string; position: number; challengeDeadline?: number }) => void;
  'challenge-made': (data: { challengerId: string }) => void;
  'reveal': (data: {
    song: SongCard;
    correct: boolean;
    winnerId: string | null;
    stolenBy: string | null;
    modeResult?: {
      placementCorrect: boolean;
      songNamed: boolean;
      yearCorrect?: boolean;
      coopPenalty?: boolean;
    };
  }) => void;
  'shared-timeline-updated': (data: { timeline: SongCard[] }) => void;
  'tokens-updated': (data: { playerId: string; tokens: number }) => void;
  'timeline-updated': (data: { playerId: string; timeline: SongCard[] }) => void;
  'song-named': (data: { playerId: string; correct: boolean }) => void;
  'game-over': (data: { winnerId: string; players: Record<string, Player> }) => void;
  'resolving-tracks': () => void;
  'game-restarted': (data: { room: Room }) => void;
  'error': (data: { message: string }) => void;
  'state-sync': (room: Room) => void;
  'auth-result': (data: { success: boolean; error?: string; displayName?: string }) => void;
}
