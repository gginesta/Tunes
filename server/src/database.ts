import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import type { Room, LeaderboardEntry, GameHistoryEntry, SavedTable } from '@tunes/shared';
import { randomUUID } from 'node:crypto';
import type { PersistedGame } from './game';
import { encryptToken, decryptToken } from './tokenCrypto';
import { logger } from './logger';

const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', '..', 'data');
const DB_PATH = join(DATA_DIR, 'tunes.db');

let db: Database.Database;

export function initDatabase(): void {
  if (db?.open) return;
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      code TEXT PRIMARY KEY,
      host_id TEXT NOT NULL,
      original_host_id TEXT,
      settings TEXT NOT NULL,
      game_state TEXT NOT NULL,
      players TEXT NOT NULL,
      spotify_token TEXT,
      playback_mode TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS game_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_code TEXT NOT NULL,
      mode TEXT NOT NULL,
      winner_username TEXT,
      player_count INTEGER NOT NULL,
      total_rounds INTEGER NOT NULL,
      played_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS game_participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL REFERENCES game_history(id),
      username TEXT NOT NULL,
      display_name TEXT NOT NULL,
      cards_won INTEGER NOT NULL,
      correct_placements INTEGER NOT NULL,
      total_placements INTEGER NOT NULL,
      longest_streak INTEGER NOT NULL,
      challenges_won INTEGER NOT NULL,
      songs_named INTEGER NOT NULL,
      fastest_placement_ms INTEGER,
      is_winner BOOLEAN NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS leaderboard (
      username TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      total_games INTEGER NOT NULL DEFAULT 0,
      total_wins INTEGER NOT NULL DEFAULT 0,
      total_correct INTEGER NOT NULL DEFAULT 0,
      total_placements INTEGER NOT NULL DEFAULT 0,
      best_streak INTEGER NOT NULL DEFAULT 0,
      total_challenges_won INTEGER NOT NULL DEFAULT 0,
      total_songs_named INTEGER NOT NULL DEFAULT 0,
      best_fastest_ms INTEGER,
      updated_at TEXT NOT NULL
    );
  `);

  migrateToGuestIdentity();
  migrateRoomPlaybackMode();
  migrateOriginalHostIdentity();
  migrateRecoverableRooms();
  migrateTablePlaylistHistory();
}

export function closeDatabase(): void {
  if (db?.open) db.close();
}

function migrateRecoverableRooms(): void {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version >= 4) return;

  db.transaction(() => {
    db.exec(`
      ALTER TABLE rooms ADD COLUMN recovery TEXT;
      ALTER TABLE game_history ADD COLUMN match_id TEXT;
      ALTER TABLE game_history ADD COLUMN result TEXT;
      ALTER TABLE game_history ADD COLUMN table_id TEXT;
      CREATE UNIQUE INDEX game_history_match_id ON game_history(match_id);
      CREATE INDEX game_history_table_id ON game_history(table_id);
      CREATE INDEX game_participants_username ON game_participants(username);

      CREATE TABLE guests (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE
      );

      CREATE TABLE saved_tables (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        settings TEXT NOT NULL,
        playback_mode TEXT NOT NULL
      );

      CREATE TABLE saved_table_members (
        table_id TEXT NOT NULL REFERENCES saved_tables(id),
        guest_id TEXT NOT NULL REFERENCES guests(id),
        display_name TEXT NOT NULL,
        PRIMARY KEY (table_id, guest_id)
      );
    `);
    db.pragma('user_version = 4');
  })();
}

function migrateTablePlaylistHistory(): void {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version >= 5) return;
  db.transaction(() => {
    db.exec("ALTER TABLE saved_tables ADD COLUMN heard_recordings TEXT NOT NULL DEFAULT '[]'");
    db.pragma('user_version = 5');
  })();
}

/**
 * One-time migration (schema v0 -> v1): identity moved from password
 * accounts to guest display names. Leaderboard and history rows are
 * re-keyed to lower-cased display names, merging rows that collide,
 * and the legacy accounts table is dropped.
 */
function migrateToGuestIdentity(): void {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version >= 1) return;

  const hasAccountsTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'")
    .get();

  const migrate = db.transaction(() => {
    const rows = db.prepare('SELECT * FROM leaderboard').all() as (LeaderboardRow & {
      updated_at: string;
    })[];

    const merged = new Map<string, LeaderboardRow & { updated_at: string }>();
    for (const row of rows) {
      const key = row.display_name.trim().toLowerCase();
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, { ...row, username: key });
        continue;
      }
      existing.total_games += row.total_games;
      existing.total_wins += row.total_wins;
      existing.total_correct += row.total_correct;
      existing.total_placements += row.total_placements;
      existing.best_streak = Math.max(existing.best_streak, row.best_streak);
      existing.total_challenges_won += row.total_challenges_won;
      existing.total_songs_named += row.total_songs_named;
      if (
        row.best_fastest_ms !== null &&
        (existing.best_fastest_ms === null || row.best_fastest_ms < existing.best_fastest_ms)
      ) {
        existing.best_fastest_ms = row.best_fastest_ms;
      }
      if (row.updated_at > existing.updated_at) {
        existing.display_name = row.display_name;
        existing.updated_at = row.updated_at;
      }
    }

    db.exec('DELETE FROM leaderboard');
    const insert = db.prepare(`
      INSERT INTO leaderboard (username, display_name, total_games, total_wins, total_correct, total_placements, best_streak, total_challenges_won, total_songs_named, best_fastest_ms, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of merged.values()) {
      insert.run(
        row.username,
        row.display_name,
        row.total_games,
        row.total_wins,
        row.total_correct,
        row.total_placements,
        row.best_streak,
        row.total_challenges_won,
        row.total_songs_named,
        row.best_fastest_ms,
        row.updated_at,
      );
    }

    db.exec("UPDATE game_participants SET username = lower(trim(display_name))");

    if (hasAccountsTable) {
      db.exec(`
        UPDATE game_history SET winner_username = (
          SELECT lower(trim(a.display_name)) FROM accounts a WHERE a.username = game_history.winner_username
        )
        WHERE winner_username IS NOT NULL
          AND EXISTS (SELECT 1 FROM accounts a WHERE a.username = game_history.winner_username);
      `);
      db.exec('DROP TABLE accounts');
    }

    db.pragma('user_version = 1');
  });

  migrate();
  logger.info('Database migrated to guest identity (schema v1)', {
    migratedLeaderboardRows: db.prepare('SELECT COUNT(*) AS c FROM leaderboard').get(),
  });
}

