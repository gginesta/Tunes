import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  destroyFallback,
  pauseFallback,
  playPreviewUrl,
  resumeFallback,
} from '../../app/src/services/audioFallback';

class FakeAudio {
  paused = true;
  ended = false;
  src = '';
  currentTime = 0;
  volume = 1;
  playCount = 0;

  addEventListener(): void {}

  async play(): Promise<void> {
    this.playCount++;
    this.paused = false;
  }

  pause(): void {
    this.paused = true;
  }
}

describe('preview fallback pause/resume', () => {
  let audio: FakeAudio;

  beforeEach(() => {
    audio = new FakeAudio();
    vi.stubGlobal('Audio', function AudioMock() {
      return audio;
    });
  });

  afterEach(() => {
    destroyFallback();
    vi.unstubAllGlobals();
  });

  it('continues the current source from its paused position', async () => {
    await expect(playPreviewUrl('https://example.com/preview.mp3')).resolves.toBe(true);
    audio.currentTime = 12.5;
    pauseFallback();

    await expect(resumeFallback()).resolves.toBe(true);

    expect(audio.src).toBe('https://example.com/preview.mp3');
    expect(audio.currentTime).toBe(12.5);
    expect(audio.playCount).toBe(2);
  });
});
