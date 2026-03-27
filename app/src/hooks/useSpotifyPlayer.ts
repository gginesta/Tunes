import { useEffect, useRef, useCallback } from 'react';
import { useGameStore } from '../store';
import { refreshAccessToken } from '../services/spotify';
import {
  initPlayer,
  activateElement,
  playTrack,
  pause,
  resume,
  togglePlay,
  isInitialized,
  requestActivation,
  setPlayerVolume,
} from '../services/spotifyPlayer';
import {
  initFallbackAudio,
  playPreviewUrl,
  pauseFallback,
  setFallbackVolume,
} from '../services/audioFallback';

export function useSpotifyPlayer() {
  const spotifyToken = useGameStore((s) => s.spotifyToken);
  const spotifyRefreshToken = useGameStore((s) => s.spotifyRefreshToken);
  const hostId = useGameStore((s) => s.hostId);
  const myId = useGameStore((s) => s.myId);
  const phase = useGameStore((s) => s.phase);
  const currentTrackId = useGameStore((s) => s.currentTrackId);
  const spotifyReady = useGameStore((s) => s.spotifyReady);
  const volume = useGameStore((s) => s.volume);

  const isHost = myId === hostId;
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

  // Initialize fallback audio for all hosts (preview mode needs it)
  useEffect(() => {
    if (!isHost) return;
    initFallbackAudio({
      onStateChange: (paused) => {
        if (usingFallbackRef.current) {
          useGameStore.setState({ isPlaying: !paused });
        }
      },
    });
  }, [isHost]);

  // Initialize SDK player (host with Spotify only)
  useEffect(() => {
    if (!isHost || !spotifyToken || isInitialized()) return;

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
        useGameStore.setState({ isPlaying: false, autoplayBlocked: true });
        console.log('[Hitster] Autoplay blocked — user must tap to unlock audio');
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

  // Sync volume to Spotify player and fallback audio
  useEffect(() => {
    setPlayerVolume(volume);
    setFallbackVolume(volume);
  }, [volume]);

  // Auto-play when track changes and device is confirmed ready
  useEffect(() => {
    if (!isHost || !currentTrackId) return;
    if (phase !== 'playing') return;
    if (currentTrackId === lastTrackRef.current) return;

    // For SDK playback, wait until device is confirmed
    if (spotifyToken && !spotifyReady) return;

    lastTrackRef.current = currentTrackId;

    if (spotifyToken) {
      // SDK path: activate element and play via Spotify
      activateElement();
      attemptPlayTrack(currentTrackId);
    } else {
      // Preview-only mode (no Spotify token): play via fallback audio
      const previewUrl = useGameStore.getState().currentPreviewUrl;
      if (previewUrl) {
        usingFallbackRef.current = true;
        playPreviewUrl(previewUrl).then((ok) => {
          if (ok) {
            useGameStore.setState({ isPlaying: true, autoplayBlocked: false });
          } else {
            // Browser blocked autoplay — show the banner
            useGameStore.setState({ isPlaying: false, autoplayBlocked: true });
          }
        });
      }
    }
  }, [isHost, spotifyToken, spotifyReady, currentTrackId, phase, attemptPlayTrack]);

  // Auto-pause on reveal/game_over (keep music playing during challenge)
  useEffect(() => {
    if (!isHost) return;
    if (phase === 'reveal' || phase === 'game_over') {
      pause();
      pauseFallback();
    }
  }, [isHost, phase]);

  // Play button handler — called on user gesture (click).
  // This is the critical path for unlocking audio. It must:
  // 1. Call activateElement() to unlock the SDK's AudioContext (every time, not just once)
  // 2. Call player.resume() directly — this goes through the SDK's own AudioContext
  //    from within the user gesture call stack, which browsers trust
  // 3. Then also try the REST API path as a backup
  const togglePlayback = useCallback(async () => {
    activateElement();
    useGameStore.setState({ autoplayBlocked: false });

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
      // First try resume() — this uses the SDK's internal AudioContext
      // directly from the gesture context, which is the most reliable way
      // to satisfy browser autoplay policy
      await resume().catch(() => {});

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
