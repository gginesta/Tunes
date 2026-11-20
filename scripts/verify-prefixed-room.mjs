// Run after build:shared and build:server. This starts an isolated production server.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import jsQR from 'jsqr';
import { chromium } from 'playwright-core';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = await mkdtemp(join(tmpdir(), 'tunes-prefixed-room-'));
const host = '127.0.0.1';
const prefix = '/play/';
const rootKeys = {
  tunes_room: 'ROOT',
  tunes_player: 'legacy-player',
  tunes_seat_token: 'legacy-seat',
  tunes_guest_token: 'legacy-guest',
  tunes_session_ts: String(Date.now()),
  tunes_playback_intent: 'spotify',
  spotify_refresh_token: 'legacy-refresh-fixture',
  [JSON.stringify(['tunes-table-spotify', 'ROOT', 'legacy-player'])]: 'legacy-table-refresh-fixture',
};

async function listen(server) {
  server.listen(0, host);
  await once(server, 'listening');
  return server.address().port;
}

async function waitForHealth(url, server) {
  let result;
  for (let attempt = 0; attempt < 200 && server.exitCode === null; attempt++) {
    const response = await fetch(url).catch((error) => { result = error.cause ?? error; });
    if (response?.ok) return;
    if (response) result = response.status;
    await delay(50);
  }
  throw Error(`The isolated Tunes server did not start (${server.exitCode ?? result})`);
}

function pathWithoutPrefix(url) {
  return '/' + url.slice(prefix.length);
}

