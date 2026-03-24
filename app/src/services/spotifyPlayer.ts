let player: Spotify.Player | null = null;
let deviceId: string | null = null;
let sdkLoaded = false;
let sdkReady: Promise<void> | null = null;

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
}

export async function initPlayer(
  getToken: () => Promise<string>,
  callbacks: SpotifyPlayerCallbacks,
): Promise<void> {
  // Guard against double-init
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
    callbacks.onReady(device_id);
  });

  player.addListener('not_ready', () => {
    deviceId = null;
    callbacks.onNotReady();
  });

  player.addListener('authentication_error', (err) => {
    callbacks.onError('Spotify Premium is required to play music');
    console.error('Spotify auth error:', err.message);
  });

  player.addListener('initialization_error', (err) => {
    callbacks.onError('Failed to initialize Spotify player');
    console.error('Spotify init error:', err.message);
  });

  player.addListener('account_error', (err) => {
    callbacks.onError('Spotify Premium is required to play music');
    console.error('Spotify account error:', err.message);
  });

  player.addListener('playback_error', (err) => {
    console.error('Spotify playback error:', err.message);
  });

  player.addListener('player_state_changed', (state) => {
    if (state) {
      callbacks.onStateChange(state.paused);
    }
  });

  const connected = await player.connect();
  if (!connected) {
    callbacks.onError('Failed to connect to Spotify');
  }
}

export async function playTrack(
  trackId: string,
  accessToken: string,
): Promise<void> {
  if (!deviceId) {
    console.error('[Hitster] playTrack: no deviceId — player not ready');
    return;
  }

  console.log('[Hitster] playTrack:', trackId, 'device:', deviceId);

  const doPlay = () =>
    fetch(
      `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`,
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

  const res = await doPlay();

  if (!res.ok && res.status !== 204) {
    console.warn('[Hitster] playTrack first attempt failed:', res.status, await res.text().catch(() => ''));
    // Retry once after a short delay
    await new Promise((r) => setTimeout(r, 1000));
    const retry = await doPlay();
    if (!retry.ok && retry.status !== 204) {
      console.error('[Hitster] playTrack retry failed:', retry.status, await retry.text().catch(() => ''));
    }
  }
}

export async function pause(): Promise<void> {
  if (player) {
    await player.pause().catch(() => {});
  }
}

export async function resume(): Promise<void> {
  if (player) {
    await player.resume().catch(() => {});
  }
}

export function disconnect(): void {
  if (player) {
    player.disconnect();
    player = null;
    deviceId = null;
  }
}

export function isInitialized(): boolean {
  return player !== null && deviceId !== null;
}
