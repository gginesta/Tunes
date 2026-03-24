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
import { selectGameDeck, resolveTrackIds } from './songs';

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
      settings: { mode: 'original', cardsToWin: DEFAULT_CARDS_TO_WIN },
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

    socket.emit('room-joined', { room, playerId });
    socket.to(upperCode).emit('player-joined', player);
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

    let deck = selectGameDeck();
    let engine = games.get(mapping.code);
    if (!engine) {
      engine = new GameEngine(room, io);
      games.set(mapping.code, engine);
    }

    // Resolve Spotify track IDs if token available
    const spotifyToken = roomSpotifyTokens.get(mapping.code);
    if (spotifyToken) {
      io.to(mapping.code).emit('resolving-tracks');
      const playable = await resolveTrackIds(deck, spotifyToken);
      if (playable.length === 0) {
        socket.emit('error', { message: 'Could not find any songs on Spotify. Please try again.' });
        return;
      }
      deck = playable;
    }

    engine.startGame(deck);
  });

  socket.on('place-card', ({ position }) => {
    const engine = getEngine(socket);
    const mapping = socketToRoom.get(socket.id);
    if (!engine || !mapping) return;
    engine.placeCard(mapping.playerId, position);
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
    if (!engine) return;
    engine.confirmReveal();
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

  const connectedPlayers = Object.values(room.players).filter((p) => p.connected);
  if (connectedPlayers.length === 0) {
    rooms.delete(mapping.code);
    games.delete(mapping.code);
  } else if (mapping.playerId === room.hostId) {
    const newHost = connectedPlayers[0];
    room.hostId = newHost.id;
    newHost.isHost = true;
    io.to(mapping.code).emit('state-sync', room);
  }
}
