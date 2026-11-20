import { io, Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@tunes/shared';
import { clearTableSpotifyCredential } from './tableSpotifyCredential';
import { appPath, appStorageKey } from '../paths';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: GameSocket | null = null;

export function getSocket(): GameSocket {
  if (!socket) {
    const url = import.meta.env.VITE_SERVER_URL || '';
    socket = io(url, {
      path: url ? '/socket.io' : appPath('socket.io'),
      transports: ['websocket', 'polling'],
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });

    // When tab becomes visible again, force reconnect if disconnected
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && socket && !socket.connected) {
        console.log('[Tunes] Tab visible again — reconnecting socket');
        socket.connect();
      }
    });
  }
  return socket;
}

/**
 * Store session info so we can rejoin after disconnect. Uses localStorage so
 * that the session survives iOS Safari killing the tab when the phone locks
 * or the app is backgrounded — sessionStorage gets wiped in those cases and
 * the player would lose access to the running game.
 *
 * The session is stamped with a timestamp and only considered valid for a
 * short window so a stale session from days ago doesn't try to rejoin a room
 * that no longer exists.
 */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const PLAYBACK_INTENT_KEY = appStorageKey('tunes_playback_intent');
const ROOM_KEY = appStorageKey('tunes_room');
const PLAYER_KEY = appStorageKey('tunes_player');
const SEAT_TOKEN_KEY = appStorageKey('tunes_seat_token');
const GUEST_TOKEN_KEY = appStorageKey('tunes_guest_token');
const SESSION_TIMESTAMP_KEY = appStorageKey('tunes_session_ts');

export type PlaybackIntent = 'spotify' | 'preview';

export function setSessionPlaybackIntent(intent: PlaybackIntent): void {
  try {
    localStorage.setItem(PLAYBACK_INTENT_KEY, intent);
  } catch { /* localStorage unavailable */ }
}

export function getSessionPlaybackIntent(): PlaybackIntent | null {
  try {
    const intent = localStorage.getItem(PLAYBACK_INTENT_KEY);
    return intent === 'spotify' || intent === 'preview' ? intent : null;
  } catch { /* localStorage unavailable */ }
  return null;
}

/** Migrate only when the restored room itself proves the original host's mode. */
export function migrateSessionPlaybackIntent(
  roomPlaybackMode: PlaybackIntent | undefined,
  isOriginalHost: boolean,
): void {
  if (getSessionPlaybackIntent() === null && isOriginalHost && roomPlaybackMode) {
    setSessionPlaybackIntent(roomPlaybackMode);
  }
}

export function sessionAllowsSpotifyRestore(
  expectedRoomCode: string,
  expectedPlayerId: string,
  currentRoomCode: string,
  currentPlayerId: string,
): boolean {
  return getSessionPlaybackIntent() === 'spotify'
    && expectedRoomCode === currentRoomCode
    && expectedPlayerId === currentPlayerId;
}

export function saveSession(roomCode: string, playerId: string, resumeToken: string, guestToken?: string): void {
  try {
    localStorage.setItem(ROOM_KEY, roomCode);
    localStorage.setItem(PLAYER_KEY, playerId);
    localStorage.setItem(SEAT_TOKEN_KEY, resumeToken);
    if (guestToken) localStorage.setItem(GUEST_TOKEN_KEY, guestToken);
    localStorage.setItem(SESSION_TIMESTAMP_KEY, String(Date.now()));
  } catch { /* localStorage unavailable */ }
}

export function getSession(): { roomCode: string; playerId: string; resumeToken: string } | null {
  try {
    const roomCode = localStorage.getItem(ROOM_KEY);
    const playerId = localStorage.getItem(PLAYER_KEY);
    const ts = parseInt(localStorage.getItem(SESSION_TIMESTAMP_KEY) || '0', 10);
    if (!roomCode || !playerId) return null;
    if (ts && Date.now() - ts > SESSION_TTL_MS) {
      clearSession();
      return null;
    }
    return { roomCode, playerId, resumeToken: localStorage.getItem(SEAT_TOKEN_KEY) || '' };
  } catch { /* localStorage unavailable */ }
  return null;
}

export function getGuestToken(): string | undefined {
  try { return localStorage.getItem(GUEST_TOKEN_KEY) || undefined; } catch { return undefined; }
}

export function createTable(playerName: string): void {
  const client = getSocket();
  if (client.connected) client.emit('create-room', { playerName: playerName.trim(), guestToken: getGuestToken(), playbackMode: 'manual' });
}

export function joinTable(code: string, playerName: string): void {
  const client = getSocket();
  if (client.connected) client.emit('join-room', { code: code.trim().toUpperCase(), playerName: playerName.trim(), guestToken: getGuestToken() });
}

export function resumeSavedRoom(): void {
  const session = getSession();
  if (!session) return;
  window.dispatchEvent(new Event('tunes:resuming'));
  if (!session.resumeToken) {
    window.dispatchEvent(new Event('tunes:legacy-seat'));
    return;
  }
  const client = getSocket();
  if (!client.connected) { client.connect(); return; }
  client.emit('rejoin-room', { code: session.roomCode, playerId: session.playerId, resumeToken: session.resumeToken });
}

export function leaveTable(): void {
  const client = getSocket();
  clearSession();
  if (client.connected) client.emit('leave-room');
  window.dispatchEvent(new Event('tunes:left'));
}

export function clearSession(): void {
  try {
    const roomCode = localStorage.getItem(ROOM_KEY);
    const playerId = localStorage.getItem(PLAYER_KEY);
    if (roomCode && playerId) clearTableSpotifyCredential(roomCode, playerId);
    localStorage.removeItem(ROOM_KEY);
    localStorage.removeItem(PLAYER_KEY);
    localStorage.removeItem(SEAT_TOKEN_KEY);
    localStorage.removeItem(SESSION_TIMESTAMP_KEY);
    localStorage.removeItem(PLAYBACK_INTENT_KEY);
  } catch { /* localStorage unavailable */ }
}
