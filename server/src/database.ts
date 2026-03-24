import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import type { Room } from '@hitster/shared';
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
