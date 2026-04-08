import { useEffect } from 'react';
import { getSocket, saveSession, getSession, clearSession } from '../services/socket';
import { useGameStore } from '../store';
import { playBuzzSound, playBuzzAlertSound, playTurnSound } from '../services/sounds';

export function useSocket() {
  useEffect(() => {
    const socket = getSocket();
    socket.connect();

    socket.on('connect', () => {
      useGameStore.getState().setConnected(true);

      // Auto-rejoin room after reconnect
      const session = getSession();
      if (session) {
        console.log('[Tunes] Reconnected — attempting rejoin', session.roomCode);
        socket.emit('rejoin-room', {
          code: session.roomCode,
          playerId: session.playerId,
        });
      }
    });
    socket.on('disconnect', () => useGameStore.getState().setConnected(false));

    socket.on('room-created', ({ code, playerId, room }) => {
      const store = useGameStore.getState();
      store.setMyId(playerId);
      store.setRoomCode(code);
      store.setPlayers(room.players);
      store.setHostId(room.hostId);
      store.setSettings(room.settings);
      store.setScreen('lobby');
      store.setError(null);
      saveSession(code, playerId);
    });

    socket.on('room-joined', ({ room, playerId }) => {
      const store = useGameStore.getState();
      store.setMyId(playerId);
      store.setRoomCode(room.code);
      store.setPlayers(room.players);
      store.setHostId(room.hostId);
      store.setSettings(room.settings);
      // Only navigate to lobby if not in an active game
      const phase = room.gameState.phase;
      if (phase === 'lobby') {
        store.setScreen('lobby');
      }
      store.setError(null);
      saveSession(room.code, playerId);
    });

    socket.on('player-joined', (player) => {
      useGameStore.getState().addPlayer(player);
    });

    socket.on('player-left', (playerId) => {
      useGameStore.getState().removePlayer(playerId);
    });

    socket.on('settings-updated', (settings) => {
      useGameStore.getState().setSettings(settings);
    });

    socket.on('game-started', ({ gameState, anchorCards }) => {
      const store = useGameStore.getState();
      store.setPhase(gameState.phase);
      store.setTurnOrder(gameState.turnOrder || []);
      store.setCurrentTurnPlayerId(gameState.currentTurnPlayerId);
      store.setDeckSize(gameState.deckSize);
      store.setLastReveal(null);
      store.setAnchorCards(anchorCards ?? null);
      useGameStore.setState({ triviaScore: { correct: 0, total: 0 } });
      store.setScreen('game');

      // Request notification permission for background turn alerts
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    });

    socket.on('new-turn', ({ turnPlayerId, songCard }) => {
      const store = useGameStore.getState();
      store.setCurrentTurnPlayerId(turnPlayerId);
      store.setCurrentSong(songCard);
      store.setPhase('playing');
      store.setPendingPlacement(null);
      store.setLastReveal(null);
      store.setAnchorCards(null);
      useGameStore.setState({ songNameResult: null, turnDeadline: null, challengers: [] });
      store.clearBuzzedPlayers();

      // Notify player when it's their turn (sound + vibrate + background notification)
      if (turnPlayerId === store.myId) {
        playTurnSound();
        if (document.hidden && Notification.permission === 'granted') {
          new Notification('Tunes', { body: "It's your turn!", icon: '/favicon.ico' });
        }
      }
    });

    socket.on('turn-started', ({ turnDeadline }) => {
      useGameStore.setState({ turnDeadline });
    });

    socket.on('play-song', ({ spotifyTrackId, previewUrl }) => {
      useGameStore.getState().setCurrentTrackId(spotifyTrackId, previewUrl);
    });

    socket.on('resolving-tracks', () => {
      // Could show a loading state — for now just log
      console.log('Resolving Spotify track IDs...');
    });

    socket.on('card-placed', ({ position, challengeDeadline }) => {
      const store = useGameStore.getState();
      store.setPendingPlacement(position);
      useGameStore.setState({ challengeDeadline: challengeDeadline ?? null, turnDeadline: null });
      store.setPhase('challenge');
    });

    socket.on('challenge-made', ({ challengerId }) => {
      useGameStore.getState().addChallenger(challengerId);
    });

    socket.on('reveal', (data) => {
      const store = useGameStore.getState();
      store.setLastReveal(data);
      store.setPhase('reveal');
      store.setCurrentSong(data.song);
      useGameStore.setState({ challengeDeadline: null, turnDeadline: null });
    });

    socket.on('tokens-updated', ({ playerId, tokens }) => {
      useGameStore.getState().updatePlayerTokens(playerId, tokens);
    });

    socket.on('timeline-updated', ({ playerId, timeline }) => {
      useGameStore.getState().updatePlayerTimeline(playerId, timeline);
    });

    socket.on('shared-timeline-updated', ({ timeline }) => {
      useGameStore.getState().setSharedTimeline(timeline);
    });

    socket.on('song-named', ({ playerId, correct, titleMatch, artistMatch }) => {
      useGameStore.getState().setSongNameResult(playerId, correct, titleMatch, artistMatch);
    });

    socket.on('game-stats', (data) => {
      useGameStore.getState().setGameStats(data);
    });

    socket.on('song-history', ({ history }) => {
      useGameStore.getState().setSongHistory(history);
    });

    socket.on('game-over', ({ winnerId, players }) => {
      const store = useGameStore.getState();
      store.setWinner(winnerId, players);
      store.setPhase('game_over');
      store.setScreen('results');
      useGameStore.setState({ turnDeadline: null });
    });

    socket.on('game-restarted', ({ room }) => {
      const store = useGameStore.getState();
      store.syncRoom(room);
      store.setScreen('lobby');
      store.setCurrentTrackId(null);
      store.setIsPlaying(false);
      store.setLastReveal(null);
      useGameStore.setState({
        winnerId: null,
        finalPlayers: {},
        gameStats: null,
        songHistory: [],
        songNameResult: null,
        challengeDeadline: null,
        turnDeadline: null,
      });
    });

    socket.on('error', ({ message }) => {
      useGameStore.getState().setError(message);
      // If rejoin failed (room gone), clear saved session
      if (message.includes('not found') || message.includes('unknown')) {
        clearSession();
      }
    });

    socket.on('state-sync', (room) => {
      useGameStore.getState().syncRoom(room);
    });

    socket.on('player-disconnected', ({ playerId, reconnectDeadline }) => {
      useGameStore.getState().setPlayerDisconnected(playerId, reconnectDeadline);
    });

    socket.on('player-reconnected', ({ playerId }) => {
      useGameStore.getState().setPlayerReconnected(playerId);
    });

    socket.on('player-timed-out', ({ playerId }) => {
      useGameStore.getState().setPlayerTimedOut(playerId);
    });

    socket.on('player-buzzed', ({ playerId }) => {
      const store = useGameStore.getState();
      store.addBuzzedPlayer(playerId);
      // Annoying alert for the active player, normal sound for others
      if (store.currentTurnPlayerId === store.myId) {
        playBuzzAlertSound();
        store.triggerBuzzFlash();
      } else {
        playBuzzSound();
      }
    });

    socket.on('leaderboard', ({ entries }) => {
      useGameStore.getState().setLeaderboard(entries);
    });

    socket.on('my-stats', ({ stats }) => {
      useGameStore.getState().setMyStats(stats);
    });

    socket.on('my-history', ({ games }) => {
      useGameStore.getState().setMyHistory(games);
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, []);
}
