import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, Room, ServerToClientEvents } from '@tunes/shared';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
type TunesServer = Server<ClientToServerEvents, ServerToClientEvents>;

const dataDir = mkdtempSync(join(tmpdir(), 'tunes-room-test-'));
const clients = new Set<Client>();
let database: typeof import('./database');
let rooms: typeof import('./rooms');
let server: TunesServer;
let url: string;

async function startServer() {
  const http = createServer();
  server = new Server(http);
  server.on('connection', (socket) => rooms.registerRoomHandlers(server, socket));
  database.initDatabase();
  rooms.restoreRoomsFromDatabase(server);
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
}

async function newClient(): Promise<Client> {
  const client: Client = connect(url, { transports: ['websocket'], reconnection: false });
  clients.add(client);
  await new Promise<void>((resolve, reject) => {
    client.once('connect', resolve);
    client.once('connect_error', (error) => reject(error.description ?? error));
  });
  return client;
}

function once<Event extends keyof ServerToClientEvents>(
  client: Client, event: Event, accept?: (payload: Parameters<ServerToClientEvents[Event]>[0]) => boolean,
): Promise<Parameters<ServerToClientEvents[Event]>[0]> {
  type Payload = Parameters<ServerToClientEvents[Event]>[0];
  return new Promise<Payload>((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off(event, handler as ServerToClientEvents[Event]);
      reject(new Error(`Timed out on ${event}`));
    }, 2000);
    const handler = (payload: Payload) => {
      if (accept && !accept(payload)) return;
      clearTimeout(timer);
      client.off(event, handler as ServerToClientEvents[Event]);
      resolve(payload);
    };
    client.on(event, handler as ServerToClientEvents[Event]);
  });
}

async function hostRoom(client: Client) {
  const created = once(client, 'room-created');
  client.emit('create-room', { playerName: 'Alex' });
  return created;
}

async function joinRoom(client: Client, code: string) {
  const joined = once(client, 'room-joined');
  client.emit('join-room', { code, playerName: 'Alex' });
  return joined;
}

async function crashAndRestore() {
  // Disposing process memory before closing connections avoids writing an orderly disconnect.
  rooms.stopRoomRuntime();
  for (const client of clients) client.disconnect();
  clients.clear();
  await server.close();
  database.closeDatabase();
  await startServer();
}

beforeAll(async () => {
  vi.stubEnv('DATA_DIR', dataDir);
  database = await import('./database');
  rooms = await import('./rooms');
  await startServer();
});

afterAll(async () => {
  for (const client of clients) client.disconnect();
  await server?.close();
  rooms?.stopRoomRuntime();
  database?.closeDatabase();
  vi.unstubAllEnvs();
  rmSync(dataDir, { recursive: true, force: true });
});

it('fences a superseded socket and permits a fresh room after leaving', async () => {
  const host = await newClient();
  const guest = await newClient();
  const replacement = await newClient();
  const created = await hostRoom(host);
  const joined = await joinRoom(guest, created.code);
  const proof = { code: created.code, playerId: created.playerId, resumeToken: created.resumeToken };
  const notAuthorized = once(replacement, 'error');
  replacement.emit('rejoin-room', { ...proof, resumeToken: joined.resumeToken });
  expect(await notAuthorized).toMatchObject({ code: 'REJOIN_FAILED' });

  const oldSeat = once(host, 'error');
  const resumed = once(replacement, 'room-joined');
  const roster = once(guest, 'state-sync', (room) => room.players[created.playerId]?.connected);
  replacement.emit('rejoin-room', proof);
  expect(await oldSeat).toMatchObject({ code: 'SEAT_REPLACED' });
  expect(await resumed).toMatchObject({ playerId: created.playerId, resumeToken: created.resumeToken });
  expect((await roster).hostId).toBe(created.playerId);

  const transferred = once(guest, 'state-sync', (room) => room.hostId === joined.playerId);
  const left = once(replacement, 'room-left');
  replacement.emit('leave-room');
  await left;
  expect((await transferred).players[created.playerId]).toBeUndefined();
  expect((await hostRoom(replacement)).code).not.toBe(created.code);
});