/** One-time migration (schema v1 -> v2): persist non-secret room playback mode. */
function migrateRoomPlaybackMode(): void {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version >= 2) return;

  const columns = db.prepare('PRAGMA table_info(rooms)').all() as { name: string }[];
  if (!columns.some((column) => column.name === 'playback_mode')) {
    db.exec('ALTER TABLE rooms ADD COLUMN playback_mode TEXT');
  }
  db.pragma('user_version = 2');
  logger.info('Database migrated to persisted room playback mode (schema v2)');
}

/** One-time migration (schema v2 -> v3): retain creator identity for host recovery. */
function migrateOriginalHostIdentity(): void {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version >= 3) return;

  const columns = db.prepare('PRAGMA table_info(rooms)').all() as { name: string }[];
  if (!columns.some((column) => column.name === 'original_host_id')) {
    // Existing rows stay null: host_id is mutable after a transfer, so copying
    // it would falsely bless a successor as the Spotify credential owner.
    db.exec('ALTER TABLE rooms ADD COLUMN original_host_id TEXT');
  }
  db.pragma('user_version = 3');
  logger.info('Database migrated to persisted original host identity (schema v3)');
}

// --- Room functions ---

interface RoomRow {
  code: string;
  host_id: string;
  original_host_id: string | null;
  settings: string;
  game_state: string;
  players: string;
  spotify_token: string | null;
  playback_mode: string | null;
  created_at: string;
  updated_at: string;
  recovery: string | null;
}

