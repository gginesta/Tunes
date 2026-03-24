const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
// Use 127.0.0.1 in dev because Spotify rejects "localhost" as insecure
const REDIRECT_URI = window.location.hostname === 'localhost'
  ? `http://127.0.0.1:${window.location.port}/callback.html`
  : `${window.location.origin}/callback.html`;
const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-modify-playback-state',
  'user-read-playback-state',
].join(' ');

const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const AUTH_ENDPOINT = 'https://accounts.spotify.com/authorize';

function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const array = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(array, (b) => chars[b % chars.length]).join('');
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  return crypto.subtle.digest('SHA-256', encoder.encode(plain));
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function getSpotifyAuthUrl(): Promise<string> {
  const codeVerifier = generateRandomString(64);
  sessionStorage.setItem('spotify_code_verifier', codeVerifier);
  sessionStorage.setItem('spotify_client_id', CLIENT_ID);
  sessionStorage.setItem('spotify_opener_origin', window.location.origin);

  const challenge = base64UrlEncode(await sha256(codeVerifier));

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });

  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export async function exchangeCodeForToken(
  code: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const codeVerifier = sessionStorage.getItem('spotify_code_verifier');
  if (!codeVerifier) throw new Error('Missing PKCE code verifier');

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error_description || 'Token exchange failed');
  }

  const data = await res.json();
  sessionStorage.removeItem('spotify_code_verifier');

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    throw new Error('Token refresh failed');
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresIn: data.expires_in,
  };
}

export function openSpotifyLogin(): Promise<{ accessToken: string; refreshToken: string }> {
  return new Promise(async (resolve, reject) => {
    const url = await getSpotifyAuthUrl();

    const width = 500;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const popup = window.open(
      url,
      'spotify-auth',
      `width=${width},height=${height},left=${left},top=${top}`,
    );

    if (!popup) {
      reject(new Error('Popup blocked — please allow popups for this site'));
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'spotify-auth-callback') return;

      window.removeEventListener('message', handleMessage);
      clearInterval(pollTimer);

      if (event.data.error) {
        reject(new Error(event.data.error));
      } else {
        resolve({
          accessToken: event.data.accessToken,
          refreshToken: event.data.refreshToken,
        });
      }
    };

    window.addEventListener('message', handleMessage);

    // Poll to detect if popup was closed without completing
    const pollTimer = setInterval(() => {
      if (popup.closed) {
        clearInterval(pollTimer);
        window.removeEventListener('message', handleMessage);
        reject(new Error('Spotify login cancelled'));
      }
    }, 500);
  });
}
