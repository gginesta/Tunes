import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createGuest, getGuestId } from './database';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function issueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function matchesToken(token: unknown, expectedHash: string): boolean {
  return typeof token === 'string' && TOKEN.test(token) && /^[a-f0-9]{64}$/.test(expectedHash)
    && timingSafeEqual(Buffer.from(tokenHash(token), 'hex'), Buffer.from(expectedHash, 'hex'));
}

export function authenticateGuest(token: unknown): string | undefined {
  return typeof token === 'string' && TOKEN.test(token) ? getGuestId(tokenHash(token)) : undefined;
}

export function getOrCreateGuest(token: unknown): { guestId: string; guestToken: string } {
  if (typeof token === 'string') {
    const guestId = authenticateGuest(token);
    if (guestId) return { guestId, guestToken: token };
  }
  const guestToken = issueToken();
  return { guestId: createGuest(tokenHash(guestToken)), guestToken };
}
