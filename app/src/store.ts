import { create } from 'zustand';
import type {
  GamePhase,
  GameSettings,
  GameStats,
  GameHistoryEntry,
  LeaderboardEntry,
  PlayedSong,
  Player,
  SongCard,
  Room,
} from '@hitster/shared';

export type Screen = 'home' | 'lobby' | 'game' | 'results' | 'rules' | 'leaderboard' | 'profile';

interface ModeResult {
  placementCorrect: boolean;
  songNamed: boolean;
  yearCorrect?: boolean;
  coopPenalty?: boolean;
}

interface RevealData {
  song: SongCard;
  correct: boolean;
  winnerId: string | null;
  stolenBy: string | null;
  modeResult?: ModeResult;
  challengeResults?: Record<string, { position: number; correct: boolean }>;
}

interface GameStore {
  // Connection
  screen: Screen;
  myId: string;
  roomCode: string;
  connected: boolean;
  error: string | null;
  pendingJoinCode: string | null;

  // Room
  players: Record<string, Player>;
  hostId: string;
  settings: GameSettings;

  // Game
  phase: GamePhase;
  currentTurnPlayerId: string | null;
  currentSong: Partial<SongCard> | null;
  pendingPlacement: number | null;
  challengers: string[];
  deckSize: number;

  // Shared timeline (co-op)
  sharedTimeline: SongCard[];

  // Reveal
  lastReveal: RevealData | null;
  songNameResult: { playerId: string; correct: boolean } | null;

  // Challenge
  challengeDeadline: number | null;

  // Turn timer
  turnDeadline: number | null;

  // Audio
  volume: number;

  // Spotify
  spotifyToken: string | null;
  spotifyRefreshToken: string | null;
  spotifyDeviceId: string | null;
  spotifyReady: boolean;
  spotifyError: string | null;
  isPlaying: boolean;
  autoplayBlocked: boolean;
  currentTrackId: string | null;
  currentPreviewUrl: string | null;


  // Trivia
  triviaScore: { correct: number; total: number };

  // Buzz
  buzzedPlayers: string[];
  // Disconnect grace period
  disconnectedPlayers: Record<string, number>; // playerId → reconnectDeadline timestamp

  // Winner
  winnerId: string | null;
  finalPlayers: Record<string, Player>;

  // End-of-game stats
  gameStats: GameStats | null;

  // Song history
  songHistory: PlayedSong[];

  // Leaderboard & stats
  leaderboard: LeaderboardEntry[];
  myStats: LeaderboardEntry | null;
  myHistory: GameHistoryEntry[];

  // Actions
  setScreen: (screen: Screen) => void;
  setMyId: (id: string) => void;
  setRoomCode: (code: string) => void;
  setConnected: (connected: boolean) => void;
  setError: (error: string | null) => void;
  setPendingJoinCode: (code: string | null) => void;
  setPlayers: (players: Record<string, Player>) => void;
  setHostId: (hostId: string) => void;
  setSettings: (settings: GameSettings) => void;
  setPhase: (phase: GamePhase) => void;
  setCurrentTurnPlayerId: (id: string | null) => void;
  setCurrentSong: (song: Partial<SongCard> | null) => void;
  setPendingPlacement: (pos: number | null) => void;
  addChallenger: (id: string) => void;
  setDeckSize: (size: number) => void;
  setSharedTimeline: (timeline: SongCard[]) => void;
  setLastReveal: (reveal: RevealData | null) => void;
  setSongNameResult: (playerId: string, correct: boolean) => void;
  setWinner: (winnerId: string, players: Record<string, Player>) => void;
  updatePlayerTokens: (playerId: string, tokens: number) => void;
  updatePlayerTimeline: (playerId: string, timeline: SongCard[]) => void;
  addPlayer: (player: Player) => void;
  removePlayer: (playerId: string) => void;
  setVolume: (v: number) => void;
  setSpotifyToken: (token: string | null) => void;
  setSpotifyRefreshToken: (token: string | null) => void;
  setSpotifyDeviceId: (id: string | null) => void;
  setSpotifyReady: (ready: boolean) => void;
  setSpotifyError: (error: string | null) => void;
  setIsPlaying: (playing: boolean) => void;
  setCurrentTrackId: (trackId: string | null, previewUrl?: string | null) => void;
  setPlayerDisconnected: (playerId: string, deadline: number) => void;
  setPlayerReconnected: (playerId: string) => void;
  setPlayerTimedOut: (playerId: string) => void;
  setGameStats: (stats: GameStats) => void;
  setSongHistory: (history: PlayedSong[]) => void;
  addBuzzedPlayer: (id: string) => void;
  clearBuzzedPlayers: () => void;
  addTriviaAnswer: (correct: boolean) => void;
  setLeaderboard: (entries: LeaderboardEntry[]) => void;
  setMyStats: (stats: LeaderboardEntry | null) => void;
  setMyHistory: (games: GameHistoryEntry[]) => void;
  syncRoom: (room: Room) => void;
  reset: () => void;
}