it('restores an interrupted Dinner Set and keeps locked guesses private', async () => {
  const host = await newClient();
  const guest = await newClient();
  const third = await newClient();
  const created = await hostRoom(host);
  const joined = await joinRoom(guest, created.code);
  const another = await joinRoom(third, created.code);
  expect(new Set([created.guestToken, joined.guestToken, another.guestToken]).size).toBe(3);
  const privateTokens = [created.resumeToken, created.guestToken, joined.resumeToken, joined.guestToken];
  for (const token of privateTokens) expect(JSON.stringify(another.room)).not.toContain(token);

  const settings = once(host, 'state-sync', (room) => room.settings.mode === 'dinner');
  host.emit('update-settings', { mode: 'dinner' });
  await settings;
  const started = once(host, 'state-sync', (room) => room.gameState.phase === 'anchor_preview');
  host.emit('start-game');
  host.emit('start-game');
  const anchors = await started;
  const scope = { matchId: anchors.gameState.matchId!, roundId: anchors.gameState.roundId! };
  const seating = [[host, created.playerId], [guest, joined.playerId], [third, another.playerId]] as const;
  const views = seating.map(([client]) => once(client, 'state-sync', (room) => room.gameState.phase === 'playing'));
  host.emit('skip-anchors', scope);
  const atCue = await Promise.all(views);
  const audio = atCue[0].gameState.audio!;
  const operatorIndex = seating.findIndex(([, id]) => id === audio.operatorId);
  const guesserIndex = (operatorIndex + 1) % seating.length;
  const watchingIndex = (operatorIndex + 2) % seating.length;
  expect(atCue[operatorIndex].gameState.audio?.recording?.title).toBeTruthy();
  expect(atCue[guesserIndex].gameState.audio?.recording).toBeUndefined();
  expect(atCue[watchingIndex].gameState.currentSong).toBeNull();
  const tableSaved = once(host, 'table-saved');
  host.emit('save-table', { name: 'Friday dinner' });
  const { table } = await tableSaved;
  const action = {
    matchId: atCue[0].gameState.matchId!, roundId: atCue[0].gameState.roundId!, cueId: audio.cueId!,
  };
  const playing = once(host, 'state-sync', (room) => room.gameState.audio?.status === 'playing');
  seating[operatorIndex][0].emit('audio-ready', action);
  await playing;

  const helper = new Database(join(dataDir, 'tunes.db'));
  const guessAction = { ...action, position: 1, actionId: 'guest-placement' };
  try {
    helper.exec(`
      CREATE TRIGGER fail_room_action BEFORE UPDATE ON rooms
      BEGIN SELECT RAISE(ABORT, 'simulated action write failure'); END;
    `);
    const rejectedAction = once(seating[guesserIndex][0], 'error');
    seating[guesserIndex][0].emit('lock-guess', guessAction);
    expect(await rejectedAction).toMatchObject({ action: 'lock-guess', code: 'ACTION_SAVE_FAILED' });
    const saved = database.loadRoom(created.code)?.recovery?.game;
    expect(saved?.round.guesses[seating[guesserIndex][1]]?.locked).not.toBe(true);
  } finally {
    helper.exec('DROP TRIGGER IF EXISTS fail_room_action');
    helper.close();
  }

  const locked = once(seating[watchingIndex][0], 'state-sync', (room) => room.gameState.dinner?.submittedCount === 1);
  seating[guesserIndex][0].emit('lock-guess', guessAction);
  expect((await locked).gameState.dinner).toMatchObject({ submittedCount: 1, myPosition: null, myLocked: false });
  const checkpoint = database.loadRoom(created.code);
  expect(checkpoint?.recovery?.game?.state.matchId).toBe(scope.matchId);
  expect(checkpoint?.recovery?.game?.heard).toHaveLength(1);

  await crashAndRestore();
  const recovered: Room[] = [];
  const resumedClients: Client[] = [];
  for (const seat of [created, joined, another]) {
    const client = await newClient();
    resumedClients.push(client);
    const resumed = once(client, 'room-joined');
    client.emit('rejoin-room', { code: created.code, playerId: seat.playerId, resumeToken: seat.resumeToken });
    recovered.push((await resumed).room);
  }
  expect(recovered[guesserIndex].gameState).toMatchObject({
    phase: 'playing',
    matchId: scope.matchId,
    roundId: action.roundId,
    audio: { status: 'paused', reason: 'server-restart', cueId: action.cueId },
    timing: { deadline: null, remainingMs: expect.any(Number) },
    dinner: { submittedCount: 1, myPosition: 1, myLocked: true },
  });
  expect(recovered[watchingIndex].gameState.dinner?.myPosition).toBeNull();
  expect(recovered[watchingIndex].gameState.audio?.recording).toBeUndefined();
  expect(recovered[operatorIndex].gameState.audio?.recording).toEqual(atCue[operatorIndex].gameState.audio?.recording);

  for (const client of resumedClients) {
    const left = once(client, 'room-left');
    client.emit('leave-room');
    await left;
  }
  expect(database.loadRoom(created.code)).toBeNull();
  const open = once(resumedClients[0], 'room-created');
  resumedClients[0].emit('open-table', { tableId: table.id, playerName: 'Alex again', guestToken: created.guestToken });
  const reopened = await open;
  expect(reopened.room.savedTableId).toBe(table.id);
  expect(database.loadRoom(reopened.code)?.recovery?.game?.heard).toEqual(checkpoint?.recovery?.game?.heard);
  expect(database.loadRoom(reopened.code)?.room.gameState.phase).toBe('lobby');
});