export interface RoomRecovery {
  version: 1;
  seats: Record<string, { guestId: string; resumeTokenHash: string }>;
  expiresAt?: number;
  speakerId?: string;
  savedTableId?: string;
  restartRequired?: boolean;
  completedMatchIds?: string[];
  game?: PersistedGame;
}

interface SavedRoom {
  room: Room;
  spotifyToken: string | null;
  recovery?: RoomRecovery;
}

export function saveRoom(code: string, room: Room, spotifyToken?: string, recovery?: RoomRecovery): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO rooms (code, host_id, original_host_id, settings, game_state, players, spotify_token, playback_mode, created_at, updated_at, recovery)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      host_id = excluded.host_id,
      original_host_id = excluded.original_host_id,
      settings = excluded.settings,
      game_state = excluded.game_state,
      players = excluded.players,
      spotify_token = excluded.spotify_token,
      playback_mode = excluded.playback_mode,
      updated_at = excluded.updated_at,
      recovery = excluded.recovery
  `);
  stmt.run(
    code,
    room.hostId,
    room.originalHostId ?? null,
    JSON.stringify(room.settings),
    JSON.stringify(room.gameState),
    JSON.stringify(room.players),
    spotifyToken ? encryptToken(spotifyToken) : null,
    room.playbackMode ?? null,
    now,
    now,
    recovery ? JSON.stringify(recovery) : null,
  );
}

function readRoom(row: RoomRow): SavedRoom {
  const recovery: RoomRecovery | undefined = row.recovery ? JSON.parse(row.recovery) : undefined;
  return {
    room: {
      code: row.code,
      hostId: row.host_id,
      originalHostId: row.original_host_id ?? undefined,
      playbackMode: (['manual', 'spotify', 'preview', 'licensed'] as const)
        .find((mode) => mode === row.playback_mode),
      speakerId: recovery?.speakerId,
      savedTableId: recovery?.savedTableId,
      settings: JSON.parse(row.settings),
      gameState: JSON.parse(row.game_state),
      players: JSON.parse(row.players),
    },
    spotifyToken: row.spotify_token ? decryptToken(row.spotify_token) : null,
    recovery,
  };
}

export function loadRoom(code: string): SavedRoom | null {
  const row = db.prepare('SELECT * FROM rooms WHERE code = ?').get(code) as RoomRow | undefined;
  return row ? readRoom(row) : null;
}

export function loadAllRooms(): SavedRoom[] {
  const rows = db.prepare('SELECT * FROM rooms').all() as RoomRow[];
  return rows.flatMap((row) => {
    try {
      return [readRoom(row)];
    } catch {
      logger.warn('Could not read saved room', { code: row.code });
      return [];
    }
  });
}

export function deleteRoom(code: string): void {
  const stmt = db.prepare('DELETE FROM rooms WHERE code = ?');
  stmt.run(code);
}

export function getGuestId(tokenHash: string): string | undefined {
  const row = db.prepare('SELECT id FROM guests WHERE token_hash = ?').get(tokenHash) as { id: string } | undefined;
  return row?.id;
}

export function createGuest(tokenHash: string): string {
  const guestId = randomUUID();
  db.prepare('INSERT INTO guests (id, token_hash) VALUES (?, ?)').run(guestId, tokenHash);
  return guestId;
}

// --- Game history & leaderboard functions ---

export interface SaveGameParticipant {
  username: string;
  displayName: string;
  cardsWon: number;
  correctPlacements: number;
  totalPlacements: number;
  longestStreak: number;
  challengesWon: number;
  songsNamed: number;
  fastestPlacementMs: number | null;
  isWinner: boolean;
}

export interface FinishedMatch {
  result: NonNullable<Room['gameState']['result']>;
  totalRounds: number;
  participants: SaveGameParticipant[];
}

/** Commit the terminal checkpoint, history and all private statistics together. */
export function saveFinishedMatch(room: Room, recovery: RoomRecovery, match: FinishedMatch): boolean {
  return db.transaction(() => {
    saveTableCheckpoint(room, recovery);
    const result = db.prepare(`
      INSERT INTO game_history (room_code, mode, winner_username, player_count, total_rounds, played_at, match_id, result, table_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(match_id) DO NOTHING
    `).run(
      room.code,
      room.settings.mode,
      match.participants.filter((p) => p.isWinner).length === 1
        ? match.participants.find((p) => p.isWinner)?.username ?? null
        : null,
      Object.keys(match.result.scores).length,
      match.totalRounds,
      new Date().toISOString(),
      match.result.matchId,
      JSON.stringify(match.result),
      room.savedTableId ?? null,
    );
    if (!result.changes) return false;

    const insertParticipant = db.prepare(`
      INSERT INTO game_participants (game_id, username, display_name, cards_won, correct_placements, total_placements, longest_streak, challenges_won, songs_named, fastest_placement_ms, is_winner)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const player of match.participants) {
      insertParticipant.run(
        result.lastInsertRowid,
        player.username,
        player.displayName,
        player.cardsWon,
        player.correctPlacements,
        player.totalPlacements,
        player.longestStreak,
        player.challengesWon,
        player.songsNamed,
        player.fastestPlacementMs,
        player.isWinner ? 1 : 0,
      );
      if (match.result.status !== 'abandoned') updateLeaderboard(player.username, player.displayName, player);
    }
    return true;
  })();
}