const initialState = {
  screen: 'home' as Screen,
  myId: '',
  roomCode: '',
  connected: false,
  error: null,
  pendingJoinCode: null,
  players: {} as Record<string, Player>,
  hostId: '',
  settings: { mode: 'original' as const, cardsToWin: 10, songPack: 'standard' as const },
  phase: 'lobby' as GamePhase,
  currentTurnPlayerId: null,
  currentSong: null,
  pendingPlacement: null,
  challengers: [],
  deckSize: 0,
  sharedTimeline: [] as SongCard[],
  challengeDeadline: null as number | null,
  turnDeadline: null as number | null,
  volume: (() => {
    const stored = localStorage.getItem('hitster-volume');
    if (stored !== null) {
      const v = parseFloat(stored);
      if (!isNaN(v) && v >= 0 && v <= 1) return v;
    }
    return 0.8;
  })(),
  spotifyToken: null as string | null,
  spotifyRefreshToken: null as string | null,
  spotifyDeviceId: null as string | null,
  spotifyReady: false,
  spotifyError: null as string | null,
  isPlaying: false,
  autoplayBlocked: false,
  currentTrackId: null as string | null,
  currentPreviewUrl: null as string | null,
  triviaScore: { correct: 0, total: 0 },
  buzzedPlayers: [] as string[],
  disconnectedPlayers: {} as Record<string, number>,
  lastReveal: null,
  songNameResult: null,
  winnerId: null,
  finalPlayers: {} as Record<string, Player>,
  gameStats: null as GameStats | null,
  songHistory: [] as PlayedSong[],
  leaderboard: [] as LeaderboardEntry[],
  myStats: null as LeaderboardEntry | null,
  myHistory: [] as GameHistoryEntry[],
};

export const useGameStore = create<GameStore>((set) => ({
  ...initialState,

  setScreen: (screen) => set({ screen }),
  setMyId: (myId) => set({ myId }),
  setRoomCode: (roomCode) => set({ roomCode }),
  setConnected: (connected) => set({ connected }),
  setError: (error) => set({ error }),
  setPendingJoinCode: (pendingJoinCode) => set({ pendingJoinCode }),
  setPlayers: (players) => set({ players }),
  setHostId: (hostId) => set({ hostId }),
  setSettings: (settings) => set({ settings }),
  setPhase: (phase) => set({ phase }),
  setCurrentTurnPlayerId: (currentTurnPlayerId) => set({ currentTurnPlayerId }),
  setCurrentSong: (currentSong) => set({ currentSong }),
  setPendingPlacement: (pendingPlacement) => set({ pendingPlacement }),
  addChallenger: (id) => set((s) => ({ challengers: [...s.challengers, id] })),
  setDeckSize: (deckSize) => set({ deckSize }),
  setSharedTimeline: (sharedTimeline) => set({ sharedTimeline }),
  setLastReveal: (lastReveal) => set({ lastReveal }),
  setSongNameResult: (playerId, correct) => set({ songNameResult: { playerId, correct } }),
  setWinner: (winnerId, players) => set({ winnerId, finalPlayers: players }),
  updatePlayerTokens: (playerId, tokens) =>
    set((s) => ({
      players: {
        ...s.players,
        [playerId]: { ...s.players[playerId], tokens },
      },
    })),
  updatePlayerTimeline: (playerId, timeline) =>
    set((s) => ({
      players: {
        ...s.players,
        [playerId]: { ...s.players[playerId], timeline },
      },
    })),
  addPlayer: (player) =>
    set((s) => ({
      players: { ...s.players, [player.id]: player },
    })),
  removePlayer: (playerId) =>
    set((s) => {
      const { [playerId]: _, ...rest } = s.players;
      return { players: rest };
    }),
  setVolume: (v) => {
    const volume = Math.max(0, Math.min(1, v));
    localStorage.setItem('hitster-volume', String(volume));
    set({ volume });
  },
  setSpotifyToken: (spotifyToken) => set({ spotifyToken }),
  setSpotifyRefreshToken: (spotifyRefreshToken) => set({ spotifyRefreshToken }),
  setSpotifyDeviceId: (spotifyDeviceId) => set({ spotifyDeviceId }),
  setSpotifyReady: (spotifyReady) => set({ spotifyReady }),
  setSpotifyError: (spotifyError) => set({ spotifyError }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setCurrentTrackId: (currentTrackId, previewUrl) => set({ currentTrackId, currentPreviewUrl: previewUrl ?? null }),
  setPlayerDisconnected: (playerId, deadline) =>
    set((s) => ({
      disconnectedPlayers: { ...s.disconnectedPlayers, [playerId]: deadline },
    })),
  setPlayerReconnected: (playerId) =>
    set((s) => {
      const { [playerId]: _, ...rest } = s.disconnectedPlayers;
      return { disconnectedPlayers: rest };
    }),
  setPlayerTimedOut: (playerId) =>
    set((s) => {
      const { [playerId]: _, ...rest } = s.disconnectedPlayers;
      return { disconnectedPlayers: rest };
    }),
  setGameStats: (gameStats) => set({ gameStats }),
  setSongHistory: (songHistory) => set({ songHistory }),
  addBuzzedPlayer: (id) =>
    set((s) => ({
      buzzedPlayers: s.buzzedPlayers.includes(id) ? s.buzzedPlayers : [...s.buzzedPlayers, id],
    })),
  clearBuzzedPlayers: () => set({ buzzedPlayers: [] }),
  addTriviaAnswer: (correct) =>
    set((s) => ({
      triviaScore: {
        correct: s.triviaScore.correct + (correct ? 1 : 0),
        total: s.triviaScore.total + 1,
      },
    })),
  setLeaderboard: (leaderboard) => set({ leaderboard }),
  setMyStats: (myStats) => set({ myStats }),
  setMyHistory: (myHistory) => set({ myHistory }),
  syncRoom: (room) =>
    set({
      players: room.players,
      hostId: room.hostId,
      settings: room.settings,
      phase: room.gameState.phase,
      currentTurnPlayerId: room.gameState.currentTurnPlayerId,
      currentSong: room.gameState.currentSong,
      pendingPlacement: room.gameState.pendingPlacement,
      challengers: room.gameState.challengers,
      deckSize: room.gameState.deckSize,
      sharedTimeline: room.gameState.sharedTimeline || [],
    }),
  reset: () => set(initialState),
}));
