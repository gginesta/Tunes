import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { logger } from './logger';

/**
 * AES-256-GCM encryption for Spotify tokens persisted to SQLite, so a leaked
 * database file does not hand out live access to hosts' Spotify accounts.
 *
 * Key resolution order:
 *  1. TOKEN_ENCRYPTION_KEY env var (64 hex chars)
 *  2. data/.token-key file (auto-generated on first run, mode 0600)
 * The auto-generated file keeps zero-config deployments working: tokens
 * still survive server restarts as long as the data volume persists.
 */

const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', '..', 'data');
const KEY_FILE = join(DATA_DIR, '.token-key');
const PREFIX = 'enc:v1:';

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const fromEnv = process.env.TOKEN_ENCRYPTION_KEY;
  if (fromEnv) {
    const key = Buffer.from(fromEnv, 'hex');
    if (key.length === 32) {
      cachedKey = key;
      return key;
    }
    logger.warn('TOKEN_ENCRYPTION_KEY is not 64 hex chars; falling back to key file');
  }

  if (existsSync(KEY_FILE)) {
    const key = Buffer.from(readFileSync(KEY_FILE, 'utf8').trim(), 'hex');
    if (key.length === 32) {
      cachedKey = key;
      return key;
    }
    logger.warn('Token key file is malformed; generating a new key', { keyFile: KEY_FILE });
  }

  const key = randomBytes(32);
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(KEY_FILE, key.toString('hex'), { mode: 0o600 });
  logger.info('Generated token encryption key', { keyFile: KEY_FILE });
  cachedKey = key;
  return key;
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

/**
 * Returns the plaintext token, or null when the value cannot be decrypted
 * (e.g. the key was rotated). Values without the encryption prefix are
 * legacy plaintext rows and are returned as-is.
 */
export function decryptToken(stored: string): string | null {
  if (!stored.startsWith(PREFIX)) return stored;
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
    const iv = raw.subarray(0, 12);
    const authTag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', getKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (err) {
    logger.warn('Could not decrypt stored Spotify token; discarding it', { error: String(err) });
    return null;
  }
}
