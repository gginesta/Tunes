import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  Room,
  Player,
  GameState,
  GameSettings,
} from '@hitster/shared';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  ROOM_CODE_LENGTH,
  STARTING_TOKENS,
  DEFAULT_CARDS_TO_WIN,
  MIN_CARDS_TO_WIN,
  MAX_CARDS_TO_WIN,
} from '@hitster/shared';
import type { GameMode } from '@hitster/shared';

const VALID_GAME_MODES: GameMode[] = ['original', 'pro', 'expert', 'coop'];
import { GameEngine } from './game';
import { selectGameDeck, resolveTrackIds, fetchPlaylistDeck } from './songs';
import { saveRoom, loadAllRooms, deleteRoom, saveGameResult, updateLeaderboard, getLeaderboard, getPlayerStats, getPlayerGameHistory } from './database';
import type { SaveGameParticipant } from './database';
import { socketToUsername } from './accounts-handler';
import { logger } from './logger';

type HitsterSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type HitsterServer = Server<ClientToServerEvents, ServerToClientEvents>;

const rooms = new Map<string, Room>();
const games = new Map<string, GameEngine>();
const socketToRoom = new Map<string, { code: string; playerId: string }>();
const roomSpotifyTokens = new Map<string, string>();

/** Reverse map: playerId -> socketId (for username lookups) */
const playerToSocket = new Map<string, string>();
/** Timers for delayed room cleanup when all players disconnect */
const roomCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

const ALLOWED_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function generateRoomCode(): string {
  let code: string;
  do {
    code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ALLOWED_CHARS[Math.floor(Math.random() * ALLOWED_CHARS.length)];
    }
  } while (rooms.has(code));
  return code;
}

function createDefaultGameState(): GameState {
  return {
    phase: 'lobby',
    currentTurnPlayerId: null,
    currentSong: null,
    pendingPlacement: null,
    challengers: [],
    turnOrder: [],
    turnIndex: 0,
    deckSize: 0,
    sharedTimeline: [],
  };
}

/**
 * Persist the current room state to SQLite.
 */
function persistRoom(code: string): void {
  const room = rooms.get(code);
  if (!room) return;
  const spotifyToken = roomSpotifyTokens.get(code);
  try {
    saveRoom(code, room, spotifyToken);
  } catch (err) {
    logger.error('Failed to persist room', { code, error: String(err) });
  }
}

/**
 * Set up the game-end callback to save results to the database.
 */
function setupGameEndHook(engine: GameEngine, roomCode: string): void {
  engine.onGameEnd(() => {
    try {
      const room = engine.getRoom();
      const { playerStats, totalRounds } = engine.getGameStats();
      const winnerId = engine.getWinnerId();
      const isCoop = room.settings.mode === 'coop';

      // Build participant list for logged-in players
      const participants: SaveGameParticipant[] = [];
      let winnerUsername: string | null = null;

      for (const [playerId, player] of Object.entries(room.players)) {
        const socketId = playerToSocket.get(playerId);
        if (!socketId) continue;
        const username = socketToUsername.get(socketId);
        if (!username) continue;

        const stats = playerStats.get(playerId);
        const isWinner = isCoop ? true : playerId === winnerId;
        const cardsWon = isCoop
          ? room.gameState.sharedTimeline.length
          : player.timeline.length;

        if (isWinner && !isCoop) {
          winnerUsername = username;
        }

        participants.push({
          username,
          displayName: player.name,
          cardsWon,
          correctPlacements: stats?.correctPlacements ?? 0,
          totalPlacements: stats?.totalPlacements ?? 0,
          longestStreak: stats?.longestStreak ?? 0,
          challengesWon: stats?.challengesWon ?? 0,
          songsNamed: stats?.songsNamed ?? 0,
          fastestPlacementMs: stats?.fastestPlacementMs ?? null,
          isWinner,
        });
      }

      if (participants.length === 0) return;

      saveGameResult(
        roomCode,
        room.settings.mode,
        winnerUsername,
        Object.keys(room.players).length,
        totalRounds,
        participants,
      );

      for (const p of participants) {
        updateLeaderboard(p.username, p.displayName, {
          isWinner: p.isWinner,
          correctPlacements: p.correctPlacements,
          totalPlacements: p.totalPlacements,
          longestStreak: p.longestStreak,
          challengesWon: p.challengesWon,
          songsNamed: p.songsNamed,
          fastestPlacementMs: p.fastestPlacementMs,
        });
      }

      logger.info('Game results saved to database', { roomCode, participantCount: participants.length });
    } catch (err) {
      logger.error('Failed to save game results', { roomCode, error: String(err) });
    }
  });
}

