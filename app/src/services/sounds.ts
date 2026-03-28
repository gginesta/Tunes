// Sound effects service using Web Audio API
// All sounds are generated programmatically — no audio files needed.

const STORAGE_KEY = 'tunes-muted';

let audioCtx: AudioContext | null = null;
let muted = localStorage.getItem(STORAGE_KEY) === 'true';
let masterVolume = 0.35;

function getContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  // Resume if suspended (browsers require user gesture)
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

export function isMuted(): boolean {
  return muted;
}

export function toggleMute(): boolean {
  muted = !muted;
  localStorage.setItem(STORAGE_KEY, String(muted));
  return muted;
}

export function setVolume(vol: number): void {
  masterVolume = Math.max(0, Math.min(1, vol));
}

// --- Helper to play a tone ---

interface ToneOptions {
  frequency: number;
  type: OscillatorType;
  duration: number; // seconds
  startTime: number; // relative to "now" in seconds
  volume?: number;
  frequencyEnd?: number; // for sweeps
}

function playTones(tones: ToneOptions[]): void {
  if (muted) return;
  const ctx = getContext();
  const now = ctx.currentTime;

  for (const t of tones) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = t.type;
    osc.frequency.setValueAtTime(t.frequency, now + t.startTime);
    if (t.frequencyEnd !== undefined) {
      osc.frequency.linearRampToValueAtTime(t.frequencyEnd, now + t.startTime + t.duration);
    }

    const vol = (t.volume ?? 1) * masterVolume;
    gain.gain.setValueAtTime(vol, now + t.startTime);
    // Quick fade-out to avoid clicks
    gain.gain.setValueAtTime(vol, now + t.startTime + t.duration * 0.8);
    gain.gain.linearRampToValueAtTime(0, now + t.startTime + t.duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now + t.startTime);
    osc.stop(now + t.startTime + t.duration);
  }
}

// --- Note frequencies ---
const NOTE = {
  E3: 164.81,
  A3: 220.0,
  C4: 261.63,
  E4: 329.63,
  G4: 392.0,
  B4: 493.88,
  C5: 523.25,
  E5: 659.25,
  A5: 880.0,
  C3: 130.81,
};

// --- Sound effect functions ---

/** Correct placement — two ascending tones (C5 → E5), sine wave, 200ms */
export function playCorrectSound(): void {
  playTones([
    { frequency: NOTE.C5, type: 'sine', duration: 0.1, startTime: 0 },
    { frequency: NOTE.E5, type: 'sine', duration: 0.15, startTime: 0.1 },
  ]);
}

/** Wrong placement — low descending tone (A3 → E3), square wave, 300ms */
export function playWrongSound(): void {
  playTones([
    {
      frequency: NOTE.A3,
      frequencyEnd: NOTE.E3,
      type: 'square',
      duration: 0.3,
      startTime: 0,
      volume: 0.5,
    },
  ]);
}

/** Challenge made — quick three-note alert (E4 → G4 → B4), sawtooth, 150ms each */
export function playChallengeSound(): void {
  playTones([
    { frequency: NOTE.E4, type: 'sawtooth', duration: 0.12, startTime: 0, volume: 0.3 },
    { frequency: NOTE.G4, type: 'sawtooth', duration: 0.12, startTime: 0.13, volume: 0.3 },
    { frequency: NOTE.B4, type: 'sawtooth', duration: 0.15, startTime: 0.26, volume: 0.3 },
  ]);
}

/** Card stolen — descending sweep (C5 → C3), sine wave, 400ms */
export function playStolenSound(): void {
  playTones([
    {
      frequency: NOTE.C5,
      frequencyEnd: NOTE.C3,
      type: 'sine',
      duration: 0.4,
      startTime: 0,
      volume: 0.7,
    },
  ]);
}

/** Timer warning — short click (A5), sine wave, 50ms */
export function playTickSound(): void {
  playTones([
    { frequency: NOTE.A5, type: 'sine', duration: 0.05, startTime: 0, volume: 0.4 },
  ]);
}

/** Buzz — quick short blip (E5), triangle wave, 80ms */
export function playBuzzSound(): void {
  playTones([
    { frequency: NOTE.E5, type: 'triangle', duration: 0.08, startTime: 0, volume: 0.5 },
  ]);
}

/** Your turn notification — distinct rising two-tone alert */
export function playTurnSound(): void {
  playTones([
    { frequency: NOTE.E4, type: 'sine', duration: 0.15, startTime: 0, volume: 0.7 },
    { frequency: NOTE.A5, type: 'sine', duration: 0.25, startTime: 0.18, volume: 0.7 },
  ]);
  // Vibrate on mobile (no-op on desktop)
  navigator.vibrate?.(200);
}

/** Annoying buzz alert for active player — obnoxious repeated buzzer */
export function playBuzzAlertSound(): void {
  playTones([
    { frequency: NOTE.E5, type: 'sawtooth', duration: 0.08, startTime: 0, volume: 0.6 },
    { frequency: NOTE.E5, type: 'sawtooth', duration: 0.08, startTime: 0.12, volume: 0.6 },
    { frequency: NOTE.E5, type: 'sawtooth', duration: 0.08, startTime: 0.24, volume: 0.6 },
  ]);
  // Annoying vibration pattern: buzz-buzz-buzz
  navigator.vibrate?.([100, 50, 100, 50, 100]);
}

/** Game start — ascending arpeggio (C4 → E4 → G4 → C5), sine wave, 100ms each */
export function playStartSound(): void {
  playTones([
    { frequency: NOTE.C4, type: 'sine', duration: 0.1, startTime: 0, volume: 0.6 },
    { frequency: NOTE.E4, type: 'sine', duration: 0.1, startTime: 0.1, volume: 0.6 },
    { frequency: NOTE.G4, type: 'sine', duration: 0.1, startTime: 0.2, volume: 0.6 },
    { frequency: NOTE.C5, type: 'sine', duration: 0.2, startTime: 0.3, volume: 0.6 },
  ]);
}
