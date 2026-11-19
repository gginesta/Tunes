import { randomInt, randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents, GameSettings, GameState, PlaybackMode, Player, Room, SavedTable,
  ServerToClientEvents,
} from '@tunes/shared';
import {
  DEFAULT_CARDS_TO_WIN, getDinnerRoundCount, MAX_CARDS_TO_WIN, MAX_PLAYERS, MIN_CARDS_TO_WIN,
  MIN_PLAYERS, ROOM_CODE_LENGTH, ROOM_RECOVERY_MS, STARTING_TOKENS,
} from '@tunes/shared';
import {
  createSavedTable, deleteRoom, getSavedTableConfig, getSavedTables, loadAllRooms, saveFinishedMatch,
  saveTableCheckpoint, updateSavedTableName,
  type RoomRecovery, type SaveGameParticipant,
} from './database';
import { GameEngine } from './game';
import { registerGameActionHandlers } from './gameActionHandlers';
import { authenticateGuest, getOrCreateGuest, issueToken, matchesToken, tokenHash } from './guestSession';
import { logger } from './logger';
import { getLicensedPacks, getPartyDeck, isAuthorizedRecording } from './partyCatalogue';
import { registerStatsHandlers } from './statsHandlers';
import { isBoundedInt, isRecord, isShortString } from './validate';

type TunesSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type TunesServer = Server<ClientToServerEvents, ServerToClientEvents>;
type Mapping = { code: string; playerId: string };
type Guest = { guestId: string; guestToken: string };

interface LiveRoom {
  room: Room;
  engine: GameEngine;
  seats: RoomRecovery['seats'];
  startsAt?: number;
  audioReportedFor?: string;
  lastAudio?: {matchId:string; roundId:number; cueId:string; status:string; issuedAt:number; confirmed:boolean};
  cleanupTimer?: ReturnType<typeof setTimeout>;
  completedMatchIds: string[];
}

const rooms = new Map<string, LiveRoom>();
const socketToRoom = new Map<string, Mapping>();
const playerSockets = new Map<string, string>();
const attachingSockets = new Set<string>();
const startAttempts = new Map<string, symbol>();
const VALID_MODES = ['original', 'pro', 'expert', 'coop', 'dinner'];
const VALID_GENRES = ['rock', 'pop', 'hip-hop', 'r-and-b', 'country', 'electronic', 'jazz', 'classical', 'latin', 'other'];
const VALID_REGIONS = ['global', 'uk', 'latin', 'kpop', 'bollywood'];
const ALLOWED_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function dinnerStartsEnabled(): boolean {
  return process.env.TUNES_DINNER_ENABLED !== 'false';
}

export function enabledLicensedPacks() {
  return process.env.TUNES_LICENSED_ENABLED === 'false' ? [] : getLicensedPacks();
}

function generateRoomCode(): string {
  let code: string;
  do {
    code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ALLOWED_CHARS[randomInt(ALLOWED_CHARS.length)];
  } while (rooms.has(code));
  return code;
}

function defaultState(): GameState {
  return {
    phase: 'lobby', currentTurnPlayerId: null, currentSong: null, pendingPlacement: null,
    challengers: [], turnOrder: [], turnIndex: 0, deckSize: 0, sharedTimeline: [],
  };
}

function connectedPlayers(room: Room): Player[] {
  return Object.values(room.players).filter((player) => player.connected);
}

function setController(room: Room, playerId: string): void {
  room.hostId = playerId;
  for (const player of Object.values(room.players)) player.isHost = player.id === playerId;
}

function sendView(io: TunesServer, playerId: string, room: Room): void {
  const socketId = playerSockets.get(playerId);
  if (socketId && !attachingSockets.has(socketId)) io.to(socketId).emit('state-sync', room);
}

function broadcastState(io: TunesServer, live: LiveRoom): void {
  updateStartAvailability(live.room);
  for (const player of connectedPlayers(live.room)) {
    sendView(io, player.id, live.engine.publicRoom(player.id));
  }
}

function recoveryFor(live: LiveRoom): RoomRecovery {
  const { room, seats, engine } = live;
  return {
    version: 1,
    seats,
    expiresAt: room.expiresAt,
    speakerId: room.speakerId,
    savedTableId: room.savedTableId,
    restartRequired: room.recovery === 'restart-required',
    completedMatchIds: live.completedMatchIds,
    game: engine.serialize(),
  };
}

function checkpointRoom(code: string, saveSettings = false): void {
  const live = rooms.get(code);
  if (!live) return;
  const started = performance.now();
  saveTableCheckpoint(live.room, recoveryFor(live), saveSettings);
  logger.debug('Room checkpoint written', { code, durationMs: performance.now() - started });
}

function persistRoom(code: string): void {
  try {
    checkpointRoom(code);
  } catch (err) {
    logger.error('Failed to persist room', { code, error: String(err) });
  }
}

