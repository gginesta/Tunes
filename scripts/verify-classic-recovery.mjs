import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium, webkit, devices } from 'playwright-core';
import { build, preview } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const app = join(root, 'app');
const fixture = await mkdtemp(join(tmpdir(), 'tunes-classic-recovery-'));
const local = '127.0.0.1';
const clientId = 'd'.repeat(32);
const accessToken = 'classic-test-access';
const refreshToken = 'classic-test-refresh';
const staleTrack = 'classic-test-stale-track';

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, local, resolve);
  });
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function until(check, label) {
  const deadline = Date.now() + 20_000;
  do {
    const value = await check();
    if (value) return value;
    await delay(50);
  } while (Date.now() < deadline);
  throw new Error('Timed out waiting for ' + label);
}

function observeSocket(page) {
  const events = [];
  page.on('websocket', socket => {
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload === 'string' && payload.startsWith('42[')) {
        const [event, data] = JSON.parse(payload.slice(2));
        events.push({ event, data });
      }
    });
  });
  return {
    mark: () => events.length,
    wait: (event, predicate, after = 0) => until(
      () => events.slice(after).find(packet => packet.event === event && predicate(packet.data))?.data,
      'Socket.IO ' + event,
    ),
  };
}

function installSyntheticPhone() {
  let visibility = 'visible';
  let sentinel;
  window.classicPhone = {
    playing: null,
    resumes: [],
    wakeRequests: 0,
    setVisibility(value) {
      visibility = value;
      if (value === 'hidden') void sentinel?.release();
      document.dispatchEvent(new Event('visibilitychange'));
    },
  };
  Object.defineProperties(document, {
    visibilityState: { configurable: true, get: () => visibility },
    hidden: { configurable: true, get: () => visibility === 'hidden' },
  });
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: {
      async request(kind) {
        if (kind !== 'screen' || document.hidden) throw new Error('Screen wake lock unavailable');
        window.classicPhone.wakeRequests++;
        const lock = Object.assign(new EventTarget(), {
          released: false,
          async release() {
            if (lock.released) return;
            lock.released = true;
            lock.dispatchEvent(new Event('release'));
          },
        });
        sentinel = lock;
        return lock;
      },
    },
  });
}

function installSpotifySdk() {
  class Player {
    constructor(options) {
      this.options = options;
      this.deviceId = 'classic-test-sdk-' + crypto.randomUUID();
      this.listeners = {};
      this.state = null;
      window.classicDevice = this;
    }
    addListener(event, listener) { this.listeners[event] = listener; }
    activateElement() { return Promise.resolve(); }
    setVolume() { return Promise.resolve(); }
    async connect() {
      await new Promise(resolve => this.options.getOAuthToken(resolve));
      this.listeners.ready({ device_id: this.deviceId });
      return true;
    }
    async pause() {
      if (this.state) this.setTrack(this.state.track_window.current_track.id, true);
    }
    async resume() {
      if (!this.state) return;
      const id = this.state.track_window.current_track.id;
      window.classicPhone.resumes.push(id);
      this.setTrack(id, false);
    }
    async togglePlay() {
      if (!this.state) return;
      if (this.state.paused) await this.resume();
      else await this.pause();
    }
    getCurrentState() { return Promise.resolve(this.state); }
    setTrack(id, paused) {
      this.state = { paused, position: 6500, duration: 180000, track_window: { current_track: { id } } };
      window.classicPhone.playing = paused ? null : id;
      this.listeners.player_state_changed(this.state);
    }
    disconnect() {
      this.state = null;
      window.classicPhone.playing = null;
    }
  }
  window.Spotify = { Player };
  window.onSpotifyWebPlaybackSDKReady();
}