export function saveGameResult(
  roomCode: string,
  mode: string,
  winnerUsername: string | null,
  playerCount: number,
  totalRounds: number,
  participants: SaveGameParticipant[],
): void {
  const now = new Date().toISOString();

  const insertGame = db.prepare(`
    INSERT INTO game_history (room_code, mode, winner_username, player_count, total_rounds, played_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertParticipant = db.prepare(`
    INSERT INTO game_participants (game_id, username, display_name, cards_won, correct_placements, total_placements, longest_streak, challenges_won, songs_named, fastest_placement_ms, is_winner)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    const result = insertGame.run(roomCode, mode, winnerUsername, playerCount, totalRounds, now);
    const gameId = result.lastInsertRowid;

    for (const p of participants) {
      insertParticipant.run(
        gameId,
        p.username,
        p.displayName,
        p.cardsWon,
        p.correctPlacements,
        p.totalPlacements,
        p.longestStreak,
        p.challengesWon,
        p.songsNamed,
        p.fastestPlacementMs,
        p.isWinner ? 1 : 0,
      );
    }
  });

  transaction();
}

export function updateLeaderboard(
  username: string,
  displayName: string,
  stats: {
    isWinner: boolean;
    correctPlacements: number;
    totalPlacements: number;
    longestStreak: number;
    challengesWon: number;
    songsNamed: number;
    fastestPlacementMs: number | null;
  },
): void {
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO leaderboard (username, display_name, total_games, total_wins, total_correct, total_placements, best_streak, total_challenges_won, total_songs_named, best_fastest_ms, updated_at)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET
      display_name = excluded.display_name,
      total_games = total_games + 1,
      total_wins = total_wins + excluded.total_wins,
      total_correct = total_correct + excluded.total_correct,
      total_placements = total_placements + excluded.total_placements,
      best_streak = MAX(best_streak, excluded.best_streak),
      total_challenges_won = total_challenges_won + excluded.total_challenges_won,
      total_songs_named = total_songs_named + excluded.total_songs_named,
      best_fastest_ms = CASE
        WHEN excluded.best_fastest_ms IS NULL THEN best_fastest_ms
        WHEN best_fastest_ms IS NULL THEN excluded.best_fastest_ms
        WHEN excluded.best_fastest_ms < best_fastest_ms THEN excluded.best_fastest_ms
        ELSE best_fastest_ms
      END,
      updated_at = excluded.updated_at
  `);

  stmt.run(
    username,
    displayName,
    stats.isWinner ? 1 : 0,
    stats.correctPlacements,
    stats.totalPlacements,
    stats.longestStreak,
    stats.challengesWon,
    stats.songsNamed,
    stats.fastestPlacementMs,
    now,
  );
}

interface LeaderboardRow {
  username: string;
  display_name: string;
  total_games: number;
  total_wins: number;
  total_correct: number;
  total_placements: number;
  best_streak: number;
  total_challenges_won: number;
  total_songs_named: number;
  best_fastest_ms: number | null;
}

export function getLeaderboard(limit = 20): LeaderboardEntry[] {
  const stmt = db.prepare(
    `SELECT leaderboard.* FROM leaderboard
     WHERE NOT EXISTS (SELECT 1 FROM guests WHERE guests.id = leaderboard.username)
     ORDER BY total_wins DESC, total_games ASC LIMIT ?`,
  );
  const rows = stmt.all(limit) as LeaderboardRow[];
  return rows.map(rowToLeaderboardEntry);
}

export function getPlayerStats(username: string): LeaderboardEntry | null {
  const stmt = db.prepare('SELECT * FROM leaderboard WHERE username = ?');
  const row = stmt.get(username) as LeaderboardRow | undefined;
  if (!row) return null;
  return rowToLeaderboardEntry(row);
}

function rowToLeaderboardEntry(row: LeaderboardRow): LeaderboardEntry {
  return {
    username: row.username,
    displayName: row.display_name,
    totalGames: row.total_games,
    totalWins: row.total_wins,
    totalCorrect: row.total_correct,
    totalPlacements: row.total_placements,
    bestStreak: row.best_streak,
    totalChallengesWon: row.total_challenges_won,
    totalSongsNamed: row.total_songs_named,
    bestFastestMs: row.best_fastest_ms,
    winRate: row.total_games > 0 ? row.total_wins / row.total_games : 0,
  };
}

interface GameHistoryRow {
  id: number;
  room_code: string;
  mode: string;
  player_count: number;
  total_rounds: number;
  played_at: string;
  is_winner: number;
  cards_won: number;
  correct_placements: number;
  total_placements: number;
  result: string | null;
}

export function getPlayerGameHistory(username: string, limit = 20): GameHistoryEntry[] {
  const stmt = db.prepare(`
    SELECT gh.id, gh.room_code, gh.mode, gh.player_count, gh.total_rounds, gh.played_at,
           gp.is_winner, gp.cards_won, gp.correct_placements, gp.total_placements, gh.result
    FROM game_history gh
    JOIN game_participants gp ON gh.id = gp.game_id
    WHERE gp.username = ?
    ORDER BY gh.played_at DESC
    LIMIT ?
  `);
  const rows = stmt.all(username, limit) as GameHistoryRow[];
  return rows.map((row) => ({
    id: row.id,
    roomCode: row.room_code,
    mode: row.mode,
    playerCount: row.player_count,
    totalRounds: row.total_rounds,
    playedAt: row.played_at,
    isWinner: row.is_winner === 1,
    cardsWon: row.cards_won,
    correctPlacements: row.correct_placements,
    totalPlacements: row.total_placements,
    outcome: row.result ? JSON.parse(row.result).status : undefined,
  }));
}

export function createSavedTable(
  room: Room,
  recovery: RoomRecovery,
  name: string,
  members: { guestId: string; displayName: string }[],
  matchIds: readonly string[],
): string {
  return db.transaction(() => {
    const id = randomUUID();
    db.prepare('INSERT INTO saved_tables (id, name, settings, playback_mode, heard_recordings) VALUES (?, ?, ?, ?, ?)')
      .run(id, name, JSON.stringify(room.settings), room.playbackMode ?? 'manual', JSON.stringify(recovery.game?.heard ?? []));
    const insertMember = db.prepare('INSERT INTO saved_table_members (table_id, guest_id, display_name) VALUES (?, ?, ?)');
    for (const member of members) insertMember.run(id, member.guestId, member.displayName);

    saveRoom(room.code, room, undefined, { ...recovery, savedTableId: id });
    const attachMatch = db.prepare('UPDATE game_history SET table_id = ? WHERE match_id = ? AND table_id IS NULL');
    for (const matchId of matchIds) attachMatch.run(id, matchId);
    return id;
  })();
}

interface SavedTableRow {
  id: string;
  name: string;
  settings: string;
  playback_mode: string;
  heard_recordings: string;
}

export function getSavedTableConfig(
  tableId: string,
  guestId: string,
): { settings: Room['settings']; playbackMode: 'manual' | 'licensed'; heardRecordingIds: string[] } | undefined {
  const row = db.prepare(`
    SELECT st.* FROM saved_tables st JOIN saved_table_members m ON st.id = m.table_id
    WHERE st.id = ? AND m.guest_id = ?
  `).get(tableId, guestId) as SavedTableRow | undefined;
  if (!row) return undefined;
  return {
    settings: JSON.parse(row.settings),
    playbackMode: row.playback_mode === 'licensed' ? 'licensed' : 'manual',
    heardRecordingIds: JSON.parse(row.heard_recordings),
  };
}

export function getSavedTables(guestId: string): SavedTable[] {
  const tables = db.prepare(`
    SELECT st.* FROM saved_tables st JOIN saved_table_members m ON st.id = m.table_id WHERE m.guest_id = ?
  `).all(guestId) as SavedTableRow[];
  const members = db.prepare('SELECT guest_id, display_name FROM saved_table_members WHERE table_id = ? ORDER BY rowid');
  const matches = db.prepare(`
    SELECT gh.id, gh.result, gp.username, gp.is_winner
    FROM game_history gh JOIN game_participants gp ON gp.game_id = gh.id
    WHERE gh.table_id = ?
  `);
  return tables.map(({ id, name }) => {
    const roster = members.all(id) as { guest_id: string; display_name: string }[];
    const completed = new Map<number, Map<string, boolean>>();
    const rows = matches.all(id) as { id: number; result: string; username: string; is_winner: number }[];
    for (const row of rows) {
      if (JSON.parse(row.result).status === 'abandoned') continue;
      const participants = completed.get(row.id) ?? new Map<string, boolean>();
      participants.set(row.username, Boolean(row.is_winner));
      completed.set(row.id, participants);
    }
    const results = [...completed.values()];
    const standings = roster.map((member) => ({
      displayName: member.display_name,
      wins: results.filter((game) => game.get(member.guest_id)).length,
      matches: results.filter((game) => game.has(member.guest_id)).length,
    })).sort((a, b) => b.wins - a.wins);
    const headToHead = roster.flatMap((first, index) => roster.slice(index + 1).map((second) => {
      const shared = results.filter((game) => game.has(first.guest_id) && game.has(second.guest_id));
      return {
        firstName: first.display_name,
        secondName: second.display_name,
        matches: shared.length,
        firstWins: shared.filter((game) => game.get(first.guest_id)).length,
        secondWins: shared.filter((game) => game.get(second.guest_id)).length,
      };
    }));
    return { id, name, playedMatches: results.length, standings, headToHead };
  });
}

export function updateSavedTableSettings(room: Room): void {
  if (room.savedTableId) {
    db.prepare('UPDATE saved_tables SET settings = ?, playback_mode = ? WHERE id = ?')
      .run(JSON.stringify(room.settings), room.playbackMode, room.savedTableId);
  }
}

export function updateSavedTableName(tableId: string, guestId: string, name: string): void {
  db.prepare('UPDATE saved_table_members SET display_name = ? WHERE table_id = ? AND guest_id = ?')
    .run(name, tableId, guestId);
}

export function saveTableCheckpoint(room: Room, recovery: RoomRecovery, saveSettings = false): void {
  if (!room.savedTableId) {
    saveRoom(room.code, room, undefined, recovery);
    return;
  }
  db.transaction(() => {
    saveRoom(room.code, room, undefined, recovery);
    const heard = JSON.stringify(recovery.game?.heard ?? []);
    db.prepare('UPDATE saved_tables SET heard_recordings = ? WHERE id = ? AND heard_recordings <> ?')
      .run(heard, room.savedTableId, heard);
    if (saveSettings) updateSavedTableSettings(room);
  })();
}
