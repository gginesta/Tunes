import { describe, expect, it } from 'vitest';
import {
  restoreHostSpotifyCredential,
  spotifyTokenForHost,
} from './spotifyCredentials';

describe('spotifyTokenForHost', () => {
  it('returns a credential owned by the current host', () => {
    expect(spotifyTokenForHost('host-a', { hostId: 'host-a', token: 'token-a' })).toBe('token-a');
  });

  it('rejects a departed host credential after host transfer', () => {
    expect(spotifyTokenForHost('host-b', { hostId: 'host-a', token: 'token-a' })).toBeUndefined();
  });

  it('discards legacy persisted tokens that have no owner proof', () => {
    expect(restoreHostSpotifyCredential('legacy-token', undefined)).toBeUndefined();
  });

  it('restores a persisted token only when its owner is recorded', () => {
    expect(restoreHostSpotifyCredential('token-a', 'host-a')).toEqual({
      hostId: 'host-a',
      token: 'token-a',
    });
  });
});
