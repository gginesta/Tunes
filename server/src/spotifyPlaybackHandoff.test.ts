import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeAudio {
  paused = true;
  ended = false;
  src = '';
  currentTime = 0;
  volume = 1;

  addEventListener(): void {}

  async play(): Promise<void> {
    this.paused = false;
  }

  pause(): void {
    this.paused = true;
  }
}

describe('Spotify playback handoff', () => {
  let audio: FakeAudio;
  let audioFallback: typeof import('../../app/src/services/audioFallback');
  let spotifySession: typeof import('../../app/src/services/spotifySession');
  let store: typeof import('../../app/src/store');

  beforeEach(async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    vi.stubGlobal('window', {
      location: {
        hostname: 'example.com',
        origin: 'https://example.com',
        port: '',
      },
    });
    audio = new FakeAudio();
    vi.stubGlobal('Audio', function AudioMock() {
      return audio;
    });
    vi.resetModules();
    audioFallback = await import('../../app/src/services/audioFallback');
    spotifySession = await import('../../app/src/services/spotifySession');
    store = await import('../../app/src/store');
  });

  afterEach(() => {
    spotifySession?.cancelSpotifyPlaybackAttempt();
    spotifySession?.setUsingFallback(false);
    audioFallback?.destroyFallback();
    vi.unstubAllGlobals();
  });

  it('keeps preview audio until Spotify confirms playback', async () => {
    await expect(audioFallback.playPreviewUrl('https://example.com/preview.mp3'))
      .resolves.toBe(true);
    spotifySession.setUsingFallback(true);
    spotifySession.beginSpotifyPlaybackAttempt('requested-track');
    store.useGameStore.setState({ isPlaying: true, autoplayBlocked: false });

    spotifySession.handleSpotifyAutoplayFailed();

    expect(audio.paused).toBe(false);
    expect(spotifySession.isUsingFallback()).toBe(true);
    expect(store.useGameStore.getState().isPlaying).toBe(true);

    spotifySession.handleSpotifyPlayerStateChange(false, 'previous-track');

    expect(audio.paused).toBe(false);
    expect(spotifySession.isUsingFallback()).toBe(true);

    spotifySession.handleSpotifyPlayerStateChange(false, 'requested-track');

    expect(audio.paused).toBe(true);
    expect(spotifySession.isUsingFallback()).toBe(false);
    expect(store.useGameStore.getState().isPlaying).toBe(true);
  });

  it('ignores a late Spotify state after the pending upgrade is cancelled', async () => {
    await expect(audioFallback.playPreviewUrl('https://example.com/preview.mp3'))
      .resolves.toBe(true);
    spotifySession.setUsingFallback(true);
    spotifySession.beginSpotifyPlaybackAttempt('requested-track');
    spotifySession.cancelSpotifyPlaybackAttempt('requested-track');

    spotifySession.handleSpotifyPlayerStateChange(false, 'requested-track');

    expect(audio.paused).toBe(false);
    expect(spotifySession.isUsingFallback()).toBe(true);
  });
});
