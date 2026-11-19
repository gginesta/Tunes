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
  /** Stable identity of the particular recording that is scored. */
  recordingId?: string;
  version?: string;
  source?: string;
  sourceUrl?: string;
  territories?: string[];
  recordingNote?: string;
  license?: string;
  licenseUrl?: string;
  /** Internal authorized clip route; exposed only to the active speaker. */
  audioUrl?: string;
  audioExpiresAt?: string;
  rightsUntil?: string;
}

export interface SongCard extends SongData {
  id: string;
  spotifyTrackId?: string;
  previewUrl?: string;
}

export type GameMode = 'original' | 'pro' | 'expert' | 'coop' | 'dinner';
export type GamePhase = 'lobby' | 'anchor_preview' | 'playing' | 'challenge' | 'reveal' | 'game_over';
export type SongPack = 'standard' | 'decades' | 'playlist' | 'genre' | 'genre-decade';
export type PlaybackMode = 'manual' | 'spotify' | 'preview' | 'licensed';

export interface GameSettings {
  mode: GameMode;
  cardsToWin: number;
  songPack: SongPack;
  decades?: number[];      // When songPack is 'decades': selected decade start years e.g. [1980, 1990]
  genres?: SongGenre[];    // When songPack is 'genre' or 'genre-decade': selected genres
  regions?: SongRegion[];  // Regional pack filter
  playlistUrl?: string;    // When songPack is 'playlist': Spotify playlist URL or ID
  dinnerRounds?: number;
  dedicatedDjId?: string;
  packId?: string;
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
  matchId?: string;
  roundId?: number;
  revision?: number;
  audio?: RoundAudio;
  timing?: { deadline: number | null; remainingMs: number | null };
  classic?: ClassicRoundView;
  dinner?: DinnerRoundView;
  reveal?: RoundReveal | null;
  finalReveal?: boolean;
  result?: MatchResult | null;
  history?: PlayedSong[];
  stats?: GameStats;
  rematchPlayerIds?: string[];
}

export interface Room {
  code: string;
  players: Record<string, Player>;
  hostId: string;
  /** Absent only on legacy rows where creator identity was never persisted. */
  originalHostId?: string;
  /** Persisted hosting choice; also migrates rooms created before client intent storage. */
  playbackMode?: PlaybackMode;
  speakerId?: string;
  expiresAt?: number;
  recovery?: 'restart-required';
  savedTableId?: string;
  startAvailability?: { playable: number; required: number; ready: boolean; issue?: string };
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

export interface RoundAction {
  matchId: string;
  roundId: number;
  actionId?: string;
}

export interface CueAction extends RoundAction {
  cueId: string;
}

export interface RoundAudio {
  kind: 'manual' | 'automatic';
  status: 'cueing' | 'awaiting_audio' | 'playing' | 'paused' | 'idle';
  cueId: string | null;
  operatorId: string | null;
  reason?: 'audio-unavailable' | 'all-away' | 'server-restart' | 'guesser-away';
  recording?: SongCard;
  source?: { url?: string; spotifyTrackId?: string };
}

export interface ClassicRoundView {
  eligibleChallengerIds: string[];
  respondedPlayerIds: string[];
  myNamed: boolean;
  myNamingDone: boolean;
  myNamingResult?: { correct: boolean; titleMatch: boolean; artistMatch: boolean };
  challengePositions: Record<string, number>;
}

export interface DinnerRoundView {
  roundCount: number;
  completedRounds: number;
  scores: Record<string, number>;
  eligiblePlayerIds: string[];
  submittedCount: number;
  myPosition: number | null;
  myLocked: boolean;
}

export interface RoundReveal {
  song: SongCard;
  correct: boolean;
  winnerId: string | null;
  stolenBy: string | null;
  position: number | null;
  correctPositions: number[];
  /** Timeline the guesses were made against, before any card was inserted. */
  timeline: SongCard[];
  modeResult?: { placementCorrect: boolean; songNamed: boolean; yearCorrect?: boolean; coopPenalty?: boolean };
  challengeResults?: Record<string, { position: number; correct: boolean }>;
  dinnerGuesses?: Record<string, { position: number | null; correct: boolean; points: number }>;
  flaggedBy?: string[];
}

export interface MatchResult {
  matchId: string;
  status: 'won' | 'tied' | 'lost' | 'abandoned';
  reason: 'target-reached' | 'deck-exhausted' | 'set-complete' | 'abandoned';
  winnerIds: string[];
  scores: Record<string, number>;
  margin: number | null;
  decidingSong: SongCard | null;
}

export interface SavedTable {
  id: string;
  name: string;
  currentRoomCode?: string;
  playedMatches: number;
  standings: { displayName: string; wins: number; matches: number }[];
  headToHead?: { firstName: string; secondName: string; matches: number; firstWins: number; secondWins: number }[];
}

// Song history (round recap)
export interface PlayedSong {
  song: SongCard;
  turnPlayerId: string;
  correct: boolean;
  stolenBy: string | null;
  roundNumber: number;
  flaggedBy?: string[];
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
  outcome?: MatchResult['status'];
}
