/**
 * HTML5 Audio fallback for when Spotify Web Playback SDK fails.
 * Uses Spotify preview URLs (30-second clips) that work without Premium.
 */

let audio: HTMLAudioElement | null = null;
let currentVolume = 0.8;
let onStateChange: ((paused: boolean) => void) | null = null;

export function initFallbackAudio(callbacks: { onStateChange: (paused: boolean) => void }) {
  onStateChange = callbacks.onStateChange;
}

export async function playPreviewUrl(url: string): Promise<boolean> {
  try {
    if (!audio) {
      audio = new Audio();
      audio.addEventListener('play', () => onStateChange?.(!audio!.paused));
      audio.addEventListener('pause', () => onStateChange?.(true));
      audio.addEventListener('ended', () => onStateChange?.(true));
      audio.addEventListener('error', (e) => {
        console.error('[Tunes] Audio fallback error:', e);
        onStateChange?.(true);
      });
    }

    audio.src = url;
    audio.currentTime = 0;
    audio.volume = currentVolume;
    await audio.play();
    console.log('[Tunes] Fallback audio playing preview URL');
    return true;
  } catch (err) {
    console.error('[Tunes] Fallback audio play failed:', err);
    return false;
  }
}

export function setFallbackVolume(vol: number): void {
  currentVolume = Math.max(0, Math.min(1, vol));
  if (audio) {
    audio.volume = currentVolume;
  }
}

export function pauseFallback(): void {
  if (audio && !audio.paused) {
    audio.pause();
  }
}

export function resumeFallback(): void {
  if (audio && audio.paused && audio.src) {
    audio.play().catch(() => {});
  }
}

export function isFallbackPlaying(): boolean {
  return !!audio && !audio.paused;
}

export function destroyFallback(): void {
  if (audio) {
    audio.pause();
    audio.src = '';
    audio = null;
  }
  onStateChange = null;
}
