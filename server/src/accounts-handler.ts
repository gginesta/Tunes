import { Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@hitster/shared';
import { createAccount, login } from './accounts';
import { logger } from './logger';

type HitsterSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/** Maps socket IDs to authenticated usernames */
export const socketToUsername = new Map<string, string>();

export function registerAuthHandlers(socket: HitsterSocket) {
  socket.on('register', ({ username, password, displayName }) => {
    const result = createAccount(username, password, displayName);
    if (result.success) {
      const key = username.toLowerCase();
      socketToUsername.set(socket.id, key);
      logger.info('Registration successful', { username });
      socket.emit('auth-result', { success: true, displayName: displayName || username });
    } else {
      logger.warn('Registration failed', { username, error: result.error });
      socket.emit('auth-result', { success: false, error: result.error });
    }
  });

  socket.on('login', ({ username, password }) => {
    const result = login(username, password);
    if (result.success) {
      socketToUsername.set(socket.id, username.toLowerCase());
    }
    socket.emit('auth-result', result);
  });

  socket.on('disconnect', () => {
    socketToUsername.delete(socket.id);
  });
}