async function stubBrowserNetwork(context, { origin, backend, host, calls }) {
  const callback = origin + '/callback.html';
  const headers = {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'cache-control': 'no-store',
  };
  let challenge;
  async function browserDevice(frame) {
    const sdk = await frame.evaluate(() => ({
      sdkId: window.classicDevice.deviceId,
      name: window.classicDevice.options.name,
    }));
    let registered = calls.devices.find(device => device.sdkId === sdk.sdkId);
    if (!registered) {
      registered = {
        ...sdk,
        // Initial device matches by SDK ID. For a fresh tab, Spotify's REST
        // registry presents a different ID and retains the abandoned tab first.
        id: calls.devices.length ? 'classic-test-rest-fresh-device' : sdk.sdkId,
      };
      calls.devices.push(registered);
    }
    return registered;
  }

  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin || url.origin === backend) return route.continue();
    if (!['accounts.spotify.com', 'sdk.scdn.co', 'api.spotify.com'].includes(url.hostname)) {
      return route.abort();
    }
    try {
      assert.ok(host, 'Guest browser must never access Spotify');
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (url.origin === 'https://accounts.spotify.com' && url.pathname === '/authorize') {
        assert.equal(url.searchParams.get('redirect_uri'), callback);
        assert.equal(url.searchParams.get('client_id'), clientId);
        assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
        challenge = url.searchParams.get('code_challenge');
        assert.ok(challenge);
        calls.authorizations++;
        const destination = new URL(callback);
        destination.search = '?code=classic-test-code';
        const state = url.searchParams.get('state');
        if (state) destination.searchParams.set('state', state);
        return route.fulfill({
          contentType: 'text/html',
          body: '<script>location.replace(' + JSON.stringify(destination.href) + ')</script>',
        });
      }
      if (url.origin === 'https://accounts.spotify.com' && url.pathname === '/api/token') {
        const params = new URLSearchParams(request.postData());
        assert.equal(params.get('client_id'), clientId);
        if (params.get('grant_type') === 'authorization_code') {
          assert.equal(params.get('code'), 'classic-test-code');
          assert.equal(params.get('redirect_uri'), callback);
          assert.equal(createHash('sha256').update(params.get('code_verifier')).digest('base64url'), challenge);
          calls.exchanges++;
        } else {
          assert.equal(params.get('grant_type'), 'refresh_token');
          assert.equal(params.get('refresh_token'), refreshToken);
          calls.refreshes++;
        }
        return route.fulfill({
          headers,
          json: { access_token: accessToken, refresh_token: refreshToken, expires_in: 3600 },
        });
      }
      if (url.origin === 'https://sdk.scdn.co' && url.pathname === '/spotify-player.js') {
        return route.fulfill({
          contentType: 'application/javascript',
          body: '(' + installSpotifySdk.toString() + ')();',
        });
      }
      if (url.origin === 'https://api.spotify.com') {
        assert.equal(request.headers().authorization, 'Bearer ' + accessToken);
        if (url.pathname === '/v1/me/player/devices') {
          await browserDevice(request.frame());
          const devices = calls.devices.map(({ id, name }) => ({ id, name }));
          return route.fulfill({ headers, json: { devices } });
        }
        if (url.pathname === '/v1/me/player/play') {
          assert.equal(request.method(), 'PUT');
          const { id } = await browserDevice(request.frame());
          assert.equal(url.searchParams.get('device_id'), id, 'Play must target the current tab’s Connect device');
          const { uris } = request.postDataJSON();
          assert.equal(uris.length, 1);
          const match = /^spotify:track:([a-f0-9]{22})$/.exec(uris[0]);
          assert.ok(match, 'Only a synthetic catalogue track may be played');
          const trackId = match[1];
          calls.plays.push(trackId);
          await request.frame().evaluate(id => window.classicDevice.setTrack(id, false), trackId);
          return route.fulfill({ status: 204, headers });
        }
      }
      assert.fail('Unexpected Spotify request ' + url.origin + url.pathname);
    } catch (error) {
      calls.errors.push(error);
      return route.abort().catch(() => {});
    }
  });
}

