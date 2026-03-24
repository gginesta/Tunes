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
} from '@hitster/shared';
import { GameEngine } from './game';
import { selectGameDeck, resolveTrackIds, fetchPlaylistDeck } from './songs';
import { saveRoom, loadAllRooms, deleteRoom } from './database';
import { logger } from './logger';

type HitsterSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type HitsterServer = Server<ClientToServerEvents, ServerToClientEvents>;

const rooms = new Map<string, Room>();
const games = new Map<string, GameEngine>();
const socketToRoom = new Map<string, { code: string; playerId: string }>();
const roomSpotifyTokens = new Map<string, string>();

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

    // Recreate GameEngine for rooms that had active games
    if (room.gameState.phase !== 'lobby' && room.gameState.phase !== 'game_over') {
      const engine = new GameEngine(room, io);
      if (spotifyToken) {
        engine.setSpotifyToken(spotifyToken);
      }
      games.set(room.code, engine);
    }

    logger.info('Restored room from database', { code: room.code, phase: room.gameState.phase });
  }
  logger.info('Room restoration complete', { count: saved.length });
}

export function registerRoomHandlers(io: HitsterServer, socket: HitsterSocket) {
  socket.on('create-room', ({ playerName, spotifyAccessToken }) => {
    const code = generateRoomCode();
    const playerId = uuidv4();

    const player: Player = {
      id: playerId,
      name: playerName,
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
    socket.join(code);

    if (spotifyAccessToken) {
      const engine = new GameEngine(room, io);
      engine.setSpotifyToken(spotifyAccessToken);
      games.set(code, engine);
      roomSpotifyTokens.set(code, spotifyAccessToken);
    }

    persistRoom(code);

    logger.info('Room created', { code, hostId: room.hostId, playerCount: Object.keys(room.players).length });
    socket.emit('room-created', { code, playerId, room });
    // Also send state-sync so the host's player data is fully populated
    socket.emit('state-sync', room);
  });

  socket.on('join-room', ({ code, playerName }) => {
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
      name: playerName,
      timeline: [],
      tokens: STARTING_TOKENS,
      isHost: false,
      connected: true,
    };

    room.players[playerId] = player;
    socketToRoom.set(socket.id, { code: upperCode, playerId });
    socket.join(upperCode);

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
    socket.join(upperCode);

    logger.info('Player rejoined', { code: upperCode, playerId, name: player.name });

    // Send full state to the reconnecting client
    socket.emit('room-joined', { room, playerId });
    // Notify others
    io.to(upperCode).emit('state-sync', room);

    // If game is in progress, resend current game screen
    if (room.gameState.phase !== 'lobby' && room.gameState.phase !== 'game_over') {
      socket.emit('game-started', { gameState: room.gameState });

      // Re-send current turn info
      if (room.gameState.currentTurnPlayerId && room.gameState.currentSong) {
        socket.emit('new-turn', {
          turnPlayerId: room.gameState.currentTurnPlayerId,
          songCard: room.gameState.currentSong,
        });
      }
    }

    persistRoom(upperCode);
  });

  socket.on('leave-room', () => {
    handleLeave(io, socket);
  });

  socket.on('update-settings', (settings) => {
    const mapping = socketToRoom.get(socket.id);
    if (!mapping) return;
    const room = rooms.get(mapping.code);
    if (!room || room.hostId !== mapping.playerId) return;

    room.settings = { ...room.settings, ...settings };
    io.to(mapping.code).emit('settings-updated', room.settings);
  });

  socket.on('start-game', async () => {
    const mapping = socketToRoom.get(socket.id);
    if (!mapping) return;
    const room = rooms.get(mapping.code);
    if (!room || room.hostId !== mapping.playerId) return;

    const playerCount = Object.keys(room.players).length;
    if (playerCount < MIN_PLAYERS) {
      socket.emit('error', { message: `Need at least ${MIN_PLAYERS} players` });
      return;
    }

    const spotifyToken = roomSpotifyTokens.get(mapping.code);
    const { songPack, decades, playlistUrl } = room.settings;
    let deck: import('@hitster/shared').SongCard[];

    if (songPack === 'playlist' && playlistUrl && spotifyToken) {
      // Fetch songs directly from a Spotify playlist
      io.to(mapping.code).emit('resolving-tracks');
      deck = await fetchPlaylistDeck(playlistUrl, spotifyToken);
      if (deck.length === 0) {
        socket.emit('error', { message: 'Could not load songs from that playlist. Check the link and try again.' });
        return;
      }
    } else {
      // Use built-in song database (standard or decade-filtered)
      deck = selectGameDeck(undefined, songPack === 'decades' ? decades : undefined);
      if (deck.length === 0) {
        socket.emit('error', { message: 'Not enough songs for the selected decades. Try adding more.' });
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
      }
    }

    let engine = games.get(mapping.code);
    if (!engine) {
      engine = new GameEngine(room, io);
      games.set(mapping.code, engine);
    }

    engine.startGame(deck);
    persistRoom(mapping.code);
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
    engine.confirmReveal();
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

  socket.on('disconnect', () => {
    handleLeave(io, socket);
  });
}

function getEngine(socket: HitsterSocket): GameEngine | null {
  const mapping = socketToRoom.get(socket.id);
  if (!mapping) return null;
  return games.get(mapping.code) || null;
}

function handleLeave(io: HitsterServer, socket: HitsterSocket) {
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

  // If player was mid-turn, skip to next player
  const engine = games.get(mapping.code);
  if (engine) {
    engine.handlePlayerDisconnect(mapping.playerId);
  }

  const connectedPlayers = Object.values(room.players).filter((p) => p.connected);
  if (connectedPlayers.length === 0) {
    logger.info('Room destroyed (no connected players)', { code: mapping.code });
    rooms.delete(mapping.code);
    games.delete(mapping.code);
    deleteRoom(mapping.code);
  } else if (mapping.playerId === room.hostId) {
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
