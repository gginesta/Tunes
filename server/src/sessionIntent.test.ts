import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSession,
  getSessionPlaybackIntent,
  setSessionPlaybackIntent,
} from '../../app/src/services/socket';

describe('session playback intent', () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps an explicit preview choice separate from a saved Spotify credential', () => {
    values.set('spotify_refresh_token', 'saved-refresh-token');
    setSessionPlaybackIntent('preview');

    expect(getSessionPlaybackIntent()).toBe('preview');
    expect(values.get('spotify_refresh_token')).toBe('saved-refresh-token');
  });

  it('restores Spotify intent for a returning Spotify host', () => {
    setSessionPlaybackIntent('spotify');
    expect(getSessionPlaybackIntent()).toBe('spotify');
  });

  it('clears room intent without deleting the reusable Spotify credential', () => {
    values.set('spotify_refresh_token', 'saved-refresh-token');
    setSessionPlaybackIntent('spotify');

    clearSession();

    expect(getSessionPlaybackIntent()).toBeNull();
    expect(values.get('spotify_refresh_token')).toBe('saved-refresh-token');
  });
});
