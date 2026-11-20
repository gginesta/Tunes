import { useEffect, useRef, useCallback } from 'react';
import { useGameStore } from '../store';
import { getSocket } from '../services/socket';
import { activateElement, playTrack, pause, setPlayerVolume } from '../services/spotifyPlayer';
import { playPreviewUrl, pauseFallback, setFallbackVolume } from '../services/audioFallback';
import {
  ensureFallbackAudio,
  ensureSpotifySession,
  beginSpotifyPlaybackAttempt,
  cancelSpotifyPlaybackAttempt,
  getSpotifyToken,
  restoreSpotifyForCurrentHost,
  isUsingFallback,
  setUsingFallback,
} from '../services/spotifySession';
import { getPlaybackAttemptKey, getPlaybackRoute } from '../services/playbackRoute';

export function useSpotifyPlayer() {
  const spotifyToken = useGameStore((s) => s.spotifyToken);
  const hostId = useGameStore((s) => s.hostId);
  const myId = useGameStore((s) => s.myId);
  const phase = useGameStore((s) => s.phase);
  const cardId = useGameStore((s) => s.currentSong?.id);
  const currentTrackId = useGameStore((s) => s.currentTrackId);
  const currentPreviewUrl = useGameStore((s) => s.currentPreviewUrl);
  const spotifyReady = useGameStore((s) => s.spotifyReady);
  const volume = useGameStore((s) => s.volume);
  const reconnecting = useGameStore((s) => s.reconnecting);
  const recoveryId = useGameStore((s) => s.hostRecovery?.id);
  const isPlaying = useGameStore((s) => s.isPlaying);

  const isHost = myId !== '' && myId === hostId;
  const lastTrackRef = useRef<string | null>(null);
  const activeAttempt = useRef<{ key: string } | null>(null);
  const recoveryAttempt = useRef<string | null>(null);
  const recoveredCard = useRef<string | null>(null);

  useEffect(() => {
    if (!isHost) return;
    ensureFallbackAudio();
    if (spotifyToken && !reconnecting) ensureSpotifySession();
  }, [isHost, spotifyToken, reconnecting]);

  useEffect(() => {
    setPlayerVolume(volume);
    setFallbackVolume(volume);
  }, [volume]);

  const startPlayback = useCallback(async (fromGesture: boolean) => {
    const state = useGameStore.getState();
    if (document.hidden || state.reconnecting || state.myId !== state.hostId) return;
    if (state.phase !== 'playing' && state.phase !== 'challenge') return;
    const {
      currentTrackId: trackId,
      currentPreviewUrl: previewUrl,
      currentSong,
      hostRecovery,
    } = state;
    const route = getPlaybackRoute(trackId, previewUrl, !!state.spotifyToken);
    const playbackKey = getPlaybackAttemptKey(route, trackId, previewUrl);
    if (!playbackKey) return;
    const attempt = { key: [currentSong?.id, playbackKey, hostRecovery?.id].join(':') };
    if (activeAttempt.current?.key === attempt.key) return;
    activeAttempt.current = attempt;
    const isCurrent = () => {
      const latest = useGameStore.getState();
      return activeAttempt.current === attempt
        && !document.hidden && !latest.reconnecting
        && latest.screen === 'game'
        && latest.myId === state.myId && latest.hostId === state.myId
        && latest.roomCode === state.roomCode
        && latest.currentSong?.id === currentSong?.id
        && latest.currentTrackId === trackId && latest.currentPreviewUrl === previewUrl
        && latest.hostRecovery?.id === hostRecovery?.id
        && (latest.phase === 'playing' || latest.phase === 'challenge');
    };

    if (fromGesture && hostRecovery) recoveryAttempt.current = hostRecovery.id;
    try {
      useGameStore.setState({ autoplayBlocked: false, spotifyError: null });
      if (route === 'spotify' && trackId) {
        if (fromGesture) ensureSpotifySession();
        beginSpotifyPlaybackAttempt(trackId);
        let sent = false;
        try {
          const token = await getSpotifyToken();
          if (isCurrent()) sent = await playTrack(trackId, token, isCurrent);
          if (!sent && isCurrent()) {
            const refreshed = await getSpotifyToken(true);
            if (isCurrent()) sent = await playTrack(trackId, refreshed, isCurrent);
          }
        } catch {
          // A failed SDK/API attempt can still use the current card's preview.
        }
        if (sent || !isCurrent()) return;
        cancelSpotifyPlaybackAttempt(trackId);
      }

      if (previewUrl && isCurrent()) {
        setUsingFallback(true);
        const played = await playPreviewUrl(previewUrl, fromGesture);
        if (!isCurrent()) return;
        if (played) {
          useGameStore.setState({ isPlaying: true, autoplayBlocked: false });
          return;
        }
      }
      if (isCurrent()) {
        useGameStore.setState({
          isPlaying: false,
          autoplayBlocked: true,
          spotifyError: 'Could not play this song. Tap play to try again.',
        });
      }
    } finally {
      if (activeAttempt.current === attempt) activeAttempt.current = null;
    }
  }, []);

  // Keep the recovery paused until the host explicitly starts the current song.
  useEffect(() => {
    if (reconnecting || !isHost || (phase !== 'playing' && phase !== 'challenge')) {
      activeAttempt.current = null;
      recoveryAttempt.current = null;
      if (phase !== 'playing' && phase !== 'challenge') {
        lastTrackRef.current = null;
        recoveredCard.current = null;
      }
    }
    if (!isHost || reconnecting || recoveryId || phase !== 'playing' || document.hidden) return;
    if (recoveredCard.current === cardId) return;
    const route = getPlaybackRoute(currentTrackId, currentPreviewUrl, !!spotifyToken);
    const playbackKey = getPlaybackAttemptKey(route, currentTrackId, currentPreviewUrl);
    if (!playbackKey || (route === 'spotify' && !spotifyReady)) return;
    const key = `${cardId ?? ''}:${playbackKey}`;
    if (lastTrackRef.current === key) return;
    lastTrackRef.current = key;
    void startPlayback(false);
  }, [
    isHost, reconnecting, recoveryId, phase, cardId, spotifyToken, spotifyReady,
    currentTrackId, currentPreviewUrl, startPlayback,
  ]);

  useEffect(() => {
    if (!isHost || reconnecting || !recoveryId || document.hidden) return;
    const needsMusic = (phase === 'playing' || phase === 'challenge')
      && !!(currentTrackId || currentPreviewUrl);
    if (needsMusic && (!isPlaying || recoveryAttempt.current !== recoveryId)) return;
    const socket = getSocket();
    if (!socket.connected) return;
    if (needsMusic) recoveredCard.current = cardId ?? null;
    socket.emit('host-playback-ready', { recoveryId });
  }, [isHost, reconnecting, recoveryId, phase, cardId, currentTrackId, currentPreviewUrl, isPlaying]);

  // Music continues during the challenge window.
  useEffect(() => {
    if (!isHost || (phase !== 'reveal' && phase !== 'game_over')) return;
    cancelSpotifyPlaybackAttempt();
    void pause();
    pauseFallback();
  }, [isHost, phase]);

  const togglePlayback = useCallback(() => {
    const state = useGameStore.getState();
    if (!isHost || state.reconnecting || (state.phase !== 'playing' && state.phase !== 'challenge')) return;
    if (state.isPlaying) {
      activeAttempt.current = null;
      cancelSpotifyPlaybackAttempt();
      if (isUsingFallback()) {
        pauseFallback();
      } else {
        void pause();
      }
      useGameStore.setState({ isPlaying: false });
      return;
    }
    activateElement();
    const route = getPlaybackRoute(state.currentTrackId, state.currentPreviewUrl, !!state.spotifyToken);
    const key = getPlaybackAttemptKey(route, state.currentTrackId, state.currentPreviewUrl);
    if (key) lastTrackRef.current = `${state.currentSong?.id ?? ''}:${key}`;
    if (!key && state.currentTrackId) {
      void restoreSpotifyForCurrentHost(state.roomCode, state.myId, state.hostId)
        .then((token) => {
          const latest = useGameStore.getState();
          if (token && latest.roomCode === state.roomCode && latest.myId === state.myId
            && latest.currentSong?.id === state.currentSong?.id
            && latest.hostRecovery?.id === state.hostRecovery?.id) {
            void startPlayback(true);
          } else if (!token) {
            useGameStore.setState({ spotifyError: 'Could not restore Spotify. Check your connection and tap play again.' });
          }
        })
        .catch(() => {
          useGameStore.setState({ spotifyError: 'Could not restore Spotify. Check your connection and tap play again.' });
        });
      return;
    }
    void startPlayback(true);
  }, [isHost, startPlayback]);

  return { isHost, spotifyReady, togglePlayback };
}
