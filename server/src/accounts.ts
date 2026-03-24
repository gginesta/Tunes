import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

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

function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

function loadStore(): AccountStore {
  if (!existsSync(ACCOUNTS_FILE)) {
    return { accounts: {} };
  }
  try {
    const raw = readFileSync(ACCOUNTS_FILE, 'utf-8');
    return JSON.parse(raw) as AccountStore;
  } catch {
    return { accounts: {} };
  }
}

function saveStore(store: AccountStore): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

export function createAccount(
  username: string,
  password: string,
  displayName: string,
): { success: boolean; error?: string } {
  const store = loadStore();
  const key = username.toLowerCase();

  if (store.accounts[key]) {
    return { success: false, error: 'Username already taken' };
  }

  if (username.length < 2 || username.length > 20) {
    return { success: false, error: 'Username must be 2-20 characters' };
  }

  if (password.length < 3) {
    return { success: false, error: 'Password must be at least 3 characters' };
  }

  store.accounts[key] = {
    username: key,
    displayName: displayName || username,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  };

  saveStore(store);
  return { success: true };
}

export function login(
  username: string,
  password: string,
): { success: boolean; error?: string; displayName?: string } {
  const store = loadStore();
  const key = username.toLowerCase();
  const account = store.accounts[key];

  if (!account) {
    return { success: false, error: 'Account not found' };
  }

  if (account.passwordHash !== hashPassword(password)) {
    return { success: false, error: 'Incorrect password' };
  }

  return { success: true, displayName: account.displayName };
}

export function getAccount(username: string): Account | null {
  const store = loadStore();
  return store.accounts[username.toLowerCase()] || null;
}
