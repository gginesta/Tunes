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
  resumeFallback,
  setFallbackVolume,
} from '../services/audioFallback';
import {
  ensureFallbackAudio,
  ensureSpotifySession,
  getSpotifyToken,
  isUsingFallback,
  setUsingFallback,
} from '../services/spotifySession';
import { getPlaybackRoute } from '../services/playbackRoute';

export function useSpotifyPlayer() {
  const spotifyToken = useGameStore((s) => s.spotifyToken);
  const hostId = useGameStore((s) => s.hostId);
  const myId = useGameStore((s) => s.myId);
  const phase = useGameStore((s) => s.phase);
  const currentTrackId = useGameStore((s) => s.currentTrackId);
  const currentPreviewUrl = useGameStore((s) => s.currentPreviewUrl);
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
  }, [tryFallback]);

  // Sync volume to Spotify player and fallback audio
  useEffect(() => {
    setPlayerVolume(volume);
    setFallbackVolume(volume);
  }, [volume]);

  // Auto-play when track changes and device is confirmed ready
  useEffect(() => {
    if (!isHost || (!currentTrackId && !currentPreviewUrl)) return;
    if (phase !== 'playing') return;
    const playbackKey = currentTrackId || currentPreviewUrl;
    if (playbackKey === lastTrackRef.current) return;
    const playbackRoute = getPlaybackRoute(
      currentTrackId,
      currentPreviewUrl,
      !!spotifyToken,
    );

    // For SDK playback, wait until device is confirmed
    if (playbackRoute === 'spotify' && !spotifyReady) return;

    lastTrackRef.current = playbackKey;

    if (playbackRoute === 'spotify' && currentTrackId) {
      // SDK path: activate element and play via Spotify
      activateElement();
      attemptPlayTrack(currentTrackId);
    } else if (playbackRoute === 'preview' && currentPreviewUrl) {
      setUsingFallback(true);
      playPreviewUrl(currentPreviewUrl).then((ok) => {
        if (ok) {
          useGameStore.setState({ isPlaying: true, autoplayBlocked: false });
        } else {
          // Browser blocked autoplay — show the banner
          useGameStore.setState({ isPlaying: false, autoplayBlocked: true });
        }
      });
    }
  }, [isHost, spotifyToken, spotifyReady, currentTrackId, currentPreviewUrl, phase, attemptPlayTrack]);

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
      currentPreviewUrl: previewUrl,
    } = useGameStore.getState();
    const playbackRoute = getPlaybackRoute(trackId, previewUrl, !!spotifyToken);

    if (playing) {
      if (isUsingFallback()) {
        pauseFallback();
        useGameStore.setState({ isPlaying: false });
      } else {
        await togglePlay();
      }
    } else {
      if (playbackRoute === 'preview' && previewUrl) {
        // Continue an existing preview from its paused position. Only assign
        // the URL again when there is no resumable fallback audio.
        const resumed = await resumeFallback();
        if (!resumed) await tryFallback();
      } else if (playbackRoute === 'spotify' && trackId) {
        // The SDK resume runs inside the gesture context, which browsers trust.
        await resume().catch(() => {});
        await attemptPlayTrack(trackId);
      } else {
        await togglePlay();
      }
    }
  }, [attemptPlayTrack, spotifyToken, tryFallback]);

  return {
    isHost,
    spotifyReady,
    togglePlayback,
  };
}