function startProxy(backendPort) {
  const legacyRequests = [];
  let legacyHomeVisits = 0;
  const playerRequests = [];
  const websockets = [];
  const sockets = new Set();
  const server = createServer((req, res) => {
    if (req.url === '/') {
      legacyHomeVisits++;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><link rel="icon" href="data:,"><h1>Legacy home fixture</h1>');
      return;
    }
    if (!req.url.startsWith(prefix)) {
      legacyRequests.push(req.url);
      res.writeHead(404).end();
      return;
    }
    const upstream = request({ host, port: backendPort, method: req.method, headers: req.headers, path: pathWithoutPrefix(req.url) }, (reply) => {
      playerRequests.push({ path: req.url, status: reply.statusCode, type: reply.headers['content-type'] });
      res.writeHead(reply.statusCode, reply.headers);
      reply.pipe(res);
      res.once('close', () => reply.destroy());
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith(prefix)) {
      legacyRequests.push(req.url);
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    const upstream = connect(backendPort, host, () => {
      const headers = [];
      for (let index = 0; index < req.rawHeaders.length; index += 2) {
        headers.push(`${req.rawHeaders[index]}: ${req.rawHeaders[index + 1]}`);
      }
      upstream.write([`GET ${pathWithoutPrefix(req.url)} HTTP/1.1`, ...headers, '', ''].join('\r\n'));
      upstream.write(head);
      upstream.pipe(socket).pipe(upstream);
    });
    upstream.once('data', (chunk) => {
      if (chunk.toString('latin1').startsWith('HTTP/1.1 101 ')) websockets.push(req.url);
    });
    socket.on('error', () => upstream.destroy());
    socket.once('close', () => upstream.destroy());
    upstream.on('error', () => socket.destroy());
  });
  return { server, sockets, legacyRequests, playerRequests, websockets, legacyHomeVisits: () => legacyHomeVisits };
}

async function inviteFromQr(page) {
  const qr = await page.locator('.tunes-qr svg').evaluate(async (svg) => {
    const image = new Image();
    image.src = 'data:image/svg+xml,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 336;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, 336, 336);
    return Array.from(context.getImageData(0, 0, 336, 336).data);
  });
  return jsQR(Uint8ClampedArray.from(qr), 336, 336)?.data;
}

let backend, proxy, browser;
const serverErrors = [];
const previousBase = process.env.VITE_BASE_PATH;
try {
  process.env.VITE_BASE_PATH = prefix;
  await build({ root: join(root, 'app'), logLevel: 'warn', define: {
    'import.meta.env.VITE_SERVER_URL': JSON.stringify(''),
    'import.meta.env.VITE_SPOTIFY_CLIENT_ID': JSON.stringify(''),
    'import.meta.env.VITE_SPOTIFY_REDIRECT_URI': JSON.stringify(''),
  }, build: { outDir: join(fixture, 'app', 'dist'), emptyOutDir: true } });
  await cp(join(root, 'server', 'dist'), join(fixture, 'server', 'dist'), { recursive: true });
  await Promise.all(['manual-recordings.json', 'independent-instrumentals.json'].map((name) =>
    cp(join(root, 'data', name), join(fixture, 'data-seed', name)),
  ));

  const portProbe = createServer();
  const backendPort = await listen(portProbe);
  await new Promise((resolve) => portProbe.close(resolve));
  proxy = startProxy(backendPort);
  const origin = `http://${host}:${await listen(proxy.server)}`;
  backend = spawn(process.execPath, [join(fixture, 'server', 'dist', 'index.js')], {
    cwd: fixture, windowsHide: true,
    env: {
      ...process.env, NODE_ENV: 'production', LOG_LEVEL: 'warn', PORT: String(backendPort), TUNES_BIND_HOST: host,
      ALLOWED_ORIGINS: origin, DATA_DIR: join(fixture, 'rooms'), TUNES_DINNER_ENABLED: 'true',
      TUNES_SPOTIFY_CLASSIC_ENABLED: 'false', TUNES_LICENSED_ENABLED: 'true', TUNES_LICENSED_MANIFEST: '',
      NODE_PATH: [join(root, 'node_modules'), join(root, 'server', 'node_modules')].join(delimiter),
    },
  });
  backend.on('error', (error) => serverErrors.push(String(error)));
  backend.stdout.on('data', (chunk) => serverErrors.push(String(chunk)));
  backend.stderr.on('data', (chunk) => serverErrors.push(String(chunk)));
  await waitForHealth(origin + prefix + 'health', backend);

  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const browserErrors = [];
  async function isolatedPage() {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    page.on('pageerror', (error) => browserErrors.push(error.message));
    return page;
  }

  const controller = await isolatedPage();
  await controller.goto(origin);
  await controller.getByRole('heading', { name: 'Legacy home fixture' }).waitFor();
  await controller.evaluate((keys) => Object.entries(keys).forEach(([key, value]) => localStorage.setItem(key, value)), rootKeys);
  await controller.goto(origin + prefix);
  await controller.locator('#stage-name').waitFor();
  assert.equal(await controller.getByRole('button', { name: /Resume your table/ }).count(), 0);
  await controller.locator('#stage-name').fill('Controller');
  await controller.getByRole('button', { name: 'Host a room' }).click();
  await controller.getByRole('heading', { name: 'Invite the table' }).waitFor();
  const code = (await controller.locator('.tunes-room-code').innerText()).trim();
  assert.match(code, /^[A-Z]{4}$/);
  const invite = await inviteFromQr(controller);
  assert.equal(invite, `${origin}${prefix}join/${code}`);

  const guest = await isolatedPage();
  let guestRoom;
  guest.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => {
    if (typeof payload !== 'string' || !payload.startsWith('42[')) return;
    const [event, data] = JSON.parse(payload.slice(2));
    if (event === 'state-sync') guestRoom = data;
  }));
  await guest.goto(invite);
  await guest.getByRole('heading', { name: 'Find your table' }).waitFor();
  assert.equal(await guest.locator('form input').nth(1).inputValue(), code);
  await guest.locator('#stage-name').fill('Guest');
  await guest.getByRole('button', { name: 'Join room' }).click();
  await guest.getByRole('heading', { name: 'Invite the table' }).waitFor();
  await controller.getByText('2 people ready').waitFor();
  const guestSeatKey = prefix + ':tunes_player';
  const guestSeat = await guest.evaluate((key) => localStorage.getItem(key), guestSeatKey);
  assert.ok(guestSeat, 'Guest seat must be persisted in the prefixed namespace');
  await guest.reload();
  await guest.getByRole('heading', { name: 'Invite the table' }).waitFor();
  await guest.getByText('2 people ready').waitFor();
  assert.equal((await guest.locator('.tunes-room-code').innerText()).trim(), code);
  assert.equal(await guest.evaluate((key) => localStorage.getItem(key), guestSeatKey), guestSeat);

  await controller.reload();
  await controller.getByRole('button', { name: 'Customize' }).click();
  for (const mode of ['Classic Pro', 'Classic Expert', 'Classic Co-op', 'Dinner Set', 'Classic']) {
    await controller.locator('.tunes-mode-choice').filter({ has: controller.getByText(mode, { exact: true }) }).click();
    await guest.getByRole('heading', { name: mode, exact: true }).waitFor();
  }

  await controller.getByLabel('Music source').selectOption('independent-instrumentals');
  await guest.getByText('Automatic music', { exact: true }).waitFor();
  const credits = controller.getByRole('link', { name: 'Automatic music credits' });
  assert.equal(await credits.getAttribute('href'), prefix + 'music-credits.html');
  assert.equal((await controller.request.get(origin + prefix + 'music-credits.html')).status(), 200);

  const isClip = (response) => new URL(response.url()).pathname.startsWith(prefix + 'listening/');
  const clip = controller.waitForResponse(isClip);
  await controller.getByRole('button', { name: 'Start Classic' }).click();
  await controller.getByRole('button', { name: 'Continue', exact: true }).click();
  const response = await clip;
  assert.ok([200, 206].includes(response.status()), 'Independent audio returned a successful file response');
  assert.match(response.headers()['content-type'], /^audio\//);
  const play = controller.getByRole('button', { name: 'Play music', exact: true });
  if (await play.isVisible()) await play.click();
  const playing = guest.getByRole('heading', { name: 'Now playing', exact: true });
  await playing.waitFor();
  const { matchId, roundId, currentTurnPlayerId, deckSize } = guestRoom.gameState;
  const hostSeat = await controller.evaluate((key) => localStorage.getItem(key), guestSeatKey);
  assert.ok(hostSeat && currentTurnPlayerId && matchId && roundId > 0);

  await controller.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await guest.getByRole('heading', { name: 'Table paused' }).waitFor();
  const remaining = guestRoom.gameState.timing.remainingMs;
  assert.ok(remaining > 0);
  await controller.reload();
  const resume = controller.getByRole('button', { name: 'Resume music', exact: true });
  await resume.waitFor();
  assert.equal(guestRoom.code, code);
  assert.equal(guestRoom.gameState.matchId, matchId);
  assert.equal(guestRoom.gameState.roundId, roundId);
  assert.equal(guestRoom.gameState.currentTurnPlayerId, currentTurnPlayerId);
  assert.equal(guestRoom.gameState.deckSize, deckSize);
  assert.equal(guestRoom.gameState.timing.remainingMs, remaining);
  assert.equal(guestRoom.gameState.timing.deadline, null);
  assert.equal(await controller.evaluate((key) => localStorage.getItem(key), guestSeatKey), hostSeat);
  const [resumed] = await Promise.all([controller.waitForResponse(isClip), resume.click()]);
  assert.equal(resumed.url(), response.url(), 'The restored speaker must play the same clip');
  assert.ok([200, 206].includes(resumed.status()));
  await playing.waitFor();

  const legacyAfter = await controller.evaluate((keys) => Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])), Object.keys(rootKeys));
  assert.deepEqual(legacyAfter, rootKeys, 'The prefixed app must preserve the root app’s saved seat');
  await controller.goto(origin);
  await controller.getByRole('heading', { name: 'Legacy home fixture' }).waitFor();
  assert.equal(proxy.legacyHomeVisits(), 2, 'Only the explicit fixture visits may request the root home');
  assert.deepEqual(proxy.legacyRequests, [], 'The prefixed browser request paths must never escape to the root app');
  assert.ok(proxy.websockets.length >= 4 && proxy.websockets.every((path) => path.startsWith(prefix + 'socket.io/')));
  assert.ok(proxy.playerRequests.some(({ path, status }) => path.startsWith(prefix + 'assets/') && status === 200));
  assert.deepEqual(browserErrors, []);
  console.log('Verified /play/ assets, WebSocket, invite QR, five modes, Classic clip and turn recovery, and root storage coexistence.');
} catch (error) {
  if (serverErrors.length) console.error(serverErrors.join(''));
  if (proxy?.legacyRequests.length) console.error('Requests escaped to the root:', proxy.legacyRequests);
  throw error;
} finally {
  if (previousBase === undefined) delete process.env.VITE_BASE_PATH;
  else process.env.VITE_BASE_PATH = previousBase;
  await browser?.close();
  if (proxy) {
    for (const socket of proxy.sockets) socket.destroy();
    await new Promise((resolve) => proxy.server.close(resolve));
  }
  if (backend?.pid && backend.exitCode === null && backend.signalCode === null) {
    const closed = once(backend, 'exit');
    backend.kill();
    await closed;
  }
  await rm(fixture, { recursive: true, force: true, maxRetries: 3 });
}
