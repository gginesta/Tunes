// Two seats, the normal UI, a real OAuth popup and a locally simulated Spotify device.
// Every remote origin is intercepted. No Spotify account, token or recording is used.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {io} from 'socket.io-client';
import {build, preview} from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = await mkdtemp(join(tmpdir(),'tunes-spotify-room-'));
const app = join(root,'app');
const clientId = 'd'.repeat(32);
const local = '127.0.0.1';
async function freePort() {
  const server = createServer().listen(0,local);
  await new Promise(resolve => server.once('listening',resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function until(fn, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await delay(50);
  }
  throw new Error('Timed out waiting for ' + label);
}
const sdk = '(' + function installPlayer() {
  class Player {
    constructor(options) {
      this.options = options;
      this.listeners = {};
      this.state = null;
      window.tableTestDevice = this;
    }
    addListener(event, callback) { this.listeners[event] = callback; }
    activateElement() { return Promise.resolve(); }
    setVolume() { return Promise.resolve(); }
    async connect() {
      await new Promise(resolve => this.options.getOAuthToken(resolve));
      this.listeners.ready({device_id:'isolated-browser-speaker'});
      return true;
    }
    async pause() {
      if (this.state) {
        this.state = {...this.state, paused:true};
        this.listeners.player_state_changed(this.state);
      }
    }
    getCurrentState() { return Promise.resolve(this.state); }
    confirm(trackId) {
      this.state = {paused:false, position:350, duration:180000, track_window:{current_track:{id:trackId}}};
      this.listeners.player_state_changed(this.state);
    }
    disconnect() { this.state = null; }
  }
  window.Spotify = {Player};
  window.onSpotifyWebPlaybackSDKReady();
}.toString() + ')();';

let processServer, web, browser, guest;
const serverErrors = [];
try {
  const recordings = JSON.parse(await readFile(join(root,'data/manual-recordings.json'),'utf8'));
  const tracks = recordings.slice(0,48).map((s,i)=>({recordingId:s.recordingId, spotifyTrackId:String(i+1).padStart(22,'0')}));
  const manifest = join(fixture,'tracks.json');
  await writeFile(manifest,JSON.stringify({tracks}));
  const port = await freePort();
  const frontPort = await freePort();
  const backend = 'http://' + local + ':' + port;
  const origin = 'http://' + local + ':' + frontPort;
  const callback = origin + '/callback.html';
  processServer = spawn(process.execPath, ['server/dist/index.js'], {cwd:root, windowsHide:true,
    env:{...process.env,PORT:String(port),DATA_DIR:fixture,TUNES_BIND_HOST:local,ALLOWED_ORIGINS:origin,
      NODE_ENV:'production',TUNES_SPOTIFY_CLASSIC_ENABLED:'true',TUNES_SPOTIFY_MANIFEST:manifest,LOG_LEVEL:'warn'}});
  processServer.stdout.resume();
  processServer.stderr.on('data', chunk => serverErrors.push(String(chunk)));
  await until(async () => {try{return (await fetch(backend+'/health')).ok;}catch{return false;}}, 'isolated server');

  const outDir = join(fixture,'ui');
  await build({root:app,logLevel:'error',define:{
    'import.meta.env.VITE_SPOTIFY_CLIENT_ID':JSON.stringify(clientId),
    'import.meta.env.VITE_SPOTIFY_REDIRECT_URI':JSON.stringify(callback),
    'import.meta.env.VITE_SERVER_URL':JSON.stringify(backend),
  },build:{outDir,emptyOutDir:true}});
  web = await preview({root:app,logLevel:'error',build:{outDir},preview:{host:local,port:frontPort,strictPort:true}});
  browser = await chromium.launch({channel:'chrome',headless:true,
    args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
  const context = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  const calls = [];
  const errors = [];
  let challenge, roundTrack, tokenExchanges=0, refreshes=0, authorizations=0;
  const cors = {'access-control-allow-origin':origin,'access-control-allow-methods':'GET,POST,PUT,OPTIONS',
    'access-control-allow-headers':'authorization,content-type','cache-control':'no-store'};
  await context.route('**/*',async route => {
    const request = route.request(), url = new URL(request.url());
    try {
      if ([origin,backend].includes(url.origin)) return route.continue();
      if (request.method()==='OPTIONS') return route.fulfill({status:204,headers:cors});
      if (url.origin==='https://accounts.spotify.com' && url.pathname==='/authorize') {
        assert.equal(url.searchParams.get('redirect_uri'),callback);
        assert.equal(url.searchParams.get('client_id'),clientId);
        assert.equal(url.searchParams.get('code_challenge_method'),'S256');
        challenge=url.searchParams.get('code_challenge');
        const state=url.searchParams.get('state');
        assert.ok(state && challenge);
        authorizations++;
        const dest=callback+'?'+new URLSearchParams({code:'test-only-code',state});
        return route.fulfill({contentType:'text/html',body:'<script>location.replace('+JSON.stringify(dest)+')</script>'});
      }
      if (url.origin==='https://accounts.spotify.com' && url.pathname==='/api/token') {
        const params=new URLSearchParams(request.postData());
        if (params.get('grant_type')==='authorization_code') {
          assert.equal(params.get('code'),'test-only-code');
          assert.equal(createHash('sha256').update(params.get('code_verifier')).digest('base64url'),challenge);
          tokenExchanges++;
        } else {
          assert.equal(params.get('grant_type'),'refresh_token');
          assert.equal(params.get('refresh_token'),'test-only-refresh');
          refreshes++;
        }
        return route.fulfill({headers:cors,json:{access_token:'test-only-access',refresh_token:'test-only-refresh',expires_in:3600}});
      }
      if (url.origin==='https://sdk.scdn.co' && url.pathname==='/spotify-player.js')
        return route.fulfill({contentType:'text/javascript',body:sdk});
      if (url.origin==='https://api.spotify.com' && url.pathname==='/v1/me/player/play') {
        assert.equal(url.searchParams.get('device_id'),'isolated-browser-speaker');
        assert.equal(request.headers().authorization,'Bearer test-only-access');
        const track=request.postDataJSON().uris[0].split(':')[2];
        assert.ok(tracks.some(t=>t.spotifyTrackId===track));
        calls.push(track);
        return route.fulfill({status:204,headers:cors});
      }
      throw new Error('Unexpected browser request to '+url.origin+url.pathname);
    } catch (error) {
      errors.push(error.message);
      await route.abort();
    }
  });
  const host=await context.newPage();
  host.on('pageerror',error=>errors.push(error.message));
  await host.goto(origin);
  await host.getByLabel('Stage name').fill('Test host');
  await host.getByRole('button',{name:'Host a room',exact:true}).click();
  const code=(await host.locator('.tunes-room-code').textContent()).trim();
  const hostId=await host.evaluate(()=>localStorage.getItem('tunes_player'));
  assert.ok(hostId);
  const views=[];
  guest=io(backend,{transports:['websocket'],forceNew:true,reconnection:false,autoConnect:false});
  guest.on('state-sync',room=>views.push(room));
  const joined=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Guest join timed out')),10000);
    guest.once('room-joined',data=>{clearTimeout(timer);resolve(data);});
  });
  guest.once('connect',()=>guest.emit('join-room',{code,playerName:'Test guest'}));
  guest.connect();
  await joined;
  await host.getByRole('button',{name:'Connect Spotify',exact:true}).click();
  await until(()=>views.at(-1)?.playbackMode==='spotify','same-room Spotify selected');
  assert.equal(tokenExchanges,1);
  assert.equal(new URL(host.url()).origin,origin);
  assert.equal(views.at(-1).code,code);
  await host.getByRole('button',{name:'Start Classic',exact:true}).click();
  await until(()=>calls.length>0,'first automatic track request');
  roundTrack=calls.at(-1);
  const state=()=>views.at(-1).gameState;
  assert.equal(state().audio.status,'awaiting_audio');
  assert.equal(state().timing.deadline,null);
  assert.equal(state().audio.source,undefined);
  assert.equal(state().currentSong,null);
  const {matchId,roundId}=state();
  await host.evaluate(id=>window.tableTestDevice.confirm(id),roundTrack);
  await until(()=>state().audio.status==='playing','SDK confirmation before the clock starts');
  await host.evaluate(()=>{
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await until(()=>state().audio.status==='paused','phone background pause');
  const frozen=state().timing.remainingMs;
  assert.ok(frozen>0);
  const deckSize=state().deckSize;
  const turnOwner=state().currentTurnPlayerId;
  await host.reload();
  const resume=host.getByRole('button',{name:'Resume music',exact:true});
  await resume.waitFor({timeout:15000});
  assert.equal(state().timing.deadline,null);
  assert.equal(state().timing.remainingMs,frozen);
  assert.equal(state().matchId,matchId);
  assert.equal(state().roundId,roundId);
  assert.equal(state().deckSize,deckSize);
  assert.equal(state().currentTurnPlayerId,turnOwner);
  assert.equal(views.at(-1).code,code);
  assert.equal(await host.evaluate(()=>localStorage.getItem('tunes_player')),hostId);
  const before=calls.length;
  await resume.click();
  await until(()=>calls.length>before,'resume track on returned speaker');
  assert.equal(calls.at(-1),roundTrack);
  await host.evaluate(id=>window.tableTestDevice.confirm(id),roundTrack);
  await until(()=>state().audio.status==='playing','confirmed music after refresh');
  assert.equal(authorizations,1);
  assert.ok(refreshes>=1);
  assert.ok(views.every(v=>!JSON.stringify(v).includes('test-only-')));
  assert.deepEqual(errors,[]);
  console.log('PASS same-room PKCE, two seats, device-confirmed start, pause, reload, token refresh and same-track resume (simulated Spotify).');
} finally {
  guest?.disconnect();
  await browser?.close();
  if (web) await web.close();
  if (processServer && processServer.exitCode===null) {
    const stopped=new Promise(resolve=>processServer.once('exit',resolve));
    processServer.kill();
    await stopped;
  }
  if (serverErrors.length) process.stderr.write(serverErrors.join('').slice(-1000));
  await rm(fixture,{recursive:true,force:true,maxRetries:4,retryDelay:100});
}
