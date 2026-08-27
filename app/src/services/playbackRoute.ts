export type PlaybackRoute = 'spotify' | 'preview' | 'none';

/** Choose a playable source from the current card, not credentials alone. */
export function getPlaybackRoute(
  trackId: string | null,
  previewUrl: string | null,
  hasSpotifyToken: boolean,
): PlaybackRoute {
  if (hasSpotifyToken && trackId) return 'spotify';
  if (previewUrl) return 'preview';
  return 'none';
}

/**
 * Identify a playback attempt by both its source and media ID. A returning
 * Spotify host may start with a preview while its credential is restoring;
 * when Spotify becomes available, that route change must trigger a new
 * attempt even though the card itself has not changed.
 */
export function getPlaybackAttemptKey(
  route: PlaybackRoute,
  trackId: string | null,
  previewUrl: string | null,
): string | null {
  if (route === 'spotify' && trackId) return `spotify:${trackId}`;
  if (route === 'preview' && previewUrl) return `preview:${previewUrl}`;
  return null;
}
