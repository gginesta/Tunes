import { Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@tunes/shared';
import { getLeaderboard, getPlayerStats, getPlayerGameHistory } from './database';
import { guestNameKey, isRecord, isShortString } from './validate';
import { logger } from './logger';

type TunesSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/** Leaderboard and per-guest stats/history lookups. */
export function registerStatsHandlers(socket: TunesSocket): void {
  socket.on('get-leaderboard', () => {
    try {
      const entries = getLeaderboard(20);
      socket.emit('leaderboard', { entries });
    } catch (err) {
      logger.error('Failed to fetch leaderboard', { error: String(err) });
    }
  });

  socket.on('get-my-stats', (payload) => {
    const name = isRecord(payload) && isShortString(payload.name, 100) ? guestNameKey(payload.name) : '';
    if (!name) {
      socket.emit('my-stats', { stats: null });
      return;
    }
    try {
      const stats = getPlayerStats(name);
      socket.emit('my-stats', { stats });
    } catch (err) {
      logger.error('Failed to fetch player stats', { error: String(err) });
    }
  });

  socket.on('get-my-history', (payload) => {
    const name = isRecord(payload) && isShortString(payload.name, 100) ? guestNameKey(payload.name) : '';
    if (!name) {
      socket.emit('my-history', { games: [] });
      return;
    }
    try {
      const games = getPlayerGameHistory(name, 20);
      socket.emit('my-history', { games });
    } catch (err) {
      logger.error('Failed to fetch player history', { error: String(err) });
    }
  });
}
