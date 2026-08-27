import { describe, expect, it } from 'vitest';
import { spotifyTokenForHost } from './spotifyCredentials';

describe('spotifyTokenForHost', () => {
  it('returns a credential owned by the current host', () => {
    expect(spotifyTokenForHost('host-a', { hostId: 'host-a', token: 'token-a' })).toBe('token-a');
  });

  it('rejects a departed host credential after host transfer', () => {
    expect(spotifyTokenForHost('host-b', { hostId: 'host-a', token: 'token-a' })).toBeUndefined();
  });
});