it('offers a fresh start for incompatible rooms and rejects expired seats', async () => {
  const template = (await hostRoom(await newClient())).room;
  const legacy = {
    ...template, code: 'LGAC', playbackMode: 'spotify' as const,
    gameState: { ...template.gameState, phase: 'challenge' as const, deckSize: 50 },
  };
  database.saveRoom(legacy.code, legacy, 'legacy-provider-token');
  database.saveRoom('OLDT', { ...template, code: 'OLDT' }, undefined, {
    version: 1, seats: {}, expiresAt: Date.now() - 1,
  });
  await crashAndRestore();
  const client = await newClient();
  const expired = once(client, 'error');
  client.emit('rejoin-room', { code: 'OLDT', playerId: template.hostId, resumeToken: 'expired' });
  expect(await expired).toMatchObject({ code: 'REJOIN_EXPIRED' });
  const incompatible = once(client, 'error');
  client.emit('rejoin-room', { code: legacy.code, playerId: legacy.hostId, resumeToken: 'insecure-legacy' });
  expect(await incompatible).toMatchObject({ code: 'ROOM_RESTART_REQUIRED' });
  const fresh = await joinRoom(client, legacy.code);
  expect(fresh.room).toMatchObject({ hostId: fresh.playerId, playbackMode: 'manual', gameState: { phase: 'lobby', deckSize: 0 } });
  expect(Object.keys(fresh.room.players)).toEqual([fresh.playerId]);
  expect(database.loadRoom(legacy.code)?.spotifyToken).toBeNull();
});

it('holds the remaining Classic clock through a six-minute simulated break', async () => {
  const host = await newClient();
  const guest = await newClient();
  const created = await hostRoom(host);
  await joinRoom(guest, created.code);
  const anchorView = once(host, 'state-sync', (room) => room.gameState.phase === 'anchor_preview');
  host.emit('start-game');
  const anchor = await anchorView;
  const matchId = anchor.gameState.matchId!;
  const cueView = once(host, 'state-sync', (room) => room.gameState.phase === 'playing');
  host.emit('skip-anchors', { matchId, roundId: anchor.gameState.roundId! });
  const { gameState } = await cueView;
  const operator = gameState.audio?.operatorId === created.playerId ? host : guest;
  const playing = once(host, 'state-sync', (room) => room.gameState.audio?.status === 'playing');
  operator.emit('audio-ready', { matchId, roundId: gameState.roundId!, cueId: gameState.audio!.cueId! });
  await playing;
  host.disconnect();
  guest.disconnect();
  const awaySince = Date.now();
  const paused = await vi.waitFor(() => {
    const saved = database.loadRoom(created.code);
    expect(saved?.recovery?.expiresAt).toBeGreaterThan(awaySince + 29 * 60_000);
    expect(saved?.recovery?.game?.state.audio?.reason).toBe('all-away');
    return saved!.recovery!.game!;
  });

  const future = vi.spyOn(Date, 'now').mockReturnValue(awaySince + 6 * 60_000);
  try {
    const client = await newClient();
    const returned = once(client, 'room-joined');
    client.emit('rejoin-room', { code: created.code, playerId: created.playerId, resumeToken: created.resumeToken });
    expect((await returned).room.gameState).toMatchObject({
      matchId, roundId: gameState.roundId, phase: 'playing',
      timing: { deadline: null, remainingMs: paused.clockRemaining },
    });
  } finally {
    future.mockRestore();
  }
});

