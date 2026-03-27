export type SongGenre = 'rock' | 'pop' | 'hip-hop' | 'r-and-b' | 'country' | 'electronic' | 'jazz' | 'classical' | 'latin' | 'other';
export type SongRegion = 'global' | 'uk' | 'latin' | 'kpop' | 'bollywood';

export interface SongData {
  title: string;
  artist: string;
  year: number;
  genre?: SongGenre;
  region?: SongRegion;
  /** Pre-baked from scripts/prebake-previews.ts; null means "attempted but unavailable" */
  previewUrl?: string | null;
  /** Pre-baked from scripts/prebake-previews.ts; null means "attempted but not found" */
  spotifyTrackId?: string | null;
  albumArtUrl?: string;
}

export interface SongCard extends SongData {
  id: string;
  spotifyTrackId?: string;
  previewUrl?: string;
}

export type GameMode = 'original' | 'pro' | 'expert' | 'coop';
export type GamePhase = 'lobby' | 'playing' | 'challenge' | 'reveal' | 'game_over';
export type SongPack = 'standard' | 'decades' | 'playlist' | 'genre' | 'genre-decade';

export interface GameSettings {
  mode: GameMode;
  cardsToWin: number;
  songPack: SongPack;
  decades?: number[];      // When songPack is 'decades': selected decade start years e.g. [1980, 1990]
  genres?: SongGenre[];    // When songPack is 'genre' or 'genre-decade': selected genres
  regions?: SongRegion[];  // Regional pack filter
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

// Song history (round recap)
export interface PlayedSong {
  song: SongCard;
  turnPlayerId: string;
  correct: boolean;
  stolenBy: string | null;
  roundNumber: number;
}

// End-of-game stats
export interface PlayerStats {
  correctPlacements: number;
  totalPlacements: number;
  challengesWon: number;
  challengesLost: number;
  longestStreak: number;
  currentStreak: number;
  fastestPlacementMs: number | null;
  decadeAccuracy: Record<number, { correct: number; total: number }>;
  songsNamed: number;
}

export interface GameStats {
  playerStats: Record<string, PlayerStats>;
  totalRounds: number;
}

export interface LeaderboardEntry {
  username: string;
  displayName: string;
  totalGames: number;
  totalWins: number;
  totalCorrect: number;
  totalPlacements: number;
  bestStreak: number;
  totalChallengesWon: number;
  totalSongsNamed: number;
  bestFastestMs: number | null;
  winRate: number;
}

export interface GameHistoryEntry {
  id: number;
  roomCode: string;
  mode: string;
  playerCount: number;
  totalRounds: number;
  playedAt: string;
  isWinner: boolean;
  cardsWon: number;
  correctPlacements: number;
  totalPlacements: number;
}
