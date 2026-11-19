import { useEffect, useRef, useState } from 'react';
import { ArrowDownRight, ArrowRight, Bookmark, BookOpen, Disc3, Radio, RotateCcw, Trophy, Users } from 'lucide-react';
import type { SavedTable } from '@tunes/shared';
import { createTable, getGuestToken, getSession, getSocket, joinTable, resumeSavedRoom } from '../services/socket';
import { useGameStore } from '../store';
import { useSpotifyClassicAvailable } from '../hooks/useSpotifyClassic';
import { Brand, Message, RecordArt } from './TableUi';

function readStageName() {
  try { return localStorage.getItem('tunes_display_name') || ''; } catch { return ''; }
}

function readRoomCode(input: string) {
  const value = input.trim();
  const invite = value.match(/\/join\/([a-z]{4})(?:[/?#]|$)/i);
  return (invite?.[1] ?? value.replace(/\s/g, '')).toUpperCase();
}

export function Home() {
  const [name, setName] = useState(readStageName);
  const [mode, setMode] = useState<'host' | 'join'>(() => useGameStore.getState().pendingJoinCode ? 'join' : 'host');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedSeat, setSavedSeat] = useState(getSession);
  const nameInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const connected = useGameStore((s) => s.connected);
  const error = useGameStore((s) => s.error);
  const notice = useGameStore((s) => s.notice);
  const buildId = useGameStore((s) => s.buildId);
  const licensedPacks = useGameStore((s) => s.licensedPacks);
  const spotifyClassicAvailable = useSpotifyClassicAvailable();
  const recoveryStatus = useGameStore((s) => s.recoveryStatus);
  const savedTables = useGameStore((s) => s.savedTables);
  const setError = useGameStore((s) => s.setError);
  const setScreen = useGameStore((s) => s.setScreen);
  const pendingJoinCode = useGameStore((s) => s.pendingJoinCode);
  const setPendingJoinCode = useGameStore((s) => s.setPendingJoinCode);

  useEffect(() => {
    if (!pendingJoinCode) return;
    setCode(pendingJoinCode);
    setMode('join');
    setPendingJoinCode(null);
  }, [pendingJoinCode, setPendingJoinCode]);

  useEffect(() => {
    if (!error && connected) return;
    setPending(false);
    setSavedSeat(getSession());
  }, [error, connected, recoveryStatus]);

  useEffect(() => {
    if (!pending) return;
    const timeout = window.setTimeout(() => {
      setPending(false);
      setFormError('The table is taking a while to respond. Try again.');
    }, 12_000);
    return () => window.clearTimeout(timeout);
  }, [pending]);

  function persistName(playerName: string) {
    try { localStorage.setItem('tunes_display_name', playerName); } catch { /* device storage unavailable */ }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const playerName = name.trim();
    const roomCode = readRoomCode(code);
    setError(null);
    if (!playerName) {
      setFormError('Enter a stage name.');
      nameInput.current?.focus();
      return;
    }
    if (mode === 'join' && !/^[A-Z]{4}$/.test(roomCode)) {
      setFormError('Enter the four-letter room code or paste the full invitation link.');
      codeInput.current?.focus();
      return;
    }
    const socket = getSocket();
    if (pending || !socket.connected) return;
    setPending(true);
    setFormError(null);
    persistName(playerName);
    if (mode === 'host') createTable(playerName);
    else joinTable(roomCode, playerName);
  }

  function openTable(table: SavedTable) {
    const playerName = name.trim();
    const guestToken = getGuestToken();
    if (!playerName) {
      setFormError('Enter a stage name to open this table.');
      nameInput.current?.focus();
      return;
    }
    const socket = getSocket();
    if (pending || !socket.connected || !guestToken) return;
    setError(null);
    setFormError(null);
    setPending(true);
    persistName(playerName);
    const seat = getSession();
    if (seat && table.currentRoomCode === seat.roomCode) resumeSavedRoom();
    else socket.emit('open-table', { tableId: table.id, playerName, guestToken });
  }

  return (
    <main className="tunes-shell tunes-home">
      <Brand>
        <button className="tunes-link" onClick={() => setScreen('rules')}><BookOpen size={17} aria-hidden="true" /> How to play</button>
      </Brand>
      <div className="tunes-home-layout">
        <section className="tunes-home-hero" aria-labelledby="home-title">
          <div className="tunes-home-copy">
            <h1 id="home-title">Drop the<br />needle<span>.</span></h1>
            <p>Hear the song. Find its place in time. Play around one table.</p>
            <ArrowDownRight className="tunes-home-arrow" size={38} strokeWidth={1.25} aria-hidden="true" />
          </div>
          <RecordArt />
        </section>
        <section className="tunes-panel tunes-entry" aria-labelledby="entry-title">
          {savedSeat && savedSeat.resumeToken && recoveryStatus !== 'expired' && (
            <button className="tunes-button tunes-button-resume" onClick={() => resumeSavedRoom()} disabled={!connected || recoveryStatus === 'joining'}>
              <RotateCcw size={19} aria-hidden="true" />
              <span><b>{recoveryStatus === 'joining' ? 'Reconnecting…' : 'Resume your table'}</b><span>Saved seat · {savedSeat.roomCode}</span></span>
              <ArrowRight size={19} aria-hidden="true" />
            </button>
          )}
          <h2 id="entry-title">{mode === 'host' ? 'Set the table' : 'Find your table'}</h2>
          <div className="tunes-segments" role="group" aria-label="How to enter">
            <button aria-pressed={mode === 'host'} onClick={() => { setMode('host'); setFormError(null); setError(null); }}><Disc3 size={18} aria-hidden="true" /> Host</button>
            <button aria-pressed={mode === 'join'} onClick={() => { setMode('join'); setFormError(null); setError(null); }}><Users size={18} aria-hidden="true" /> Join</button>
          </div>
          <form className="tunes-stack" onSubmit={submit}>
            <label className="tunes-field">Stage name
              <input ref={nameInput} id="stage-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Ella" autoComplete="nickname" autoCapitalize="words" maxLength={20} />
            </label>
            {mode === 'join' && (
              <label className="tunes-field">Room code or invite link
                <input ref={codeInput} value={code} onChange={(event) => setCode(event.target.value)} placeholder="e.g. BLUE" spellCheck={false} autoComplete="off" autoCapitalize="characters" enterKeyHint="go" />
              </label>
            )}
            {mode === 'host' && <p className="tunes-muted">Cue songs with your own music{licensedPacks.length ? ', or choose an automatic pack in the lobby' : ''}.</p>}
            {mode === 'host' && <p className="tunes-muted">{spotifyClassicAvailable ? 'For Classic with Spotify Premium, host a room and connect Spotify in the lobby.' : 'Spotify playback isn’t enabled here.'}</p>}
            {(formError || error) && <Message kind="error">{formError || error}</Message>}
            {!error && (recoveryStatus === 'expired' || recoveryStatus === 'legacy' || recoveryStatus === 'replaced') && <Message>{recoveryStatus === 'expired' ? 'Your previous room has expired. Host or join a new table.' : recoveryStatus === 'legacy' ? 'This older room needs a fresh match. Join again to get a new seat.' : 'This seat is active in another tab or on another device.'}</Message>}
            {notice && !error && recoveryStatus === 'idle' && <Message>{notice}</Message>}
            {!connected && <p className="tunes-live" role="status"><Radio size={16} aria-hidden="true" /> Connecting to Tunes…</p>}
            <button className="tunes-button tunes-button-primary" type="submit" disabled={!connected || pending}>
              {pending ? (mode === 'host' ? 'Setting your table…' : 'Joining…') : (mode === 'host' ? 'Host a room' : 'Join room')} <ArrowRight size={19} aria-hidden="true" />
            </button>
          </form>
        </section>
      </div>
      {savedTables.length > 0 && (
        <section className="tunes-saved-tables" aria-labelledby="saved-tables-title">
          <div className="tunes-row-title"><h2 id="saved-tables-title">Saved tables</h2><Bookmark size={22} aria-hidden="true" /></div>
          {savedTables.map((table) => (
            <details className="tunes-panel tunes-disclosure" key={table.id}>
              <summary>{table.name} <span className="tunes-pill">{table.playedMatches} {table.playedMatches === 1 ? 'match' : 'matches'}</span></summary>
              <div className="tunes-stack">
                <button className="tunes-button tunes-button-secondary" onClick={() => openTable(table)} disabled={!connected || pending}>Open table <ArrowRight size={18} aria-hidden="true" /></button>
                {table.standings.length > 0 && (
                  <div>
                    <h3><Trophy size={17} aria-hidden="true" /> Championship</h3>
                    <ol className="tunes-reveal-picks">
                      {table.standings.map((player, index) => <li key={index}><b>{player.displayName}</b><strong>{player.wins} {player.wins === 1 ? 'win' : 'wins'} in {player.matches}</strong></li>)}
                    </ol>
                  </div>
                )}
                {!!table.headToHead?.length && (
                  <div>
                    <h3>Head to head</h3>
                    <ul className="tunes-reveal-picks">
                      {table.headToHead.map((pair, index) => <li key={index}><div><b>{pair.firstName} vs. {pair.secondName}</b><span>{pair.matches} {pair.matches === 1 ? 'match' : 'matches'}</span></div><strong>{pair.firstWins}–{pair.secondWins}</strong></li>)}
                    </ul>
                  </div>
                )}
              </div>
            </details>
          ))}
        </section>
      )}
      <footer className="tunes-home-foot">
        <span>Build {buildId}</span>
        <nav aria-label="Play history">
          <button className="tunes-link" onClick={() => setScreen('leaderboard')}>Leaderboard</button>
          <button className="tunes-link" onClick={() => { if (name.trim()) persistName(name.trim()); setScreen('profile'); }}>My stats</button>
        </nav>
      </footer>
    </main>
  );
}
