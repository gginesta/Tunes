import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Room } from '@tunes/shared';
import type { RoomRecovery, SaveGameParticipant } from './database';

const room: Room = {
  code: 'ROOM',
  hostId: 'host-a',
  originalHostId: 'host-a',
  playbackMode: 'spotify',
  players: {},
  settings: { mode: 'original', cardsToWin: 10, songPack: 'standard' },
  gameState: {
    phase: 'lobby', currentTurnPlayerId: null, currentSong: null, pendingPlacement: null,
    challengers: [], turnOrder: [], turnIndex: 0, deckSize: 0, sharedTimeline: [],
  },
};

describe('SQLite room and result persistence', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tunes-db-test-'));
  let database: typeof import('./database');

  beforeAll(async () => {
    // Reproduce the production v1 room table so initDatabase must add the
    // playback_mode column rather than relying on a fresh schema.
    const legacy = new Database(join(dataDir, 'tunes.db'));
    legacy.exec(`
      CREATE TABLE rooms (
        code TEXT PRIMARY KEY,
        host_id TEXT NOT NULL,
        settings TEXT NOT NULL,
        game_state TEXT NOT NULL,
        players TEXT NOT NULL,
        spotify_token TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      PRAGMA user_version = 1;
    `);
    legacy.close();

    vi.stubEnv('DATA_DIR', dataDir);
    vi.resetModules();
    database = await import('./database');
    database.initDatabase();
  });

  afterAll(() => {
    database?.closeDatabase();
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('migrates v1 and retains the inferred mode after the token is dropped', () => {
    database.saveRoom(room.code, room);

    expect(database.loadRoom(room.code)?.room.playbackMode).toBe('spotify');
    expect(database.loadRoom(room.code)?.room.originalHostId).toBe('host-a');
    expect(database.loadRoom(room.code)?.spotifyToken).toBeNull();
  });

  it('rolls back a failed result and records retry, ties and same-name guests once', () => {
    const guestA = database.createGuest('hash-a');
    const guestB = database.createGuest('hash-b');
    const stranger = database.createGuest('hash-other');
    const recovery: RoomRecovery = {
      version: 1,
      seats: {
        a: { guestId: guestA, resumeTokenHash: 'resume-a' },
        b: { guestId: guestB, resumeTokenHash: 'resume-b' },
      },
      speakerId: 'b',
    };
    const participant: SaveGameParticipant = {
      username: guestA, displayName: 'Alex', cardsWon: 3, correctPlacements: 2, totalPlacements: 4,
      longestStreak: 2, challengesWon: 1, songsNamed: 1, fastestPlacementMs: 1200, isWinner: true,
    };
    const result = {
      matchId: 'a-match-id', status: 'tied', reason: 'deck-exhausted',
      winnerIds: ['a', 'b'], scores: { a: 3, b: 3 }, margin: 0, decidingSong: null,
    } as const;
    const match = {
      result: { ...result, winnerIds: [...result.winnerIds] },
      totalRounds: 4,
      participants: [participant, { ...participant, username: guestB, correctPlacements: 1 }],
    };
    const playing: Room = { ...room, playbackMode: 'manual', gameState: { ...room.gameState, phase: 'reveal' } };
    const finished: Room = { ...playing, gameState: { ...playing.gameState, phase: 'game_over', result: match.result } };
    database.saveRoom(playing.code, playing, undefined, recovery);

    const helper = new Database(join(dataDir, 'tunes.db'));
    try {
      helper.exec(`
        CREATE TRIGGER fail_stats BEFORE INSERT ON leaderboard
        BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;
      `);
      expect(() => database.saveFinishedMatch(finished, recovery, match)).toThrow('simulated write failure');
      expect(database.loadRoom(room.code)?.room.gameState.phase).toBe('reveal');
      expect(database.getPlayerGameHistory(guestA)).toEqual([]);
      expect(database.getPlayerStats(guestA)).toBeNull();
      helper.exec('DROP TRIGGER fail_stats');

      expect(database.saveFinishedMatch(finished, recovery, match)).toBe(true);
      expect(database.saveFinishedMatch(finished, recovery, match)).toBe(false);
      expect(database.loadRoom(room.code)).toMatchObject({ recovery, room: { speakerId: 'b', gameState: { phase: 'game_over' } } });
      expect(database.getPlayerStats(guestA)).toMatchObject({ totalGames: 1, totalWins: 1, totalCorrect: 2 });
      expect(database.getPlayerStats(guestB)).toMatchObject({ totalGames: 1, totalWins: 1, totalCorrect: 1 });
      expect(database.getPlayerGameHistory(guestA)).toMatchObject([{ isWinner: true, outcome: 'tied' }]);
      expect(database.getLeaderboard()).toEqual([]);

      const tableId = database.createSavedTable(finished, recovery, 'The table', [
        { guestId: guestA, displayName: 'Alex' }, { guestId: guestB, displayName: 'Alex' },
      ], [result.matchId]);
      expect(database.getSavedTableConfig(tableId, stranger)).toBeUndefined();
      expect(database.getSavedTables(stranger)).toEqual([]);
      database.updateSavedTableName(tableId, guestB, 'Sam');
      expect(database.getSavedTables(guestA)).toMatchObject([{
        id: tableId, playedMatches: 1, standings: [
          { displayName: 'Alex', matches: 1, wins: 1 }, { displayName: 'Sam', matches: 1, wins: 1 },
        ],
      }]);
    } finally {
      helper.close();
    }
  });
});
