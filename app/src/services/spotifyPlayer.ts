/**
 * Spotify Web Playback SDK integration.
 *
 * The SDK fires 'ready' with a device_id BEFORE Spotify's API servers
 * have registered that device. Calling the REST API immediately gets
 * 404 "Device not found". To fix this, we poll GET /v1/me/player/devices
 * until our device appears in the list before attempting playback.
 */

const PLAYER_NAME = 'Tunes Game';

let player: Spotify.Player | null = null;
let deviceId: string | null = null;
let sdkLoaded = false;
let sdkReady: Promise<void> | null = null;
let activated = false;
let deviceConfirmed = false;
let audioUnlocked = false;

/**
 * Pre-unlock the browser's audio context from a user gesture (click/tap).
 * Must be called synchronously from a user interaction handler.
 * This satisfies the browser autoplay policy so that later calls to
 * activateElement() and Audio.play() succeed even outside gesture context.
 */
export function preUnlockAudio(): void {
  if (audioUnlocked) return;
  try {
    // Method 1: Resume an AudioContext
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    // Play a silent buffer to fully unlock
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);

    // Method 2: Also play a silent HTML Audio element
    const audio = new Audio();
    audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    audio.volume = 0;
    audio.play().catch(() => {});

    audioUnlocked = true;
    console.log('[Tunes] Audio pre-unlocked from user gesture');
  } catch (e) {
    console.warn('[Tunes] preUnlockAudio failed:', e);
  }
}

function loadSDK(): Promise<void> {
  if (sdkLoaded) return Promise.resolve();
  if (sdkReady) return sdkReady;

  sdkReady = new Promise<void>((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.async = true;

    window.onSpotifyWebPlaybackSDKReady = () => {
      sdkLoaded = true;
      resolve();
    };

    document.body.appendChild(script);
  });

  return sdkReady;
}

export interface SpotifyPlayerCallbacks {
  onReady: (id: string) => void;
  onNotReady: () => void;
  onError: (message: string) => void;
  onStateChange: (paused: boolean) => void;
  onAutoplayFailed: () => void;
  onActive: (active: boolean) => void;
  onDeviceConfirmed: () => void;
}

let currentGetToken: (() => Promise<string>) | null = null;

export async function initPlayer(
  getToken: () => Promise<string>,
  callbacks: SpotifyPlayerCallbacks,
): Promise<void> {
  if (player) return;

  currentGetToken = getToken;
  await loadSDK();

  player = new window.Spotify.Player({
    name: PLAYER_NAME,
    getOAuthToken: (cb) => {
      getToken().then(cb).catch(() => cb(''));
    },
    volume: 0.8,
  });

  player.addListener('ready', ({ device_id }) => {
    deviceId = device_id;
    deviceConfirmed = false;
    console.log('[Tunes] SDK ready, device:', device_id);
    callbacks.onReady(device_id);

    // Start polling to confirm the device is registered with Spotify's servers
    pollForDevice(device_id, getToken, callbacks);
  });

  player.addListener('not_ready', ({ device_id }) => {
    console.warn('[Tunes] Device offline:', device_id);
    deviceId = null;
    deviceConfirmed = false;
    callbacks.onNotReady();
  });

  player.addListener('authentication_error', (err) => {
    console.error('[Tunes] Auth error:', err.message);
    callbacks.onError('Spotify authentication failed. Try reconnecting.');
  });

  player.addListener('initialization_error', (err) => {
    console.error('[Tunes] Init error:', err.message);
    callbacks.onError('Failed to initialize Spotify player');
  });

  player.addListener('account_error', (err) => {
    console.error('[Tunes] Account error:', err.message);
    callbacks.onError('Spotify Premium is required to play music');
  });

  player.addListener('playback_error', (err) => {
    console.error('[Tunes] Playback error:', err.message);
  });

  player.addListener('autoplay_failed', () => {
    console.warn('[Tunes] Autoplay blocked by browser');
    callbacks.onAutoplayFailed();
  });

  player.addListener('player_state_changed', (state) => {
    if (!state) {
      callbacks.onActive(false);
      return;
    }
    callbacks.onActive(true);
    callbacks.onStateChange(state.paused);
  });

  const connected = await player.connect();
  if (!connected) {
    callbacks.onError('Failed to connect to Spotify');
  } else {
    console.log('[Tunes] Player connected, waiting for device registration...');
    // Always activate the element once connected — audio should already be
    // unlocked from the user's START click via preUnlockAudio()
    if (!activated) {
      player.activateElement();
      activated = true;
      pendingActivation = false;
      console.log('[Tunes] activateElement() called after connect');
    }
  }
}

/**
 * Poll GET /v1/me/player/devices until our device appears.
 *
 * IMPORTANT: The SDK's device_id from the 'ready' event does NOT match
 * the device ID in Spotify's REST API. We must match by device NAME
 * and use the API's ID for all subsequent REST API calls.
 */
