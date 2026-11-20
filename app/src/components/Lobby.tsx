import { useEffect, useState } from 'react';
import { BookOpen, Check, ChevronDown, Copy, Headphones, Play, Share2, SlidersHorizontal, Users, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { getDinnerRoundCount, MIN_PLAYERS, type GameMode, type GameSettings, type PlaybackMode, type SongGenre, type SongRegion } from '@tunes/shared';
import { getSocket, leaveTable } from '../services/socket';
import { disconnectSpotifySpeaker } from '../services/tableAudio';
import { hasTableSpotifyCredential } from '../services/tableSpotifyCredential';
import { useSpotifyClassic } from '../hooks/useSpotifyClassic';
import { useGameStore } from '../store';
import { appPath } from '../paths';
import { Brand, Message, MODE_NAMES, WorkedExample } from './TableUi';

const MODES: { id: GameMode; help: string }[] = [
  { id: 'original', help: 'Take turns building your own timeline.' },
  { id: 'dinner', help: 'Everyone guesses, then the table reveals together.' },
  { id: 'pro', help: 'Place the card and name the song and artist.' },
  { id: 'expert', help: 'Place the card, name it and pin down the year.' },
  { id: 'coop', help: 'Build one timeline together.' },
];

const DECADES = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020];
const GENRES: { value: SongGenre; label: string }[] = [
  { value: 'rock', label: 'Rock' },
  { value: 'pop', label: 'Pop' },
  { value: 'hip-hop', label: 'Hip-hop' },
  { value: 'r-and-b', label: 'R&B' },
  { value: 'country', label: 'Country' },
  { value: 'electronic', label: 'Electronic' },
  { value: 'jazz', label: 'Jazz' },
  { value: 'latin', label: 'Latin' },
];
const REGIONS: { value: SongRegion; label: string }[] = [
  { value: 'uk', label: 'UK' },
  { value: 'latin', label: 'Latin' },
  { value: 'kpop', label: 'K-pop' },
  { value: 'bollywood', label: 'Bollywood' },
];

function toggled<T>(values: T[] | undefined, value: T) {
  const current = values ?? [];
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}

function InviteBlock({ code }: { code: string }) {
  const link = new URL(appPath(`join/${code}`), window.location.origin).href;
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  async function share() {
    if (!navigator.share) return copy();
    try {
      await navigator.share({ title: 'Join my Tunes table', text: `Room code ${code}`, url: link });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) await copy();
    }
  }

  return (
    <section className="tunes-panel tunes-invite" aria-labelledby="invite-title">
      <div className="tunes-invite-top">
        <div className="tunes-qr"><QRCodeSVG value={link} size={112} marginSize={4} title={`Scan to join room ${code}`} /></div>
        <div>
          <h2 id="invite-title">Invite the table</h2>
          <p className="tunes-room-code" aria-label={`Room code ${code.split('').join(' ')}`}>{code}</p>
          <p className="tunes-muted">Scan the QR or enter this code.</p>
        </div>
      </div>
      <div className="tunes-inline">
        <button className="tunes-button tunes-button-secondary" onClick={() => void copy()}>
          {copyState === 'copied' ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}
          {copyState === 'copied' ? 'Link copied' : 'Copy link'}
        </button>
        {typeof navigator.share === 'function' && <button className="tunes-button tunes-button-secondary" onClick={() => void share()}><Share2 size={17} aria-hidden="true" /> Share</button>}
      </div>
      {copyState === 'failed' && <label className="tunes-field">Invitation link<input readOnly value={link} onFocus={(event) => event.currentTarget.select()} /></label>}
      <span className="sr-only" role="status">{copyState === 'copied' ? 'Invitation link copied' : ''}</span>
    </section>
  );
}