function finishMatch(live: LiveRoom): void {
  const { room, seats, engine } = live;
  const result = engine.getResult();
  if (!result || live.completedMatchIds.includes(result.matchId)) return;
  const { playerStats, totalRounds } = engine.getGameStats();
  const participants: SaveGameParticipant[] = Object.keys(result.scores).flatMap((playerId) => {
    const player = room.players[playerId];
    const seat = seats[playerId];
    if (!seat || !player) return [];
    const stats = playerStats.get(playerId);
    return [{
      username: seat.guestId,
      displayName: player.name,
      cardsWon: result.scores[playerId],
      correctPlacements: stats?.correctPlacements ?? 0,
      totalPlacements: stats?.totalPlacements ?? 0,
      longestStreak: stats?.longestStreak ?? 0,
      challengesWon: stats?.challengesWon ?? 0,
      songsNamed: stats?.songsNamed ?? 0,
      fastestPlacementMs: stats?.fastestPlacementMs ?? null,
      isWinner: result.winnerIds.includes(playerId),
    }];
  });
  const started = performance.now();
  const completedMatchIds = [...live.completedMatchIds, result.matchId];
  const inserted = saveFinishedMatch(room, { ...recoveryFor(live), completedMatchIds }, { result, totalRounds, participants });
  live.completedMatchIds = completedMatchIds;
  if (inserted) {
    logger.info('Match completed', {
      matchId: result.matchId, status: result.status, mode: room.settings.mode,
      participantCount: participants.length, totalRounds, durationMs: performance.now() - started,
    });
  }
}

function reportAudioChange(live: LiveRoom): void {
  const {matchId, roundId, audio} = live.room.gameState;
  if (!matchId) return;
  const now = performance.now();
  const prior = live.lastAudio;
  if (prior?.cueId === audio?.cueId && prior?.status === audio?.status) return;
  const sameCue = !!prior && prior.cueId === audio?.cueId;
  if (prior && !sameCue && !prior.confirmed) {
    logger.info('Cue ended without confirmation', {matchId:prior.matchId, roundId:prior.roundId, source:live.room.playbackMode});
  }
  if (!audio?.cueId || audio.status === 'idle' || roundId === undefined) {
    live.lastAudio = undefined;
    return;
  }
  const issuedAt = sameCue ? prior.issuedAt : now;
  const confirmed = (sameCue && prior.confirmed) || audio.status === 'playing';
  if (audio.status === 'playing' || audio.status === 'paused') {
    logger.info('Music status changed', {matchId, roundId, source:live.room.playbackMode,
      status:audio.status, reason:audio.reason, elapsedSinceCueMs:now-issuedAt});
  }
  live.lastAudio = {matchId, roundId, cueId:audio.cueId, status:audio.status, issuedAt, confirmed};
}

function createLiveRoom(
  io: TunesServer, room: Room, seats: LiveRoom['seats'] = {}, completedMatchIds: string[] = [],
): LiveRoom {
  const engine = new GameEngine(room, io, {
    onChange: () => {
      checkpointRoom(room.code);
      const live = rooms.get(room.code);
      if (live) reportAudioChange(live);
      const matchId = room.gameState.matchId;
      if (live && matchId && room.gameState.audio?.status === 'playing' && live.audioReportedFor !== matchId) {
        live.audioReportedFor = matchId;
        logger.info('First audio confirmed', {
          matchId, mode: room.playbackMode,
          timeToAudioMs: live.startsAt === undefined ? undefined : performance.now() - live.startsAt,
        });
      }
    },
    send: (playerId, view) => sendView(io, playerId, view),
    canPlay: isAuthorizedRecording,
  });
  const live = { room, engine, seats, completedMatchIds };
  engine.onGameEnd(() => finishMatch(live));
  rooms.set(room.code, live);
  return live;
}

function cancelCleanup(live: LiveRoom): void {
  clearTimeout(live.cleanupTimer);
  live.cleanupTimer = undefined;
  live.room.expiresAt = undefined;
}

function removeRoom(live: LiveRoom): void {
  const abandoned = live.engine.abandon();
  if (abandoned.error) throw new Error(abandoned.error);
  deleteRoom(live.room.code);
  clearTimeout(live.cleanupTimer);
  live.engine.dispose();
  rooms.delete(live.room.code);
  startAttempts.delete(live.room.code);
}

function scheduleCleanup(live: LiveRoom, expiresAt = Date.now() + ROOM_RECOVERY_MS): void {
  clearTimeout(live.cleanupTimer);
  live.room.expiresAt = expiresAt;
  live.cleanupTimer = setTimeout(function expire() {
    try {
      removeRoom(live);
      logger.info('Room expired', { code: live.room.code, matchId: live.room.gameState.matchId });
    } catch (err) {
      logger.error('Failed to expire room', { code: live.room.code, error: String(err) });
      live.cleanupTimer = setTimeout(expire, 10_000);
      live.cleanupTimer.unref();
    }
  }, Math.max(0, expiresAt - Date.now()));
  live.cleanupTimer.unref();
}

