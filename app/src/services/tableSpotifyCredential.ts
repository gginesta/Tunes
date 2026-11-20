import { refreshAccessToken, SpotifySignInExpiredError } from './spotify';
import { appStorageKey } from '../paths';

type Credential = { accessToken: string; refreshToken: string; expiresIn?: number };
type Access = { token: string; refreshToken: string; expiresAt: number; persistent: boolean };

const access = new Map<string, Access>();
const refreshing = new Map<string, { refreshToken: string; request: ReturnType<typeof refreshAccessToken> }>();

function storageKey(roomCode: string, playerId: string): string {
  return appStorageKey(JSON.stringify(['tunes-table-spotify', roomCode, playerId]));
}

function readRefresh(key: string): string | null {
  const cached = access.get(key);
  if (cached && !cached.persistent) return cached.refreshToken;
  try { return localStorage.getItem(key); } catch { return cached?.refreshToken ?? null; }
}

export function hasTableSpotifyCredential(roomCode: string, playerId: string): boolean {
  return !!readRefresh(storageKey(roomCode, playerId));
}

export function saveTableSpotifyCredential(roomCode: string, playerId: string, credential: Credential): void {
  const key = storageKey(roomCode, playerId);
  let persistent = false;
  try {
    localStorage.setItem(key, credential.refreshToken);
    persistent = true;
  } catch { /* This page can use the in-memory grant. */ }
  access.set(key, {
    token: credential.accessToken,
    refreshToken: credential.refreshToken,
    expiresAt: Date.now() + (credential.expiresIn ?? 3600) * 1000,
    persistent,
  });
}

export function clearTableSpotifyCredential(roomCode: string, playerId: string): void {
  const key = storageKey(roomCode, playerId);
  access.delete(key);
  refreshing.delete(key);
  try { localStorage.removeItem(key); } catch { /* The current page's grant was cleared. */ }
}

export async function getTableSpotifyToken(
  roomCode: string, playerId: string, isCurrent: () => boolean, rejectedToken?: string,
): Promise<string> {
  if (!isCurrent()) throw new Error('The speaker seat changed.');
  const key = storageKey(roomCode, playerId);
  const savedRefresh = readRefresh(key);
  if (!savedRefresh) throw new Error('Connect Spotify on this speaker device.');
  const cached = access.get(key);
  if (cached && cached.refreshToken === savedRefresh && cached.expiresAt > Date.now() + 30_000 &&
      cached.token !== rejectedToken) return cached.token;

  let request = refreshing.get(key);
  if (request?.refreshToken !== savedRefresh) {
    const pending = refreshAccessToken(savedRefresh).finally(() => {
      if (refreshing.get(key)?.request === pending) refreshing.delete(key);
    });
    request = { refreshToken: savedRefresh, request: pending };
    refreshing.set(key, request);
  }
  let result;
  try {
    result = await request.request;
  } catch (error) {
    if (isCurrent() && readRefresh(key) === savedRefresh && error instanceof SpotifySignInExpiredError) {
      clearTableSpotifyCredential(roomCode, playerId);
      throw new Error('The Spotify connection expired. Connect again on this speaker device.', { cause: error });
    }
    throw error;
  }
  if (!isCurrent()) throw new Error('The speaker seat changed.');
  if (readRefresh(key) === savedRefresh) saveTableSpotifyCredential(roomCode, playerId, result);
  else if (access.get(key)?.token !== result.accessToken) throw new Error('The speaker session changed.');
  return result.accessToken;
}
