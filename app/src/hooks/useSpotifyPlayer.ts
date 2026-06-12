import { useEffect, useRef, useCallback } from 'react';
import { useGameStore } from '../store';
import {
  activateElement,
  playTrack,
  pause,
  resume,
  togglePlay,
  setPlayerVolume,
} from '../services/spotifyPlayer';
import {
  playPreviewUrl,
  pauseFallback,
  setFallbackVolume,
} from '../services/audioFallback';
import {
  ensureFallbackAudio,
  ensureSpotifySession,
  getSpotifyToken,
  isUsingFallback,
  setUsingFallback,
} from '../services/spotifySession';

export function useSpotifyPlayer() {
  const spotifyToken = useGameStore((s) => s.spotifyToken);
  const hostId = useGameStore((s) => s.hostId);
  const myId = useGameStore((s) => s.myId);
  const phase = useGameStore((s) => s.phase);
  const currentTrackId = useGameStore((s) => s.currentTrackId);
  const spotifyReady = useGameStore((s) => s.spotifyReady);
  const volume = useGameStore((s) => s.volume);

  const isHost = myId === hostId;
  const lastTrackRef = useRef<string | null>(null);

  // Initialize fallback audio for all hosts (preview mode needs it)
  useEffect(() => {
    if (!isHost) return;
    ensureFallbackAudio();
  }, [isHost]);

  // Initialize SDK player (host with Spotify only); idempotent, may have
  // already happened via App's early init in the lobby
  useEffect(() => {
    if (!isHost || !spotifyToken) return;
    ensureSpotifySession();
  }, [isHost, spotifyToken]);

  /**
   * Attempt to play a track. Tries SDK first, falls back to preview URL.
   */
  const attemptPlayTrack = useCallback(async (trackId: string): Promise<boolean> => {
    setUsingFallback(false);

    let token: string;
    try {
      token = await getSpotifyToken();
    } catch {
      console.warn('[Tunes] Could not get token for playback');
      return tryFallback();
    }

    // Try SDK playback
    const success = await playTrack(trackId, token);
    if (success) return true;

    // Token might be expired — refresh and retry
    console.log('[Tunes] Refreshing token and retrying...');
    try {
      token = await getSpotifyToken(true);
      const retrySuccess = await playTrack(trackId, token);
      if (retrySuccess) return true;
    } catch {
      console.warn('[Tunes] Token refresh failed');
    }

    return tryFallback();
  }, []);

  const tryFallback = useCallback(async (): Promise<boolean> => {
    const previewUrl = useGameStore.getState().currentPreviewUrl;
    if (previewUrl) {
      console.log('[Tunes] Trying preview URL fallback');
      setUsingFallback(true);
      const ok = await playPreviewUrl(previewUrl);
      if (ok) {
        useGameStore.setState({ isPlaying: true });
        return true;
      }
    }
    console.error('[Tunes] All playback methods failed');
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
        setUsingFallback(true);
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
      if (isUsingFallback()) {
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