function getRoomIfLive(code: string): LiveRoom | undefined {
  const live = rooms.get(code);
  if (live?.room.expiresAt !== undefined && live.room.expiresAt <= Date.now()) {
    return undefined;
  }
  return live;
}

export function restoreRoomsFromDatabase(io: TunesServer): void {
  for (const { room, recovery, spotifyToken } of loadAllRooms()) {
    const saved = recovery?.version === 1 ? recovery : undefined;
    const legacyPlayback = room.playbackMode === 'spotify' || room.playbackMode === 'preview' || Boolean(spotifyToken);
    for (const player of Object.values(room.players)) player.connected = false;
    if (legacyPlayback) room.playbackMode = 'manual';
    if (room.settings.songPack === 'playlist') {
      room.settings.songPack = 'standard';
      room.settings.playlistUrl = undefined;
    }
    const live = createLiveRoom(io, room, saved?.seats, saved?.completedMatchIds);
    // Legacy provider recordings stay unavailable after restart.
    if (saved?.game?.version === 1 && Array.isArray(saved.game.deck) && saved.game.state
      && (!legacyPlayback || room.gameState.phase === 'game_over')) {
      try {
        live.engine.restore(saved.game);
        if (room.gameState.phase === 'game_over') finishMatch(live);
      } catch (err) {
        logger.warn('Room snapshot could not be restored', { code: room.code, error: String(err) });
        room.recovery = 'restart-required';
      }
    } else if (room.gameState.phase !== 'lobby' || !saved) {
      room.recovery = 'restart-required';
    }
    if (saved?.restartRequired) room.recovery = 'restart-required';
    if (room.recovery) {
      room.gameState = defaultState();
      live.engine.resetGame();
    }
    scheduleCleanup(live, saved?.expiresAt);
    persistRoom(room.code);
    logger.info('Room restored', { code: room.code, phase: room.gameState.phase, matchId: room.gameState.matchId });
  }
}

function getMapping(socketId: string): Mapping | undefined {
  const mapping = socketToRoom.get(socketId);
  return mapping && playerSockets.get(mapping.playerId) === socketId ? mapping : undefined;
}

function getLiveForSocket(socketId: string): LiveRoom | undefined {
  const mapping = getMapping(socketId);
  return mapping && rooms.get(mapping.code);
}

function refuseIfSeated(socket: TunesSocket): boolean {
  if (!getMapping(socket.id)) return false;
  socket.emit('error', { message: 'Leave your current table before starting or joining another.' });
  return true;
}

function parseName(payload: unknown, socket: TunesSocket): string | undefined {
  if (isRecord(payload) && isShortString(payload.playerName, 100)) {
    const name = payload.playerName.trim();
    if (name.length >= 1 && name.length <= 30) return name;
  }
  socket.emit('error', { message: 'Player name must be between 1 and 30 characters' });
  return undefined;
}

function bindSeat(socket: TunesSocket, live: LiveRoom, player: Player): void {
  player.connected = true;
  socketToRoom.set(socket.id, { code: live.room.code, playerId: player.id });
  playerSockets.set(player.id, socket.id);
  void socket.join(live.room.code);
}

function issueSeat(live: LiveRoom, socket: TunesSocket, name: string, guestId: string, id = randomUUID()) {
  const resumeToken = issueToken();
  const player: Player = {
    id, name, timeline: [], tokens: STARTING_TOKENS, isHost: id === live.room.hostId, connected: true,
  };
  live.room.players[id] = player;
  live.seats[id] = { guestId, resumeTokenHash: tokenHash(resumeToken) };
  cancelCleanup(live);
  bindSeat(socket, live, player);
  if (live.room.savedTableId) updateSavedTableName(live.room.savedTableId, guestId, name);
  return { player, resumeToken };
}

function createRoom(
  io: TunesServer, socket: TunesSocket, name: string, guest: Guest,
  playbackMode: PlaybackMode, settings: GameSettings, savedTableId?: string, heardRecordingIds: string[] = [],
): void {
  const code = generateRoomCode();
  const playerId = randomUUID();
  const room: Room = {
    code, players: {}, hostId: playerId, originalHostId: playerId, speakerId: playerId,
    playbackMode, savedTableId, settings, gameState: defaultState(),
  };
  const live = createLiveRoom(io, room);
  live.engine.inheritHeardRecordingIds(heardRecordingIds);
  try {
    const { resumeToken } = issueSeat(live, socket, name, guest.guestId, playerId);
    updateStartAvailability(room);
    checkpointRoom(code);
    logger.info('Room created', { code, playerId, playbackMode });
    socket.emit('room-created', { code, playerId, resumeToken, guestToken: guest.guestToken, room: live.engine.publicRoom(playerId) });
  } catch (err) {
    socketToRoom.delete(socket.id);
    playerSockets.delete(playerId);
    rooms.delete(code);
    live.engine.dispose();
    void socket.leave(code);
    logger.error('Could not create room', { code, error: String(err) });
    socket.emit('error', { message: 'Could not save this table. Try again.', action: 'create-room' });
  }
}

