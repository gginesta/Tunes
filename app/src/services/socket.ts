import { io, Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@tunes/shared';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: GameSocket | null = null;

export function getSocket(): GameSocket {
  if (!socket) {
    const url = import.meta.env.VITE_SERVER_URL || '';
    socket = io(url, {
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

/** Store session info so we can rejoin after disconnect */
export function saveSession(roomCode: string, playerId: string): void {
  try {
    sessionStorage.setItem('tunes_room', roomCode);
    sessionStorage.setItem('tunes_player', playerId);
  } catch { /* sessionStorage unavailable */ }
}

export function getSession(): { roomCode: string; playerId: string } | null {
  try {
    const roomCode = sessionStorage.getItem('tunes_room');
    const playerId = sessionStorage.getItem('tunes_player');
    if (roomCode && playerId) return { roomCode, playerId };
  } catch { /* sessionStorage unavailable */ }
  return null;
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem('tunes_room');
    sessionStorage.removeItem('tunes_player');
  } catch { /* sessionStorage unavailable */ }
}
