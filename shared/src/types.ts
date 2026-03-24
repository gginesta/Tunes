export interface SongData {
  title: string;
  artist: string;
  year: number;
}

export interface SongCard extends SongData {
  id: string;
  spotifyTrackId?: string;
  previewUrl?: string;
}

export type GameMode = 'original' | 'pro' | 'expert' | 'coop';
export type GamePhase = 'lobby' | 'playing' | 'challenge' | 'reveal' | 'game_over';
export type SongPack = 'standard' | 'decades' | 'playlist';

export interface GameSettings {
  mode: GameMode;
  cardsToWin: number;
  songPack: SongPack;
  decades?: number[];      // When songPack is 'decades': selected decade start years e.g. [1980, 1990]
  playlistUrl?: string;    // When songPack is 'playlist': Spotify playlist URL or ID
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
  sharedTimeline: SongCard[];
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
  year?: number;
}