function assertSameRound(room, original, hostId, guestId) {
  assert.equal(room.code, original.code);
  assert.equal(room.hostId, hostId);
  assert.equal(room.originalHostId, hostId);
  assert.equal(room.playbackMode, 'spotify');
  assert.deepEqual(Object.keys(room.players).sort(), [hostId, guestId].sort());
  assert.equal(room.players[guestId].connected, true);
  assert.equal(room.gameState.phase, 'playing');
  assert.equal(room.gameState.currentSong.id, original.gameState.currentSong.id);
  assert.equal(room.gameState.currentSong.spotifyTrackId, original.gameState.currentSong.spotifyTrackId);
  assert.equal(room.gameState.turnIndex, original.gameState.turnIndex);
  assert.equal(room.gameState.currentTurnPlayerId, original.gameState.currentTurnPlayerId);
  assert.equal(room.gameState.deckSize, original.gameState.deckSize);
}

let server, web, browser, calls;
const diagnostics = [];
try {
  const backendPort = await freePort();
  const frontendPort = await freePort();
  const backend = 'http://' + local + ':' + backendPort;
  const origin = 'http://' + local + ':' + frontendPort;
  const songs = Array.from({ length: 12 }, (_, index) => ({
    title: 'Test Song ' + index,
    artist: 'Test Artist',
    year: 1975 + index,
    genre: 'pop',
    region: 'global',
  }));
  await writeFile(join(fixture, 'songs.json'), JSON.stringify(songs));

  // Intercept the production server's catalogue lookups using synthetic track IDs.
  const preload = join(fixture, 'synthetic-spotify.cjs');
  await writeFile(preload, [
    "const assert = require('node:assert/strict');",
    "const { createHash } = require('node:crypto');",
    'globalThis.fetch = async (input, init) => {',
    '  const url = new URL(input);',
    "  assert.equal(url.origin + url.pathname, 'https://api.spotify.com/v1/search');",
    '  assert.equal(init?.headers.Authorization, ' + JSON.stringify('Bearer ' + accessToken) + ');',
    "  const query = url.searchParams.get('q');",
    '  assert.match(query, /^track:Test Song \\d+ artist:Test Artist$/);',
    "  const id = createHash('sha256').update(query).digest('hex').slice(0, 22);",
    '  return Response.json({ tracks: { items: [{ id }] } });',
    '};',
  ].join('\n'));
  server = spawn(process.execPath, ['--require', preload, 'server/dist/index.js'], {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DATA_DIR: fixture,
      PORT: String(backendPort),
      ALLOWED_ORIGINS: origin,
    },
  });
  server.on('error', error => diagnostics.push(String(error)));
  for (const stream of [server.stdout, server.stderr]) {
    stream.on('data', chunk => diagnostics.push(String(chunk)));
  }
  await until(async () => {
    try {
      return (await fetch(backend + '/health')).ok;
    } catch {
      return false;
    }
  }, 'local Classic server');

  const outDir = join(fixture, 'ui');
  await build({
    root: app,
    logLevel: 'error',
    define: {
      'import.meta.env.VITE_SPOTIFY_CLIENT_ID': JSON.stringify(clientId),
      'import.meta.env.VITE_SERVER_URL': JSON.stringify(backend),
    },
    build: { outDir, emptyOutDir: true },
  });
  web = await preview({
    root: app,
    logLevel: 'error',
    build: { outDir },
    preview: { host: local, port: frontendPort, strictPort: true },
  });

  const runWebKit = process.env.TUNES_TEST_BROWSER === 'webkit';
  browser = runWebKit ? await webkit.launch() : await chromium.launch({ channel: 'chrome' });
  const hostContext = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
  const guestContext = await browser.newContext({ serviceWorkers: 'block' });
  calls = { authorizations: 0, exchanges: 0, refreshes: 0, devices: [], plays: [], errors: [] };
  await hostContext.addInitScript(installSyntheticPhone);
  await stubBrowserNetwork(hostContext, { origin, backend, host: true, calls });
  await stubBrowserNetwork(guestContext, { origin, backend, host: false, calls });

  let hostWire;
  await hostContext.routeWebSocket(backend.replace('http:', 'ws:') + '/socket.io/**', wire => {
    hostWire = wire.connectToServer();
  });

  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const hostSocket = observeSocket(host);
  const guestSocket = observeSocket(guest);

  await host.goto(origin);
  await host.getByPlaceholder('Enter your nickname...').fill('Phone Host');
  await host.getByRole('button', { name: 'HOST A ROOM' }).click();
  await host.getByRole('button', { name: /HOST WITH SPOTIFY/ }).click();
  const { code, playerId: hostId } = await hostSocket.wait('room-created', packet => !!packet.code);
  assert.equal(calls.authorizations, 1);
  assert.equal(calls.exchanges, 1);
  await until(() => host.evaluate(() => window.classicPhone.wakeRequests > 0), 'host lobby wake lock');

  await guest.goto(origin);
  await guest.getByPlaceholder('Enter your nickname...').fill('Table Guest');
  await guest.getByRole('button', { name: 'JOIN WITH CODE' }).click();
  for (const [index, letter] of [...code].entries()) await guest.locator('#code-' + index).fill(letter);
  await guest.getByRole('button', { name: 'Join Room', exact: true }).click();
  const { playerId: guestId } = await guestSocket.wait('room-joined', packet => packet.room.code === code);
  await host.getByText('Table Guest', { exact: true }).waitFor();
  await host.getByRole('button', { name: 'START GAME' }).click();
  const firstTurn = await guestSocket.wait('new-turn', packet => !!packet.songCard.id);
  const { spotifyTrackId } = await guestSocket.wait('play-song', packet => !!packet.spotifyTrackId);
  await until(() => host.evaluate(id => window.classicPhone.playing === id, spotifyTrackId), 'host Spotify playback');
  await host.getByRole('button', { name: 'Pause', exact: true }).waitFor();
  await guest.getByRole('button', { name: 'Song History' }).waitFor();
  const initialWakeRequests = await host.evaluate(() => window.classicPhone.wakeRequests);

  // Background the phone and explicitly resume the Spotify track for this round.
  let guestMark = guestSocket.mark();
  await host.evaluate(() => window.classicPhone.setVisibility('hidden'));
  const suspended = await guestSocket.wait('state-sync', room => !!room.hostRecovery, guestMark);
  assert.equal(suspended.code, code);
  assert.equal(suspended.gameState.currentSong.id, firstTurn.songCard.id);
  assert.equal(suspended.gameState.currentTurnPlayerId, firstTurn.turnPlayerId);
  assert.equal(suspended.gameState.currentSong.spotifyTrackId, spotifyTrackId);
  assert.equal(suspended.players[hostId].connected, true);
  await until(() => host.evaluate(() => !window.classicPhone.playing), 'local Spotify pause on background');
  await host.evaluate(() => window.classicPhone.setVisibility('visible'));
  await until(() => host.evaluate(count => window.classicPhone.wakeRequests > count, initialWakeRequests), 'foreground wake lock reacquisition');
  guestMark = guestSocket.mark();
  await host.getByRole('button', { name: 'TAP TO RESUME MUSIC' }).click();
  const resumed = await guestSocket.wait('state-sync', room => !room.hostRecovery, guestMark);
  assertSameRound(resumed, suspended, hostId, guestId);
  assert.equal(await host.evaluate(() => window.classicPhone.playing), spotifyTrackId);
  assert.equal(calls.plays.at(-1), spotifyTrackId);
  const playsBeforeReload = calls.plays.length;

  // Drop the existing network connection as well as emulating an offline network.
  guestMark = guestSocket.mark();
  await hostContext.setOffline(true);
  assert.ok(hostWire);
  hostWire.close({ code: 1012, reason: 'Synthetic phone network loss' });
  const disconnected = await guestSocket.wait(
    'state-sync',
    room => room.hostRecovery && room.players[hostId]?.connected === false,
    guestMark,
  );
  assertSameRound(disconnected, suspended, hostId, guestId);
  assert.equal(await guest.getByRole('button', { name: 'Stop Game' }).count(), 0);
  assert.equal(await guest.getByRole('button', { name: 'Play', exact: true }).count(), 0);
  await guest.getByRole('button', { name: 'Song History' }).waitFor();

  // Evict the offline tab to discard its JS and session storage, then reopen its origin.
  await host.close();
  await hostContext.setOffline(false);
  const restoredHost = await hostContext.newPage();
  const restoredSocket = observeSocket(restoredHost);
  const refreshesBeforeReload = calls.refreshes;
  await restoredHost.goto(origin);
  const rejoined = await restoredSocket.wait('room-joined', packet => packet.room.code === code);
  assert.equal(rejoined.playerId, hostId);
  assertSameRound(rejoined.room, suspended, hostId, guestId);
  assert.ok(rejoined.room.hostRecovery);
  const resumeButton = restoredHost.getByRole('button', { name: 'TAP TO RESUME MUSIC' });
  await resumeButton.waitFor();
  await until(async () => calls.refreshes > refreshesBeforeReload &&
    await restoredHost.evaluate(() => !!window.classicDevice), 'saved Spotify session and a fresh SDK');
  for (const track of [staleTrack, spotifyTrackId]) {
    await restoredHost.evaluate(id => window.classicDevice.setTrack(id, false), track);
    await until(() => restoredHost.evaluate(() => !window.classicPhone.playing), 'unsolicited Spotify state to pause');
    await resumeButton.waitFor();
  }
  assert.equal(calls.plays.length, playsBeforeReload);
  guestMark = guestSocket.mark();
  await resumeButton.click();
  const restored = await guestSocket.wait('state-sync', room => !room.hostRecovery, guestMark);
  assertSameRound(restored, suspended, hostId, guestId);
  assert.equal(restored.players[hostId].connected, true);
  assert.equal(calls.plays.at(-1), spotifyTrackId);
  assert.deepEqual(await restoredHost.evaluate(() => window.classicPhone.resumes), []);
  await restoredHost.getByRole('button', { name: 'Pause', exact: true }).waitFor();
  assert.equal(calls.plays.length, playsBeforeReload + 1);
  assert.equal(calls.devices.length, 2);
  assert.notEqual(calls.devices[1].name, calls.devices[0].name);
  assert.notEqual(calls.devices[1].id, calls.devices[1].sdkId);
  assert.equal(calls.authorizations, 1);

  // The next turn should play on the recovered host's current browser device
  // through the usual automatic playback path, with no second recovery tap.
  const activeSeat = firstTurn.turnPlayerId === hostId ? restoredHost : guest;
  guestMark = guestSocket.mark();
  await activeSeat.getByRole('button', { name: /^Skip ·/ }).click();
  const nextTurn = await guestSocket.wait('new-turn', packet => packet.songCard.id !== firstTurn.songCard.id, guestMark);
  assert.notEqual(nextTurn.turnPlayerId, firstTurn.turnPlayerId);
  const nextTrack = await guestSocket.wait('play-song', packet => packet.spotifyTrackId !== spotifyTrackId, guestMark);
  await until(
    () => restoredHost.evaluate(id => window.classicPhone.playing === id, nextTrack.spotifyTrackId),
    'automatic Spotify playback on the next turn',
  );
  assert.equal(calls.plays.at(-1), nextTrack.spotifyTrackId);
  assert.deepEqual(calls.errors, []);

  const health = await fetch(backend + '/health').then(response => response.json());
  assert.equal(health.rooms, 1);
  assert.equal(health.players, 2);
  console.log('Classic Spotify recovery passed for ' + (runWebKit ? 'WebKit' : 'Chrome') +
    ': original host, guest, room, round, and track survived background, network loss, and tab eviction. The recovered device played the next turn.');
} catch (error) {
  for (const routeError of calls?.errors ?? []) console.error(routeError);
  console.error(diagnostics.slice(-15).join(''));
  throw error;
} finally {
  await browser?.close();
  if (web) {
    web.httpServer.closeAllConnections?.();
    await new Promise(resolve => web.httpServer.close(resolve));
  }
  if (server && server.exitCode === null && server.pid) {
    const stopped = new Promise(resolve => server.once('exit', resolve));
    server.kill();
    await stopped;
  }
  await rm(fixture, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
}