function joinRoom(io: TunesServer, socket: TunesSocket, live: LiveRoom, name: string, guest: Guest): void {
  const { room, engine } = live;
  if (startAttempts.has(room.code)) {
    socket.emit('error', { message: 'This table is preparing a game. Try again in a moment.' });
    return;
  }
  if (room.gameState.phase === 'game_over') {
    socket.emit('error', { message: 'The match has ended. Ask the controller to open the next game.' });
    return;
  }
  if (!room.recovery && Object.keys(room.players).length >= MAX_PLAYERS) {
    socket.emit('error', { message: 'Room is full' });
    return;
  }
  if (Object.values(live.seats).some((seat) => seat.guestId === guest.guestId)) {
    socket.emit('error', { message: 'You already have a seat at this table. Use Resume your table.', code: 'SEAT_ALREADY_EXISTS' });
    return;
  }
  attachingSockets.add(socket.id);
  try {
    const { player, resumeToken } = issueSeat(live, socket, name, guest.guestId);
    if (room.recovery) {
      room.recovery = undefined;
      room.originalHostId = player.id;
      room.speakerId = player.id;
      for (const id of Object.keys(room.players)) if (!live.seats[id]) delete room.players[id];
    }
    if (!room.players[room.hostId]?.connected) setController(room, player.id);
    if (!room.speakerId && room.gameState.phase === 'lobby') room.speakerId = player.id;
    updateStartAvailability(room);
    if (room.gameState.phase !== 'lobby') engine.addLatecomer(player.id);
    persistRoom(room.code);
    socket.emit('room-joined', {
      room: engine.publicRoom(player.id), playerId: player.id, resumeToken, guestToken: guest.guestToken,
    });
    broadcastState(io, live);
  } finally {
    attachingSockets.delete(socket.id);
  }
}

function rejoinRoom(io: TunesServer, socket: TunesSocket, payload: unknown): void {
  if (!isRecord(payload) || !isShortString(payload.code, 10) || !isShortString(payload.playerId, 64)) return;
  const code = payload.code.trim().toUpperCase();
  const playerId = payload.playerId;
  const live = getRoomIfLive(code);
  if (!live) {
    socket.emit('error', { message: 'This table has expired. Host or join a new table.', code: 'REJOIN_EXPIRED' });
    return;
  }
  const { room, engine, seats } = live;
  const seat = Object.prototype.hasOwnProperty.call(seats, playerId) ? seats[playerId] : undefined;
  if (!seat || !matchesToken(payload.resumeToken, seat.resumeTokenHash)) {
    socket.emit('error', room.recovery
      ? { message: 'This room was saved before secure recovery. Join the room code again to start a fresh match.', code: 'ROOM_RESTART_REQUIRED' }
      : { message: 'This device no longer has a saved seat at that table.', code: 'REJOIN_FAILED' });
    return;
  }
  const player = room.players[playerId];
  if (!player) return;
  const current = getMapping(socket.id);
  if (current && current.playerId !== playerId) {
    refuseIfSeated(socket);
    return;
  }
  const previous = playerSockets.get(playerId);
  if (previous && previous !== socket.id) {
    socketToRoom.delete(previous);
    const oldSocket = io.sockets.sockets.get(previous);
    void oldSocket?.leave(code);
    oldSocket?.emit('error', { message: 'This seat moved to another connection.', code: 'SEAT_REPLACED' });
    oldSocket?.disconnect(true);
    if (room.gameState.audio?.operatorId === playerId && room.playbackMode === 'licensed') {
      engine.handlePlayerDisconnect(playerId);
    }
    if (room.hostId === playerId) cancelStart(io, code);
  }
  attachingSockets.add(socket.id);
  try {
    const phase = room.gameState.phase;
    cancelCleanup(live);
    bindSeat(socket, live, player);
    if (playerId === room.originalHostId || !room.players[room.hostId]?.connected) {
      if (room.hostId !== playerId) cancelStart(io, code);
      setController(room, playerId);
    }
    updateStartAvailability(room);
    engine.handlePlayerReconnect(playerId);
    persistRoom(code);
    socket.emit('room-joined', { room: engine.publicRoom(playerId), playerId, resumeToken: payload.resumeToken as string });
    broadcastState(io, live);
    logger.info('Seat resumed', { code, playerId, matchId: room.gameState.matchId, phaseBefore: phase, phaseAfter: room.gameState.phase });
  } finally {
    attachingSockets.delete(socket.id);
  }
}

