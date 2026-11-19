import { Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, SavedTable } from '@tunes/shared';
import { getLeaderboard, getPlayerStats, getPlayerGameHistory, getSavedTables } from './database';
import { authenticateGuest } from './guestSession';
import { isRecord } from './validate';
import { logger } from './logger';

type TunesSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/** Leaderboard and per-guest stats/history lookups. */
export function registerStatsHandlers(
  socket: TunesSocket,
  guestForSeat: () => string | undefined,
  withLiveRooms: (tables: SavedTable[]) => SavedTable[],
): void {
  function ownIdentity(payload: unknown): string | undefined {
    return guestForSeat() ?? authenticateGuest(isRecord(payload) ? payload.guestToken : undefined);
  }
  socket.on('get-leaderboard', () => {
    try {
      const entries = getLeaderboard(20);
      socket.emit('leaderboard', { entries });
    } catch (err) {
      logger.error('Failed to fetch leaderboard', { error: String(err) });
    }
  });

  socket.on('get-my-stats', (payload) => {
    try {
      const guestId = ownIdentity(payload);
      socket.emit('my-stats', { stats: guestId ? getPlayerStats(guestId) : null });
    } catch (err) {
      logger.error('Failed to fetch player stats', { error: String(err) });
    }
  });

  socket.on('get-my-history', (payload) => {
    try {
      const guestId = ownIdentity(payload);
      socket.emit('my-history', { games: guestId ? getPlayerGameHistory(guestId, 20) : [] });
    } catch (err) {
      logger.error('Failed to fetch player history', { error: String(err) });
    }
  });

  socket.on('get-my-tables', (payload) => {
    try {
      const guestId = ownIdentity(payload);
      socket.emit('my-tables', { tables: guestId ? withLiveRooms(getSavedTables(guestId)) : [] });
    } catch (err) {
      logger.error('Failed to fetch saved tables', { error: String(err) });
    }
  });
}
