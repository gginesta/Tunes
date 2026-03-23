import { create } from 'zustand';
import type {
  GamePhase,
  GameSettings,
  Player,
  SongCard,
  Room,
} from '@hitster/shared';

export type Screen = 'home' | 'lobby' | 'game' | 'results' | 'rules';

interface RevealData {
  song: SongCard;
  correct: boolean;
  winnerId: string | null;
  stolenBy: string | null;
}

interface GameStore {
  // Connection
  screen: Screen;
  myId: string;
  roomCode: string;
  connected: boolean;
  error: string | null;

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

  // Reveal
  lastReveal: RevealData | null;

  // Winner
  winnerId: string | null;
  finalPlayers: Record<string, Player>;

  // Actions
  setScreen: (screen: Screen) => void;
  setMyId: (id: string) => void;
  setRoomCode: (code: string) => void;
  setConnected: (connected: boolean) => void;
  setError: (error: string | null) => void;
  setPlayers: (players: Record<string, Player>) => void;
  setHostId: (hostId: string) => void;
  setSettings: (settings: GameSettings) => void;
  setPhase: (phase: GamePhase) => void;
  setCurrentTurnPlayerId: (id: string | null) => void;
  setCurrentSong: (song: Partial<SongCard> | null) => void;
  setPendingPlacement: (pos: number | null) => void;
  addChallenger: (id: string) => void;
  setDeckSize: (size: number) => void;
  setLastReveal: (reveal: RevealData | null) => void;
  setWinner: (winnerId: string, players: Record<string, Player>) => void;
  updatePlayerTokens: (playerId: string, tokens: number) => void;
  updatePlayerTimeline: (playerId: string, timeline: SongCard[]) => void;
  addPlayer: (player: Player) => void;
  removePlayer: (playerId: string) => void;
  syncRoom: (room: Room) => void;
  reset: () => void;
}

const initialState = {
  screen: 'home' as Screen,
  myId: '',
  roomCode: '',
  connected: false,
  error: null,
  players: {} as Record<string, Player>,
  hostId: '',
  settings: { mode: 'original' as const, cardsToWin: 10 },
  phase: 'lobby' as GamePhase,
  currentTurnPlayerId: null,
  currentSong: null,
  pendingPlacement: null,
  challengers: [],
  deckSize: 0,
  lastReveal: null,
  winnerId: null,
  finalPlayers: {} as Record<string, Player>,
};

export const useGameStore = create<GameStore>((set) => ({
  ...initialState,

  setScreen: (screen) => set({ screen }),
  setMyId: (myId) => set({ myId }),
  setRoomCode: (roomCode) => set({ roomCode }),
  setConnected: (connected) => set({ connected }),
  setError: (error) => set({ error }),
  setPlayers: (players) => set({ players }),
  setHostId: (hostId) => set({ hostId }),
  setSettings: (settings) => set({ settings }),
  setPhase: (phase) => set({ phase }),
  setCurrentTurnPlayerId: (currentTurnPlayerId) => set({ currentTurnPlayerId }),
  setCurrentSong: (currentSong) => set({ currentSong }),
  setPendingPlacement: (pendingPlacement) => set({ pendingPlacement }),
  addChallenger: (id) => set((s) => ({ challengers: [...s.challengers, id] })),
  setDeckSize: (deckSize) => set({ deckSize }),
  setLastReveal: (lastReveal) => set({ lastReveal }),
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
    }),
  reset: () => set(initialState),
}));
