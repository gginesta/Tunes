/**
 * Spotify Web Playback SDK integration.
 *
 * Key issues solved:
 * 1. Device not found (404): The SDK fires 'ready' before the device is
 *    registered with Spotify's servers. We must wait + retry with backoff.
 * 2. Device reconnection: The SDK may disconnect and reconnect with a NEW
 *    device ID. We track pending tracks and replay on new device.
 * 3. Autoplay: activateElement() must be called during a user gesture.
 * 4. Transfer playback: We transfer playback to our device first, then play.
 */

let player: Spotify.Player | null = null;
let deviceId: string | null = null;
let sdkLoaded = false;
let sdkReady: Promise<void> | null = null;
let activated = false;

// Track pending playback so we can retry when device reconnects
let pendingTrack: { trackId: string; accessToken: string } | null = null;
let onPendingTrackReady: (() => void) | null = null;

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
}

export async function initPlayer(
  getToken: () => Promise<string>,
  callbacks: SpotifyPlayerCallbacks,
): Promise<void> {
  if (player) return;

  await loadSDK();

  player = new window.Spotify.Player({
    name: 'Hitster Game',
    getOAuthToken: (cb) => {
      getToken().then(cb).catch(() => cb(''));
    },
    volume: 0.8,
  });

  player.addListener('ready', ({ device_id }) => {
    deviceId = device_id;
    console.log('[Hitster] Spotify SDK ready, device:', device_id);
    callbacks.onReady(device_id);

    // If there's a pending track from a failed attempt, retry it
    if (pendingTrack) {
      console.log('[Hitster] Retrying pending track on new device...');
      if (onPendingTrackReady) onPendingTrackReady();
    }
  });

  player.addListener('not_ready', ({ device_id }) => {
    console.warn('[Hitster] Spotify device offline:', device_id);
    deviceId = null;
    callbacks.onNotReady();
  });

  player.addListener('authentication_error', (err) => {
    console.error('[Hitster] Spotify auth error:', err.message);
    callbacks.onError('Spotify authentication failed. Try reconnecting.');
  });

  player.addListener('initialization_error', (err) => {
    console.error('[Hitster] Spotify init error:', err.message);
    callbacks.onError('Failed to initialize Spotify player');
  });

  player.addListener('account_error', (err) => {
    console.error('[Hitster] Spotify account error:', err.message);
    callbacks.onError('Spotify Premium is required to play music');
  });

  player.addListener('playback_error', (err) => {
    console.error('[Hitster] Spotify playback error:', err.message);
  });

  player.addListener('autoplay_failed', () => {
    console.warn('[Hitster] Autoplay blocked by browser — user must click play');
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
    console.log('[Hitster] Spotify player connected');
  }
}

export function activateElement(): void {
  if (player && !activated) {
    player.activateElement();
    activated = true;
    console.log('[Hitster] activateElement() called');
  }
}

/**
 * Transfer playback to our SDK device. This ensures Spotify's servers
 * recognize the device before we try to play on it.
 */
async function transferPlayback(accessToken: string): Promise<boolean> {
  if (!deviceId) return false;

  console.log('[Hitster] Transferring playback to device:', deviceId);
  const res = await fetch('https://api.spotify.com/v1/me/player', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      device_ids: [deviceId],
      play: false,
    }),
  });

  // 204 = success, 404 = device not yet registered
  if (res.ok || res.status === 204) {
    console.log('[Hitster] Transfer playback success');
    return true;
  }

  console.warn('[Hitster] Transfer playback failed:', res.status);
  return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Play a track with retry + backoff for "Device not found" (404).
 * The SDK fires 'ready' before Spotify's API servers know about the device,
 * so we must retry with increasing delays.
 */
export async function playTrack(
  trackId: string,
  accessToken: string,
): Promise<boolean> {
  if (!deviceId) {
    console.error('[Hitster] playTrack: no deviceId — player not ready');
    return false;
  }

  activateElement();

  // Store as pending so we can retry on device reconnection
  pendingTrack = { trackId, accessToken };

  console.log('[Hitster] playTrack:', trackId, 'device:', deviceId);

  const doPlay = () => {
    // Always use the latest deviceId (it can change between retries)
    const currentDeviceId = deviceId;
    if (!currentDeviceId) return Promise.resolve(new Response(null, { status: 404 }));

    return fetch(
      `https://api.spotify.com/v1/me/player/play?device_id=${currentDeviceId}`,
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

  // Retry with backoff: 1s, 2s, 3s, 4s — device registration can take a few seconds
  const delays = [0, 1000, 2000, 3000, 4000];
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt] > 0) {
      console.log(`[Hitster] playTrack retry ${attempt}, waiting ${delays[attempt]}ms...`);
      await sleep(delays[attempt]);
    }

    const res = await doPlay();

    if (res.ok || res.status === 204) {
      console.log('[Hitster] playTrack success on attempt', attempt + 1);
      pendingTrack = null;
      return true;
    }

    if (res.status === 401) {
      console.warn('[Hitster] playTrack: token expired (401)');
      return false;
    }

    const body = await res.text().catch(() => '');
    console.warn(`[Hitster] playTrack attempt ${attempt + 1} failed:`, res.status, body);

    // If not a 404 "Device not found", don't keep retrying
    if (res.status !== 404) {
      break;
    }

    // On first 404, try transferring playback to register the device
    if (attempt === 1) {
      await transferPlayback(accessToken);
    }
  }

  // All retries failed — wait for device reconnection
  console.log('[Hitster] playTrack: all attempts failed, waiting for device reconnection...');

  // Wait up to 8 more seconds for a new 'ready' event
  const reconnected = await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      onPendingTrackReady = null;
      resolve(false);
    }, 8000);

    onPendingTrackReady = () => {
      clearTimeout(timeout);
      onPendingTrackReady = null;
      resolve(true);
    };
  });

  if (reconnected && deviceId) {
    console.log('[Hitster] Device reconnected, final retry with new device:', deviceId);
    await sleep(1000); // Give the new device a moment
    const res = await doPlay();
    if (res.ok || res.status === 204) {
      console.log('[Hitster] playTrack success after reconnection');
      pendingTrack = null;
      return true;
    }
    console.error('[Hitster] playTrack failed even after reconnection:', res.status);
  }

  pendingTrack = null;
  return false;
}

export async function pause(): Promise<void> {
  if (player) {
    await player.pause().catch((err) => {
      console.warn('[Hitster] pause failed:', err);
    });
  }
}

export async function resume(): Promise<void> {
  if (player) {
    activateElement();
    await player.resume().catch((err) => {
      console.warn('[Hitster] resume failed:', err);
    });
  }
}

export async function togglePlay(): Promise<void> {
  if (player) {
    activateElement();
    await player.togglePlay().catch((err) => {
      console.warn('[Hitster] togglePlay failed:', err);
    });
  }
}

export async function getCurrentState(): Promise<Spotify.PlaybackState | null> {
  if (!player) return null;
  return player.getCurrentState();
}

export function disconnect(): void {
  if (player) {
    player.disconnect();
    player = null;
    deviceId = null;
    activated = false;
    pendingTrack = null;
    onPendingTrackReady = null;
  }
}

export function getDeviceId(): string | null {
  return deviceId;
}

export function isInitialized(): boolean {
  return player !== null && deviceId !== null;
}
