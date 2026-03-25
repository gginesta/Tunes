import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import type { Room, LeaderboardEntry, GameHistoryEntry } from '@hitster/shared';
import type { Account } from './accounts';

const DATA_DIR = join(__dirname, '..', '..', 'data');
const DB_PATH = join(DATA_DIR, 'hitster.db');

let db: Database.Database;

export function initDatabase(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      username TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rooms (
      code TEXT PRIMARY KEY,
      host_id TEXT NOT NULL,
      settings TEXT NOT NULL,
      game_state TEXT NOT NULL,
      players TEXT NOT NULL,
      spotify_token TEXT,
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
}

// --- Account functions ---

export function saveAccount(account: Account): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO accounts (username, display_name, password_hash, created_at)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(account.username, account.displayName, account.passwordHash, account.createdAt);
}

export function loadAccount(username: string): Account | null {
  const stmt = db.prepare('SELECT * FROM accounts WHERE username = ?');
  const row = stmt.get(username) as { username: string; display_name: string; password_hash: string; created_at: string } | undefined;
  if (!row) return null;
  return {
    username: row.username,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  };
}

export function getAllAccounts(): Account[] {
  const stmt = db.prepare('SELECT * FROM accounts');
  const rows = stmt.all() as { username: string; display_name: string; password_hash: string; created_at: string }[];
  return rows.map((row) => ({
    username: row.username,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  }));
}

// --- Room functions ---

interface RoomRow {
  code: string;
  host_id: string;
  settings: string;
  game_state: string;
  players: string;
  spotify_token: string | null;
  created_at: string;
  updated_at: string;
}

export function saveRoom(code: string, room: Room, spotifyToken?: string): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO rooms (code, host_id, settings, game_state, players, spotify_token, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      host_id = excluded.host_id,
      settings = excluded.settings,
      game_state = excluded.game_state,
      players = excluded.players,
      spotify_token = excluded.spotify_token,
      updated_at = excluded.updated_at
  `);
  stmt.run(
    code,
    room.hostId,
    JSON.stringify(room.settings),
    JSON.stringify(room.gameState),
    JSON.stringify(room.players),
    spotifyToken ?? null,
    now,
    now,
  );
}

export function loadRoom(code: string): { room: Room; spotifyToken: string | null } | null {
  const stmt = db.prepare('SELECT * FROM rooms WHERE code = ?');
  const row = stmt.get(code) as RoomRow | undefined;
  if (!row) return null;
  return {
    room: {
      code: row.code,
      hostId: row.host_id,
      settings: JSON.parse(row.settings),
      gameState: JSON.parse(row.game_state),
      players: JSON.parse(row.players),
    },
    spotifyToken: row.spotify_token,
  };
}

export function loadAllRooms(): { room: Room; spotifyToken: string | null }[] {
  const stmt = db.prepare('SELECT * FROM rooms');
  const rows = stmt.all() as RoomRow[];
  return rows.map((row) => ({
    room: {
      code: row.code,
      hostId: row.host_id,
      settings: JSON.parse(row.settings),
      gameState: JSON.parse(row.game_state),
      players: JSON.parse(row.players),
    },
    spotifyToken: row.spotify_token,
  }));
}

export function deleteRoom(code: string): void {
  const stmt = db.prepare('DELETE FROM rooms WHERE code = ?');
  stmt.run(code);
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
    'SELECT * FROM leaderboard ORDER BY total_wins DESC, total_games ASC LIMIT ?',
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
}

export function getPlayerGameHistory(username: string, limit = 20): GameHistoryEntry[] {
  const stmt = db.prepare(`
    SELECT gh.id, gh.room_code, gh.mode, gh.player_count, gh.total_rounds, gh.played_at,
           gp.is_winner, gp.cards_won, gp.correct_placements, gp.total_placements
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
  }));
}
