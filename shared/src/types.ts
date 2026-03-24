export interface SongData {
  title: string;
  artist: string;
  year: number;
}

export interface SongCard extends SongData {
  id: string;
  spotifyTrackId?: string;
}

export type GameMode = 'original' | 'pro' | 'expert' | 'coop';
export type GamePhase = 'lobby' | 'playing' | 'challenge' | 'reveal' | 'game_over';

export interface GameSettings {
  mode: GameMode;
  cardsToWin: number;
}

export interface Player {
  id: string;
  name: string;
  timeline: SongCard[];
  tokens: number;
  isHost: boolean;
  connected: boolean;
}

export interface GameState {
  phase: GamePhase;
  currentTurnPlayerId: string | null;
  currentSong: SongCard | null;
  pendingPlacement: number | null;
  challengers: string[];
  turnOrder: string[];
  turnIndex: number;
  deckSize: number;
}

export interface Room {
  code: string;
  players: Record<string, Player>;
  hostId: string;
  settings: GameSettings;
  gameState: GameState;
}

export interface PublicGameView {
  room: Room;
  myId: string;
}

export interface SongGuess {
  title: string;
  artist: string;
}
