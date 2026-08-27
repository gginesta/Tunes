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
