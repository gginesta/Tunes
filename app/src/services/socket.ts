import { io, Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@hitster/shared';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: GameSocket | null = null;

export function getSocket(): GameSocket {
  if (!socket) {
    const url = import.meta.env.VITE_SERVER_URL || '';
    socket = io(url, {
      transports: ['websocket', 'polling'],
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });
  }
  return socket;
}

/** Store session info so we can rejoin after disconnect */
export function saveSession(roomCode: string, playerId: string): void {
  try {
    sessionStorage.setItem('hitster_room', roomCode);
    sessionStorage.setItem('hitster_player', playerId);
  } catch { /* sessionStorage unavailable */ }
}

export function getSession(): { roomCode: string; playerId: string } | null {
  try {
    const roomCode = sessionStorage.getItem('hitster_room');
    const playerId = sessionStorage.getItem('hitster_player');
    if (roomCode && playerId) return { roomCode, playerId };
  } catch { /* sessionStorage unavailable */ }
  return null;
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem('hitster_room');
    sessionStorage.removeItem('hitster_player');
  } catch { /* sessionStorage unavailable */ }
}
