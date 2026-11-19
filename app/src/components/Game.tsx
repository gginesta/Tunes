import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Check, Clock3, Flag, Headphones, History, Lock, Play, Repeat2, ShoppingBag, SkipForward, Star, Users } from 'lucide-react';
import { BUY_CARD_COST, SKIP_COST, type CueAction, type Room, type RoundAction, type RoundReveal, type SongCard, type SongGuess } from '@tunes/shared';
import { getSocket, leaveTable } from '../services/socket';
import { startSpeakerAudio } from '../services/tableAudio';
import { useGameStore } from '../store';
import { Brand, gapLabel, makeActionId, Message, MODE_NAMES, RecordArt } from './TableUi';
import { GapTimeline } from './game/GapTimeline';
import { TableDialog } from './game/TableDialog';
import { WaitingState } from './WaitingState';

function useSeconds(deadline: number | null | undefined, remainingMs: number | null | undefined) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!deadline) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [deadline]);
  const ms = deadline ? Math.max(0, deadline - now) : remainingMs;
  return ms === null || ms === undefined ? null : Math.ceil(ms / 1000);
}

function RoundClock({ timing, frozen }: { timing: Room['gameState']['timing']; frozen: boolean }) {
  const seconds = useSeconds(timing?.deadline, timing?.remainingMs);
  if ((!timing?.deadline && !frozen) || seconds === null) return null;
  return (
    <span className="tunes-pill tunes-clock" role="timer" aria-label={`${seconds} seconds ${frozen ? 'saved' : 'left'}`}>
      <Clock3 size={16} aria-hidden="true" /> {seconds}s{frozen ? ' saved' : ''}
    </span>
  );
}

function RoundRecord({ song, privateCue = false }: { song: SongCard; privateCue?: boolean }) {
  return (
    <div className="tunes-record-details">
      <span className="tunes-released">{privateCue ? 'Private DJ cue' : song.year}</span>
      <h2>{song.title}</h2>
      <p>{song.artist}{privateCue ? ` · ${song.year}` : ''}{song.version ? ` · ${song.version}` : ''}</p>
      {song.recordingNote && <p className="tunes-record-note">{song.recordingNote}</p>}
      {!privateCue && (song.sourceUrl || song.licenseUrl) && (
        <div className="tunes-record-links">
          {song.sourceUrl && <a href={song.sourceUrl} target="_blank" rel="noreferrer">Recording source</a>}
          {song.licenseUrl && <a href={song.licenseUrl} target="_blank" rel="noreferrer">{song.license || 'Music license'}</a>}
        </div>
      )}
    </div>
  );
}

