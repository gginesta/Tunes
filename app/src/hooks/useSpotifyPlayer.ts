import { useEffect, useRef, useCallback } from 'react';
import { useGameStore } from '../store';
import { refreshAccessToken } from '../services/spotify';
import {
  initPlayer,
  activateElement,
  playTrack,
  pause,
  togglePlay,
  disconnect,
  isInitialized,
} from '../services/spotifyPlayer';
import {
  initFallbackAudio,
  playPreviewUrl,
  pauseFallback,
  destroyFallback,
} from '../services/audioFallback';

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
  const usingFallbackRef = useRef(false);
  // Track whether autoplay was blocked — user needs to click play
  const autoplayBlockedRef = useRef(false);

  // Keep token ref current
  useEffect(() => {
    tokenRef.current = spotifyToken;
  }, [spotifyToken]);

  // Get a fresh token (refresh if needed)
  const getToken = useCallback(async (): Promise<string> => {
    if (tokenRef.current) return tokenRef.current;

    // Check both storage locations (Home.tsx saves to localStorage)
    const refreshToken = spotifyRefreshToken
      || localStorage.getItem('spotify_refresh_token')
      || sessionStorage.getItem('spotify_refresh_token');
    if (!refreshToken) throw new Error('No token available');

    const result = await refreshAccessToken(refreshToken);
    useGameStore.setState({
      spotifyToken: result.accessToken,
      spotifyRefreshToken: result.refreshToken,
    });
    // Save to both storage locations for consistency
    localStorage.setItem('spotify_refresh_token', result.refreshToken);
    tokenRef.current = result.accessToken;
    return result.accessToken;
  }, [spotifyRefreshToken]);

  // Initialize SDK player (host only)
  useEffect(() => {
    if (!isHost || isInitialized()) return;

    // Init fallback audio in parallel
    initFallbackAudio({
      onStateChange: (paused) => {
        if (usingFallbackRef.current) {
          useGameStore.setState({ isPlaying: !paused });
        }
      },
    });

    initPlayer(getToken, {
      onReady: (_deviceId) => {
        useGameStore.setState({
          spotifyDeviceId: _deviceId,
          spotifyReady: true,
          spotifyError: null,
        });
      },
      onNotReady: () => {
        // Don't set spotifyReady=false — the SDK will reconnect with a new device
        // and fire 'ready' again. Setting false would cancel pending playback.
        useGameStore.setState({ spotifyDeviceId: null });
        console.log('[Hitster] Device went offline, waiting for reconnection...');
      },
      onError: (message) => {
        useGameStore.setState({ spotifyError: message, spotifyReady: false });
      },
      onAutoplayFailed: () => {
        // Browser blocked autoplay — the user must click the play button
        autoplayBlockedRef.current = true;
        useGameStore.setState({ isPlaying: false });
        console.log('[Hitster] Autoplay blocked — waiting for user to click play');
      },
      onStateChange: (paused) => {
        if (!usingFallbackRef.current) {
          useGameStore.setState({ isPlaying: !paused });
        }
      },
      onActive: (active) => {
        if (!active) {
          console.log('[Hitster] Player state is null — device not yet active');
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

  /**
   * Attempt to play a track. Tries SDK first, falls back to preview URL.
   * Returns true if playback started.
   */
  const attemptPlayTrack = useCallback(async (trackId: string): Promise<boolean> => {
    usingFallbackRef.current = false;

    // Get a fresh token
    let token: string;
    try {
      token = await getToken();
    } catch {
      console.warn('[Hitster] Could not get token for playback');
      return tryFallback();
    }

    // Try SDK playback
    const success = await playTrack(trackId, token);
    if (success) {
      // If token was 401, refresh and retry once
      return true;
    }

    // Token might be expired — refresh and retry
    console.log('[Hitster] Refreshing token and retrying playTrack...');
    try {
      tokenRef.current = null; // Force refresh
      token = await getToken();
      const retrySuccess = await playTrack(trackId, token);
      if (retrySuccess) return true;
    } catch {
      console.warn('[Hitster] Token refresh failed');
    }

    // SDK failed — try preview URL fallback
    return tryFallback();
  }, [getToken]);

  const tryFallback = useCallback(async (): Promise<boolean> => {
    const previewUrl = useGameStore.getState().currentPreviewUrl;
    if (previewUrl) {
      console.log('[Hitster] Using preview URL fallback');
      usingFallbackRef.current = true;
      const ok = await playPreviewUrl(previewUrl);
      if (ok) {
        useGameStore.setState({ isPlaying: true });
        return true;
      }
    }
    console.error('[Hitster] All playback methods failed');
    useGameStore.setState({
      spotifyError: 'Could not play this song. Try clicking the play button.',
    });
    return false;
  }, []);

  // Auto-play on new turn OR when device becomes ready
  useEffect(() => {
    if (!isHost || !spotifyReady || !currentTrackId) return;
    if (phase !== 'playing') return;
    if (currentTrackId === lastTrackRef.current) return;

    lastTrackRef.current = currentTrackId;
    autoplayBlockedRef.current = false;

    attemptPlayTrack(currentTrackId);
  }, [isHost, spotifyReady, currentTrackId, phase, attemptPlayTrack]);

  // When spotifyReady flips to true (device reconnected), retry if we have a track
  const prevReadyRef = useRef(spotifyReady);
  useEffect(() => {
    const wasReady = prevReadyRef.current;
    prevReadyRef.current = spotifyReady;

    // Device just became ready and we have an unplayed track
    if (!wasReady && spotifyReady && isHost && currentTrackId && phase === 'playing') {
      console.log('[Hitster] Device reconnected, retrying track:', currentTrackId);
      lastTrackRef.current = currentTrackId;
      attemptPlayTrack(currentTrackId);
    }
  }, [spotifyReady, isHost, currentTrackId, phase, attemptPlayTrack]);

  // Auto-pause on challenge/reveal/game_over
  useEffect(() => {
    if (!isHost) return;
    if (phase === 'challenge' || phase === 'reveal' || phase === 'game_over') {
      pause();
      pauseFallback();
    }
  }, [isHost, phase]);

  // Play button handler — called on user gesture (click)
  const togglePlayback = useCallback(async () => {
    // This is a user gesture — activate the audio element
    activateElement();

    const {
      isPlaying: playing,
      currentTrackId: trackId,
    } = useGameStore.getState();

    if (playing) {
      // Pause
      if (usingFallbackRef.current) {
        pauseFallback();
        useGameStore.setState({ isPlaying: false });
      } else {
        await togglePlay();
      }
    } else {
      // Play — if autoplay was blocked or SDK failed, start from scratch
      if (trackId) {
        const success = await attemptPlayTrack(trackId);
        if (!success) {
          // Last resort: try togglePlay in case SDK has a track queued
          await togglePlay();
        }
      } else {
        await togglePlay();
      }
    }
  }, [attemptPlayTrack]);

  return {
    isHost,
    spotifyReady,
    togglePlayback,
  };
}