/**
 * Load all rooms from the database on server startup.
 * GameEngine instances are recreated for rooms with active games.
 */
export function restoreRoomsFromDatabase(io: HitsterServer): void {
  const saved = loadAllRooms();
  for (const { room, spotifyToken } of saved) {
    rooms.set(room.code, room);
    if (spotifyToken) {
      roomSpotifyTokens.set(room.code, spotifyToken);
    }

    // Mark all players as disconnected since this is a fresh server start
    for (const player of Object.values(room.players)) {
      player.connected = false;
    }

    // Rooms with active games cannot be resumed (deck is not persisted),
    // so reset them to lobby phase instead of trying to continue.
    if (room.gameState.phase !== 'lobby' && room.gameState.phase !== 'game_over') {
      logger.warn('Restored room had active game with no deck, resetting to lobby', {
        code: room.code,
        previousPhase: room.gameState.phase,
      });
      room.gameState = createDefaultGameState();
      for (const player of Object.values(room.players)) {
        player.timeline = [];
        player.tokens = STARTING_TOKENS;
      }
    }

    logger.info('Restored room from database', { code: room.code, phase: room.gameState.phase });
  }
  logger.info('Room restoration complete', { count: saved.length });
}

export function registerRoomHandlers(io: HitsterServer, socket: HitsterSocket) {
  socket.on('create-room', ({ playerName, spotifyAccessToken }) => {
    const trimmedName = (playerName || '').trim();
    if (trimmedName.length < 1 || trimmedName.length > 30) {
      socket.emit('error', { message: 'Player name must be between 1 and 30 characters' });
      return;
    }

    const code = generateRoomCode();
    const playerId = uuidv4();

    const player: Player = {
      id: playerId,
      name: trimmedName,
      timeline: [],
      tokens: STARTING_TOKENS,
      isHost: true,
      connected: true,
    };

    const room: Room = {
      code,
      players: { [playerId]: player },
      hostId: playerId,
      settings: { mode: 'original', cardsToWin: DEFAULT_CARDS_TO_WIN, songPack: 'standard' },
      gameState: createDefaultGameState(),
    };

    rooms.set(code, room);
    socketToRoom.set(socket.id, { code, playerId });
    playerToSocket.set(playerId, socket.id);
    socket.join(code);

    const engine = new GameEngine(room, io);
    setupGameEndHook(engine, code);
    games.set(code, engine);

    if (spotifyAccessToken) {
      engine.setSpotifyToken(spotifyAccessToken);
      roomSpotifyTokens.set(code, spotifyAccessToken);
    }

    persistRoom(code);

    logger.info('Room created', { code, hostId: room.hostId, playerCount: Object.keys(room.players).length });
    socket.emit('room-created', { code, playerId, room });
    // Also send state-sync so the host's player data is fully populated
    socket.emit('state-sync', room);
  });

  socket.on('join-room', ({ code, playerName }) => {
    const trimmedName = (playerName || '').trim();
    if (trimmedName.length < 1 || trimmedName.length > 30) {
      socket.emit('error', { message: 'Player name must be between 1 and 30 characters' });
      return;
    }

    const upperCode = code.toUpperCase();
    const room = rooms.get(upperCode);

    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    if (room.gameState.phase !== 'lobby') {
      socket.emit('error', { message: 'Game already in progress' });
      return;
    }

    if (Object.keys(room.players).length >= MAX_PLAYERS) {
      socket.emit('error', { message: 'Room is full' });
      return;
    }

    const playerId = uuidv4();
    const player: Player = {
      id: playerId,
      name: trimmedName,
      timeline: [],
      tokens: STARTING_TOKENS,
      isHost: false,
      connected: true,
    };

    room.players[playerId] = player;
    socketToRoom.set(socket.id, { code: upperCode, playerId });
    playerToSocket.set(playerId, socket.id);
    socket.join(upperCode);

    // Cancel any pending room cleanup (someone came back)
    cancelRoomCleanup(upperCode);

    persistRoom(upperCode);

    socket.emit('room-joined', { room, playerId });
    socket.to(upperCode).emit('player-joined', player);
  });

  socket.on('rejoin-room', ({ code, playerId }) => {
    const upperCode = code.toUpperCase();
    const room = rooms.get(upperCode);

    if (!room || !room.players[playerId]) {
      socket.emit('error', { message: 'Room not found or player unknown' });
      return;
    }

    // Re-associate this socket with the existing player
    const player = room.players[playerId];
    player.connected = true;
    socketToRoom.set(socket.id, { code: upperCode, playerId });
    playerToSocket.set(playerId, socket.id);
    socket.join(upperCode);

    // Cancel any pending room cleanup (player came back)
    cancelRoomCleanup(upperCode);

    logger.info('Player rejoined', { code: upperCode, playerId, name: player.name });

    // Send full state to the reconnecting client
    socket.emit('room-joined', { room, playerId });
    // Notify others
    io.to(upperCode).emit('state-sync', room);

    // If game is in progress, resend current game screen and handle reconnect
    if (room.gameState.phase !== 'lobby' && room.gameState.phase !== 'game_over') {
      // Clear disconnect grace timer if one is running
      const engine = games.get(upperCode);
      if (engine) {
        engine.handlePlayerReconnect(playerId);
      }

      socket.emit('game-started', { gameState: room.gameState });

      // Re-send current turn info (strip song details to avoid leaking answers)
      if (room.gameState.currentTurnPlayerId && room.gameState.currentSong) {
        socket.emit('new-turn', {
          turnPlayerId: room.gameState.currentTurnPlayerId,
          songCard: { id: room.gameState.currentSong.id },
        });
      }
    }

    // Re-send song history if available
    const engineForHistory = games.get(upperCode);
    if (engineForHistory) {
      const history = engineForHistory.getSongHistory();
      if (history.length > 0) {
        socket.emit('song-history', { history });
      }
    }

    persistRoom(upperCode);
  });

  socket.on('leave-room', () => {
    handleLeave(io, socket, true);
  });

  socket.on('update-settings', (settings) => {
    const mapping = socketToRoom.get(socket.id);
    if (!mapping) return;
    const room = rooms.get(mapping.code);
    if (!room || room.hostId !== mapping.playerId) return;

    // Validate cardsToWin
    if (settings.cardsToWin != null) {
      const ctw = Number(settings.cardsToWin);
      if (isNaN(ctw) || ctw < MIN_CARDS_TO_WIN || ctw > MAX_CARDS_TO_WIN) {
        socket.emit('error', { message: `cardsToWin must be between ${MIN_CARDS_TO_WIN} and ${MAX_CARDS_TO_WIN}` });
        return;
      }
      settings.cardsToWin = ctw;
    }

    // Validate mode
    if (settings.mode != null && !VALID_GAME_MODES.includes(settings.mode as GameMode)) {
      socket.emit('error', { message: 'Invalid game mode' });
      return;
    }

    room.settings = { ...room.settings, ...settings };
    io.to(mapping.code).emit('settings-updated', room.settings);
    persistRoom(mapping.code);
  });

  socket.on('start-game', async (data) => {
    try {
      const mapping = socketToRoom.get(socket.id);
      if (!mapping) {
        socket.emit('error', { message: 'Connection lost. Please refresh and rejoin the room.' });
        return;
      }
      const room = rooms.get(mapping.code);
      if (!room) {
        socket.emit('error', { message: 'Room no longer exists.' });
        return;
      }
      if (room.hostId !== mapping.playerId) {
        socket.emit('error', { message: 'Only the host can start the game.' });
        return;
      }

      // Guard against double start
      if (room.gameState.phase !== 'lobby') {
        socket.emit('error', { message: 'Game already in progress' });
        return;
      }

      const playerCount = Object.keys(room.players).length;
      if (playerCount < MIN_PLAYERS) {
        socket.emit('error', { message: `Need at least ${MIN_PLAYERS} players` });
        return;
      }

      // Accept a fresh Spotify token from the client (handles token expiry)
      if (data?.spotifyAccessToken) {
        roomSpotifyTokens.set(mapping.code, data.spotifyAccessToken);
        const engine = games.get(mapping.code);
        if (engine) engine.setSpotifyToken(data.spotifyAccessToken);
      }

      const spotifyToken = roomSpotifyTokens.get(mapping.code);
      logger.info('Starting game', {
        code: mapping.code,
        hasSpotifyToken: !!spotifyToken,
        tokenPrefix: spotifyToken ? spotifyToken.slice(0, 10) + '...' : 'none',
        songPack: room.settings.songPack,
      });
      const { songPack, decades, genres, regions, playlistUrl } = room.settings;
      let deck: import('@hitster/shared').SongCard[];

      if (songPack === 'playlist') {
        // Validate playlist URL is provided
        if (!playlistUrl || playlistUrl.trim() === '') {
          socket.emit('error', { message: 'Please enter a Spotify playlist URL before starting.' });
          return;
        }

        if (!spotifyToken) {
          socket.emit('error', { message: 'Spotify connection required for playlist mode.' });
          return;
        }

        // Fetch songs directly from a Spotify playlist
        io.to(mapping.code).emit('resolving-tracks');
        deck = await fetchPlaylistDeck(playlistUrl, spotifyToken);
        if (deck.length === 0) {
          socket.emit('error', { message: 'Could not load songs from that playlist. It may be empty, private, or the link is invalid.' });
          return;
        }
        if (deck.length < 10) {
          socket.emit('error', {
            message: `That playlist only has ${deck.length} playable track${deck.length === 1 ? '' : 's'}. A minimum of 10 are needed for a good game. Try a larger playlist.`,
          });
          return;
        }
      } else {
        // Use built-in song database with optional decade/genre/region filters
        const useDecades = (songPack === 'decades' || songPack === 'genre-decade') ? decades : undefined;
        const useGenres = (songPack === 'genre' || songPack === 'genre-decade') ? genres : undefined;
        const useRegions = regions && regions.length > 0 ? regions : undefined;
        deck = selectGameDeck(undefined, useDecades, useGenres, useRegions);
        if (deck.length === 0) {
          socket.emit('error', { message: 'Not enough songs for the selected filters. Try broadening your selection.' });
          return;
        }

        // Resolve Spotify track IDs if token available
        if (spotifyToken) {
          io.to(mapping.code).emit('resolving-tracks');
          const playable = await resolveTrackIds(deck, spotifyToken);
          if (playable.length === 0) {
            socket.emit('error', { message: 'Could not find any songs on Spotify. Please try again.' });
            return;
          }
          deck = playable;
        } else {
          // Preview mode: only keep songs that have a pre-baked previewUrl
          deck = deck.filter((s) => !!s.previewUrl);
          if (deck.length === 0) {
            socket.emit('error', {
              message: 'No song previews available. Please use "Host with Spotify" to play.',
            });
            return;
          }
          if (deck.length < 10) {
            socket.emit('error', {
              message: `Only ${deck.length} songs have preview audio. Try broadening your selection or use "Host with Spotify".`,
            });
            return;
          }
        }
      }

      let engine = games.get(mapping.code);
      if (!engine) {
        engine = new GameEngine(room, io);
        setupGameEndHook(engine, mapping.code);
        games.set(mapping.code, engine);
      }

      // Re-register hook in case engine was reused from a previous game
      setupGameEndHook(engine, mapping.code);

      engine.startGame(deck);
      persistRoom(mapping.code);
    } catch (err) {
      logger.error('start-game handler failed', { error: String(err) });
      socket.emit('error', { message: 'Failed to start game. Please try again.' });
    }
  });

  socket.on('place-card', ({ position }) => {
    const engine = getEngine(socket);
    const mapping = socketToRoom.get(socket.id);
    if (!engine || !mapping) return;
    engine.placeCard(mapping.playerId, position);
    persistRoom(mapping.code);
  });

  socket.on('challenge', () => {
    const engine = getEngine(socket);
    const mapping = socketToRoom.get(socket.id);
    if (!engine || !mapping) return;
    engine.challenge(mapping.playerId);
  });

  socket.on('name-song', (guess) => {
    const engine = getEngine(socket);
    const mapping = socketToRoom.get(socket.id);
    if (!engine || !mapping) return;
    engine.nameSong(mapping.playerId, guess);
  });

  socket.on('skip-song', () => {
    const engine = getEngine(socket);
    const mapping = socketToRoom.get(socket.id);
    if (!engine || !mapping) return;
    engine.skipSong(mapping.playerId);
  });

  socket.on('buy-card', () => {
    const engine = getEngine(socket);
    const mapping = socketToRoom.get(socket.id);
    if (!engine || !mapping) return;
    engine.buyCard(mapping.playerId);
  });

  socket.on('confirm-reveal', () => {
    const engine = getEngine(socket);
    const mapping = socketToRoom.get(socket.id);
    if (!engine || !mapping) return;
    engine.confirmReveal(mapping.playerId);
    persistRoom(mapping.code);
  });

  socket.on('restart-game', () => {
    const mapping = socketToRoom.get(socket.id);
    if (!mapping) return;
    const room = rooms.get(mapping.code);
    if (!room) return;

    // Only the host can restart
    if (room.hostId !== mapping.playerId) {
      socket.emit('error', { message: 'Only the host can restart the game' });
      return;
    }

    // Reset engine state
    const engine = games.get(mapping.code);
    if (engine) {
      engine.resetGame();
    } else {
      // No engine — reset room state manually
      room.gameState = createDefaultGameState();
      for (const player of Object.values(room.players)) {
        player.timeline = [];
        player.tokens = STARTING_TOKENS;
      }
    }

    // Remove disconnected players
    for (const [id, player] of Object.entries(room.players)) {
      if (!player.connected) {
        delete room.players[id];
      }
    }

    persistRoom(mapping.code);

    io.to(mapping.code).emit('game-restarted', { room });
  });

  socket.on('buzz', () => {
    const mapping = socketToRoom.get(socket.id);
    if (!mapping) return;
    const room = rooms.get(mapping.code);
    if (!room || room.gameState.phase !== 'playing') return;
    if (mapping.playerId === room.gameState.currentTurnPlayerId) return;
    io.to(mapping.code).emit('player-buzzed', { playerId: mapping.playerId });
  });

  socket.on('get-leaderboard', () => {
    try {
      const entries = getLeaderboard(20);
      socket.emit('leaderboard', { entries });
    } catch (err) {
      logger.error('Failed to fetch leaderboard', { error: String(err) });
    }
  });

  socket.on('get-my-stats', () => {
    const username = socketToUsername.get(socket.id);
    if (!username) {
      socket.emit('my-stats', { stats: null });
      return;
    }
    try {
      const stats = getPlayerStats(username);
      socket.emit('my-stats', { stats });
    } catch (err) {
      logger.error('Failed to fetch player stats', { error: String(err) });
    }
  });

  socket.on('get-my-history', () => {
    const username = socketToUsername.get(socket.id);
    if (!username) {
      socket.emit('my-history', { games: [] });
      return;
    }
    try {
      const games = getPlayerGameHistory(username, 20);
      socket.emit('my-history', { games });
    } catch (err) {
      logger.error('Failed to fetch player history', { error: String(err) });
    }
  });

  socket.on('disconnect', () => {
    // Clean up playerToSocket mapping
    const mapping = socketToRoom.get(socket.id);
    if (mapping) {
      playerToSocket.delete(mapping.playerId);
    }
    handleLeave(io, socket, false);
  });
}

