/**
 * Single home for Spotify session plumbing shared by App (early init in the
 * lobby) and useSpotifyPlayer (gameplay). Previously both carried their own
 * getToken + initPlayer copies with subtly different callbacks; this module
 * is the one canonical version.
 */
import { useGameStore } from '../store';
import { refreshAccessToken } from './spotify';
import { initPlayer, isInitialized } from './spotifyPlayer';
import { initFallbackAudio } from './audioFallback';

/** True while playback is routed through the HTML5 preview fallback. */
let usingFallback = false;

export function isUsingFallback(): boolean {
  return usingFallback;
}

export function setUsingFallback(value: boolean): void {
  usingFallback = value;
}

/**
 * Return a usable access token, refreshing via the stored refresh token
 * when needed. Pass `forceRefresh` to discard the current token (e.g. when
 * the SDK rejected it as expired).
 */
export async function getSpotifyToken(forceRefresh = false): Promise<string> {
  const state = useGameStore.getState();
  if (!forceRefresh && state.spotifyToken) return state.spotifyToken;

  const refreshToken = state.spotifyRefreshToken || localStorage.getItem('spotify_refresh_token');
  if (!refreshToken) throw new Error('No token available');

  const result = await refreshAccessToken(refreshToken);
  useGameStore.setState({
    spotifyToken: result.accessToken,
    spotifyRefreshToken: result.refreshToken,
  });
  localStorage.setItem('spotify_refresh_token', result.refreshToken);
  return result.accessToken;
}

/** Wire the preview-audio fallback's play state into the store. */
export function ensureFallbackAudio(): void {
  initFallbackAudio({
    onStateChange: (paused) => {
      if (usingFallback) {
        useGameStore.setState({ isPlaying: !paused });
      }
    },
  });
}

/**
 * Initialize the Web Playback SDK (and the preview fallback) once.
 * Safe to call from multiple places; later calls are no-ops.
 *
 * No cleanup by design — the SDK connection must stay alive for the whole
 * session. Disconnect/reconnect cycles confuse Spotify's device registry;
 * the connection dies naturally with the tab.
 */
export function ensureSpotifySession(): void {
  if (isInitialized()) return;

  ensureFallbackAudio();

  initPlayer(getSpotifyToken, {
    onReady: (deviceId) => {
      useGameStore.setState({ spotifyDeviceId: deviceId, spotifyError: null });
      // Don't set spotifyReady yet — wait for device to be confirmed
      console.log('[Tunes] SDK ready, waiting for device confirmation...');
    },
    onDeviceConfirmed: () => {
      // Device is now confirmed in Spotify's device list — safe to play
      console.log('[Tunes] Device confirmed — ready to play!');
      useGameStore.setState({ spotifyReady: true, spotifyError: null });
    },
    onNotReady: () => {
      useGameStore.setState({ spotifyDeviceId: null });
      console.log('[Tunes] Device went offline, waiting for reconnection...');
    },
    onError: (message) => {
      useGameStore.setState({ spotifyError: message });
    },
    onAutoplayFailed: () => {
      useGameStore.setState({ isPlaying: false, autoplayBlocked: true });
      console.log('[Tunes] Autoplay blocked — user must tap to unlock audio');
    },
    onStateChange: (paused) => {
      if (!usingFallback) {
        useGameStore.setState({ isPlaying: !paused });
      }
    },
    onActive: (active) => {
      if (!active) {
        console.log('[Tunes] Player state null — device not yet active');
      }
    },
  });
}
