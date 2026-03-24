import { useEffect } from 'react';
import { getSocket } from '../services/socket';
import { useGameStore } from '../store';

export function useSocket() {
  const store = useGameStore();

  useEffect(() => {
    const socket = getSocket();
    socket.connect();
    store.setConnected(true);

    socket.on('connect', () => store.setConnected(true));
    socket.on('disconnect', () => store.setConnected(false));

    socket.on('room-created', ({ code, playerId, room }) => {
      store.setMyId(playerId);
      store.setRoomCode(code);
      store.setPlayers(room.players);
      store.setHostId(room.hostId);
      store.setSettings(room.settings);
      store.setScreen('lobby');
      store.setError(null);
    });

    socket.on('room-joined', ({ room, playerId }) => {
      store.setMyId(playerId);
      store.setRoomCode(room.code);
      store.setPlayers(room.players);
      store.setHostId(room.hostId);
      store.setSettings(room.settings);
      store.setScreen('lobby');
      store.setError(null);
    });

    socket.on('player-joined', (player) => {
      store.addPlayer(player);
    });

    socket.on('player-left', (playerId) => {
      store.removePlayer(playerId);
    });

    socket.on('settings-updated', (settings) => {
      store.setSettings(settings);
    });

    socket.on('game-started', ({ gameState }) => {
      store.setPhase(gameState.phase);
      store.setCurrentTurnPlayerId(gameState.currentTurnPlayerId);
      store.setDeckSize(gameState.deckSize);
      store.setLastReveal(null);
      store.setScreen('game');
    });

    socket.on('new-turn', ({ turnPlayerId, songCard }) => {
      store.setCurrentTurnPlayerId(turnPlayerId);
      store.setCurrentSong(songCard);
      store.setPhase('playing');
      store.setPendingPlacement(null);
      store.setLastReveal(null);
      useGameStore.setState({ songNameResult: null });
    });

    socket.on('play-song', ({ spotifyTrackId, previewUrl }) => {
      store.setCurrentTrackId(spotifyTrackId, previewUrl);
    });

    socket.on('resolving-tracks', () => {
      // Could show a loading state — for now just log
      console.log('Resolving Spotify track IDs...');
    });

    socket.on('card-placed', ({ position }) => {
      store.setPendingPlacement(position);
      store.setPhase('challenge');
    });

    socket.on('challenge-made', ({ challengerId }) => {
      store.addChallenger(challengerId);
    });

    socket.on('reveal', (data) => {
      store.setLastReveal(data);
      store.setPhase('reveal');
      store.setCurrentSong(data.song);
    });

    socket.on('tokens-updated', ({ playerId, tokens }) => {
      store.updatePlayerTokens(playerId, tokens);
    });

    socket.on('timeline-updated', ({ playerId, timeline }) => {
      store.updatePlayerTimeline(playerId, timeline);
    });

    socket.on('shared-timeline-updated', ({ timeline }) => {
      store.setSharedTimeline(timeline);
    });

    socket.on('song-named', ({ playerId, correct }) => {
      store.setSongNameResult(playerId, correct);
    });

    socket.on('game-over', ({ winnerId, players }) => {
      store.setWinner(winnerId, players);
      store.setPhase('game_over');
      store.setScreen('results');
    });

    socket.on('error', ({ message }) => {
      store.setError(message);
    });

    socket.on('state-sync', (room) => {
      store.syncRoom(room);
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
