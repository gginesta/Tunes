import { describe, expect, it } from 'vitest';
import {
  getPlaybackAttemptKey,
  getPlaybackRoute,
} from '../../app/src/services/playbackRoute';

describe('getPlaybackRoute', () => {
  it('uses Spotify only when the host has a token and the card has a track ID', () => {
    expect(getPlaybackRoute('track-id', 'preview-url', true)).toBe('spotify');
  });

  it('uses preview audio for preview-only cards even when the host has Spotify', () => {
    expect(getPlaybackRoute(null, 'preview-url', true)).toBe('preview');
  });

  it('uses preview audio when the host has no Spotify token', () => {
    expect(getPlaybackRoute('track-id', 'preview-url', false)).toBe('preview');
  });

  it('fails closed when the card has no playable source', () => {
    expect(getPlaybackRoute('track-id', null, false)).toBe('none');
    expect(getPlaybackRoute(null, null, true)).toBe('none');
  });
});

describe('getPlaybackAttemptKey', () => {
  it('retries the same card when credential restoration upgrades preview to Spotify', () => {
    const trackId = 'track-id';
    const previewUrl = 'preview-url';
    const previewRoute = getPlaybackRoute(trackId, previewUrl, false);
    const spotifyRoute = getPlaybackRoute(trackId, previewUrl, true);

    expect(getPlaybackAttemptKey(previewRoute, trackId, previewUrl)).toBe(
      'preview:preview-url',
    );
    expect(getPlaybackAttemptKey(spotifyRoute, trackId, previewUrl)).toBe(
      'spotify:track-id',
    );
    expect(getPlaybackAttemptKey(previewRoute, trackId, previewUrl)).not.toBe(
      getPlaybackAttemptKey(spotifyRoute, trackId, previewUrl),
    );
  });

  it('does not consume an unplayable card', () => {
    expect(getPlaybackAttemptKey('none', 'track-id', null)).toBeNull();
  });
});
