import { useEffect, useRef, useCallback } from 'react';
import { useGameStore } from '../store';
import { refreshAccessToken } from '../services/spotify';
import {
  initPlayer,
  activateElement,
  playTrack,
  pause,
  togglePlay,
  isInitialized,
  requestActivation,
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

  // Keep token ref current
  useEffect(() => {
    tokenRef.current = spotifyToken;
  }, [spotifyToken]);

  // Get a fresh token (refresh if needed)
  const getToken = useCallback(async (): Promise<string> => {
    if (tokenRef.current) return tokenRef.current;

    const refreshToken = spotifyRefreshToken
      || localStorage.getItem('spotify_refresh_token');
    if (!refreshToken) throw new Error('No token available');

    const result = await refreshAccessToken(refreshToken);
    useGameStore.setState({
      spotifyToken: result.accessToken,
      spotifyRefreshToken: result.refreshToken,
    });
    localStorage.setItem('spotify_refresh_token', result.refreshToken);
    tokenRef.current = result.accessToken;
    return result.accessToken;
  }, [spotifyRefreshToken]);

  // Initialize SDK player (host only)
  useEffect(() => {
    if (!isHost || isInitialized()) return;

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
          spotifyError: null,
        });
        // Don't set spotifyReady yet — wait for device to be confirmed
        console.log('[Hitster] SDK ready, waiting for device confirmation...');
      },
      onDeviceConfirmed: () => {
        // Device is now confirmed in Spotify's device list — safe to play
        console.log('[Hitster] Device confirmed — ready to play!');
        useGameStore.setState({ spotifyReady: true, spotifyError: null });
      },
      onNotReady: () => {
        useGameStore.setState({ spotifyDeviceId: null });
        console.log('[Hitster] Device went offline, waiting for reconnection...');
      },
      onError: (message) => {
        useGameStore.setState({ spotifyError: message });
      },
      onAutoplayFailed: () => {
        useGameStore.setState({ isPlaying: false });
        console.log('[Hitster] Autoplay blocked — user must click play');
      },
      onStateChange: (paused) => {
        if (!usingFallbackRef.current) {
          useGameStore.setState({ isPlaying: !paused });
        }
      },
      onActive: (active) => {
        if (!active) {
          console.log('[Hitster] Player state null — device not yet active');
        }
      },
    });

    // No cleanup — the SDK connection must stay alive for the entire session.
    // Disconnecting and reconnecting confuses Spotify's servers (device
    // deregistration + re-registration race). The connection is cleaned up
    // naturally when the browser tab closes.
  }, [isHost, getToken]);

  /**
   * Attempt to play a track. Tries SDK first, falls back to preview URL.
   */
  const attemptPlayTrack = useCallback(async (trackId: string): Promise<boolean> => {
    usingFallbackRef.current = false;

    let token: string;
    try {
      token = await getToken();
    } catch {
      console.warn('[Hitster] Could not get token for playback');
      return tryFallback();
    }

    // Try SDK playback
    const success = await playTrack(trackId, token);
    if (success) return true;

    // Token might be expired — refresh and retry
    console.log('[Hitster] Refreshing token and retrying...');
    try {
      tokenRef.current = null;
      token = await getToken();
      const retrySuccess = await playTrack(trackId, token);
      if (retrySuccess) return true;
    } catch {
      console.warn('[Hitster] Token refresh failed');
    }

    return tryFallback();
  }, [getToken]);

  const tryFallback = useCallback(async (): Promise<boolean> => {
    const previewUrl = useGameStore.getState().currentPreviewUrl;
    if (previewUrl) {
      console.log('[Hitster] Trying preview URL fallback');
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

  // Auto-play when track changes and device is confirmed ready
  useEffect(() => {
    if (!isHost || !spotifyReady || !currentTrackId) return;
    if (phase !== 'playing') return;
    if (currentTrackId === lastTrackRef.current) return;

    lastTrackRef.current = currentTrackId;
    // activateElement should already have been called from a user gesture
    // (Start Game click or first game screen interaction), but call it
    // here too in case the element was deferred.
    activateElement();
    attemptPlayTrack(currentTrackId);
  }, [isHost, spotifyReady, currentTrackId, phase, attemptPlayTrack]);

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
    activateElement();

    const {
      isPlaying: playing,
      currentTrackId: trackId,
    } = useGameStore.getState();

    if (playing) {
      if (usingFallbackRef.current) {
        pauseFallback();
        useGameStore.setState({ isPlaying: false });
      } else {
        await togglePlay();
      }
    } else {
      if (trackId) {
        await attemptPlayTrack(trackId);
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