function Reveal({ room, reveal, myId, onContinue, onFlag, busy, connected }: {
  room: Room;
  reveal: RoundReveal;
  myId: string;
  onContinue: () => void;
  onFlag: () => void;
  busy: string | null;
  connected: boolean;
}) {
  const { players, gameState, hostId } = room;
  const isDinner = room.settings.mode === 'dinner';
  const isCoop = room.settings.mode === 'coop';
  const active = gameState.currentTurnPlayerId ? players[gameState.currentTurnPlayerId] : undefined;
  const winner = reveal.winnerId ? players[reveal.winnerId] : undefined;
  const stealer = reveal.stolenBy ? players[reveal.stolenBy] : undefined;
  const guesses = Object.entries(reveal.dinnerGuesses ?? {});
  const finalReveal = gameState.finalReveal ?? (isDinner
    ? !!gameState.dinner && gameState.dinner.completedRounds >= gameState.dinner.roundCount
    : !!gameState.result || (isCoop ? gameState.sharedTimeline.length >= room.settings.cardsToWin : !!winner && winner.timeline.length >= room.settings.cardsToWin));
  const flagged = reveal.flaggedBy?.includes(myId);
  const { correctPositions, timeline, position, modeResult } = reveal;
  const actualGap = correctPositions.map((slot) => gapLabel(timeline, slot)).join(' / ');

  return (
    <div className="tunes-stack tunes-reveal-view">
      <section className="tunes-panel tunes-reveal">
        <RecordArt compact />
        <RoundRecord song={reveal.song} />
        {actualGap && <p className="tunes-correct-gap"><Check size={18} aria-hidden="true" /> {actualGap}</p>}
      </section>
      {isDinner ? (
        <section className="tunes-panel">
          <div className="tunes-row-title">
            <h2>The table’s picks</h2>
            <span className="tunes-pill">{guesses.filter(([, guess]) => guess.correct).length} correct</span>
          </div>
          <ul className="tunes-reveal-picks">
            {guesses.map(([id, guess]) => (
              <li key={id}>
                <div><b>{players[id]?.name || 'Guest'}{id === myId ? ' (you)' : ''}</b><span>{guess.position === null ? 'No guess' : gapLabel(timeline, guess.position)}</span></div>
                <strong data-correct={guess.correct}>{guess.correct ? `+${guess.points}` : '0'}</strong>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="tunes-panel tunes-stack">
          <h2>{stealer ? `${stealer.name} steals the card` : winner ? (isCoop ? 'One for the table' : `${winner.name} gets the card`) : 'No card awarded'}</h2>
          {position !== null && <p className="tunes-muted">{active?.name || 'The active player'} picked {gapLabel(timeline, position).toLowerCase()}.</p>}
          {!isCoop && modeResult?.placementCorrect && !winner && (room.settings.mode === 'pro' || room.settings.mode === 'expert') && (
            <p className="tunes-muted">The placement was right. {modeResult.songNamed ? 'The exact year was required.' : 'The title and artist were required.'}</p>
          )}
          {modeResult?.coopPenalty && <p className="tunes-muted">The active player loses one token.</p>}
          {reveal.challengeResults && Object.keys(reveal.challengeResults).length > 0 && (
            <ul className="tunes-reveal-picks">
              {Object.entries(reveal.challengeResults).map(([id, challenge]) => (
                <li key={id}><div><b>{players[id]?.name ?? 'Guest'}</b><span>{gapLabel(timeline, challenge.position)}</span></div><strong data-correct={challenge.correct}>{reveal.stolenBy === id ? 'Stole card' : 'No steal'}</strong></li>
              ))}
            </ul>
          )}
        </section>
      )}
      <div className="tunes-reveal-actions">
        {myId === hostId ? (
          <button className="tunes-button tunes-button-primary" disabled={!connected || !!busy} onClick={onContinue}>{finalReveal ? 'See results' : 'Continue'} <ArrowRight size={19} aria-hidden="true" /></button>
        ) : (
          <Message>Waiting for {players[hostId]?.name || 'the controller'} to continue.</Message>
        )}
        <button className="tunes-link" disabled={!connected || !!flagged || busy === 'flag-recording'} onClick={onFlag}><Flag size={16} aria-hidden="true" /> {flagged ? 'Recording flagged' : 'Flag recording'}</button>
      </div>
    </div>
  );
}

function NameSong({ mode, spent, result, disabled, onSubmit, onDone }: {
  mode: Room['settings']['mode'];
  spent: boolean;
  result?: NonNullable<Room['gameState']['classic']>['myNamingResult'];
  disabled: boolean;
  onSubmit: (guess: SongGuess) => void;
  onDone: () => void;
}) {
  const required = mode === 'pro' || mode === 'expert';
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [year, setYear] = useState('');
  const [validation, setValidation] = useState<string | null>(null);
  const yearRef = useRef<HTMLInputElement>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || (required && !artist.trim())) return;
    if (mode === 'expert' && (!/^\d{4}$/.test(year.trim()) || Number(year) < 1000 || Number(year) > 3000)) {
      setValidation('Enter a four-digit release year.');
      yearRef.current?.focus();
      return;
    }
    setValidation(null);
    onSubmit({ title: title.trim(), artist: artist.trim(), ...(mode === 'expert' ? { year: Number(year.trim()) } : {}) });
  }

  if (spent) return <Message>{result ? (result.correct ? 'Song named correctly.' : 'Naming attempt used.') : 'Naming complete.'}</Message>;
  return (
    <details className="tunes-panel tunes-disclosure" open={required || undefined}>
      <summary><Star size={18} aria-hidden="true" /> {required ? 'Name the song' : 'Name the song for a token'}</summary>
      <form className="tunes-stack" onSubmit={submit}>
        <div className="tunes-field-grid">
          <label className="tunes-field">Title<input value={title} onChange={(event) => setTitle(event.target.value)} disabled={disabled} required /></label>
          <label className="tunes-field">Artist {required ? '' : '(optional)'}<input value={artist} onChange={(event) => setArtist(event.target.value)} disabled={disabled} required={required} /></label>
          {mode === 'expert' && (
            <label className="tunes-field">Release year<input ref={yearRef} inputMode="numeric" maxLength={4} placeholder="1986" value={year} onChange={(event) => setYear(event.target.value)} disabled={disabled} aria-invalid={!!validation} /></label>
          )}
        </div>
        {validation && <Message kind="error">{validation}</Message>}
        <div className="tunes-inline">
          <button className="tunes-button tunes-button-secondary" disabled={disabled} type="submit">Submit name</button>
          {!required && <button className="tunes-link" disabled={disabled} type="button" onClick={onDone}>Done guessing</button>}
        </div>
      </form>
    </details>
  );
}

function RoundBoard({ room, myId }: { room: Room; myId: string }) {
  const { gameState: state, settings, players, hostId, speakerId } = room;
  const { phase, matchId, roundId, reveal, audio, timing, classic, dinner } = state;
  const connected = useGameStore((s) => s.connected);
  const error = useGameStore((s) => s.error);
  const errorAction = useGameStore((s) => s.errorAction);
  const notice = useGameStore((s) => s.notice);
  const wakeLock = useGameStore((s) => s.wakeLockStatus);
  const audioError = useGameStore((s) => s.spotifyError);
  const autoplayBlocked = useGameStore((s) => s.autoplayBlocked);
  const buzzedPlayers = useGameStore((s) => s.buzzedPlayers);
  const volume = useGameStore((s) => s.volume);
  const setVolume = useGameStore((s) => s.setVolume);
  const [position, setPosition] = useState<number | null>(null);
  const [challengePosition, setChallengePosition] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [viewMine, setViewMine] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [endConfirm, setEndConfirm] = useState(false);
  const [handoff, setHandoff] = useState('');
  const titleRef = useRef<HTMLHeadingElement>(null);
  const turnPlayer = state.currentTurnPlayerId ? players[state.currentTurnPlayerId] : undefined;
  const me = players[myId];
  const isController = myId === hostId;
  const isDinner = settings.mode === 'dinner';
  const isCoop = settings.mode === 'coop';
  const shared = isDinner || isCoop;
  const manual = audio?.kind === 'manual' || (!audio && room.playbackMode === 'manual');
  const isDJ = manual && audio?.operatorId === myId;
  const isSpeaker = !manual && (speakerId === myId || audio?.operatorId === myId);
  const dj = manual && audio?.operatorId ? players[audio.operatorId] : undefined;
  const speaker = !manual && (speakerId || audio?.operatorId) ? players[speakerId || audio?.operatorId || ''] : undefined;
  const isActive = turnPlayer?.id === myId;
  const isEligible = isDinner ? dinner?.eligiblePlayerIds.includes(myId) : isActive && !isDJ;
  const canGuess = phase === 'playing' && audio?.status === 'playing' && isEligible && !dinner?.myLocked;
  const canName = !isDinner && !isDJ && isActive && ['playing', 'challenge'].includes(phase) && audio?.status === 'playing';
  const hasChallenged = classic?.respondedPlayerIds.includes(myId);
  const eligibleChallenger = !!classic?.eligibleChallengerIds.includes(myId);
  const canChallenge = phase === 'challenge' && audio?.status === 'playing' && eligibleChallenger && !hasChallenged;
  const timingFrozen = audio?.status === 'paused';
  const isCueing = audio?.status === 'cueing';
  const waitingForAudio = audio?.status === 'awaiting_audio';
  const picking = canGuess || canChallenge;
  const timeline = shared ? state.sharedTimeline : (viewMine && !picking ? me?.timeline : turnPlayer?.timeline) ?? [];
  const lockedPosition = phase === 'playing' ? dinner?.myPosition ?? null : null;
  const chosen = phase === 'challenge' ? challengePosition : (position ?? lockedPosition);
  const taken = [state.pendingPlacement, ...Object.values(classic?.challengePositions ?? {})].filter((slot): slot is number => slot !== null);
  const challengeConflict = canChallenge && chosen !== null && taken.includes(chosen);
  const spectator = isDinner && !state.turnOrder.includes(myId);
  const allowControls = connected && !!matchId && roundId !== undefined;
  const actionTimeout = useRef<number | undefined>(undefined);

  function run(action: string, send: (scope: RoundAction) => void) {
    const socket = getSocket();
    if (!socket.connected || !matchId || roundId === undefined || busy) return;
    if (error) {
      useGameStore.setState({ errorAction: null });
      useGameStore.getState().setError(null);
    }
    setBusy(action);
    send({ matchId, roundId, actionId: makeActionId() });
    actionTimeout.current = window.setTimeout(() => {
      setBusy(null);
      useGameStore.getState().setError('The action is still waiting for the table. Try again.');
    }, 7_000);
  }

  function selectPlacement(value: number) {
    setPosition(value);
    if (!isDinner || !matchId || roundId === undefined) return;
    const socket = getSocket();
    if (socket.connected) socket.emit('dinner-guess', { matchId, roundId, actionId: makeActionId(), position: value });
  }

  function runCue(action: 'audio-ready' | 'replace-song' | 'resume-audio' | 'audio-interrupted') {
    const cueId = audio?.cueId;
    if (!cueId) return;
    run(action, (scope) => getSocket().emit(action, { ...scope, cueId } satisfies CueAction));
  }

  useEffect(() => {
    setBusy(null);
    window.clearTimeout(actionTimeout.current);
  }, [state.revision, errorAction, connected]);
  useEffect(() => () => window.clearTimeout(actionTimeout.current), []);

  useEffect(() => {
    if (phase === 'reveal' || phase === 'anchor_preview') {
      titleRef.current?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  }, [phase]);

  let headline: string;
  let prompt: string;
  if (phase === 'reveal') {
    headline = 'The reveal';
    prompt = isDinner ? 'Every guess is on the table.' : 'Here’s where the recording fits.';
  } else if (phase === 'anchor_preview') {
    headline = 'The starting cards';
    prompt = isCoop ? 'The table shares one timeline.' : 'Your anchor card starts your timeline.';
  } else if (timingFrozen) {
    headline = 'Table paused';
    prompt = audio?.reason === 'guesser-away'
      ? `Waiting for ${turnPlayer?.name || 'the active player'} to return.`
      : 'The clock and submitted guesses are saved.';
  } else if (isCueing || waitingForAudio) {
    headline = isDJ ? 'You’re the DJ' : isSpeaker ? 'Your phone is the speaker' : isCueing ? 'Your DJ is choosing the song' : 'Waiting for the speaker';
    prompt = isDJ ? 'Play the specific recording below. Keep this cue to yourself.' : isSpeaker ? 'Start the recording to begin the round.' : 'The clock starts when the music is playing.';
  } else if (isDinner) {
    headline = dinner?.myLocked ? 'Guess locked' : isDJ ? 'You’re the DJ' : spectator ? 'You’re watching' : 'Find the gap';
    prompt = dinner?.myLocked ? 'Your guess is saved and stays private until the reveal.' : isDJ ? 'The rest of the table is guessing this song.' : spectator ? 'You can play when the table starts a new set.' : 'Pick a gap, then lock your guess before time runs out.';
  } else if (phase === 'challenge') {
    headline = canChallenge ? 'Challenge the placement?' : 'Placement submitted';
    prompt = canChallenge ? 'Pick a different gap to try a steal, or pass.' : hasChallenged ? 'Your decision is in. Wait for the reveal.' : isDJ ? 'You cued this song and sit out the challenge.' : 'The table is finishing this round.';
  } else {
    headline = isActive ? 'Find the gap' : isDJ ? 'You’re the DJ' : `${turnPlayer?.name ?? 'Someone'}’s turn`;
    prompt = isActive ? 'Choose where the song fits, then confirm the placement.' : isDJ ? 'You cued this song and sit this round out.' : 'Listen along while the active player places the song.';
  }

  const seats = Object.values(players);
  const pending = busy !== null;
  const contextError = error && (errorAction || busy);
  const actionError = (...actions: string[]) => error && errorAction && actions.includes(errorAction) ? <Message kind="error">{error}</Message> : null;
  const hasMusicControls = ['playing', 'challenge'].includes(phase) && audio?.cueId;
  const canHandoff = !manual && isController && hasMusicControls;
  const declaredRound = isDinner && dinner
    ? `Song ${Math.min(dinner.roundCount, dinner.completedRounds + (phase === 'reveal' ? 0 : 1))} of ${dinner.roundCount}`
    : `${state.deckSize} left in pack`;
  const audioRole = manual ? (dj ? `DJ · ${dj.name}` : 'Rotating DJ') : speaker ? `Speaker · ${speaker.name}` : 'Speaker unavailable';
  const musicFallback = <RecordArt compact spinning={audio?.status === 'playing'} />;

  return (
    <main className="tunes-shell tunes-game" data-mode={isDinner ? 'dinner' : 'classic'}>
      <Brand>
        <span className="tunes-pill tunes-pill-room">Room {room.code}</span>
        <button className="tunes-link" onClick={() => setShowHistory(true)}><History size={17} aria-hidden="true" /> Songs</button>
        <button className="tunes-link" onClick={() => setLeaveConfirm(true)}>Leave</button>
      </Brand>
      <div className="tunes-page-heading tunes-game-heading">
        <div className="tunes-chip-row">
          <span className="tunes-pill tunes-pill-accent">{MODE_NAMES[settings.mode]}</span>
          <span className="tunes-pill">{declaredRound}</span>
          <RoundClock timing={timing} frozen={timingFrozen} />
        </div>
        <h1 ref={titleRef} tabIndex={-1}>{headline}</h1>
        <p>{prompt}</p>
      </div>
      {!connected && <Message>Reconnecting… Your place at the table is saved.</Message>}
      {connected && canGuess && !isDinner && buzzedPlayers.length > 0 && <Message>{buzzedPlayers.map((id) => players[id]?.name || 'A guest').join(', ')} buzzed.</Message>}
      {notice && <Message>{notice}</Message>}
      {error && !contextError && <Message kind="error">{error}</Message>}
      <div className="tunes-game-grid">
        <div className="tunes-stack tunes-main-board">
          {phase === 'reveal' && reveal ? (
            <Reveal room={room} reveal={reveal} myId={myId} busy={busy} connected={allowControls}
              onContinue={() => run('confirm-reveal', (scope) => getSocket().emit('confirm-reveal', scope))}
              onFlag={() => run('flag-recording', (scope) => getSocket().emit('flag-recording', scope))} />
          ) : (
            <>
              <section className="tunes-panel tunes-listen" aria-label="Music and round controls">
                {musicFallback}
                <div className="tunes-listen-body">
                  {isDJ && audio?.recording && (isCueing || timingFrozen) ? <RoundRecord song={audio.recording} privateCue /> : (
                    <>
                      <h2>{phase === 'anchor_preview' ? 'On the record' : audio?.status === 'playing' ? 'Now playing' : timingFrozen ? 'On hold' : 'Mystery track'}</h2>
                      <p>{phase === 'anchor_preview' ? 'Check the years on your timeline.' : timingFrozen ? audio?.reason === 'audio-unavailable' ? 'Waiting for the music to come back.' : 'The room will continue when it’s ready.' : isCueing || waitingForAudio ? audioRole : isDinner ? `${dinner?.submittedCount ?? 0} of ${dinner?.eligiblePlayerIds.length ?? 0} guesses locked` : audioRole}</p>
                    </>
                  )}
                  {phase === 'anchor_preview' && isController && <button className="tunes-button tunes-button-secondary" disabled={!allowControls || pending} onClick={() => run('skip-anchors', (scope) => getSocket().emit('skip-anchors', scope))}>Continue <ArrowRight size={17} aria-hidden="true" /></button>}
                  {isDJ && (isCueing || (timingFrozen && audio?.reason !== 'guesser-away')) && (
                    <button className="tunes-button tunes-button-primary" disabled={!allowControls || pending} onClick={() => runCue('audio-ready')}><Play size={18} aria-hidden="true" /> Music is playing</button>
                  )}
                  {isSpeaker && (waitingForAudio || (timingFrozen && audio?.reason !== 'guesser-away')) && (
                    <button className="tunes-button tunes-button-primary" disabled={!connected || pending} onClick={() => void startSpeakerAudio()}><Play size={18} aria-hidden="true" /> {timingFrozen ? 'Resume music' : 'Play music'}</button>
                  )}
                  {isSpeaker && (audioError || autoplayBlocked) && <Message kind="error">{audioError || 'Tap Play music to allow audio on this phone.'}</Message>}
                  {hasMusicControls && (isDJ || isSpeaker) && audio?.status === 'playing' && (
                    <button className="tunes-link" disabled={!allowControls || pending} onClick={() => runCue('audio-interrupted')}>Pause the table</button>
                  )}
                </div>
              </section>
              {canHandoff && (timingFrozen || waitingForAudio) && (
                <section className="tunes-panel tunes-handoff">
                  <label className="tunes-field">Use another speaker
                    <select value={handoff} onChange={(event) => setHandoff(event.target.value)}>
                      <option value="">Choose a connected player</option>
                      {seats.filter((seat) => seat.connected && seat.id !== speakerId).map((seat) => <option key={seat.id} value={seat.id}>{seat.name}</option>)}
                    </select>
                  </label>
                  <button className="tunes-button tunes-button-secondary" disabled={!allowControls || pending || !handoff} onClick={() => run('assign-speaker', (scope) => getSocket().emit('assign-speaker', { ...scope, playerId: handoff }))}>Hand off</button>
                </section>
              )}
              {!shared && turnPlayer?.id !== myId && !picking && !!me && (
                <button className="tunes-link tunes-board-switch" aria-pressed={viewMine} onClick={() => setViewMine((value) => !value)}>{viewMine ? 'View the active timeline' : 'View my timeline'}</button>
              )}
              <GapTimeline cards={timeline} heading={shared ? 'Shared timeline' : viewMine || isActive ? 'Your timeline' : `${turnPlayer?.name ?? 'Active player'}’s timeline`}
                selected={picking ? chosen : null} marked={isDinner ? dinner?.myLocked ? lockedPosition : null : viewMine && !picking ? null : state.pendingPlacement}
                unavailable={phase === 'challenge' ? taken : []}
                onSelect={picking && connected ? phase === 'challenge' ? setChallengePosition : selectPlacement : undefined} />
              {canGuess && (
                <div className="tunes-round-actions">
                  <button className="tunes-button tunes-button-primary" disabled={!allowControls || pending || chosen === null}
                    onClick={() => {
                      if (chosen === null) return;
                      if (isDinner) run('lock-guess', (scope) => getSocket().emit('lock-guess', { ...scope, position: chosen }));
                      else run('place-card', (scope) => getSocket().emit('place-card', { ...scope, position: chosen }));
                    }}>{isDinner ? <Lock size={17} aria-hidden="true" /> : <Check size={19} aria-hidden="true" />} {isDinner ? 'Lock guess' : 'Confirm placement'}</button>
                </div>
              )}
              {canChallenge && (
                <div className="tunes-inline">
                  <button className="tunes-button tunes-button-primary" disabled={!allowControls || pending || chosen === null || challengeConflict}
                    onClick={() => { if (chosen !== null) run('challenge', (scope) => getSocket().emit('challenge', { ...scope, position: chosen })); }}>Challenge · 1 token</button>
                  <button className="tunes-button tunes-button-secondary" disabled={!allowControls || pending} onClick={() => run('pass-challenge', (scope) => getSocket().emit('pass-challenge', scope))}>Pass</button>
                </div>
              )}
              {challengeConflict && <Message>That gap has been claimed. Choose another gap or pass.</Message>}
              {actionError('dinner-guess', 'lock-guess', 'place-card', 'challenge', 'pass-challenge')}
              {canName && (
                <NameSong mode={settings.mode} spent={!!(classic?.myNamed || classic?.myNamingDone)} result={classic?.myNamingResult} disabled={!allowControls || pending}
                  onSubmit={(guess) => run('name-song', (scope) => getSocket().emit('name-song', { ...scope, ...guess }))}
                  onDone={() => run('done-guessing', (scope) => getSocket().emit('done-guessing', scope))} />
              )}
              {actionError('name-song', 'done-guessing')}
              {canName && phase === 'challenge' && (settings.mode === 'original' || settings.mode === 'coop') && !classic?.myNamed && !classic?.myNamingDone && (
                <button className="tunes-button tunes-button-secondary" disabled={!allowControls || pending} onClick={() => run('done-guessing', (scope) => getSocket().emit('done-guessing', scope))}>Done guessing</button>
              )}
              {!isDinner && canGuess && (
                <div className="tunes-inline tunes-token-actions">
                  <button className="tunes-link" disabled={!allowControls || pending || (me?.tokens ?? 0) < SKIP_COST} onClick={() => run('skip-song', (scope) => getSocket().emit('skip-song', scope))}><SkipForward size={16} aria-hidden="true" /> Skip · {SKIP_COST} token</button>
                  <button className="tunes-link" disabled={!allowControls || pending || (me?.tokens ?? 0) < BUY_CARD_COST || state.deckSize === 0} onClick={() => run('buy-card', (scope) => getSocket().emit('buy-card', scope))}><ShoppingBag size={16} aria-hidden="true" /> Buy card · {BUY_CARD_COST} tokens</button>
                </div>
              )}
            </>
          )}
          {contextError && !['dinner-guess', 'lock-guess', 'place-card', 'challenge', 'pass-challenge', 'name-song', 'done-guessing'].includes(errorAction ?? '') && <Message kind="error">{error}</Message>}
        </div>
        <aside className="tunes-stack tunes-game-sidebar" aria-label="Table information">
          <section className="tunes-panel">
            <div className="tunes-row-title"><h2>At the table</h2><Users size={21} aria-hidden="true" /></div>
            <ul className="tunes-player-list tunes-score-list">
              {seats.map((seat) => {
                const roles = [seat.id === hostId && 'Controller', seat.id === dj?.id && 'DJ', seat.id === speaker?.id && 'Speaker', !isDinner && seat.id === turnPlayer?.id && 'Guessing', isDinner && !state.turnOrder.includes(seat.id) && 'Watching', !seat.connected && 'Away'].filter(Boolean);
                const score = isDinner ? dinner?.scores[seat.id] ?? 0 : seat.timeline.length;
                return (
                  <li key={seat.id}>
                    <div className="tunes-avatar" aria-hidden="true">{seat.name[0]?.toUpperCase() || '?'}</div>
                    <div className="tunes-player-label"><b>{seat.name}{seat.id === myId ? ' (you)' : ''}</b>{roles.length > 0 && <span>{roles.join(' · ')}</span>}</div>
                    {!isCoop && <strong className="tunes-score">{score}<span className="sr-only">{isDinner ? ' points' : ' cards'}</span></strong>}
                    {!isDinner && seat.id === myId && <span className="tunes-tokens">{seat.tokens} <Star size={14} aria-hidden="true" /><span className="sr-only">tokens</span></span>}
                  </li>
                );
              })}
            </ul>
          </section>
          <section className="tunes-panel tunes-side-controls">
            <p><Headphones size={18} aria-hidden="true" /> {audioRole}</p>
            {hasMusicControls && isSpeaker && <label className="tunes-volume">Speaker volume <input aria-valuetext={`${Math.round(volume * 100)} percent`} type="range" min="0" max="1" step="0.05" value={volume} onChange={(event) => setVolume(Number(event.target.value))} /></label>}
            {isSpeaker && wakeLock !== 'off' && <p className="tunes-muted">{wakeLock === 'active' ? 'Speaker screen stays awake.' : 'Screen wake lock is unavailable.'}</p>}
            {timingFrozen && room.expiresAt && <p className="tunes-muted">Seat held until {new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(room.expiresAt)}.</p>}
            {hasMusicControls && (isController || isDJ || isSpeaker) && <button className="tunes-link" disabled={!allowControls || pending} onClick={() => runCue('replace-song')}><Repeat2 size={17} aria-hidden="true" /> Replace recording</button>}
            {isController && phase !== 'game_over' && !state.finalReveal && <button className="tunes-link" onClick={() => setEndConfirm(true)}>End match</button>}
          </section>
          {!isDinner && !isActive && !isDJ && phase === 'playing' && audio?.status === 'playing' && <WaitingState />}
        </aside>
      </div>
      {showHistory && (
        <TableDialog title="Songs this match" onClose={() => setShowHistory(false)}>
          {state.history?.length ? <ol className="tunes-reveal-picks">
            {[...state.history].reverse().map(({ song, roundNumber }) => <li key={roundNumber}><div><b>{song.title}</b><span>{song.artist}</span></div><strong>{song.year}</strong></li>)}
          </ol> : <p className="tunes-muted">Revealed recordings will appear here.</p>}
        </TableDialog>
      )}
      {leaveConfirm && (
        <TableDialog title="Leave this table?" onClose={() => setLeaveConfirm(false)}>
          <p className="tunes-muted">Your active seat will close.</p>
          <div className="tunes-inline"><button className="tunes-button tunes-button-secondary" onClick={() => setLeaveConfirm(false)}>Stay</button><button className="tunes-button tunes-button-primary" onClick={leaveTable}>Leave table</button></div>
        </TableDialog>
      )}
      {endConfirm && (
        <TableDialog title="End the match?" onClose={() => setEndConfirm(false)}>
          <p className="tunes-muted">The table will see the scores so far.</p>
          <div className="tunes-inline">
            <button className="tunes-button tunes-button-secondary" onClick={() => setEndConfirm(false)}>Keep playing</button>
            <button className="tunes-button tunes-button-primary" disabled={!allowControls || pending} onClick={() => {
              run('end-match', (scope) => getSocket().emit('end-match', scope));
              setEndConfirm(false);
            }}>End match</button>
          </div>
        </TableDialog>
      )}
    </main>
  );
}

export function Game() {
  const room = useGameStore((s) => s.room);
  const myId = useGameStore((s) => s.myId);
  if (!room) return null;
  return <RoundBoard key={`${room.gameState.matchId}:${room.gameState.roundId}`} room={room} myId={myId} />;
}
