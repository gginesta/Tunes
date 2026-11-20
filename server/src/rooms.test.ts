import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHALLENGE_WINDOW_MS, TURN_TIME_MS, type ClientToServerEvents, type ServerToClientEvents } from '@tunes/shared';
import { deleteRoom } from './database';
import { registerRoomHandlers } from './rooms';

vi.mock('./database', () => ({
  deleteRoom: vi.fn(),
  loadAllRooms: vi.fn(() => []),
  saveRoom: vi.fn(),
  saveGameResult: vi.fn(),
  updateLeaderboard: vi.fn(),
}));

vi.mock('./songs', () => ({
  selectGameDeck: () => Array.from({ length: 15 }, (_, i) => ({
    id: `song-${i}`,
    title: `Song ${i}`,
    artist: 'Artist',
    year: 1980 + i,
    previewUrl: `https://example.com/song-${i}.mp3`,
  })),
  getBuiltInDeckFilters: () => ({}),
  getEffectiveSongPack: () => 'standard',
  resolveTrackIds: (deck: unknown) => Promise.resolve(deck),
  fetchPlaylistDeck: vi.fn(),
}));

vi.mock('./shuffle', () => ({ fisherYatesShuffle: (items: unknown[]) => items }));
vi.mock('./logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

type Event = keyof ServerToClientEvents;
type Input = keyof ClientToServerEvents;

function createTransport() {
  const sockets = new Map<string, ReturnType<typeof registerSocket>>();
  const members = new Map<string, Set<string>>();
  const broadcast = (code: string, excluding?: string) => ({
    emit(event: Event, payload: unknown) {
      for (const id of members.get(code) ?? []) {
        if (id !== excluding) sockets.get(id)?.emit(event, payload);
      }
    },
  });
  const io = { sockets: { sockets }, to: broadcast };

  function registerSocket(id: string) {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const events: { name: Event; payload: unknown }[] = [];
    const socket = {
      id,
      on(name: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(name, handler);
      },
      emit(name: Event, payload: unknown) {
        events.push({ name, payload: structuredClone(payload) });
      },
      join(code: string) {
        if (!members.has(code)) members.set(code, new Set());
        members.get(code)?.add(id);
      },
      leave(code: string) {
        members.get(code)?.delete(id);
      },
      to: (code: string) => broadcast(code, id),
      async send<E extends Input>(event: E, ...args: Parameters<ClientToServerEvents[E]>) {
        await handlers.get(event)?.(...args);
      },
      disconnect() {
        sockets.delete(id);
        for (const roomMembers of members.values()) roomMembers.delete(id);
        handlers.get('disconnect')?.();
      },
      payloads<E extends Event>(event: E) {
        return events.filter(({ name }) => name === event)
          .map(({ payload }) => payload as Parameters<ServerToClientEvents[E]>[0]);
      },
    };
    sockets.set(id, socket);
    registerRoomHandlers(
      io as unknown as Parameters<typeof registerRoomHandlers>[0],
      socket as unknown as Parameters<typeof registerRoomHandlers>[1],
    );
    return socket;
  }

  return { registerSocket };
}

async function startRoom() {
  const { registerSocket } = createTransport();
  const host = registerSocket('host');
  const guest = registerSocket('guest');
  await host.send('create-room', { playerName: 'Host', spotifyAccessToken: 'existing-token' });
  const { code, playerId: hostId } = host.payloads('room-created')[0];
  await guest.send('join-room', { code, playerName: 'Guest' });
  const { playerId: guestId } = guest.payloads('room-joined')[0];
  await host.send('start-game');
  vi.advanceTimersByTime(3500);
  return { registerSocket, code, hostId, guestId, host, guest };
}

describe('same-room host recovery', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('holds the guest turn and remaining time while the host disconnects and restores the same seat', async () => {
    const { registerSocket, code, hostId, guestId, host, guest } = await startRoom();
    await host.send('skip-song');
    const turn = guest.payloads('new-turn').at(-1)!;
    expect(turn.turnPlayerId).toBe(guestId);
    vi.advanceTimersByTime(10_000);

    host.disconnect();
    vi.advanceTimersByTime(6 * 60_000);
    await guest.send('place-card', { position: 0 });
    const held = guest.payloads('state-sync').at(-1)!;
    expect(held.hostId).toBe(hostId);
    expect(held.hostRecovery?.reconnectDeadline).toBeNull();
    expect(held.gameState.turnDeadline).toBeNull();
    expect(held.gameState.currentSong?.id).toBe(turn.songCard.id);
    expect(guest.payloads('card-placed')).toHaveLength(0);

    const returningHost = registerSocket('returning-host');
    await returningHost.send('rejoin-room', { code, playerId: hostId, waitForPlayback: true });
    const { room, rejoined } = returningHost.payloads('room-joined').at(-1)!;
    expect(rejoined).toBe(true);
    expect(room.hostId).toBe(hostId);
    expect(room.players[hostId].connected).toBe(true);
    expect(room.gameState.currentTurnPlayerId).toBe(guestId);
    expect(room.gameState.currentSong?.id).toBe(turn.songCard.id);
    expect(returningHost.payloads('new-turn')).toHaveLength(0);
    expect(returningHost.payloads('game-started')).toHaveLength(0);
    const recoveryId = room.hostRecovery!.id;

    await guest.send('host-playback-ready', { recoveryId });
    expect(guest.payloads('state-sync').at(-1)?.hostRecovery?.id).toBe(recoveryId);
    await returningHost.send('host-playback-ready', { recoveryId });
    expect(guest.payloads('state-sync').at(-1)?.hostRecovery).toBeUndefined();
    expect(guest.payloads('state-sync').at(-1)?.gameState.turnDeadline).toBe(Date.now() + TURN_TIME_MS - 10_000);
  });

  it('holds challenge state through repeated suspension and only resumes the latest recovery ID', async () => {
    const { code, hostId, host, guest } = await startRoom();
    await host.send('place-card', { position: 0 });
    vi.advanceTimersByTime(CHALLENGE_WINDOW_MS - 1000);
    await host.send('host-playback-suspended');
    const first = host.payloads('state-sync').at(-1)!.hostRecovery!.id;
    vi.advanceTimersByTime(70_000);
    await host.send('rejoin-room', { code, playerId: hostId, waitForPlayback: true });
    expect(host.payloads('room-joined').at(-1)?.room.hostRecovery?.id).toBe(first);

    await host.send('host-playback-suspended');
    const latest = host.payloads('state-sync').at(-1)!.hostRecovery!.id;
    expect(latest).not.toBe(first);
    await host.send('host-playback-ready', { recoveryId: first });
    vi.advanceTimersByTime(CHALLENGE_WINDOW_MS);
    expect(guest.payloads('reveal')).toHaveLength(0);
    await host.send('host-playback-ready', { recoveryId: latest });
    expect(guest.payloads('state-sync').at(-1)?.gameState.challengeDeadline).toBe(Date.now() + 1000);
    vi.advanceTimersByTime(999);
    expect(guest.payloads('reveal')).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(guest.payloads('reveal')).toHaveLength(1);
    await host.send('rejoin-room', { code, playerId: hostId, waitForPlayback: true });
    expect(host.payloads('room-joined').at(-1)?.room.gameState.lastReveal).toEqual(guest.payloads('reveal')[0]);
  });

  it('ignores old host requests and teardown after the seat moves to a replacement socket', async () => {
    const { registerSocket, code, hostId, host, guest } = await startRoom();
    const replacement = registerSocket('replacement');
    await replacement.send('rejoin-room', { code, playerId: hostId, waitForPlayback: true });
    const recoveryId = replacement.payloads('room-joined').at(-1)!.room.hostRecovery!.id;

    await host.send('host-playback-ready', { recoveryId });
    await host.send('rejoin-room', { code, playerId: hostId, waitForPlayback: true });
    expect(host.payloads('room-joined')).toHaveLength(0);
    host.disconnect();
    expect(guest.payloads('state-sync').at(-1)?.players[hostId].connected).toBe(true);
    expect(guest.payloads('state-sync').at(-1)?.hostRecovery?.id).toBe(recoveryId);
    await replacement.send('host-playback-ready', { recoveryId });
    expect(guest.payloads('state-sync').at(-1)?.hostRecovery).toBeUndefined();
  });

  it('automatically recovers an older host client and transfers the room on explicit leave', async () => {
    const { registerSocket, code, hostId, guestId, host, guest } = await startRoom();
    host.disconnect();
    const returningHost = registerSocket('legacy-host');
    await returningHost.send('rejoin-room', { code, playerId: hostId });
    const room = returningHost.payloads('room-joined').at(-1)!.room;
    expect(room.hostRecovery).toBeUndefined();
    expect(room.gameState.currentTurnPlayerId).toBe(hostId);
    expect(returningHost.payloads('game-started')).toHaveLength(1);
    expect(returningHost.payloads('play-song')).toHaveLength(1);

    await returningHost.send('leave-room');
    const afterLeave = guest.payloads('state-sync').at(-1)!;
    expect(afterLeave.hostId).toBe(guestId);
    expect(afterLeave.gameState.currentTurnPlayerId).toBe(guestId);
  });

  it('retains an all-away active game beyond five minutes and only cleans it up after the new grace', async () => {
    const { registerSocket, code, hostId, guestId, host, guest } = await startRoom();
    const song = host.payloads('new-turn').at(-1)?.songCard;
    guest.disconnect();
    host.disconnect();
    vi.advanceTimersByTime(29 * 60_000);
    expect(deleteRoom).not.toHaveBeenCalledWith(code);

    const returningGuest = registerSocket('returning-guest');
    await returningGuest.send('rejoin-room', { code, playerId: guestId, waitForPlayback: true });
    const held = returningGuest.payloads('room-joined').at(-1)!.room;
    expect(held.gameState.currentSong?.id).toBe(song?.id);
    expect(held.gameState.currentTurnPlayerId).toBe(hostId);
    expect(held.hostRecovery?.reconnectDeadline).toBeNull();
    vi.advanceTimersByTime(2 * 60_000);
    expect(deleteRoom).not.toHaveBeenCalledWith(code);

    returningGuest.disconnect();
    vi.advanceTimersByTime(30 * 60_000);
    expect(deleteRoom).toHaveBeenCalledWith(code);
  });
});