it('runs gated Spotify Classic in the same room and restores a private, paused cue', async () => {
  const manifest = join(dataDir, 'spotify-fixture.json');
  const manual = JSON.parse(readFileSync(join(__dirname, '../../data/manual-recordings.json'), 'utf8'));
  const tracks = manual.slice(0, 12).map(({ recordingId }: { recordingId: string }, index: number) => ({
    recordingId, spotifyTrackId: String(index + 1).padStart(22, 'X'),
  }));
  writeFileSync(manifest, JSON.stringify({ tracks }));
  const gate = process.env.TUNES_SPOTIFY_CLASSIC_ENABLED;
  const previousManifest = process.env.TUNES_SPOTIFY_MANIFEST;
  vi.stubEnv('TUNES_SPOTIFY_MANIFEST', manifest);
  vi.stubEnv('TUNES_SPOTIFY_CLASSIC_ENABLED', 'false');
  try {
    let host = await newClient();
    let guest = await newClient();
    const created = await hostRoom(host);
    const joined = await joinRoom(guest, created.code);
    const changeSource = (playbackMode: 'manual' | 'spotify') => {
      const synced = once(host, 'state-sync', (room) => room.playbackMode === playbackMode);
      host.emit('update-settings', { mode: 'original', playbackMode });
      return synced;
    };
    const disabled = once(host, 'error', (error) => error.action === 'update-settings');
    host.emit('update-settings', { mode: 'original', playbackMode: 'spotify' });
    await disabled;

    vi.stubEnv('TUNES_SPOTIFY_CLASSIC_ENABLED', 'true');
    const dinnerRejected = once(host, 'error', (error) => error.action === 'update-settings');
    host.emit('update-settings', { mode: 'dinner', playbackMode: 'spotify' });
    await dinnerRejected;
    expect(await changeSource('spotify')).toMatchObject({
      code: created.code, settings: { mode: 'original' },
      startAvailability: { playable: 12, required: 11, ready: true },
    });
    const dinner = once(host, 'state-sync', (room) => room.settings.mode === 'dinner');
    host.emit('update-settings', { mode: 'dinner' });
    expect((await dinner).playbackMode).toBe('manual');
    await changeSource('spotify');

    const tooFew = once(host, 'state-sync', (room) => room.settings.cardsToWin === 15);
    host.emit('update-settings', { cardsToWin: 15 });
    expect((await tooFew).startAvailability).toMatchObject({ playable: 12, required: 16, ready: false });
    const rejected = once(host, 'error', (error) => error.action === 'start-game');
    host.emit('start-game');
    expect(await rejected).toMatchObject({ message: expect.stringContaining('Only 12 usable recordings') });
    const enough = once(host, 'state-sync', (room) => room.startAvailability?.ready === true);
    host.emit('update-settings', { cardsToWin: 10 });
    await enough;

    const anchored = once(host, 'state-sync', (room) => room.gameState.phase === 'anchor_preview');
    host.emit('start-game');
    const anchor = (await anchored).gameState;
    const matchId = anchor.matchId!;
    const nextCue = (client: Client) => once(client, 'state-sync', (room) => room.gameState.audio?.status === 'awaiting_audio');
    const hostCue = nextCue(host);
    const guestCue = nextCue(guest);
    host.emit('skip-anchors', { matchId, roundId: anchor.roundId! });
    const [speakerView, watcherView] = await Promise.all([hostCue, guestCue]);
    const first = speakerView.gameState;
    const scope = { matchId, roundId: first.roundId! };
    const cue = { ...scope, cueId: first.audio!.cueId! };
    const trackId = first.audio?.source?.spotifyTrackId;
    expect(first.audio).toMatchObject({ kind: 'automatic', operatorId: created.playerId, source: { spotifyTrackId: expect.any(String) } });
    expect(first.timing?.deadline).toBeNull();
    expect(first.currentSong).toBeNull();
    expect(JSON.stringify(watcherView)).not.toContain(trackId);

    const blocked = once(guest, 'error', (error) => error.action === 'audio-ready');
    guest.emit('audio-ready', cue);
    expect(await blocked).toMatchObject({ code: 'CUE_MOVED_ON' });
    const playing = once(host, 'state-sync', (room) => room.gameState.audio?.status === 'playing');
    host.emit('audio-ready', cue);
    expect((await playing).gameState.timing?.deadline).toBeGreaterThan(Date.now());
    const hostGuesses = first.currentTurnPlayerId === created.playerId;
    const guesser = hostGuesses ? host : guest;
    const locked = once(host, 'state-sync', (room) => room.gameState.phase === 'challenge');
    guesser.emit('place-card', { ...scope, position: 0 });
    await locked;
    const interrupted = once(host, 'state-sync', (room) => room.gameState.audio?.status === 'paused');
    host.emit('audio-interrupted', cue);
    expect((await interrupted).gameState).toMatchObject({ pendingPlacement: 0, timing: { deadline: null } });
    const checkpoint = database.loadRoom(created.code)!;
    expect(checkpoint.recovery?.version).toBe(2);
    expect(checkpoint.spotifyToken).toBeNull();

    await crashAndRestore();
    const resumeSeat = async (client: Client, seat: typeof created | typeof joined) => {
      const resumed = once(client, 'room-joined');
      client.emit('rejoin-room', { code: created.code, playerId: seat.playerId, resumeToken: seat.resumeToken });
      return (await resumed).room;
    };
    host = await newClient();
    guest = await newClient();
    const restored = await resumeSeat(host, created);
    const recoveredWatcher = await resumeSeat(guest, joined);
    expect(restored).toMatchObject({
      playbackMode: 'spotify',
      gameState: { ...scope, phase: 'challenge', pendingPlacement: 0,
        audio: { status: 'paused', cueId: cue.cueId, reason: 'server-restart', source: { spotifyTrackId: trackId } } },
    });
    expect(JSON.stringify(recoveredWatcher)).not.toContain(trackId);

    const resumed = nextCue(host);
    host.emit('resume-audio', cue);
    const renewed = (await resumed).gameState.audio!;
    expect(renewed.cueId).not.toBe(cue.cueId);
    const stale = once(host, 'error', (error) => error.action === 'audio-ready');
    host.emit('audio-ready', cue);
    expect(await stale).toMatchObject({ code: 'CUE_MOVED_ON' });
    const resumedPlaying = once(guest, 'state-sync', (room) => room.gameState.audio?.status === 'playing');
    host.emit('audio-ready', { ...scope, cueId: renewed.cueId! });
    await resumedPlaying;
    const paused = once(guest, 'state-sync', (room) => room.gameState.audio?.status === 'paused');
    host.disconnect();
    expect((await paused).gameState).toMatchObject({ pendingPlacement: 0, timing: { deadline: null } });

    host = await newClient();
    vi.stubEnv('TUNES_SPOTIFY_CLASSIC_ENABLED', 'false');
    expect((await resumeSeat(host, created)).gameState.audio?.source).toBeUndefined();
    const revoked = once(host, 'error', (error) => error.action === 'resume-audio');
    host.emit('resume-audio', { ...scope, cueId: renewed.cueId! });
    expect(await revoked).toMatchObject({ message: expect.stringContaining('unavailable') });
    vi.stubEnv('TUNES_SPOTIFY_CLASSIC_ENABLED', 'true');

    const sourceAgain = nextCue(host);
    host.emit('resume-audio', { ...scope, cueId: renewed.cueId! });
    const current = (await sourceAgain).gameState.audio!;
    const playingAgain = once(host, 'state-sync', (room) => room.gameState.audio?.status === 'playing');
    host.emit('audio-ready', { ...scope, cueId: current.cueId! });
    await playingAgain;
    const replacement = await newClient();
    const fenced = once(host, 'error', (error) => error.code === 'SEAT_REPLACED');
    expect((await resumeSeat(replacement, created)).gameState.audio).toMatchObject({ status: 'paused' });
    await fenced;
    const recued = nextCue(replacement);
    replacement.emit('resume-audio', { ...scope, cueId: current.cueId! });
    const finalCue = (await recued).gameState.audio!;
    const audible = once(replacement, 'state-sync', (room) => room.gameState.audio?.status === 'playing');
    replacement.emit('audio-ready', { ...scope, cueId: finalCue.cueId! });
    await audible;
    const guesserSeat = hostGuesses ? replacement : guest;
    const challengerSeat = hostGuesses ? guest : replacement;
    const named = once(guesserSeat, 'state-sync', (room) => room.gameState.classic?.myNamingDone === true);
    guesserSeat.emit('done-guessing', scope);
    await named;
    const revealed = once(guest, 'state-sync', (room) => room.gameState.phase === 'reveal');
    challengerSeat.emit('pass-challenge', scope);
    const revealView = await revealed;
    expect(revealView.gameState.reveal?.song.recordingId).toBe(tracks.find((track: { spotifyTrackId: string }) => track.spotifyTrackId === trackId)?.recordingId);
    expect(JSON.stringify(revealView)).not.toContain(trackId);
    const ended = once(replacement, 'state-sync', (room) => room.gameState.phase === 'game_over');
    replacement.emit('end-match', scope);
    await ended;
    for (const client of [replacement, guest]) {
      const consented = once(client, 'state-sync', (room) =>
        room.gameState.rematchPlayerIds?.includes(client === replacement ? created.playerId : joined.playerId) === true);
      client.emit('rematch-consent', { ...scope, accept: true });
      await consented;
    }
    const rematched = once(replacement, 'state-sync', (room) => room.gameState.phase === 'anchor_preview');
    replacement.emit('start-rematch', { matchId });
    expect(await rematched).toMatchObject({ code: created.code, playbackMode: 'spotify' });
  } finally {
    vi.stubEnv('TUNES_SPOTIFY_CLASSIC_ENABLED', gate);
    vi.stubEnv('TUNES_SPOTIFY_MANIFEST', previousManifest);
  }
});