function validList(value: unknown, allowed: string[]): boolean {
  return Array.isArray(value) && value.length <= allowed.length && value.every((item) => allowed.includes(item));
}

function updateRoomSettings(room: Room, settings: unknown): boolean {
  if (!isRecord(settings)) return false;
  const { mode, cardsToWin, songPack, decades, genres, regions, playbackMode, packId, dinnerRounds, dedicatedDjId } = settings;
  if (mode !== undefined && (typeof mode !== 'string' || !VALID_MODES.includes(mode))) return false;
  if (cardsToWin !== undefined && !isBoundedInt(cardsToWin, MIN_CARDS_TO_WIN, MAX_CARDS_TO_WIN)) return false;
  if (songPack !== undefined && (typeof songPack !== 'string' || !['standard', 'decades', 'genre', 'genre-decade'].includes(songPack))) return false;
  if (decades !== undefined && (!Array.isArray(decades) || decades.length > 15 || !decades.every((year) => isBoundedInt(year, 1900, 2090) && year % 10 === 0))) return false;
  if (genres !== undefined && !validList(genres, VALID_GENRES)) return false;
  if (regions !== undefined && !validList(regions, VALID_REGIONS)) return false;
  if (dinnerRounds !== undefined && !isBoundedInt(dinnerRounds, 2, 24)) return false;
  if (dedicatedDjId !== undefined && dedicatedDjId !== ''
    && (!isShortString(dedicatedDjId, 64) || !Object.prototype.hasOwnProperty.call(room.players, dedicatedDjId))) return false;
  if (playbackMode !== undefined && playbackMode !== 'licensed' && playbackMode !== 'manual') return false;
  const packs = enabledLicensedPacks();
  if (packId !== undefined && !packs.some((pack) => pack.id === packId)) return false;
  if (playbackMode === 'licensed' && packs.length === 0) return false;

  const typed = settings as Partial<GameSettings>;
  room.settings = {
    ...room.settings,
    mode: typed.mode ?? room.settings.mode,
    cardsToWin: typed.cardsToWin ?? room.settings.cardsToWin,
    songPack: typed.songPack ?? room.settings.songPack,
    decades: typed.decades ?? room.settings.decades,
    genres: typed.genres ?? room.settings.genres,
    regions: typed.regions ?? room.settings.regions,
    dinnerRounds: typed.dinnerRounds ?? room.settings.dinnerRounds,
    dedicatedDjId: dedicatedDjId === undefined ? room.settings.dedicatedDjId : typed.dedicatedDjId || undefined,
    packId: typed.packId ?? room.settings.packId ?? packs[0]?.id,
  };
  if (playbackMode === 'manual' || playbackMode === 'licensed') room.playbackMode = playbackMode;
  return true;
}

function recordingsNeeded(room: Room, playerCount: number): number {
  if (room.settings.mode === 'dinner') {
    return 3 + getDinnerRoundCount(room.settings, room.playbackMode, playerCount);
  }
  return (room.settings.mode === 'coop' ? 1 : playerCount) + room.settings.cardsToWin - 1;
}

function startIssue(room: Room, playerCount: number, dedicatedDjReady: boolean, playable: number): string | undefined {
  if (room.settings.mode === 'dinner' && !dinnerStartsEnabled()) return 'Dinner Set is unavailable for new starts.';
  if (room.playbackMode === 'licensed' && !enabledLicensedPacks().length) return 'Licensed playback is unavailable for new starts.';
  if (!dedicatedDjReady) return 'Connect your dedicated DJ to start.';
  if (playerCount < MIN_PLAYERS) return `Need at least ${MIN_PLAYERS} connected players.`;
  const required = recordingsNeeded(room, playerCount);
  if (playable < required) return `Only ${playable} usable recordings match this pack. This table needs ${required} for these settings.`;
}

function updateStartAvailability(room: Room): void {
  room.startAvailability = undefined;
  if (room.gameState.phase !== 'lobby') return;
  const dedicatedId = room.playbackMode === 'manual' ? room.settings.dedicatedDjId : undefined;
  const playerCount = connectedPlayers(room).filter(({ id }) => id !== dedicatedId).length;
  const playable = getPartyDeck(room.settings, room.playbackMode ?? 'manual').length;
  const required = recordingsNeeded(room, Math.max(MIN_PLAYERS, playerCount));
  const issue = startIssue(room, playerCount, !dedicatedId || room.players[dedicatedId]?.connected, playable);
  room.startAvailability = { playable, required, ready: !issue, issue };
}

function cancelStart(io: TunesServer, code: string): void {
  if (startAttempts.delete(code)) io.to(code).emit('start-status', { phase: 'idle' });
}

