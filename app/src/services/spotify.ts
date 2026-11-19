const SCOPES = ['streaming', 'user-read-email', 'user-read-private', 'user-modify-playback-state', 'user-read-playback-state'];
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const AUTH_ENDPOINT = 'https://accounts.spotify.com/authorize';

export interface SpotifyCredential {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export class SpotifySignInExpiredError extends Error {}

function clientConfig() {
  const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID?.trim();
  const redirectUri = import.meta.env.VITE_SPOTIFY_REDIRECT_URI?.trim();
  if (!clientId || !/^[a-zA-Z0-9]{32}$/.test(clientId) || !redirectUri) return null;
  const {origin, protocol, hostname} = window.location;
  const loopback = hostname === '127.0.0.1' || hostname === '[::1]';
  if (protocol !== 'https:' && !(loopback && protocol === 'http:')) return null;
  if (redirectUri !== origin + '/callback.html') return null;
  return {clientId, redirectUri};
}

export function isSpotifyClientConfigured(): boolean {
  return Boolean(clientConfig());
}

function randomNonce() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function authorizeUrl(clientId: string, redirectUri: string, verifier: string, state: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return AUTH_ENDPOINT + '?' + new URLSearchParams({client_id:clientId, response_type:'code', redirect_uri:redirectUri,
    state, scope:SCOPES.join(' '), code_challenge_method:'S256', code_challenge:challenge});
}

async function requestToken(params: URLSearchParams, previousRefresh?: string): Promise<SpotifyCredential> {
  const response = await fetch(TOKEN_ENDPOINT, {method:'POST', body:params,
    signal:AbortSignal.timeout(20_000), referrerPolicy:'no-referrer'});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (data.error === 'invalid_grant') throw new SpotifySignInExpiredError('Spotify sign-in has expired. Connect again on this phone.');
    throw new Error('Spotify could not finish signing in. Try again.');
  }
  const refresh = data.refresh_token || previousRefresh;
  if (typeof data.access_token !== 'string' || !data.access_token || typeof refresh !== 'string' || !refresh ||
      !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new Error('Spotify returned an incomplete sign-in.');
  return {accessToken:data.access_token, refreshToken:refresh, expiresIn:data.expires_in};
}

export function refreshAccessToken(refreshToken: string): Promise<SpotifyCredential> {
  const config = clientConfig();
  if (!config) return Promise.reject(new Error('Spotify sign-in is unavailable on this site.'));
  return requestToken(new URLSearchParams({client_id:config.clientId, grant_type:'refresh_token', refresh_token:refreshToken}), refreshToken);
}

let pending: Promise<SpotifyCredential> | undefined;

export function openSpotifyLogin(): Promise<SpotifyCredential> {
  if (pending) return pending;
  const config = clientConfig();
  if (!config) return Promise.reject(new Error('Spotify sign-in is unavailable on this site.'));
  const verifier = randomNonce();
  const state = randomNonce();
  // Open inside the tap handler, before the asynchronous PKCE digest, for iOS Safari.
  const popup = window.open('about:blank', '_blank', 'popup,width=500,height=700');
  if (!popup) return Promise.reject(new Error('Allow the Spotify sign-in window, then tap Connect Spotify again.'));

  const code = new Promise<string>((resolve, reject) => {
    let finished = false;
    const finish = (value: string, failed = false) => {
      if (finished) return;
      finished = true;
      window.removeEventListener('message', message);
      window.clearInterval(poll);
      window.clearTimeout(timeout);
      popup.close();
      if (failed) reject(new Error(value));
      else resolve(value);
    };
    const message = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== popup || event.data?.type !== 'tunes:spotify:code') return;
      if (event.data.state !== state) return;
      if (event.data.error || typeof event.data.code !== 'string' || !event.data.code) {
        finish('Spotify sign-in was cancelled or denied.', true);
      } else finish(event.data.code);
    };
    window.addEventListener('message', message);
    const poll = window.setInterval(() => { if (popup.closed) finish('Spotify sign-in was cancelled.', true); }, 500);
    const timeout = window.setTimeout(() => finish('Spotify sign-in timed out. Try again.', true), 5 * 60_000);
    void authorizeUrl(config.clientId, config.redirectUri, verifier, state)
      .then(url => { if (!finished) popup.location.replace(url); })
      .catch(() => finish('Could not open Spotify sign-in.', true));
  });
  pending = code.then(value => requestToken(new URLSearchParams({client_id:config.clientId, grant_type:'authorization_code',
    code:value, redirect_uri:config.redirectUri, code_verifier:verifier}))).finally(() => { pending = undefined; });
  return pending;
}
