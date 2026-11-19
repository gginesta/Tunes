import { useEffect } from 'react';
import type { Room } from '@tunes/shared';
import { clearSession, getGuestToken, getSession, getSocket, resumeSavedRoom, saveSession } from '../services/socket';
import { useGameStore } from '../store';

export function useSocket() {
  useEffect(() => {
    const socket = getSocket();
    const store = useGameStore;
    const reset = () => {
      store.getState().reset();
      store.setState({ connected: socket.connected });
    };
    const legacy = () => {
      const roomCode = getSession()?.roomCode ?? null;
      clearSession();
      reset();
      store.setState({ recoveryStatus: 'legacy', pendingJoinCode: roomCode });
    };
    const resuming = () => store.setState({ recoveryStatus: 'joining' });
    function connected() {
      store.setState({ connected: true });
      const guestToken = getGuestToken();
      if (guestToken) socket.emit('get-my-tables', { guestToken });
      if (store.getState().recoveryStatus === 'replaced') return;
      const incoming = /^\/join\/([A-Za-z]{4})\/?$/.exec(window.location.pathname)?.[1] || store.getState().pendingJoinCode;
      const seat = getSession();
      if (seat && (!incoming || incoming.toUpperCase() === seat.roomCode)) resumeSavedRoom();
    }
    function joined(data: { room: Room; playerId: string; resumeToken: string; guestToken?: string }) {
      if (!data.resumeToken) { legacy(); return; }
      saveSession(data.room.code, data.playerId, data.resumeToken, data.guestToken);
      store.setState({ myId: data.playerId, pendingJoinCode: null, error: null, errorAction: null });
      store.getState().syncRoom(data.room);
      if (window.location.pathname.startsWith('/join/')) window.history.replaceState({}, '', '/');
      const guestToken = getGuestToken();
      if (guestToken) socket.emit('get-my-tables', { guestToken });
    }
    socket.on('connect', connected);
    socket.on('disconnect', (reason) => {
      store.setState({ connected: false });
      if (reason === 'io server disconnect' && store.getState().recoveryStatus === 'replaced') {
        queueMicrotask(() => socket.connect());
      }
    });
    socket.on('room-created', joined);
    socket.on('room-joined', joined);
    socket.on('room-left', () => {
      clearSession();
      reset();
      const guestToken = getGuestToken();
      if (guestToken) socket.emit('get-my-tables', {guestToken});
    });
    socket.on('state-sync', (room) => {
      const current = store.getState().room;
      if (!current || current.code !== room.code) return;
      if (current.gameState.matchId && current.gameState.matchId === room.gameState.matchId &&
          (current.gameState.revision ?? 0) > (room.gameState.revision ?? 0)) return;
      store.getState().syncRoom(room);
    });
    socket.on('game-restarted', ({room}) => store.getState().syncRoom(room));
    socket.on('server-config', (config) => {
      store.setState({
        buildId: import.meta.env.VITE_BUILD_REVISION && config.revision && config.revision !== import.meta.env.VITE_BUILD_REVISION
          ? import.meta.env.VITE_BUILD_REVISION + ' · server ' + config.revision
          : config.revision || import.meta.env.VITE_BUILD_REVISION || 'local',
        dinnerAvailable: config.dinnerAvailable !== false,
        licensedPackAvailable: !!config.licensedPacksAvailable,
        licensedPacks: config.licensedPacks || [],
      });
    });
    socket.on('start-status', (status) => {
      store.setState({startProgress: status.phase === 'preparing' ? status.message || 'Preparing the first song…' : null});
      if (status.phase === 'idle' && status.message) store.getState().setNotice(status.message);
    });
    socket.on('error', ({message, code, action}) => {
      if (code === 'ROOM_RESTART_REQUIRED') legacy();
      else if (code === 'REJOIN_FAILED' || code === 'REJOIN_EXPIRED' || code === 'SEAT_REPLACED') {
        // A replaced tab shares storage with its replacement. Keep the newest seat.
        if (code !== 'SEAT_REPLACED') clearSession();
        reset();
        store.setState({recoveryStatus: code === 'SEAT_REPLACED' ? 'replaced' : 'expired'});
      }
      store.setState({ errorAction: action || null, startProgress: null });
      store.getState().setError(message);
    });
    socket.on('player-buzzed', ({playerId}) => store.getState().addBuzzedPlayer(playerId));
    socket.on('leaderboard', ({entries}) => store.setState({leaderboard: entries}));
    socket.on('my-stats', ({stats}) => store.setState({myStats: stats}));
    socket.on('my-history', ({games}) => store.setState({myHistory: games}));
    socket.on('my-tables', ({tables}) => store.setState({savedTables: tables}));
    socket.on('table-saved', ({table}) => {
      store.setState((s) => ({savedTables: [table, ...s.savedTables.filter(t => t.id !== table.id)]}));
      store.getState().setNotice('Table saved. You can find it on Home.');
    });
    window.addEventListener('tunes:left', reset);
    window.addEventListener('tunes:legacy-seat', legacy);
    window.addEventListener('tunes:resuming', resuming);
    if (socket.connected) connected();
    else socket.connect();
    return () => {
      window.removeEventListener('tunes:left', reset);
      window.removeEventListener('tunes:legacy-seat', legacy);
      window.removeEventListener('tunes:resuming', resuming);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, []);
}