async function startGame(io: TunesServer, socket: TunesSocket, rematchId?: string): Promise<void> {
  const mapping = getMapping(socket.id);
  const live = getLiveForSocket(socket.id);
  if (!mapping || !live || live.room.hostId !== mapping.playerId) {
    socket.emit('error', { message: 'Only the controller can start the game.' });
    return;
  }
  const { room, engine } = live;
  if (startAttempts.has(room.code)) return;
  if (rematchId
    ? room.gameState.phase !== 'game_over' || room.gameState.matchId !== rematchId
    : room.gameState.phase !== 'lobby') return;

  const attempt = Symbol();
  startAttempts.set(room.code, attempt);
  const started = performance.now();
  let message: string | undefined;
  io.to(room.code).emit('start-status', { phase: 'preparing' });

  try {
    // Yield before deck preparation so the room can see or cancel the attempt.
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (startAttempts.get(room.code) !== attempt || room.hostId !== mapping.playerId || !getMapping(socket.id)) return;
    const consenting = new Set(room.gameState.rematchPlayerIds ?? []);
    const dedicatedId = room.playbackMode === 'manual' ? room.settings.dedicatedDjId : undefined;
    const roster = connectedPlayers(room).filter((player) => !rematchId || consenting.has(player.id) || player.id === dedicatedId);
    const players = roster.filter((player) => player.id !== dedicatedId);
    if (players.length < MIN_PLAYERS || (dedicatedId && !roster.some((player) => player.id === dedicatedId))) {
      socket.emit('error', { message: dedicatedId
        ? `Connect your dedicated DJ and at least ${MIN_PLAYERS} players to start.`
        : `Need at least ${MIN_PLAYERS} ${rematchId ? 'accepting' : 'connected'} players.`, action: 'start-game' });
      return;
    }
    if (!rematchId && room.playbackMode === 'licensed' && !room.players[room.speakerId ?? '']?.connected) {
      room.speakerId = room.hostId;
    }
    if (room.playbackMode === 'licensed' && !room.players[room.speakerId ?? '']?.connected) {
      socket.emit('error', { message: 'Connect the speaker before starting.', action: 'start-game' });
      return;
    }
    const heard = engine.getHeardRecordingIds();
    const playbackMode = room.playbackMode ?? 'manual';
    const deck = getPartyDeck(room.settings, playbackMode, [...heard]);
    const needed = recordingsNeeded(room, players.length);
    const issue = startIssue(room, players.length, !dedicatedId || roster.some((player) => player.id === dedicatedId), deck.length);
    if (issue) {
      socket.emit('error', { message: issue, action: 'start-game' });
      return;
    }
    const heardKeys = new Set(heard);
    if (deck.filter((card) => !heardKeys.has(card.recordingId ?? card.id)).length < needed) {
      message = 'Some recordings will repeat to complete this set.';
    }
    room.recovery = undefined;
    room.startAvailability = undefined;
    live.startsAt = started;
    engine.startGame(deck, players.map((player) => player.id));
    logger.info(rematchId ? 'Rematch started' : 'Match started', {
      code: room.code, matchId: room.gameState.matchId, playerCount: players.length, source: playbackMode,
      prepareMs: performance.now() - started,
    });
  } catch (err) {
    logger.error('Could not prepare game', { code: room.code, error: String(err) });
    socket.emit('error', { message: 'Could not prepare this game. Try again.', action: 'start-game' });
  } finally {
    if (startAttempts.get(room.code) === attempt) {
      startAttempts.delete(room.code);
      io.to(room.code).emit('start-status', { phase: 'idle', message });
    }
  }
}

function withLiveRooms(tables: SavedTable[]): SavedTable[] {
  return tables.map((table) => ({
    ...table,
    currentRoomCode: [...rooms.values()].find(
      ({ room }) => room.savedTableId === table.id && (room.expiresAt === undefined || room.expiresAt > Date.now()),
    )?.room.code,
  }));
}

function handleLeave(io: TunesServer, socket: TunesSocket, voluntary: boolean): void {
  const mapping = getMapping(socket.id);
  const live = getLiveForSocket(socket.id);
  if (!mapping || !live) return;
  const { room, engine, seats } = live;
  const { code, playerId } = mapping;
  room.players[playerId].connected = false;
  socketToRoom.delete(socket.id);
  playerSockets.delete(playerId);
  void socket.leave(code);
  if (room.hostId === playerId) {
    cancelStart(io, code);
    const next = connectedPlayers(room)[0];
    if (next) setController(room, next.id);
  }
  if (voluntary) {
    // Keep identity for terminal statistics while invalidating the resume token.
    const seat = seats[playerId];
    if (seat) seat.resumeTokenHash = '';
    if (room.originalHostId === playerId) room.originalHostId = undefined;
    if (room.gameState.phase === 'lobby') {
      delete room.players[playerId];
      delete seats[playerId];
      if (room.speakerId === playerId) room.speakerId = connectedPlayers(room)[0]?.id;
      if (room.settings.dedicatedDjId === playerId) room.settings.dedicatedDjId = undefined;
    }
  }
  if (!connectedPlayers(room).length) {
    if (voluntary && !Object.values(seats).some((seat) => seat.resumeTokenHash)) {
      try {
        removeRoom(live);
        return;
      } catch (err) {
        logger.error('Could not close abandoned room', { code, error: String(err) });
      }
    }
    scheduleCleanup(live, room.expiresAt);
  }
  if (voluntary) engine.handlePlayerVoluntaryLeave(playerId);
  else engine.handlePlayerDisconnect(playerId);
  persistRoom(code);
  broadcastState(io, live);
  logger.info('Seat disconnected', { code, playerId, matchId: room.gameState.matchId, phase: room.gameState.phase, voluntary });
}

