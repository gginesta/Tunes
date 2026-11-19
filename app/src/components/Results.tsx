import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Bookmark, Check, Disc3, History, RotateCcw, Trophy } from 'lucide-react';
import { MIN_PLAYERS, type Room } from '@tunes/shared';
import { getSocket, leaveTable } from '../services/socket';
import { useGameStore } from '../store';
import { Brand, makeActionId, Message, MODE_NAMES, RecordArt } from './TableUi';
import { TableDialog } from './game/TableDialog';

function MatchSummary({ room, myId }: { room: Room; myId: string }) {
  const { code, settings, gameState, hostId, players } = room;
  const { result, roundId, matchId } = gameState;
  const connected = useGameStore((s) => s.connected);
  const notice = useGameStore((s) => s.notice);
  const error = useGameStore((s) => s.error);
  const startProgress = useGameStore((s) => s.startProgress);
  const savedTable = useGameStore((s) => s.savedTables.find((table) => table.id === room.savedTableId || table.currentRoomCode === code));
  const [history, setHistory] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [tableName, setTableName] = useState('');
  const [submittedVote, setSubmittedVote] = useState<boolean | null>(null);
  const title = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    title.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, []);
  useEffect(() => {
    if (savedTable || room.savedTableId) setSaveOpen(false);
  }, [savedTable, room.savedTableId]);
  useEffect(() => {
    setSubmittedVote(null);
  }, [gameState.revision, connected, error]);

  if (!result) return <main className="tunes-shell"><Brand><button className="tunes-link" onClick={leaveTable}>Leave</button></Brand><Message>Waiting for match results…</Message></main>;
  const { scores, status, winnerIds, decidingSong, margin, reason } = result;
  const controller = hostId === myId;
  const dinner = settings.mode === 'dinner';
  const coop = settings.mode === 'coop';
  const pointsWord = dinner ? 'points' : 'cards';
  const winnerNames = winnerIds.map((id) => players[id]?.name || 'Guest');
  const acceptances = gameState.rematchPlayerIds ?? [];
  const actualAccepted = Object.values(players).filter((seat) => seat.connected && acceptances.includes(seat.id));
  const dedicated = room.playbackMode === 'manual' && !!settings.dedicatedDjId;
  const enoughForRematch = actualAccepted.filter((player) => !(dedicated && player.id === settings.dedicatedDjId)).length >= MIN_PLAYERS &&
    (!dedicated || Object.values(players).some((player) => player.connected && player.id === settings.dedicatedDjId));
  const optedIn = acceptances.includes(myId);
  const list = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const headline = status === 'abandoned' ? 'Match ended early' : status === 'lost' ? 'The set got away' : coop ? 'The table wins' : status === 'tied' ? 'Co-champions' : `${winnerNames[0] || 'A table'} wins`;
  const resultDetail = status === 'tied'
    ? winnerNames.join(' & ')
    : status === 'lost' && coop
      ? `${gameState.sharedTimeline.length} of ${settings.cardsToWin} cards collected`
      : status === 'won' && coop
        ? `${settings.cardsToWin}-card target reached`
        : margin !== null && margin > 0
          ? `Winning margin · ${margin} ${margin === 1 ? pointsWord.slice(0, -1) : pointsWord}`
          : reason === 'deck-exhausted' ? 'The pack ran out of cards.' : '';

  function vote() {
    const socket = getSocket();
    if (!socket.connected || !matchId || roundId === undefined || submittedVote !== null) return;
    const accepted = !optedIn;
    setSubmittedVote(accepted);
    socket.emit('rematch-consent', { matchId, roundId, actionId: makeActionId(), accept: accepted });
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const socket = getSocket();
    if (socket.connected) socket.emit('save-table', { name: tableName.trim() || undefined });
  }

  return (
    <main className="tunes-shell tunes-results" data-mode={dinner ? 'dinner' : 'classic'}>
      <Brand>
        <span className="tunes-pill tunes-pill-room">Room {code}</span>
        <button className="tunes-link" onClick={leaveTable}>Leave</button>
      </Brand>
      {!connected && <Message>Reconnecting… Your results are saved.</Message>}
      {error && !saveOpen && <Message kind="error">{error}</Message>}
      {notice && <Message>{notice}</Message>}
      <section className="tunes-results-hero" aria-labelledby="results-title">
        <div>
          <span className="tunes-pill tunes-pill-accent"><Trophy size={16} aria-hidden="true" /> {MODE_NAMES[settings.mode]} results</span>
          <h1 id="results-title" tabIndex={-1} ref={title}>{headline}<span>.</span></h1>
          {resultDetail && <p>{resultDetail}</p>}
        </div>
        <RecordArt compact />
      </section>
      <div className="tunes-lobby-grid">
        <section className="tunes-panel tunes-stack" aria-labelledby="scores-title">
          <div className="tunes-row-title">
            <h2 id="scores-title">{coop ? 'The team' : 'Final scores'}</h2>
            {gameState.stats && <span className="tunes-pill">{gameState.stats.totalRounds} songs</span>}
          </div>
          {coop ? (
            <><p className="tunes-muted">Shared timeline · {gameState.sharedTimeline.length} cards</p><ul className="tunes-player-list">
              {Object.values(players).filter((player) => player.id !== settings.dedicatedDjId).map((player) => (
                <li key={player.id}><div className="tunes-avatar" aria-hidden="true">{player.name[0]?.toUpperCase() || '?'}</div><b>{player.name}{player.id === myId ? ' (you)' : ''}</b></li>
              ))}
            </ul></>
          ) : (
            <ol className="tunes-player-list tunes-podium">
              {list.map(([id, score], index) => {
                const rank = list.findIndex(([, other]) => other === score) + 1;
                return (
                  <li key={id} data-leader={winnerIds.includes(id) || undefined}>
                    <span className="tunes-avatar">{winnerIds.includes(id) ? <Trophy size={18} aria-label="Champion" /> : rank || index + 1}</span>
                    <b>{players[id]?.name || 'Guest'}{id === myId ? ' (you)' : ''}</b>
                    <strong>{score} <span>{score === 1 ? pointsWord.slice(0, -1) : pointsWord}</span></strong>
                  </li>
                );
              })}
            </ol>
          )}
          {decidingSong && (
            <div className="tunes-decider">
              <Disc3 size={26} aria-hidden="true" />
              <div><b>The deciding song</b><p>{decidingSong.title} · {decidingSong.artist} · {decidingSong.year}</p></div>
            </div>
          )}
          <button className="tunes-link" onClick={() => setHistory(true)}><History size={18} aria-hidden="true" /> Songs from this match</button>
        </section>
        <section className="tunes-panel tunes-stack tunes-rematch" aria-labelledby="rematch-title">
          <h2 id="rematch-title">Another round?</h2>
          <p className="tunes-muted">Keep this room and its settings. The next match starts with the people who opt in.</p>
          <button className={`tunes-button ${optedIn ? 'tunes-button-secondary' : 'tunes-button-primary'}`} disabled={!connected || submittedVote !== null || !matchId} aria-pressed={optedIn} onClick={vote}>
            {optedIn ? <Check size={18} aria-hidden="true" /> : <RotateCcw size={18} aria-hidden="true" />} {optedIn ? 'You’re in · Undo' : 'I’m in for a rematch'}
          </button>
          <p className="tunes-muted" role="status">{actualAccepted.length ? `In: ${actualAccepted.map((seat) => seat.id === myId ? 'you' : seat.name).join(', ')}` : 'Waiting for someone to opt in.'}</p>
          {controller && <button className="tunes-button tunes-button-primary" disabled={!connected || !enoughForRematch || !!startProgress || !matchId}
            onClick={() => { if (matchId && getSocket().connected) getSocket().emit('start-rematch', { matchId }); }}>{startProgress || 'Start rematch'} <ArrowRight size={18} aria-hidden="true" /></button>}
          {controller && startProgress && <button className="tunes-link" onClick={() => getSocket().emit('cancel-start')}>Cancel start</button>}
          {dedicated && <p className="tunes-muted">The dedicated DJ must be connected and at least two players must opt in.</p>}
        </section>
        {(controller || !!room.savedTableId || savedTable) && <section className="tunes-panel tunes-stack tunes-save-table">
          <div className="tunes-row-title"><h2>{savedTable?.name || 'Save this table'}</h2><Bookmark size={21} aria-hidden="true" /></div>
          <p className="tunes-muted">{savedTable || room.savedTableId ? 'Find your table on Home for championship standings and head-to-head history.' : 'Bring this group back on another night and keep a private record of your champions.'}</p>
          {!room.savedTableId && !savedTable && <button className="tunes-button tunes-button-secondary" disabled={!connected} onClick={() => setSaveOpen(true)}><Bookmark size={18} aria-hidden="true" /> Save table</button>}
        </section>}
      </div>
      {history && (
        <TableDialog title="Songs this match" onClose={() => setHistory(false)}>
          {gameState.history?.length ? <ol className="tunes-reveal-picks">
            {[...gameState.history].reverse().map(({ song, roundNumber }) => <li key={roundNumber}><div><b>{song.title}</b><span>{song.artist}</span></div><strong>{song.year}</strong></li>)}
          </ol> : <p className="tunes-muted">No recordings were revealed.</p>}
        </TableDialog>
      )}
      {saveOpen && (
        <TableDialog title="Save this table" onClose={() => setSaveOpen(false)}>
          <form className="tunes-stack" onSubmit={save}>
            <label className="tunes-field">Table name<input value={tableName} onChange={(event) => setTableName(event.target.value)} maxLength={50} placeholder="Friday dinner" /></label>
            {error && <Message kind="error">{error}</Message>}
            <button className="tunes-button tunes-button-primary" disabled={!connected} type="submit"><Bookmark size={18} aria-hidden="true" /> Save table</button>
          </form>
        </TableDialog>
      )}
    </main>
  );
}

export function Results() {
  const room = useGameStore((s) => s.room);
  const myId = useGameStore((s) => s.myId);
  return room ? <MatchSummary key={room.gameState.matchId} room={room} myId={myId} /> : null;
}
