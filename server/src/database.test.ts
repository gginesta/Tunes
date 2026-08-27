import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Room } from '@tunes/shared';

describe('room playback mode persistence', () => {
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
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('migrates v1 and retains the inferred mode after the token is dropped', () => {
    const room: Room = {
      code: 'ROOM',
      hostId: 'host-a',
      originalHostId: 'host-a',
      playbackMode: 'spotify',
      players: {},
      settings: { mode: 'original', cardsToWin: 10, songPack: 'standard' },
      gameState: {
        phase: 'lobby',
        currentTurnPlayerId: null,
        currentSong: null,
        pendingPlacement: null,
        challengers: [],
        turnOrder: [],
        turnIndex: 0,
        deckSize: 0,
        sharedTimeline: [],
      },
    };

    database.saveRoom(room.code, room);

    expect(database.loadRoom(room.code)?.room.playbackMode).toBe('spotify');
    expect(database.loadRoom(room.code)?.room.originalHostId).toBe('host-a');
    expect(database.loadRoom(room.code)?.spotifyToken).toBeNull();
  });
});
