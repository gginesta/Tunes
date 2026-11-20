import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import jsQR from 'jsqr';

// Run against a disposable production build and a separate headless Chrome profile.
// See the Browser regression checks section in the README for the launch commands.
const dir = process.argv[2] ?? join(tmpdir(), 'tunes-browser-checks');
const origin = process.env.TUNES_BROWSER_TEST_ORIGIN ?? 'http://127.0.0.1:5199';
const cdp = process.env.TUNES_BROWSER_TEST_CDP ?? 'http://127.0.0.1:9227';
for (const url of [origin, cdp]) {
  const host = new URL(url).hostname;
  assert.ok(host === '127.0.0.1' || host === 'localhost' || host === '[::1]', 'Use loopback fixtures for browser regression checks.');
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const version = await fetch(new URL('/json/version', cdp)).then((res) => res.json());
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, {once:true}); ws.addEventListener('error', reject, {once:true}); });
let nextId = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(Error(msg.error.message));
    else resolve(msg.result);
  }
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
});
function call(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}
await mkdir(dir, { recursive: true });
const contexts = [];
async function newPage(name, width, height, mobile = true, sharedContextId) {
  const browserContextId = sharedContextId ?? (await call('Target.createBrowserContext')).browserContextId;
  if (!sharedContextId) contexts.push(browserContextId);
  const { targetId } = await call('Target.createTarget', {url:'about:blank',browserContextId});
  const { sessionId } = await call('Target.attachToTarget', {targetId,flatten:true});
  const send = (method, params) => call(method, params, sessionId);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.tunesTestAudio = [];
    window.Audio = new Proxy(window.Audio, {
      construct(Audio, args) {
        const element = Reflect.construct(Audio, args);
        window.tunesTestAudio.push(element);
        return element;
      },
    });
  ` });
  const evaluate = async (expression, userGesture = false) => {
    const answer = await send('Runtime.evaluate', { expression, returnByValue:true, awaitPromise:true, userGesture });
    if (answer.exceptionDetails) throw Error(answer.exceptionDetails.exception?.description ?? answer.exceptionDetails.text);
    return answer.result.value;
  };
  const waitFor = async (expression, label = expression) => {
    for (let i=0;i<90;i++) {
      try { if (await evaluate(expression)) return; } catch {}
      await pause(100);
    }
    throw Error(name + ' timed out: ' + label + '\n' + (await evaluate('document.body?.innerText')).slice(0, 2100));
  };
  const text = async (fragment) => waitFor('document.body.innerText.includes(' + JSON.stringify(fragment) + ')', fragment);
  const click = async (label) => {
    const find = 'Array.from(document.querySelectorAll("button")).find(b => b.innerText.trim() === ' + JSON.stringify(label) + ' && !b.disabled)';
    await waitFor('Boolean(' + find + ')', 'clickable ' + label);
    await evaluate(find + '.click()');
  };
  const tap = async (label) => {
    const find = 'Array.from(document.querySelectorAll("button")).find(b => b.innerText.trim() === ' + JSON.stringify(label) + ' && !b.disabled)';
    await waitFor('Boolean(' + find + ')', 'tappable ' + label);
    const point = await evaluate('(()=>{const b=' + find + '; b.scrollIntoView({block:"center"});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
    await send('Input.dispatchMouseEvent', { ...point, type: 'mousePressed', button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { ...point, type: 'mouseReleased', button: 'left', clickCount: 1 });
  };
  const clickCss = async (selector) => {
    const q = 'document.querySelector(' + JSON.stringify(selector) + ')';
    await waitFor('Boolean(' + q + ')', selector);
    await evaluate(q + '.click()');
  };
  const fill = async (selector, value) => {
    await evaluate('(()=>{ const e = document.querySelector(' + JSON.stringify(selector) + '); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,' + JSON.stringify(value) + '); e.dispatchEvent(new Event("input",{bubbles:true})); })()');
  };
  const setSelect = async (label, value) => {
    const find = 'Array.from(document.querySelectorAll("label")).find(e=>e.childNodes[0].textContent.trim()===' + JSON.stringify(label) + ')?.querySelector("select")';
    await waitFor('Boolean(' + find + ')', label);
    await evaluate('(()=>{const s=' + find + ';s.value=' + JSON.stringify(value) + ';s.dispatchEvent(new Event("change",{bubbles:true}));})()');
  };
  const open = async (path = '/') => {
    await send('Page.navigate', {url:origin + path});
    await waitFor('document.readyState === "complete" && Boolean(document.querySelector("#stage-name, .tunes-lobby, .tunes-game"))', 'page loaded');
  };
  const fit = async (label) => {
    const dimensions = await evaluate('({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth, shell: document.querySelector("main").scrollWidth })');
    assert.ok(dimensions.document <= dimensions.viewport + 1, name + ' horizontal overflow ' + label + ' ' + JSON.stringify(dimensions));
    const tiny = await evaluate('Array.from(document.querySelectorAll(".tunes-button, .tunes-gap")).filter(b=>b.getBoundingClientRect().height > 0 && b.getBoundingClientRect().height < 43.5).map(b=>b.innerText || b.ariaLabel)');
    assert.deepEqual(tiny, [], name + ' small main touch targets ' + label);
  };
  const snap = async (base) => {
    await evaluate('document.fonts.ready.then(()=>true)');
    await evaluate('window.scrollTo(0,0)');
    const { data } = await send('Page.captureScreenshot', {format:'png',captureBeyondViewport:false,fromSurface:true});
    await writeFile(join(dir, base + '.png'), Buffer.from(data,'base64'));
  };
  const decodeQr = async () => {
    const clip = await evaluate('(()=>{ const r=document.querySelector(".tunes-qr").getBoundingClientRect(); return {x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height,scale:1}; })()');
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true, fromSurface: true });
    const pixels = await evaluate(`(async()=>{
      const img = new Image();
      img.src = 'data:image/png;base64,${data}';
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return { width: img.width, height: img.height, data: Array.from(ctx.getImageData(0, 0, img.width, img.height).data) };
    })()`);
    return jsQR(Uint8ClampedArray.from(pixels.data), pixels.width, pixels.height)?.data;
  };
  return { name, browserContextId, evaluate, waitFor, text, click, tap, clickCss, fill, setSelect, open, fit, snap, decodeQr, send };
}

const host = await newPage('host',390,844);
const guest = await newPage('guest',320,780);
const third = await newPage('third',390,844);
const desktop = await newPage('desktop',1180,850,false);
const roomCode = (page) => page.evaluate('document.querySelector(".tunes-room-code").innerText.trim()');
const spotifyFixture = process.env.TUNES_BROWSER_TEST_SPOTIFY_FIXTURE === '1';
const noExternalSpotifyLink = '!Array.from(document.links).some(link => link.hostname === "tunes.buzzrounds.com")';
const spotifyConnectButton = 'Array.from(document.querySelectorAll("button")).some(button => button.innerText.trim() === "Connect Spotify")';

async function verifySpotifyControls(page, { lobbyHost = false, homeHost = false } = {}) {
  assert.equal(await page.evaluate(noExternalSpotifyLink), true, page.name + ' has no outgoing Classic link');
  if (spotifyFixture && lobbyHost) await page.waitFor(spotifyConnectButton, 'native Spotify connect button');
  else assert.equal(await page.evaluate(spotifyConnectButton), false, page.name + ' native Spotify connect button count');
  if (!spotifyFixture && lobbyHost) await page.text('Spotify playback isn’t enabled for this room.');
  if (!spotifyFixture && homeHost) await page.text('Spotify playback isn’t enabled here.');
  if (spotifyFixture && homeHost) await page.text('connect Spotify in the lobby');
}

async function verifySpotifyInRoom(page, guest, code) {
  await verifySpotifyControls(page, {lobbyHost:true});
  if (!spotifyFixture) return;
  await page.evaluate(`(() => {
    const fetchOriginal = window.fetch;
    window.fetch = (input, options) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.origin);
      if (!/(^|\\.)spotify\\.com$|(^|\\.)scdn\\.co$/.test(url.hostname)) return fetchOriginal(input, options);
      if (url.href !== 'https://accounts.spotify.com/api/token') throw Error('Unexpected Spotify fixture request ' + url.pathname);
      const body = options.body;
      if (body.get('code') !== 'browser-fixture-code' || body.get('grant_type') !== 'authorization_code' ||
        body.get('redirect_uri') !== location.origin + '/callback.html' || body.get('code_verifier')?.length !== 64) {
        throw Error('Unexpected Spotify token request');
      }
      return Promise.resolve(new Response(JSON.stringify({access_token:'fixture-access', refresh_token:'fixture-refresh', expires_in:3600})));
    };
    window.tunesTestSpotifyApprove = false;
    window.open = (url) => {
      if (url !== 'about:blank') throw Error('Unexpected Spotify popup URL');
      const popup = {
        closed: false,
        close() { this.closed = true; },
        location: {replace(raw) {
          const authorization = new URL(raw);
          const params = authorization.searchParams;
          if (authorization.origin !== 'https://accounts.spotify.com' || params.get('code_challenge_method') !== 'S256' ||
              params.get('redirect_uri') !== location.origin + '/callback.html' || params.get('state')?.length !== 64) {
            throw Error('Unexpected Spotify authorization request');
          }
          const result = window.tunesTestSpotifyApprove ? {code:'browser-fixture-code'} : {error:'access_denied'};
          window.dispatchEvent(Object.assign(new Event('message'), {
            origin:location.origin, source:popup, data:{type:'tunes:spotify:code', state:params.get('state'), ...result},
          }));
        }},
      };
      return popup;
    };
  })()`);
  await page.click('Connect Spotify');
  await page.text('Spotify sign-in was cancelled or denied.');
  await page.text('Rotating DJ');
  assert.equal(await roomCode(page), code);
  assert.equal(await roomCode(guest), code);
  await page.evaluate('window.tunesTestSpotifyApprove = true');
  await page.click('Customize');
  await page.setSelect('Music source', 'spotify');
  await page.text('Spotify connected on this device.');
  await guest.waitFor('Array.from(document.querySelectorAll(".tunes-pill")).some(pill => pill.innerText.trim() === "Spotify")');
  assert.equal(await roomCode(page), code);
  assert.equal(await roomCode(guest), code);
  assert.equal(await page.decodeQr(), origin + '/join/' + code);
  await page.text('Ella');
  assert.equal(await page.evaluate('document.querySelector("select option[value=spotify]").selected'), true);
  await page.waitFor('Array.from(document.querySelectorAll("button")).some(button => button.innerText.trim() === "Start Classic" && !button.disabled)', 'signed-in speaker can start');
  await page.click('Forget Spotify on this device');
  await page.text('Reconnect Spotify on this device or choose another music source to start.');
  await page.open();
  await page.text('Invite the table');
  await page.text('Reconnect Spotify on this device or choose another music source to start.');
  assert.equal(await page.evaluate('Array.from(document.querySelectorAll("button")).find(button => button.innerText.trim() === "Start Classic")?.disabled'), true);
  assert.equal(await roomCode(page), code);
  assert.equal(await roomCode(guest), code);
  await page.click('Customize');
  assert.equal(await page.evaluate('document.querySelector("select option[value=spotify]").selected'), true);
  await page.setSelect('Music source', 'manual');
  await page.text('Rotating DJ');
  await page.click('Customize');
}

const joinGuest = async (page, code, name) => {
  await page.open('/join/' + code);
  await page.text('Find your table');
  await verifySpotifyControls(page);
  assert.equal(await page.evaluate('document.querySelectorAll("form input")[1].value'), code);
  await page.fill('#stage-name', name);
  await page.click('Join room');
  await page.text('Invite the table');
};
const chooser = 'button.tunes-gap:not([aria-disabled="true"])';
const operator = async () => {
  for (let i=0;i<45;i++) {
    for (const page of [host, guest, third]) {
      if (await page.evaluate('Boolean(Array.from(document.querySelectorAll("button")).find(b=>b.innerText.trim()==="Music is playing" && !b.disabled))')) return page;
    }
    await pause(100);
  }
  throw Error('No manual DJ cue');
};
async function verifyTabRecovery() {
  const legacy = await newPage('legacy seed',390,844);
  await legacy.open();
  await legacy.waitFor('Boolean(document.querySelector(".tunes-button-primary:not(:disabled)"))', 'seed tab connected before writing the old seat');
  await legacy.evaluate(`(() => {
    localStorage.setItem('tunes_room', 'OLDD');
    localStorage.setItem('tunes_player', 'legacy-public-seat');
    localStorage.setItem('tunes_session_ts', String(Date.now()));
  })()`);
  const legacyTab = await newPage('legacy fresh tab',390,844,true,legacy.browserContextId);
  await legacyTab.open();
  await legacyTab.text('Find your table');
  await legacyTab.waitFor('document.querySelectorAll("form input")[1]?.value === "OLDD"', 'legacy room code preserved');
  assert.equal(await legacyTab.evaluate('localStorage.getItem("tunes_player")'), null);

  const original = await newPage('original active tab',390,844);
  await original.open();
  await original.fill('#stage-name','Returning host');
  await original.click('Host a room');
  await original.text('Invite the table');
  const code = await roomCode(original);
  const replacement = await newPage('replacement active tab',390,844,true,original.browserContextId);
  await replacement.open();
  await replacement.text('Invite the table');
  assert.equal(await roomCode(replacement),code);
  await original.text('This seat moved to another connection.');
  await original.waitFor('Boolean(document.querySelector(".tunes-button-resume:not(:disabled)"))', 'old tab connected without taking the seat back');
  await original.send('Page.bringToFront');
  await pause(250);
  assert.equal(await replacement.evaluate('Boolean(document.querySelector(".tunes-lobby"))'),true);
  await original.click('Resume your table\nSaved seat · ' + code);
  await original.text('Invite the table');
  await replacement.text('This seat moved to another connection.');
}

try {
  await verifyTabRecovery();
  await desktop.open();
  await desktop.fit('desktop home');
  await desktop.snap('01-desktop-home');
  await host.open();
  await host.text('Drop the');
  await verifySpotifyControls(host, {homeHost:true});
  await host.fit('390 home');
  await host.snap('02-mobile-home');
  await host.fill('#stage-name','Guillermo');
  await host.click('Host a room');
  await host.text('Invite the table');
  const code = await roomCode(host);
  assert.match(code, /^[A-Z]{4}$/);
  assert.equal(await host.evaluate('document.querySelector(".tunes-qr svg title")?.textContent'), 'Scan to join room ' + code);
  assert.equal(await host.decodeQr(), origin + '/join/' + code, 'Actual browser QR pixels must decode to the current room invite.');
  await joinGuest(guest, code, 'Ella');
  await third.open();
  await third.click('Join');
  await third.text('Find your table');
  await verifySpotifyControls(third);
  await third.fill('#stage-name', 'Miles');
  await third.evaluate('document.querySelectorAll("form input")[1].focus()');
  await third.send('Input.insertText', { text: origin + '/join/' + code });
  await third.click('Join room');
  await third.text('Invite the table');
  await guest.fit('320 lobby');
  assert.equal(await guest.decodeQr(), origin + '/join/' + code);
  await host.snap('03-mobile-lobby');
  await host.click('Customize');
  await host.click('Dinner Set\nEveryone guesses, then the table reveals together.');
  await host.waitFor('document.querySelector(".tunes-lobby").dataset.mode === "dinner"');
  await guest.waitFor('document.querySelector(".tunes-lobby").dataset.mode === "dinner"');
  await verifySpotifyControls(host);
  await verifySpotifyControls(guest);
  await host.setSelect('Length', '3');
  await host.text('3 songs');
  await host.click('Start Dinner Set');
  const dj = await operator();
  const players = [host, guest, third];
  const startingGuessers = players.filter(p => p !== dj);
  await dj.text('Private DJ cue');
  await dj.snap('04-private-dj');
  for (const person of startingGuessers) {
    await person.text('Your DJ is choosing the song');
    assert.equal(await person.evaluate('document.body.innerText.includes("Private DJ cue")'), false);
  }
  await dj.click('Music is playing');
  const [first, second] = startingGuessers;
  await first.text('Find the gap');
  assert.equal(await first.evaluate('getComputedStyle(document.querySelector(".tunes-record-live .tunes-record-disc")).animationName'), 'none');
  await first.evaluate('document.documentElement.style.fontSize = "24px"');
  await first.fit('dinner play with large text');
  await first.snap('05-large-type');
  await first.evaluate('document.documentElement.style.fontSize = ""');
  await first.clickCss(chooser);
  const firstGap = await first.evaluate('document.querySelector("button.tunes-gap[aria-pressed=true]").ariaLabel');
  assert.match(firstGap, /Before|Between|After/);
  await first.snap('06-dinner-select');
  await first.click('Lock guess');
  await first.text('Guess locked');
  await second.text('1 of 2 guesses locked');
  assert.equal(await second.evaluate('document.querySelectorAll("button.tunes-gap[aria-pressed=true]").length'), 0);
  await first.send('Page.reload', {});
  await first.text('Guess locked');
  await first.fit('rejoined locked guess');
  await second.text('Find the gap');
  await second.clickCss(chooser);
  await second.click('Lock guess');
  await host.text('The reveal');
  await host.text('The table’s picks');
  await host.snap('07-shared-reveal');
  for (let number = 2; number <= 3; number++) {
    await host.click('Continue');
    const nextDJ = await operator();
    await nextDJ.click('Music is playing');
    for (const player of players.filter(p => p !== nextDJ)) {
      await player.clickCss(chooser);
      await player.click('Lock guess');
    }
    await host.text('The reveal');
  }
  await host.click('See results');
  await host.text('Final scores');
  await host.snap('08-dinner-results');
  await host.click('Save table');
  await host.fill('dialog input', 'Visual QA table');
  await host.evaluate('document.querySelector("dialog form").requestSubmit()');
  await host.text('Visual QA table');
  await host.click('I’m in for a rematch');
  await guest.click('I’m in for a rematch');
  await host.click('Start rematch');
  await operator();
  assert.equal(await host.evaluate('document.querySelector(".tunes-pill-room").textContent'), 'Room ' + code);
  await host.click('Leave');
  await host.click('Leave table');
  await host.text('Set the table');
  await host.text('Saved tables');
  await guest.click('Leave');
  await guest.click('Leave table');
  await guest.text('Set the table');

  await host.click('Host a room');
  await host.text('Invite the table');
  const classicCode = await roomCode(host);
  await joinGuest(guest, classicCode, 'Ella');
  await host.text('Ella');
  await verifySpotifyControls(guest);
  await verifySpotifyInRoom(host, guest, classicCode);
  assert.equal(await roomCode(host), classicCode);
  assert.equal(await roomCode(guest), classicCode);
  await host.text('Ella');
  await host.click('Customize');
  await host.click('Classic Expert\nPlace the card, name it and pin down the year.');
  await host.click('Start Classic Expert');
  const classicDJ = await operator();
  await classicDJ.click('Music is playing');
  const guesser = classicDJ === host ? guest : host;
  await guesser.text('Find the gap');
  await guesser.fill('form input:nth-of-type(1)', 'Example title');
  await guesser.evaluate('(()=>{const field=Array.from(document.querySelectorAll("form input"))[1]; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(field,"Example artist"); field.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await guesser.click('Submit name');
  await guesser.text('Enter a four-digit release year.');
  assert.equal(await guesser.evaluate('document.activeElement?.inputMode'), 'numeric');
  await guesser.fit('expert input at mobile width');
  await guesser.snap('09-expert-year-validation');

  for (const page of [host, guest]) {
    await page.click('Leave');
    await page.click('Leave table');
    await page.text('Set the table');
  }
  await host.click('Host a room');
  await host.text('Invite the table');
  const automatedCode = await roomCode(host);
  await joinGuest(guest, automatedCode, 'Ella');
  await host.click('Customize');
  await host.setSelect('Music source', 'independent-instrumentals');
  await host.text('Automatic music');
  await host.send('Page.bringToFront');
  await host.tap('Start Classic');
  const advances = 'window.tunesTestAudio.some(a=>a.currentTime>0.15 && !a.paused && a.src.includes("/listening/"))';
  const maybeStart = async (page) => {
    await page.waitFor('document.body.innerText.includes("Play music") || document.body.innerText.includes("Now playing")', 'speaker cue or audible round');
    if (await page.evaluate('document.body.innerText.includes("Play music")')) await page.tap('Play music');
    await page.waitFor(advances, 'actual automatic clip advances');
  };
  await maybeStart(host);
  const source = await host.evaluate('window.tunesTestAudio.find(a=>!a.paused).src');
  const simulateBackground = '(value)=>{Object.defineProperty(document,"hidden",{configurable:true,value});document.dispatchEvent(new Event("visibilitychange"))}';
  await host.evaluate('(' + simulateBackground + ')(true)');
  await guest.text('Table paused');
  assert.equal(await host.evaluate('window.tunesTestAudio.every(a=>a.paused)'), true);
  await host.evaluate('(' + simulateBackground + ')(false)');
  await host.tap('Resume music');
  await maybeStart(host);
  assert.equal(await host.evaluate('window.tunesTestAudio.find(a=>!a.paused).src'), source);
  await host.tap('Pause the table');
  await host.text('Table paused');
  const guestId = await host.evaluate('Array.from(document.querySelectorAll("select option")).find(o=>o.textContent==="Ella").value');
  await host.setSelect('Use another speaker', guestId);
  await host.click('Hand off');
  await guest.send('Page.bringToFront');
  await maybeStart(guest);
  assert.equal(await guest.evaluate('window.tunesTestAudio.find(a=>!a.paused).src'), source);
  assert.equal(await host.evaluate('window.tunesTestAudio.every(a=>a.paused)'), true);
  await guest.snap('10-automatic-speaker-handoff');
  const active = await host.evaluate('Boolean(document.querySelector("button.tunes-gap"))') ? host : guest;
  const opponent = active === host ? guest : host;
  await active.clickCss(chooser);
  await active.click('Confirm placement');
  await opponent.click('Pass');
  await active.click('Done guessing');
  await host.text('The reveal');
  await host.text('Recording source');
  assert.equal(await guest.evaluate('window.tunesTestAudio.every(a=>a.paused)'), true);
  assert.equal(await guest.evaluate('Array.from(document.querySelectorAll("button")).some(b=>b.innerText.trim()==="End match")'), false);
  await host.click('End match');
  await host.clickCss('dialog .tunes-button-primary');
  await host.text('Match ended early');
  await guest.text('Match ended early');
  assert.equal(await host.evaluate('document.querySelectorAll(".tunes-podium [data-leader]").length'), 0);
  assert.deepEqual(errors, []);
  const spotifyCheck = spotifyFixture ? 'same-room Spotify sign-in and cancellation' : 'unconfigured Spotify availability';
  process.stdout.write(`PASS responsive layout, reduced motion, QR and pasted invites, legacy and replaced tabs, Dinner guess recovery and rematch, saved tables, ${spotifyCheck}, Expert year validation, automatic music handoff, and abandoned results.\n`);
} finally {
  await Promise.allSettled(contexts.map((browserContextId) => call('Target.disposeBrowserContext', { browserContextId })));
  ws.close();
}
