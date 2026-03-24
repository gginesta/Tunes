import { createHash } from 'crypto';
import { readFileSync, renameSync, existsSync } from 'fs';
import { join } from 'path';
import { saveAccount, loadAccount } from './database';
import { logger } from './logger';

export interface Account {
  username: string;
  displayName: string;
  passwordHash: string;
  createdAt: string;
}

interface AccountStore {
  accounts: Record<string, Account>;
}

const DATA_DIR = join(__dirname, '..', '..', 'data');
const ACCOUNTS_FILE = join(DATA_DIR, 'accounts.json');
const MIGRATED_FILE = join(DATA_DIR, 'accounts.json.migrated');

function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

/**
 * Migrate accounts from the old JSON file to SQLite.
 * Called once on startup. If accounts.json exists, imports all entries
 * into SQLite and renames the file to accounts.json.migrated.
 */
export function migrateAccountsFromJson(): void {
  if (!existsSync(ACCOUNTS_FILE)) return;

  try {
    const raw = readFileSync(ACCOUNTS_FILE, 'utf-8');
    const store = JSON.parse(raw) as AccountStore;

    for (const account of Object.values(store.accounts)) {
      saveAccount(account);
    }

    renameSync(ACCOUNTS_FILE, MIGRATED_FILE);
    logger.info('Migrated accounts from JSON to SQLite', { count: Object.keys(store.accounts).length });
  } catch (err) {
    logger.error('Failed to migrate accounts from JSON', { error: String(err) });
  }
}

export function createAccount(
  username: string,
  password: string,
  displayName: string,
): { success: boolean; error?: string } {
  const key = username.toLowerCase();

  if (loadAccount(key)) {
    return { success: false, error: 'Username already taken' };
  }

  if (username.length < 2 || username.length > 20) {
    return { success: false, error: 'Username must be 2-20 characters' };
  }

  if (password.length < 3) {
    return { success: false, error: 'Password must be at least 3 characters' };
  }

  const account: Account = {
    username: key,
    displayName: displayName || username,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  };

  saveAccount(account);
  logger.info('Account created', { username: key });
  return { success: true };
}

export function login(
  username: string,
  password: string,
): { success: boolean; error?: string; displayName?: string } {
  const key = username.toLowerCase();
  const account = loadAccount(key);

  if (!account) {
    logger.warn('Login failed: account not found', { username: key });
    return { success: false, error: 'Account not found' };
  }

  if (account.passwordHash !== hashPassword(password)) {
    logger.warn('Login failed: incorrect password', { username: key });
    return { success: false, error: 'Incorrect password' };
  }

  logger.info('Login successful', { username: key });
  return { success: true, displayName: account.displayName };
}

export function getAccount(username: string): Account | null {
  return loadAccount(username.toLowerCase());
}