function registerTableHandlers(io: TunesServer, socket: TunesSocket): void {
  socket.on('save-table', (payload) => {
    const mapping = getMapping(socket.id);
    const live = getLiveForSocket(socket.id);
    if (!mapping || !live || live.room.hostId !== mapping.playerId) return;
    const guestId = live.seats[mapping.playerId]?.guestId;
    if (!guestId) return;
    try {
      if (!live.room.savedTableId) {
        const name = isRecord(payload) && isShortString(payload.name, 60) && payload.name.trim()
          ? payload.name.trim()
          : `${live.room.players[mapping.playerId].name}’s table`;
        const members = new Map<string, string>();
        for (const [playerId, seat] of Object.entries(live.seats)) {
          const player = live.room.players[playerId];
          if (player && (seat.resumeTokenHash || live.room.gameState.result?.scores[playerId] !== undefined)) {
            members.set(seat.guestId, player.name);
          }
        }
        live.room.savedTableId = createSavedTable(
          live.room, recoveryFor(live), name,
          [...members].map(([guestId, displayName]) => ({ guestId, displayName })),
          live.completedMatchIds,
        );
        broadcastState(io, live);
      }
      const table = withLiveRooms(getSavedTables(guestId)).find((entry) => entry.id === live.room.savedTableId);
      if (table) socket.emit('table-saved', { table });
      else socket.emit('error', { message: 'This table is private to its original members.' });
    } catch (err) {
      logger.error('Could not save table', { code: live.room.code, error: String(err) });
      socket.emit('error', { message: 'Could not save your table. Try again.' });
    }
  });

  socket.on('open-table', (payload) => {
    if (!isRecord(payload) || !isShortString(payload.tableId, 64) || !isShortString(payload.guestToken, 64)
      || refuseIfSeated(socket)) return;
    const name = parseName(payload, socket);
    if (!name) return;
    const guestId = authenticateGuest(payload.guestToken);
    const config = guestId && getSavedTableConfig(payload.tableId, guestId);
    if (!guestId || !config) {
      socket.emit('error', { message: 'This private table is unavailable to this device.' });
      return;
    }
    const guest = { guestId, guestToken: payload.guestToken };
    const existing = [...rooms.values()].find((live) => live.room.savedTableId === payload.tableId);
    const live = existing && getRoomIfLive(existing.room.code);
    if (live) joinRoom(io, socket, live, name, guest);
    else {
      config.settings.dedicatedDjId = undefined;
      if (config.playbackMode === 'licensed' && !enabledLicensedPacks().some((pack) => pack.id === config.settings.packId)) {
        config.playbackMode = 'manual';
      }
      if (!dinnerStartsEnabled() && config.settings.mode === 'dinner') config.settings.mode = 'original';
      createRoom(io, socket, name, guest, config.playbackMode, config.settings, payload.tableId, config.heardRecordingIds);
    }
  });
}