async function pollForDevice(
  _sdkDeviceId: string,
  getToken: () => Promise<string>,
  callbacks: SpotifyPlayerCallbacks,
): Promise<void> {
  const MAX_POLLS = 15;
  const POLL_INTERVAL = 2000;

  for (let i = 0; i < MAX_POLLS; i++) {
    try {
      const token = await getToken();
      const res = await fetch('https://api.spotify.com/v1/me/player/devices', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        const devices: { name: string; id: string }[] = data.devices || [];
        console.log(`[Tunes] Devices poll ${i + 1}/${MAX_POLLS}:`,
          devices.map((d) => `${d.name} (${d.id.slice(0, 8)}...)`));

        // Match by NAME, not by ID — the SDK's device_id differs from the API's
        const found = devices.find((d) => d.name === PLAYER_NAME);
        if (found) {
          console.log('[Tunes] Device found in API! SDK id:', _sdkDeviceId.slice(0, 8), '→ API id:', found.id.slice(0, 8));
          // Use the API's device ID for REST calls, not the SDK's
          deviceId = found.id;
          deviceConfirmed = true;
          callbacks.onDeviceConfirmed();
          return;
        }
      }
    } catch (err) {
      console.warn('[Tunes] Device poll error:', err);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }

  console.warn('[Tunes] Device never appeared after', MAX_POLLS, 'polls — trying with SDK device ID');
  deviceConfirmed = true;
  callbacks.onDeviceConfirmed();
}

export function activateElement(): void {
  if (player) {
    player.activateElement();
    activated = true;
    console.log('[Tunes] activateElement() called');
  }
}

/**
 * Pre-activate the audio element from any user gesture.
 * Can be called even before the player is fully initialized —
 * stores intent and applies it once the player is ready.
 */
let pendingActivation = false;

export function requestActivation(): void {
  // Always pre-unlock audio from the user gesture, even if SDK isn't ready yet
  preUnlockAudio();
  if (player) {
    activateElement();
  } else {
    pendingActivation = true;
  }
}

export function applyPendingActivation(): void {
  if (pendingActivation && player && !activated) {
    player.activateElement();
    activated = true;
    pendingActivation = false;
    console.log('[Tunes] Deferred activateElement() applied');
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Play a track via the Spotify Web API.
 * Waits for device to be confirmed before calling the API.
 */
export async function playTrack(
  trackId: string,
  accessToken: string,
): Promise<boolean> {
  if (!deviceId) {
    console.error('[Tunes] playTrack: no deviceId');
    return false;
  }

  activateElement();

  console.log('[Tunes] playTrack:', trackId, 'device:', deviceId, 'confirmed:', deviceConfirmed);

  // If device isn't confirmed yet, wait briefly
  if (!deviceConfirmed) {
    console.log('[Tunes] Waiting for device confirmation...');
    await sleep(3000);
  }

  const doPlay = () => {
    const id = deviceId;
    if (!id) return Promise.resolve(new Response(null, { status: 404 }));

    return fetch(
      `https://api.spotify.com/v1/me/player/play?device_id=${id}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          uris: [`spotify:track:${trackId}`],
          position_ms: 0,
        }),
      },
    );
  };

  // Try up to 3 times with delays
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      console.log(`[Tunes] playTrack retry ${attempt}, waiting ${attempt * 2000}ms...`);
      await sleep(attempt * 2000);
    }

    const res = await doPlay();

    if (res.ok || res.status === 204) {
      console.log('[Tunes] playTrack success');
      return true;
    }

    if (res.status === 401) {
      console.warn('[Tunes] playTrack: token expired (401)');
      return false;
    }

    const body = await res.text().catch(() => '');
    console.warn(`[Tunes] playTrack attempt ${attempt + 1} failed:`, res.status, body);
  }

  return false;
}

export async function pause(): Promise<void> {
  if (player) {
    await player.pause().catch((err) => {
      console.warn('[Tunes] pause failed:', err);
    });
  }
}

export async function resume(): Promise<void> {
  if (player) {
    activateElement();
    await player.resume().catch((err) => {
      console.warn('[Tunes] resume failed:', err);
    });
  }
}

export async function togglePlay(): Promise<void> {
  if (player) {
    activateElement();
    await player.togglePlay().catch((err) => {
      console.warn('[Tunes] togglePlay failed:', err);
    });
  }
}

export async function getCurrentState(): Promise<Spotify.PlaybackState | null> {
  if (!player) return null;
  return player.getCurrentState();
}

export async function setPlayerVolume(vol: number): Promise<void> {
  if (player) {
    await player.setVolume(vol).catch((err) => {
      console.warn('[Tunes] setVolume failed:', err);
    });
  }
}

export function disconnect(): void {
  if (player) {
    player.disconnect();
    player = null;
    deviceId = null;
    deviceConfirmed = false;
    activated = false;
    currentGetToken = null;
  }
}

export function getDeviceId(): string | null {
  return deviceId;
}

export function isDeviceConfirmed(): boolean {
  return deviceConfirmed;
}

export function isInitialized(): boolean {
  return player !== null && deviceId !== null;
}
