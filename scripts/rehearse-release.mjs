// Run after npm run build. All rooms and database writes stay in a temporary directory.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import {io} from 'socket.io-client';

const root = new URL('../', import.meta.url);
const dataDir = await mkdtemp(join(tmpdir(), 'tunes-release-'));
const sockets = [];
const logs = [];
const portFinder = createServer();
await new Promise(resolve => portFinder.listen(0, '127.0.0.1', resolve));
const port = portFinder.address().port;
await new Promise(resolve => portFinder.close(resolve));
const base = 'http://127.0.0.1:' + port;
const server = spawn(process.execPath, ['scripts/start.mjs'], {cwd:root,
  env:{...process.env, PORT:String(port), DATA_DIR:dataDir, BUILD_REVISION:'rehearsal', LOG_LEVEL:'debug'}, windowsHide:true});
let carried = '';
server.stdout.on('data', chunk => {
  const parts = (carried + chunk).split('\n');
  carried = parts.pop();
  for (const line of parts) { try { logs.push(JSON.parse(line)); } catch { /* console output */ } }
});
server.stderr.on('data', chunk => process.stderr.write(chunk));
const closed = new Promise(resolve => server.once('exit', resolve));

async function until(fn, label) {
  const stop = Date.now() + 10000;
  while (Date.now() < stop) {
    const result = await fn();
    if (result) return result;
    await wait(12);
  }
  throw new Error('Timed out waiting for ' + label);
}
const next = (socket, event) => new Promise((resolve,reject) => {
  const timer = setTimeout(() => reject(new Error('No ' + event)), 8000);
  socket.once(event, value => {clearTimeout(timer); resolve(value);});
});
async function seat(name, code) {
  const client = io(base, {autoConnect:false, forceNew:true, transports:['websocket'], reconnection:false});
  sockets.push(client);
  const seat = {client, id:null, room:null, bytes:[], errors:[]};
  client.on('state-sync', room => {seat.room = room; seat.bytes.push(Buffer.byteLength(JSON.stringify(room)));});
  client.on('error', e => seat.errors.push(e.message));
  const connected = next(client, 'connect');
  client.connect();
  await connected;
  const joined = next(client, code ? 'room-joined' : 'room-created');
  client.emit(code ? 'join-room' : 'create-room', {playerName:name, code});
  const data = await joined;
  seat.id = data.playerId;
  seat.room = data.room;
  return seat;
}
const scope = room => ({matchId:room.gameState.matchId, roundId:room.gameState.roundId, cueId:room.gameState.audio?.cueId});
const pct = (array, fraction) => array.length ? [...array].sort((a,b) => a-b)[Math.max(0,Math.ceil(fraction * array.length)-1)] : null;
async function runTable(size, source) {
  const host = await seat('Listener 1');
  const code = host.room.code;
  const seats = [host];
  for (let i = 1; i < size; i++) seats.push(await seat('Listener ' + (i + 1), code));
  const room = () => host.room;
  const state = () => room().gameState;
  const count = source === 'manual' ? size : 6;
  host.client.emit('update-settings', {mode:'dinner', playbackMode:source, dinnerRounds:count});
  await until(() => room().settings.mode === 'dinner' && room().playbackMode === source, 'settings');
  const startAt = performance.now();
  host.client.emit('start-game');
  host.client.emit('start-game');
  await until(() => state().phase === 'anchor_preview', 'anchors');
  const initialId = state().matchId;
  host.client.emit('skip-anchors', scope(room()));
  let initialReadyMs;
  for (let i = 0; i < count; i++) {
    await until(() => state().phase === 'playing' && ['cueing','awaiting_audio'].includes(state().audio?.status), 'next cue');
    const action = scope(room());
    const speaker = seats.find(s => s.id === state().audio.operatorId);
    await until(() => speaker.room.gameState.audio?.cueId === action.cueId, 'speaker view');
    const audio = speaker.room.gameState.audio;
    if (source === 'licensed') {
      assert.ok(audio.source?.url);
      const fetched = await fetch(base + audio.source.url, {headers:{Range:'bytes=0-2047'}});
      assert.equal(fetched.status,206);
      assert.match(fetched.headers.get('content-type'),/^audio\//);
      assert.equal((await fetched.arrayBuffer()).byteLength,2048);
    } else {
      assert.ok(audio.recording?.sourceUrl);
      assert.ok(seats.filter(s => s !== speaker).every(s => !s.room.gameState.audio?.recording));
    }
    speaker.client.emit('audio-ready', action);
    await until(() => state().audio?.status === 'playing', 'audible acknowledgement');
    if (i === 0) initialReadyMs = Math.round(performance.now()-startAt);
    const eligible = seats.filter(s => state().dinner.eligiblePlayerIds.includes(s.id));
    for (const [index,player] of eligible.entries()) player.client.emit('lock-guess', {...action,position:index % (state().sharedTimeline.length+1)});
    await until(() => state().phase === 'reveal', 'shared reveal');
    assert.equal(Object.keys(state().reveal.dinnerGuesses).length, eligible.length);
    assert.equal(!!state().finalReveal, i === count - 1);
    await wait(240);
    host.client.emit('confirm-reveal', scope(room()));
  }
  await until(() => state().phase === 'game_over', 'results');
  assert.equal(state().result.matchId,initialId);
  assert.ok(state().result.winnerIds.length > 0);
  for (const person of seats) person.client.emit('rematch-consent', {...scope(room()), accept:true});
  await until(() => state().rematchPlayerIds?.length === seats.length, 'rematch consents');
  host.client.emit('start-rematch', {matchId:initialId});
  await until(() => state().phase === 'anchor_preview' && state().matchId !== initialId, 'rematch with a new match ID');
  const bytes = seats.flatMap(s => s.bytes);
  assert.deepEqual(seats.flatMap(s => s.errors),[]);
  return {seats:size, source, rounds:count, firstAcknowledgementMs:initialReadyMs, snapshotP95Bytes:pct(bytes,0.95), deliveredSnapshots:bytes.length};
}

try {
  await until(async () => {try {return (await (await fetch(base+'/health')).json()).revision === 'rehearsal';} catch {return false;}}, 'production server');
  const tables = await Promise.all([runTable(2,'manual'),runTable(6,'licensed'),runTable(12,'manual')]);
  const writes = logs.filter(l => l.message === 'Room checkpoint written').map(l => l.durationMs);
  console.log(JSON.stringify({tables, checkpointCount:writes.length, checkpointP50Ms:pct(writes,0.5), checkpointP95Ms:pct(writes,0.95)},null,2));
} finally {
  for (const socket of sockets) socket.disconnect();
  server.kill();
  await closed;
  await rm(dataDir, {recursive:true, force:true, maxRetries:5, retryDelay:100});
}