export function registerRoomHandlers(io: TunesServer, socket: TunesSocket): void {
  socket.on('create-room', (payload) => {
    if (!isRecord(payload) || refuseIfSeated(socket)) return;
    const name = parseName(payload, socket);
    if (!name) return;
    if (payload.playbackMode !== undefined && payload.playbackMode !== 'manual' && payload.playbackMode !== 'licensed') {
      socket.emit('error', { message: 'This music source is unavailable. Choose Manual DJ or an available licensed pack.' });
      return;
    }
    if (payload.spotifyAccessToken) {
      socket.emit('error', { message: 'Refresh Tunes to use the available hosting modes.', code: 'REFRESH_REQUIRED' });
      return;
    }
    const playbackMode = payload.playbackMode === 'licensed' ? 'licensed' : 'manual';
    const packs = playbackMode === 'licensed' ? enabledLicensedPacks() : [];
    const pack = payload.packId ? packs.find((item) => item.id === payload.packId) : packs[0];
    if (playbackMode === 'licensed' && !pack) {
      socket.emit('error', { message: 'That licensed pack is unavailable.' });
      return;
    }
    createRoom(io, socket, name, getOrCreateGuest(payload.guestToken), playbackMode, {
      mode: 'original', cardsToWin: DEFAULT_CARDS_TO_WIN, songPack: 'standard', packId: pack?.id,
    });
  });

  socket.on('join-room', (payload) => {
    if (!isRecord(payload) || !isShortString(payload.code, 10) || refuseIfSeated(socket)) return;
    const name = parseName(payload, socket);
    if (!name) return;
    const live = getRoomIfLive(payload.code.trim().toUpperCase());
    if (live) joinRoom(io, socket, live, name, getOrCreateGuest(payload.guestToken));
    else socket.emit('error', { message: 'Room not found or expired' });
  });
  socket.on('rejoin-room', (payload) => rejoinRoom(io, socket, payload));
  socket.on('leave-room', () => {
    handleLeave(io, socket, true);
    socket.emit('room-left');
  });

  socket.on('update-settings', (settings) => {
    const mapping = getMapping(socket.id);
    const live = getLiveForSocket(socket.id);
    if (!mapping || !live || live.room.hostId !== mapping.playerId || live.room.gameState.phase !== 'lobby') return;
    if (startAttempts.has(live.room.code)) return;
    const { room } = live;
    const previous = { settings: room.settings, playbackMode: room.playbackMode };
    if (!updateRoomSettings(room, settings)) {
      socket.emit('error', { message: 'These settings are unavailable for this table.', action: 'update-settings' });
      return;
    }
    try {
      const guestId = live.seats[mapping.playerId]?.guestId;
      const saveSettings = guestId && room.savedTableId && getSavedTableConfig(room.savedTableId, guestId);
      checkpointRoom(room.code, Boolean(saveSettings));
      broadcastState(io, live);
    } catch (err) {
      Object.assign(room, previous);
      logger.error('Could not save room settings', { code: room.code, error: String(err) });
      socket.emit('error', { message: 'Could not save these settings. Try again.', action: 'update-settings' });
    }
  });
  socket.on('start-game', () => void startGame(io, socket));
  socket.on('start-rematch', (payload) => {
    if (isRecord(payload) && isShortString(payload.matchId, 64)) void startGame(io, socket, payload.matchId);
  });
  socket.on('cancel-start', () => {
    const live = getLiveForSocket(socket.id);
    if (live && live.room.hostId === getMapping(socket.id)?.playerId) cancelStart(io, live.room.code);
  });

  registerGameActionHandlers(socket, {
    getEngine: () => getLiveForSocket(socket.id)?.engine ?? null,
    getMapping,
  });

  socket.on('restart-game', () => {
    const mapping = getMapping(socket.id);
    const live = getLiveForSocket(socket.id);
    if (!mapping || !live || live.room.hostId !== mapping.playerId) return;
    const { room, engine, seats } = live;
    if (room.gameState.phase !== 'lobby' && room.gameState.phase !== 'game_over') {
      socket.emit('error', { message: 'Finish the active match before opening a new game.' });
      return;
    }
    cancelStart(io, room.code);
    room.recovery = undefined;
    for (const [id, player] of Object.entries(room.players)) {
      if (!player.connected && !seats[id]?.resumeTokenHash) {
        delete room.players[id];
        delete seats[id];
      }
    }
    engine.resetGame();
    updateStartAvailability(room);
    persistRoom(room.code);
    for (const player of connectedPlayers(room)) {
      const socketId = playerSockets.get(player.id);
      if (socketId) io.to(socketId).emit('game-restarted', { room: engine.publicRoom(player.id) });
    }
  });
  socket.on('buzz', () => {
    const mapping = getMapping(socket.id);
    const live = getLiveForSocket(socket.id);
    if (mapping && live?.room.gameState.phase === 'playing' && live.room.gameState.audio?.status === 'playing'
      && live.room.gameState.currentTurnPlayerId !== mapping.playerId) {
      io.to(mapping.code).emit('player-buzzed', { playerId: mapping.playerId });
    }
  });

  registerTableHandlers(io, socket);
  registerStatsHandlers(socket, () => {
    const mapping = getMapping(socket.id);
    return mapping && rooms.get(mapping.code)?.seats[mapping.playerId]?.guestId;
  }, withLiveRooms);
  socket.on('disconnect', () => handleLeave(io, socket, false));
}

export function getRoomCount(): number {
  return rooms.size;
}

export function getTotalPlayerCount(): number {
  return [...rooms.values()].reduce((count, live) => count + connectedPlayers(live.room).length, 0);
}

export function stopRoomRuntime(): void {
  for (const { cleanupTimer, engine } of rooms.values()) {
    clearTimeout(cleanupTimer);
    engine.dispose();
  }
  rooms.clear();
  socketToRoom.clear();
  playerSockets.clear();
  attachingSockets.clear();
  startAttempts.clear();
}
