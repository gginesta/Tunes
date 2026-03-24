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
import {
  initFallbackAudio,
  playPreviewUrl,
  pauseFallback,
  resumeFallback,
  isFallbackPlaying,
  destroyFallback,
} from '../services/audioFallback';

export function useSpotifyPlayer() {
  const spotifyToken = useGameStore((s) => s.spotifyToken);
  const spotifyRefreshToken = useGameStore((s) => s.spotifyRefreshToken);
  const hostId = useGameStore((s) => s.hostId);
  const myId = useGameStore((s) => s.myId);
  const phase = useGameStore((s) => s.phase);
  const currentTrackId = useGameStore((s) => s.currentTrackId);
  const currentPreviewUrl = useGameStore((s) => s.currentPreviewUrl);
  const spotifyReady = useGameStore((s) => s.spotifyReady);

  const isHost = myId === hostId && !!spotifyToken;
  const lastTrackRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(spotifyToken);
  // Track whether we're using fallback audio for the current track
  const usingFallbackRef = useRef(false);

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

    // Always init fallback audio for state changes
    initFallbackAudio({
      onStateChange: (paused) => {
        if (usingFallbackRef.current) {
          useGameStore.setState({ isPlaying: !paused });
        }
      },
    });

    initPlayer(getToken, {
      onReady: (deviceId) => {
        console.log('[Hitster] Spotify SDK ready, device:', deviceId);
        useGameStore.setState({
          spotifyDeviceId: deviceId,
          spotifyReady: true,
          spotifyError: null,
        });
      },
      onNotReady: () => {
        console.warn('[Hitster] Spotify SDK not ready');
        useGameStore.setState({ spotifyReady: false, spotifyDeviceId: null });
      },
      onError: (message) => {
        console.error('[Hitster] Spotify SDK error:', message);
        // Still mark as ready so the play button shows — we'll use fallback
        useGameStore.setState({
          spotifyError: message,
          spotifyReady: true,
        });
      },
      onStateChange: (paused) => {
        if (!usingFallbackRef.current) {
          useGameStore.setState({ isPlaying: !paused });
        }
      },
    });

    return () => {
      disconnect();
      destroyFallback();
      useGameStore.setState({
        spotifyReady: false,
        spotifyDeviceId: null,
        isPlaying: false,
      });
    };
  }, [isHost, getToken]);

  // Auto-play on new turn
  useEffect(() => {
    if (!isHost || !currentTrackId) return;
    if (phase !== 'playing') return;
    if (currentTrackId === lastTrackRef.current) return;

    lastTrackRef.current = currentTrackId;
    usingFallbackRef.current = false;

    const attemptPlay = async () => {
      // Try Spotify SDK first
      let sdkSuccess = false;
      let token = tokenRef.current;
      if (!token) {
        try {
          token = await getToken();
        } catch {
          console.warn('[Hitster] Failed to get Spotify token');
        }
      }

      if (token && spotifyReady) {
        try {
          await playTrack(currentTrackId, token);
          // Check if playback actually started after a short delay
          await new Promise((r) => setTimeout(r, 1500));
          const { isPlaying } = useGameStore.getState();
          sdkSuccess = isPlaying;
          if (sdkSuccess) {
            console.log('[Hitster] Spotify SDK playback started');
          } else {
            console.warn('[Hitster] Spotify SDK playTrack called but not playing');
          }
        } catch (err) {
          console.warn('[Hitster] Spotify SDK playTrack failed:', err);
        }
      }

      // Fallback to preview URL if SDK didn't work
      if (!sdkSuccess) {
        const previewUrl = useGameStore.getState().currentPreviewUrl;
        if (previewUrl) {
          console.log('[Hitster] Falling back to preview URL');
          usingFallbackRef.current = true;
          const ok = await playPreviewUrl(previewUrl);
          if (ok) {
            useGameStore.setState({ isPlaying: true, spotifyError: null });
          } else {
            useGameStore.setState({
              spotifyError: 'Could not play audio. Check your browser permissions.',
            });
          }
        } else {
          console.error('[Hitster] No preview URL available for fallback');
          useGameStore.setState({
            spotifyError: 'Could not play this song. Spotify Premium may be required.',
          });
        }
      }
    };

    attemptPlay();
  }, [isHost, spotifyReady, currentTrackId, phase, getToken]);

  // Auto-pause on challenge/reveal
  useEffect(() => {
    if (!isHost) return;
    if (phase === 'challenge' || phase === 'reveal' || phase === 'game_over') {
      pause();
      pauseFallback();
    }
  }, [isHost, phase]);

  // Expose controls
  const togglePlayback = useCallback(async () => {
    const { isPlaying: playing, currentTrackId: trackId, currentPreviewUrl: previewUrl } = useGameStore.getState();

    if (playing) {
      if (usingFallbackRef.current) {
        pauseFallback();
        useGameStore.setState({ isPlaying: false });
      } else {
        await pause();
      }
    } else {
      if (usingFallbackRef.current) {
        // Resume or restart fallback
        if (isFallbackPlaying()) return;
        if (previewUrl) {
          await playPreviewUrl(previewUrl);
          useGameStore.setState({ isPlaying: true });
        } else {
          resumeFallback();
        }
      } else {
        // Try SDK playTrack, then fall back
        const token = tokenRef.current;
        if (trackId && token) {
          try {
            await playTrack(trackId, token);
            // Give SDK a moment to respond
            await new Promise((r) => setTimeout(r, 1000));
            const { isPlaying: nowPlaying } = useGameStore.getState();
            if (!nowPlaying && previewUrl) {
              console.log('[Hitster] SDK toggle failed, using fallback');
              usingFallbackRef.current = true;
              await playPreviewUrl(previewUrl);
              useGameStore.setState({ isPlaying: true });
            }
          } catch {
            if (previewUrl) {
              usingFallbackRef.current = true;
              await playPreviewUrl(previewUrl);
              useGameStore.setState({ isPlaying: true });
            }
          }
        } else if (previewUrl) {
          usingFallbackRef.current = true;
          await playPreviewUrl(previewUrl);
          useGameStore.setState({ isPlaying: true });
        } else {
          await resume();
        }
      }
    }
  }, []);

  return {
    isHost,
    spotifyReady,
    togglePlayback,
  };
}