export function Lobby() {
  const room = useGameStore((s) => s.room);
  const connected = useGameStore((s) => s.connected);
  const myId = useGameStore((s) => s.myId);
  const error = useGameStore((s) => s.error);
  const notice = useGameStore((s) => s.notice);
  const startProgress = useGameStore((s) => s.startProgress);
  const licensedPacks = useGameStore((s) => s.licensedPacks);
  const dinnerAvailable = useGameStore((s) => s.dinnerAvailable);
  const hasSpotifyGrant = useGameStore((s) => !!s.room && hasTableSpotifyCredential(s.room.code, s.myId));
  const spotify = useSpotifyClassic();
  const [customize, setCustomize] = useState(false);
  const [showExample, setShowExample] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => { if (error || !connected) setStarting(false); }, [error, connected]);
  useEffect(() => { if (startProgress === null) setStarting(false); }, [startProgress]);

  useEffect(() => {
    if (!starting) return;
    const id = window.setTimeout(() => {
      setStarting(false);
      if (!useGameStore.getState().error) useGameStore.getState().setError('The room is taking a while to start. Try again.');
    }, 25_000);
    return () => window.clearTimeout(id);
  }, [starting]);

  if (!room) return null;
  const { code, hostId, players, settings, playbackMode } = room;
  const availability = room.startAvailability;
  const playerList = Object.values(players);
  const online = playerList.filter((player) => player.connected);
  const isHost = myId === hostId;
  const manual = playbackMode === 'manual' || !playbackMode;
  const isDinner = settings.mode === 'dinner';
  const spotifySelected = playbackMode === 'spotify';
  const speakerId = room.speakerId && players[room.speakerId]?.connected ? room.speakerId : hostId;
  const needsSpotifyGrant = spotifySelected && speakerId === myId && (!spotify.available || !hasSpotifyGrant);
  const canChooseSpotify = spotify.available && !isDinner && (!spotifySelected || !hasSpotifyGrant);
  const spotifyAction = hasSpotifyGrant ? 'Use Spotify' : spotifySelected ? 'Reconnect Spotify' : 'Connect Spotify';
  const dedicated = manual && !!settings.dedicatedDjId;
  const requiredSeats = dedicated ? MIN_PLAYERS + 1 : MIN_PLAYERS;
  const eligible = online.filter((player) => !dedicated || player.id !== settings.dedicatedDjId);
  const rotationSize = Math.max(1, eligible.length);
  const songCount = getDinnerRoundCount(settings, manual ? 'manual' : playbackMode, eligible.length);
  const isPreparing = starting || !!startProgress;

  function update(values: Partial<GameSettings> & { playbackMode?: PlaybackMode }) {
    const socket = getSocket();
    if (socket.connected) socket.emit('update-settings', values);
  }

  async function selectSpotify() {
    if (!spotify.available || !connected || isPreparing || !isHost || isDinner) return;
    if (!hasSpotifyGrant && !await spotify.connect(code, myId)) return;
    const current = useGameStore.getState();
    if (current.room?.code === code && current.myId === myId && current.room.hostId === myId &&
      current.room.settings.mode !== 'dinner' && current.room.gameState.phase === 'lobby') {
      if (current.room.playbackMode !== 'spotify' || current.room.speakerId !== myId) {
        update({ playbackMode: 'spotify' });
      }
    }
  }

  function start() {
    const socket = getSocket();
    if (!socket.connected || starting || needsSpotifyGrant || spotify.pending) return;
    useGameStore.getState().setError(null);
    setStarting(true);
    socket.emit('start-game');
  }

  const modeHelp = MODES.find((mode) => mode.id === settings.mode)?.help;
  const connectedWord = `${online.length} ${online.length === 1 ? 'person' : 'people'} ready`;
  return (
    <main className="tunes-shell tunes-lobby" data-mode={isDinner ? 'dinner' : 'classic'}>
      <Brand>
        <span className="tunes-pill tunes-pill-room">Room {code}</span>
        <button className="tunes-link" onClick={leaveTable}>Leave</button>
      </Brand>
      <div className="tunes-page-heading">
        <h1>The table</h1>
        <p>{isHost ? 'Share the invite, then start when everyone is here.' : 'You’re in. The controller starts the game.'}</p>
      </div>
      {!connected && <Message>Reconnecting to room {code}…</Message>}
      {error && <Message kind="error">{error}</Message>}
      {notice && !error && <Message>{notice}</Message>}
      {room.recovery === 'restart-required' && <Message>This older table needs a fresh match. Invite the table and choose Start when everyone is ready.</Message>}
      <div className="tunes-lobby-grid">
        <InviteBlock code={code} />
        <section className="tunes-panel tunes-lobby-options" aria-labelledby="session-title">
          <div className="tunes-row-title">
            <h2 id="session-title">{MODE_NAMES[settings.mode]}</h2>
            {isHost && (
              <button className="tunes-link" type="button" aria-expanded={customize} aria-controls="customize-options" onClick={() => setCustomize((value) => !value)}>
                <SlidersHorizontal size={17} aria-hidden="true" /> Customize <ChevronDown size={14} aria-hidden="true" />
              </button>
            )}
          </div>
          <p className="tunes-muted">{modeHelp}</p>
          <div className="tunes-chip-row">
            <span className="tunes-pill"><Headphones size={16} aria-hidden="true" /> {spotifySelected ? 'Spotify' : manual ? (dedicated ? 'Dedicated DJ' : 'Rotating DJ') : 'Automatic music'}</span>
            <span className="tunes-pill">{isDinner ? `${songCount} songs` : `${settings.cardsToWin} cards to win`}</span>
          </div>
          <div className="tunes-lobby-start" aria-label="Start the game">
            {isHost ? (
              <>
                <button className="tunes-button tunes-button-primary" onClick={start} disabled={!connected || online.length < requiredSeats || (dedicated && !online.some((player) => player.id === settings.dedicatedDjId)) || availability?.ready === false || isPreparing || spotify.pending || needsSpotifyGrant}>
                  <Play size={19} aria-hidden="true" /> {startProgress || (isPreparing ? 'Preparing the pack…' : `Start ${MODE_NAMES[settings.mode]}`)}
                </button>
                {needsSpotifyGrant ? <p className="tunes-muted" role="status">{spotify.available ? 'Reconnect Spotify on this device or choose another music source to start.' : 'Choose another music source to start.'}</p> : availability?.issue ? <p className="tunes-muted" role="status">{availability.issue}</p> : online.length < requiredSeats ? <p className="tunes-muted">You need {requiredSeats} people to start{dedicated ? ' with a dedicated DJ' : ''}.</p> : availability?.ready ? <p className="tunes-muted">{availability.playable} usable recordings in this pack.</p> : null}
                {isPreparing && <button className="tunes-link" disabled={!connected} onClick={() => { getSocket().emit('cancel-start'); setStarting(false); }}>Cancel start</button>}
              </>
            ) : <Message>Waiting for {players[hostId]?.name || 'the controller'} to start.</Message>}
          </div>
          {isHost && (!isDinner || hasSpotifyGrant) && (
            <div className="tunes-spotify-host">
              {hasSpotifyGrant && <>
                <p className="tunes-muted" role="status"><Check size={16} aria-hidden="true" /> Spotify connected on this device.</p>
                <button className="tunes-link" type="button" disabled={!connected || isPreparing || spotify.pending} onClick={() => disconnectSpotifySpeaker(code, myId)}>Forget Spotify on this device</button>
              </>}
              {canChooseSpotify && <>
                <button className="tunes-button tunes-button-secondary" disabled={!connected || isPreparing || spotify.pending} onClick={() => void selectSpotify()}>
                  <Headphones size={18} aria-hidden="true" /> {spotify.pending ? 'Connecting Spotify…' : spotifyAction}
                </button>
                {!hasSpotifyGrant && <p className="tunes-muted">Sign in with Spotify Premium to play music in this room.</p>}
              </>}
              {!isDinner && !spotify.available && <p className="tunes-muted">Spotify playback isn’t enabled for this room.</p>}
              {spotify.error && <Message kind="error">{spotify.error}</Message>}
            </div>
          )}
          {isHost && customize && (
            <div id="customize-options" className="tunes-customize">
              <fieldset className="tunes-fieldset" disabled={!connected || isPreparing || spotify.pending}>
                <legend>Game mode</legend>
                <div className="tunes-choice-grid">
                  {MODES.filter((mode) => mode.id !== 'dinner' || dinnerAvailable || isDinner).map((mode) => (
                    <button type="button" key={mode.id} className="tunes-mode-choice" aria-pressed={settings.mode === mode.id} onClick={() => update({ mode: mode.id })}>
                      <b>{MODE_NAMES[mode.id]}</b><span>{mode.help}{mode.id === 'dinner' && spotifySelected ? ' Switching uses Manual DJ.' : ''}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="tunes-field-grid">
                {!isDinner && (
                  <label className="tunes-field">Cards to win
                    <select disabled={!connected || isPreparing} value={settings.cardsToWin} onChange={(event) => update({ cardsToWin: Number(event.target.value) })}>
                      {Array.from({ length: 11 }, (_, index) => index + 5).map((number) => <option key={number} value={number}>{number} cards</option>)}
                    </select>
                  </label>
                )}
                {manual && (
                  <label className="tunes-field">Who cues music?
                    <select disabled={!connected || isPreparing} value={settings.dedicatedDjId || ''} onChange={(event) => update({ dedicatedDjId: event.target.value })}>
                      <option value="">Rotate the DJ</option>
                      {playerList.map((player) => <option key={player.id} value={player.id}>{player.name} · dedicated DJ</option>)}
                    </select>
                  </label>
                )}
                {isDinner && manual && !dedicated && (
                  <label className="tunes-field">Length
                    <select disabled={!connected || isPreparing} value={songCount} onChange={(event) => update({ dinnerRounds: Number(event.target.value) })}>
                      {[1, 2].map((rotation) => <option key={rotation} value={rotation * rotationSize}>{rotation * rotationSize} songs · {rotation} {rotation === 1 ? 'rotation' : 'rotations'}</option>)}
                    </select>
                  </label>
                )}
                {isDinner && (!manual || dedicated) && (
                  <label className="tunes-field">Length
                    <select disabled={!connected || isPreparing} value={songCount} onChange={(event) => update({ dinnerRounds: Number(event.target.value) })}>
                      {[6, 8, 10, 12].map((count) => <option key={count} value={count}>{count} songs</option>)}
                    </select>
                  </label>
                )}
              </div>
              {(licensedPacks.length > 0 || (!isDinner && (spotify.available || spotifySelected))) && (
                <div className="tunes-stack">
                  <label className="tunes-field">Music source
                    <select disabled={!connected || isPreparing || spotify.pending} value={spotifySelected ? 'spotify' : playbackMode === 'licensed' ? settings.packId ?? licensedPacks[0]?.id ?? 'manual' : 'manual'} onChange={(event) => {
                      const pick = event.target.value;
                      if (pick === 'manual') update({ playbackMode: 'manual', songPack: 'standard' });
                      else if (pick === 'spotify') void selectSpotify();
                      else update({ playbackMode: 'licensed', packId: pick, songPack: 'standard' });
                    }}>
                      <option value="manual">Manual DJ · Use your own music</option>
                      {!isDinner && (spotify.available || spotifySelected) && <option value="spotify" disabled={!spotify.available}>Spotify Premium</option>}
                      {licensedPacks.map((pack) => <option value={pack.id} key={pack.id}>{pack.name} · {pack.trackCount} recordings</option>)}
                    </select>
                  </label>
                  {licensedPacks.length > 0 && <a className="tunes-link" href={appPath('music-credits.html')} target="_blank" rel="noreferrer">Automatic music credits</a>}
                </div>
              )}
              <fieldset className="tunes-fieldset" disabled={!connected || isPreparing}>
                <legend>Decades</legend>
                <div className="tunes-chip-row">
                  {DECADES.map((decade) => <button key={decade} type="button" className="tunes-filter" aria-pressed={settings.decades?.includes(decade) ?? false} onClick={() => {
                    const decades = toggled(settings.decades, decade);
                    update({ decades, songPack: decades.length ? (settings.genres?.length ? 'genre-decade' : 'decades') : (settings.genres?.length ? 'genre' : 'standard') });
                  }}>{decade}s</button>)}
                </div>
              </fieldset>
              <fieldset className="tunes-fieldset" disabled={!connected || isPreparing}>
                <legend>Genres</legend>
                <div className="tunes-chip-row">
                  {GENRES.map(({ value, label }) => <button key={value} className="tunes-filter" type="button" aria-pressed={settings.genres?.includes(value) ?? false} onClick={() => {
                    const genres = toggled(settings.genres, value);
                    update({ genres, songPack: genres.length ? (settings.decades?.length ? 'genre-decade' : 'genre') : (settings.decades?.length ? 'decades' : 'standard') });
                  }}>{label}</button>)}
                </div>
              </fieldset>
              <fieldset className="tunes-fieldset" disabled={!connected || isPreparing}>
                <legend>Regions</legend>
                <div className="tunes-chip-row">
                  {REGIONS.map(({ value, label }) => <button key={value} className="tunes-filter" type="button" aria-pressed={settings.regions?.includes(value) ?? false} onClick={() => update({ regions: toggled(settings.regions, value) })}>{label}</button>)}
                </div>
              </fieldset>
            </div>
          )}
        </section>
        <section className="tunes-panel tunes-roster" aria-labelledby="seats-title">
          <div className="tunes-row-title">
            <h2 id="seats-title">Who’s here</h2>
            <span className="tunes-pill"><Users size={15} aria-hidden="true" /> {connectedWord}</span>
          </div>
          <ul className="tunes-player-list">
            {playerList.map((player) => (
              <li key={player.id}>
                <div className="tunes-avatar" aria-hidden="true">{player.name[0]?.toUpperCase() || '?'}</div>
                <div className="tunes-player-label">
                  <b>{player.name}{player.id === myId ? ' (you)' : ''}</b>
                  <span>{[player.id === hostId && 'Controller', dedicated && player.id === settings.dedicatedDjId && 'Dedicated DJ'].filter(Boolean).join(' · ')}</span>
                </div>
                <span className={`tunes-seat-status ${player.connected ? 'is-ready' : ''}`}>{player.connected ? 'Ready' : 'Away'}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="tunes-lobby-example">
          <button className="tunes-link" onClick={() => setShowExample((value) => !value)} aria-expanded={showExample} aria-controls="lobby-example">
            {showExample ? <X size={17} aria-hidden="true" /> : <BookOpen size={17} aria-hidden="true" />} {showExample ? 'Close example' : 'See a placement example'}
          </button>
          {showExample && <div id="lobby-example"><WorkedExample /></div>}
        </section>
      </div>
    </main>
  );
}
