/**
 * Single home for Spotify session plumbing shared by App (early init in the
 * lobby) and useSpotifyPlayer (gameplay). Previously both carried their own
 * getToken + initPlayer copies with subtly different callbacks; this module
 * is the one canonical version.
 */
import { useGameStore } from '../store';
import { refreshAccessToken } from './spotify';
import { initPlayer, isInitialized, pause as pauseSpotify } from './spotifyPlayer';
import { initFallbackAudio, isFallbackPlaying, pauseFallback } from './audioFallback';
import { sessionAllowsSpotifyRestore } from './socket';

/** True while playback is routed through the HTML5 preview fallback. */
let usingFallback = false;
let pendingSpotifyTrackId: string | null = null;
type RefreshedSpotifyToken = Awaited<ReturnType<typeof refreshAccessToken>>;
const pendingRefreshes = new Map<string, Promise<RefreshedSpotifyToken>>();

export function isUsingFallback(): boolean {
  return usingFallback;
}

export function setUsingFallback(value: boolean): void {
  usingFallback = value;
}

export function beginSpotifyPlaybackAttempt(trackId: string): void {
  pendingSpotifyTrackId = trackId;
}

export function cancelSpotifyPlaybackAttempt(trackId?: string): void {
  if (!trackId || pendingSpotifyTrackId === trackId) {
    pendingSpotifyTrackId = null;
  }
}

/** Keep a working preview alive when the SDK cannot autoplay the upgrade. */
export function handleSpotifyAutoplayFailed(): void {
  if (usingFallback && isFallbackPlaying()) {
    useGameStore.setState({ isPlaying: true, autoplayBlocked: false });
    console.log('[Tunes] Spotify autoplay blocked — keeping preview audio');
    return;
  }

  useGameStore.setState({ isPlaying: false, autoplayBlocked: true });
  console.log('[Tunes] Autoplay blocked — user must tap to unlock audio');
}

/** Hand off from preview audio only after the SDK confirms audible playback. */
export function handleSpotifyPlayerStateChange(paused: boolean, trackId: string): void {
  if (
    !paused
    && trackId !== pendingSpotifyTrackId
    && (usingFallback || pendingSpotifyTrackId !== null)
  ) {
    // resume() can briefly surface the previously played SDK track. Stop it;
    // any late/stale SDK track must also stop while preview audio owns playback.
    void pauseSpotify();
    return;
  }

  const requestedTrackStarted = !paused
    && pendingSpotifyTrackId !== null
    && trackId === pendingSpotifyTrackId;
  if (requestedTrackStarted) {
    pendingSpotifyTrackId = null;
  }

  if (requestedTrackStarted && usingFallback) {
    usingFallback = false;
    pauseFallback();
  }

  if (!usingFallback) {
    useGameStore.setState({ isPlaying: !paused });
  }
}

function refreshSpotifyCredential(refreshToken: string): Promise<RefreshedSpotifyToken> {
  const existing = pendingRefreshes.get(refreshToken);
  if (existing) return existing;

  const request = refreshAccessToken(refreshToken).finally(() => {
    if (pendingRefreshes.get(refreshToken) === request) {
      pendingRefreshes.delete(refreshToken);
    }
  });
  pendingRefreshes.set(refreshToken, request);
  return request;
}

/** Restore only if the exact room/player session still intends Spotify. */
export async function restoreSavedSpotifyAccessToken(
  refreshToken: string,
  expectedRoomCode: string,
  expectedPlayerId: string,
): Promise<string> {
  const result = await refreshSpotifyCredential(refreshToken);
  const state = useGameStore.getState();
  if (!sessionAllowsSpotifyRestore(
    expectedRoomCode,
    expectedPlayerId,
    state.roomCode,
    state.myId,
  )) {
    throw new Error('Spotify session changed during restore');
  }

  useGameStore.setState({
    spotifyToken: result.accessToken,
    spotifyRefreshToken: result.refreshToken,
  });
  localStorage.setItem('spotify_refresh_token', result.refreshToken);
  return result.accessToken;
}

/** Restore a saved Spotify session for the current room host, if intended. */
export async function restoreSpotifyForCurrentHost(
  roomCode: string,
  playerId: string,
  hostId: string,
): Promise<string | null> {
  const state = useGameStore.getState();
  if (playerId !== hostId || !sessionAllowsSpotifyRestore(
    roomCode,
    playerId,
    state.roomCode,
    state.myId,
  )) {
    return null;
  }

  const savedRefresh = localStorage.getItem('spotify_refresh_token');
  if (!savedRefresh) return null;
  return restoreSavedSpotifyAccessToken(savedRefresh, roomCode, playerId);
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
      handleSpotifyAutoplayFailed();
    },
    onStateChange: (paused, trackId) => {
      handleSpotifyPlayerStateChange(paused, trackId);
    },
    onActive: (active) => {
      if (!active) {
        console.log('[Tunes] Player state null — device not yet active');
      }
    },
  });
}
