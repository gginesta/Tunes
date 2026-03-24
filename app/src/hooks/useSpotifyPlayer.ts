import { useEffect, useRef, useCallback } from 'react';
import { useGameStore } from '../store';
import { refreshAccessToken } from '../services/spotify';
import {
  initPlayer,
  playTrack,
  pause,
  resume,
  disconnect,
  isInitialized,
} from '../services/spotifyPlayer';

export function useSpotifyPlayer() {
  const spotifyToken = useGameStore((s) => s.spotifyToken);
  const spotifyRefreshToken = useGameStore((s) => s.spotifyRefreshToken);
  const hostId = useGameStore((s) => s.hostId);
  const myId = useGameStore((s) => s.myId);
  const phase = useGameStore((s) => s.phase);
  const currentTrackId = useGameStore((s) => s.currentTrackId);
  const spotifyReady = useGameStore((s) => s.spotifyReady);

  const isHost = myId === hostId && !!spotifyToken;
  const lastTrackRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(spotifyToken);

  // Keep token ref current
  useEffect(() => {
    tokenRef.current = spotifyToken;
  }, [spotifyToken]);

  // Get a fresh token (refresh if needed)
  const getToken = useCallback(async (): Promise<string> => {
    if (tokenRef.current) return tokenRef.current;

    const refreshToken = spotifyRefreshToken || sessionStorage.getItem('spotify_refresh_token');
    if (!refreshToken) throw new Error('No token available');

    const result = await refreshAccessToken(refreshToken);
    useGameStore.setState({
      spotifyToken: result.accessToken,
      spotifyRefreshToken: result.refreshToken,
    });
    sessionStorage.setItem('spotify_refresh_token', result.refreshToken);
    tokenRef.current = result.accessToken;
    return result.accessToken;
  }, [spotifyRefreshToken]);

  // Initialize SDK player (host only)
  useEffect(() => {
    if (!isHost || isInitialized()) return;

    initPlayer(getToken, {
      onReady: (deviceId) => {
        useGameStore.setState({
          spotifyDeviceId: deviceId,
          spotifyReady: true,
          spotifyError: null,
        });
      },
      onNotReady: () => {
        useGameStore.setState({ spotifyReady: false, spotifyDeviceId: null });
      },
      onError: (message) => {
        useGameStore.setState({ spotifyError: message, spotifyReady: false });
      },
      onStateChange: (paused) => {
        useGameStore.setState({ isPlaying: !paused });
      },
    });

    return () => {
      disconnect();
      useGameStore.setState({
        spotifyReady: false,
        spotifyDeviceId: null,
        isPlaying: false,
      });
    };
  }, [isHost, getToken]);

  // Auto-play on new turn
  useEffect(() => {
    if (!isHost || !spotifyReady || !currentTrackId) return;
    if (phase !== 'playing') return;
    if (currentTrackId === lastTrackRef.current) return;

    lastTrackRef.current = currentTrackId;

    const attemptPlay = async () => {
      let token = tokenRef.current;
      if (!token) {
        // Token might not be ready yet — try refreshing
        try {
          token = await getToken();
        } catch {
          console.error('[Hitster] Failed to get Spotify token for auto-play');
          return;
        }
      }
      try {
        await playTrack(currentTrackId, token);
      } catch (err) {
        console.error('[Hitster] Auto-play failed:', err);
      }
    };

    attemptPlay();
  }, [isHost, spotifyReady, currentTrackId, phase, getToken]);

  // Auto-pause on challenge/reveal
  useEffect(() => {
    if (!isHost || !spotifyReady) return;
    if (phase === 'challenge' || phase === 'reveal' || phase === 'game_over') {
      pause();
    }
  }, [isHost, spotifyReady, phase]);

  // Expose controls
  const togglePlayback = useCallback(async () => {
    const { isPlaying: playing, currentTrackId: trackId } = useGameStore.getState();
    if (playing) {
      await pause();
    } else {
      // Try resume first; if no track is loaded, start playback from scratch
      const token = tokenRef.current;
      if (trackId && token) {
        await playTrack(trackId, token);
      } else {
        await resume();
      }
    }
  }, []);

  return {
    isHost,
    spotifyReady,
    togglePlayback,
  };
}