it('validates licensed readiness and sizes views for concurrent 6- and 12-seat rooms', async () => {
  async function createTable(size: number) {
    const host = await newClient();
    const created = await hostRoom(host);
    const guests = await Promise.all(Array.from({ length: size - 1 }, newClient));
    await Promise.all(guests.map((guest) => joinRoom(guest, created.code)));
    return { host, created };
  }

  const tables = await Promise.all([createTable(6), createTable(12)]);
  const smallHost = tables[0].host;
  const unsuitable = once(smallHost, 'state-sync', (room) => room.settings.dinnerRounds === 24);
  smallHost.emit('update-settings', {
    mode: 'dinner', playbackMode: 'licensed', packId: 'independent-instrumentals', dinnerRounds: 24,
  });
  expect((await unsuitable).startAvailability).toMatchObject({ playable: 24, required: 27, ready: false });
  const failedStart = once(smallHost, 'error');
  smallHost.emit('start-game');
  expect(await failedStart).toMatchObject({ action: 'start-game', message: expect.stringContaining('Only 24 usable recordings') });

  const observations = await Promise.all(tables.map(async ({ host, created }, index) => {
    const ready = once(host, 'state-sync', (room) => room.settings.mode === 'dinner' && room.playbackMode === 'manual');
    host.emit('update-settings', { mode: 'dinner', playbackMode: 'manual', dinnerRounds: index === 0 ? 12 : 24 });
    const { startAvailability } = await ready;
    expect(startAvailability?.ready).toBe(true);
    const started = once(host, 'state-sync', (room) => room.gameState.phase === 'anchor_preview');
    const before = performance.now();
    host.emit('start-game');
    host.emit('start-game');
    const anchor = await started;
    const startMs = performance.now() - before;
    const checkpoint = database.loadRoom(created.code)?.recovery?.game;
    expect(checkpoint?.state.matchId).toBe(anchor.gameState.matchId);
    const cue = once(host, 'state-sync', (room) => room.gameState.phase === 'playing');
    host.emit('skip-anchors', { matchId: anchor.gameState.matchId!, roundId: anchor.gameState.roundId! });
    const room = await cue;
    expect(room.gameState.currentSong).toBeNull();
    expect(Object.keys(room.players)).toHaveLength(index === 0 ? 6 : 12);
    return {
      seats: Object.keys(room.players).length,
      startMs: Math.round(startMs * 10) / 10,
      cueViewBytes: Buffer.byteLength(JSON.stringify(room)),
      checkpointBytes: Buffer.byteLength(JSON.stringify(checkpoint)),
    };
  }));
  process.stdout.write(`${JSON.stringify({ test: 'concurrent rooms', observations })}\n`);
});