function getEngine(socket: HitsterSocket): GameEngine | null {
  const mapping = socketToRoom.get(socket.id);
  if (!mapping) return null;
  return games.get(mapping.code) || null;
}

function cancelRoomCleanup(code: string): void {
  const timer = roomCleanupTimers.get(code);
  if (timer) {
    clearTimeout(timer);
    roomCleanupTimers.delete(code);
    logger.info('Room cleanup cancelled (player reconnected)', { code });
  }
}

function handleLeave(io: HitsterServer, socket: HitsterSocket, voluntary: boolean = false) {
  const mapping = socketToRoom.get(socket.id);
  if (!mapping) return;

  const room = rooms.get(mapping.code);
  if (!room) return;

  const player = room.players[mapping.playerId];
  if (player) {
    player.connected = false;
  }

  socket.to(mapping.code).emit('player-left', mapping.playerId);
  socketToRoom.delete(socket.id);
  socket.leave(mapping.code);

  // If player was mid-turn, handle accordingly
  const engine = games.get(mapping.code);
  if (engine) {
    if (voluntary) {
      // Voluntary leave skips grace period — immediately advance turn if needed
      engine.handlePlayerVoluntaryLeave(mapping.playerId);
    } else {
      // Disconnect gets a grace period for reconnection
      engine.handlePlayerDisconnect(mapping.playerId);
    }
  }

  const connectedPlayers = Object.values(room.players).filter((p) => p.connected);
  if (connectedPlayers.length === 0) {
    // Don't destroy immediately — give players time to come back (e.g. tab switch)
    const ROOM_CLEANUP_DELAY_MS = 5 * 60 * 1000; // 5 minutes
    const code = mapping.code;
    logger.info('All players disconnected, room cleanup scheduled', { code, delayMs: ROOM_CLEANUP_DELAY_MS });

    // Store cleanup timer so it can be cancelled if someone reconnects
    if (!roomCleanupTimers.has(code)) {
      const timer = setTimeout(() => {
        roomCleanupTimers.delete(code);
        const currentRoom = rooms.get(code);
        if (!currentRoom) return; // already cleaned up
        const stillConnected = Object.values(currentRoom.players).filter((p) => p.connected);
        if (stillConnected.length === 0) {
          logger.info('Room destroyed (cleanup timer expired)', { code });
          rooms.delete(code);
          games.delete(code);
          deleteRoom(code);
        }
      }, ROOM_CLEANUP_DELAY_MS);
      roomCleanupTimers.set(code, timer);
    }
  } else if (mapping.playerId === room.hostId) {
    const oldHost = room.players[mapping.playerId];
    if (oldHost) {
      oldHost.isHost = false;
    }
    const newHost = connectedPlayers[0];
    room.hostId = newHost.id;
    newHost.isHost = true;
    logger.info('Host transferred', { code: mapping.code, newHostId: newHost.id });
    io.to(mapping.code).emit('state-sync', room);
    persistRoom(mapping.code);
  } else {
    persistRoom(mapping.code);
  }
}

export function getRoomCount(): number {
  return rooms.size;
}

export function getTotalPlayerCount(): number {
  let count = 0;
  for (const room of rooms.values()) {
    count += Object.values(room.players).filter((p) => p.connected).length;
  }
  return count;
}
