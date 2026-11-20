import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameSettings, PlaybackMode, Room, SongCard } from '@tunes/shared';
import {
  ANCHOR_PREVIEW_MS, BUY_CARD_COST, CHALLENGE_WINDOW_MS, STARTING_TOKENS, TURN_TIME_MS,
} from '@tunes/shared';
import { GameEngine } from './game';

vi.mock('./shuffle', () => ({ fisherYatesShuffle: <T>(items: T[]) => items }));
vi.mock('./logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));

let nextId = 0;

function card(year: number, details?: Partial<SongCard>): SongCard {
  const id = String(++nextId);
  return {
    id, recordingId: 'recording-' + id, title: 'Song ' + id, artist: 'Artist ' + id,
    year, audioUrl: '/listening/' + id + '.mp3', spotifyTrackId: 'private-old-provider-id',
    ...details,
  };
}

function createRoom(ids: string[], options: Partial<GameSettings>, playbackMode: PlaybackMode): Room {
  return {
    code: 'TEST', hostId: ids[0], speakerId: ids[0], playbackMode,
    settings: { mode: 'original', cardsToWin: 10, songPack: 'standard', ...options },
    players: Object.fromEntries(ids.map((id, index) => [id, {
      name: 'Seat ' + id, id, connected: true, isHost: !index, timeline: [], tokens: STARTING_TOKENS,
    }])),
    gameState: {
      phase: 'lobby', currentTurnPlayerId: null, currentSong: null, pendingPlacement: null,
      challengers: [], turnOrder: [], turnIndex: 0, deckSize: 0, sharedTimeline: [],
    },
  };
}

const fakeIo = {} as ConstructorParameters<typeof GameEngine>[1];

function setup(options: {
  players?: string[]; settings?: Partial<GameSettings>; playback?: PlaybackMode; popOrder?: SongCard[];
  skipAnchors?: boolean; startAudio?: boolean;
} = {}) {
  const room = createRoom(options.players ?? ['a', 'b'], options.settings ?? {}, options.playback ?? 'licensed');
  const views = new Map<string, Room>();
  const onChange = vi.fn();
  const engine = new GameEngine(room, fakeIo, { onChange, send: (id, view) => views.set(id, view) });
  const deck = options.popOrder ?? [card(1990), card(1980), card(2000), card(2010)];
  engine.startGame([...deck].reverse());
  if (options.skipAnchors !== false) engine.skipAnchors();
  if (options.startAudio !== false && room.gameState.audio?.cueId) {
    engine.audioReady(room.gameState.audio.operatorId!, room.gameState.audio.cueId);
  }
  return { room, engine, deck, onChange, views, state: () => room.gameState };
}

type Setup = ReturnType<typeof setup>;

function audioReady(ctx: Setup) {
  return ctx.engine.audioReady(ctx.state().audio!.operatorId!, ctx.state().audio!.cueId!);
}

function finishGuess(ctx: Setup, position: number) {
  const id = ctx.state().currentTurnPlayerId!;
  ctx.engine.doneGuessing(id);
  ctx.engine.placeCard(id, position);
}

function addSpectator(ctx: Setup, id: string) {
  ctx.room.players[id] = { id, name: 'New guest', connected: true, tokens: STARTING_TOKENS, timeline: [], isHost: false };
  ctx.engine.addLatecomer(id);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-19T03:30:00Z'));
  nextId = 0;
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('Classic lifecycle', () => {
  it('deals anchor cards and starts an untimed cue after the anchor preview', () => {
    const ctx = setup({ skipAnchors: false });
    expect(ctx.state().phase).toBe('anchor_preview');
    expect(ctx.room.players.a.timeline.map(({ year }) => year)).toEqual([1990]);
    expect(ctx.room.players.b.timeline.map(({ year }) => year)).toEqual([1980]);
    expect(ctx.state().deckSize).toBe(2);
    expect(ctx.engine.skipAnchors('b').error).toBeTruthy();

    vi.advanceTimersByTime(ANCHOR_PREVIEW_MS);
    expect(ctx.state().deckSize).toBe(1);
    expect(ctx.state().currentSong?.year).toBe(2000);
    expect(ctx.state().audio?.status).toBe('awaiting_audio');
    expect(ctx.state().timing?.deadline).toBeNull();
    vi.advanceTimersByTime(3 * TURN_TIME_MS);
    expect(ctx.state().roundId).toBe(1);
    expect(ctx.engine.placeCard('a', 1).error).toBeTruthy();

    expect(audioReady(ctx).error).toBeUndefined();
    expect(ctx.state().timing?.deadline).toBe(Date.now() + TURN_TIME_MS);
    expect(ctx.engine.getHeardRecordingIds()).toEqual([ctx.deck[2].recordingId]);
  });

  it('shows only the actual speaker the clip route and keeps the recording hidden before reveal', () => {
    const ctx = setup({ startAudio: false });
    expect(ctx.views.get('a')?.gameState.audio?.source).toEqual({ url: ctx.deck[2].audioUrl });
    expect(ctx.views.get('a')?.gameState.audio?.recording).toBeUndefined();
    expect(ctx.views.get('b')?.gameState.audio?.source).toBeUndefined();
    expect(ctx.views.get('b')?.gameState.currentSong).toBeNull();
    expect(JSON.stringify(ctx.views.get('b'))).not.toContain(ctx.deck[2].title);
    expect(JSON.stringify(ctx.views.get('a'))).not.toContain('private-old-provider-id');
  });

  it('resolves early after passes and naming, holds the deciding recording, then posts one result', () => {
    const ctx = setup({ settings: { cardsToWin: 2 } });
    const onEnd = vi.fn();
    ctx.engine.onGameEnd(onEnd);
    expect(ctx.engine.placeCard('b', 1).error).toBeTruthy();
    expect(ctx.engine.placeCard('a', 80).error).toBeTruthy();

    expect(ctx.engine.placeCard('a', 1).error).toBeUndefined();
    expect(ctx.engine.passChallenge('b').error).toBeUndefined();
    expect(ctx.state().phase).toBe('challenge');
    expect(ctx.engine.doneGuessing('a').error).toBeUndefined();
    expect(ctx.state().phase).toBe('reveal');
    expect(ctx.state().finalReveal).toBe(true);
    expect(ctx.state().reveal?.correctPositions).toEqual([1]);
    expect(ctx.state().reveal?.song.audioUrl).toBeUndefined();
    expect(ctx.room.players.a.timeline.map(({ year }) => year)).toEqual([1990, 2000]);
    expect(onEnd).not.toHaveBeenCalled();
    expect(ctx.engine.confirmReveal('b').error).toBeTruthy();

    const scope = { matchId: ctx.state().matchId!, roundId: ctx.state().roundId!, actionId: 'continue' };
    const continueGame = () => ctx.engine.dispatch('a', 'confirm-reveal', scope, () => ctx.engine.confirmReveal('a'));
    expect(continueGame()).toEqual({});
    expect(continueGame()).toEqual({});
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(ctx.engine.getResult()).toMatchObject({
      status: 'won', reason: 'target-reached', winnerIds: ['a'], scores: { a: 2, b: 1 },
      margin: 1, decidingSong: { title: ctx.deck[2].title },
    });
  });

  it('attributes exactly one steal to an actual correct alternate placement and rejects collisions', () => {
    const ctx = setup({
      players: ['a', 'b', 'c', 'd'],
      popOrder: [card(1990), card(1980), card(1970), card(1960), card(2000), card(2020)],
    });
    ctx.room.players.a.timeline.unshift(card(1985));
    finishGuess(ctx, 0);
    expect(ctx.engine.challenge('b', 0).code).toBe('CHALLENGE_COLLISION');
    expect(ctx.engine.challenge('b', 1)).toEqual({});
    expect(ctx.engine.challenge('c', 1).code).toBe('CHALLENGE_COLLISION');
    expect(ctx.room.players.c.tokens).toBe(STARTING_TOKENS);
    expect(ctx.engine.challenge('c', 2)).toEqual({});
    expect(ctx.engine.challenge('c', 2)).toEqual({});
    expect(ctx.engine.passChallenge('d')).toEqual({});

    expect(ctx.state().reveal?.challengeResults).toEqual({
      b: { position: 1, correct: false }, c: { position: 2, correct: true },
    });
    expect(ctx.state().reveal?.stolenBy).toBe('c');
    expect(ctx.room.players.c.timeline.map(({ year }) => year)).toEqual([1970, 2000]);
    expect(ctx.room.players.c.tokens).toBe(STARTING_TOKENS - 1);
    expect(ctx.engine.getGameStats().playerStats.get('c')?.challengesWon).toBe(1);
    expect(ctx.engine.getGameStats().playerStats.get('b')?.challengesLost).toBe(1);
  });

  it('treats a valid equal-year rival gap as a failed steal when the active placement succeeds', () => {
    const ctx = setup({ popOrder: [card(1990), card(1980), card(1990), card(2010)] });
    finishGuess(ctx, 0);
    ctx.engine.challenge('b', 1);
    expect(ctx.state().reveal?.correctPositions).toEqual([0, 1]);
    expect(ctx.state().reveal?.challengeResults?.b.correct).toBe(false);
    expect(ctx.state().reveal?.winnerId).toBe('a');
  });

  it('keeps a disconnected opponent bounded by the challenge deadline', () => {
    const ctx = setup();
    finishGuess(ctx, 1);
    const originalDeadline = ctx.state().timing!.deadline;
    ctx.room.players.b.connected = false;
    ctx.engine.handlePlayerDisconnect('b');
    expect(ctx.state().timing!.deadline).toBe(originalDeadline);
    vi.advanceTimersByTime(CHALLENGE_WINDOW_MS - 1);
    expect(ctx.state().phase).toBe('challenge');
    vi.advanceTimersByTime(1);
    expect(ctx.state().phase).toBe('reveal');
  });

  it('charges a purchase once across duplicate delivery and updates deck size immediately', () => {
    const ctx = setup();
    ctx.room.players.a.tokens = BUY_CARD_COST;
    const scope = { matchId: ctx.state().matchId!, roundId: ctx.state().roundId!, actionId: 'buy' };
    const buy = () => ctx.engine.dispatch('a', 'buy-card', scope, () => ctx.engine.buyCard('a'));
    expect(buy()).toEqual({});
    expect(buy()).toEqual({});
    expect(ctx.room.players.a.tokens).toBe(0);
    expect(ctx.room.players.a.timeline.map(({ year }) => year)).toEqual([1990, 2010]);
    expect(ctx.views.get('b')?.gameState.deckSize).toBe(0);
    expect(ctx.engine.skipSong('a').error).toBeTruthy();
    vi.advanceTimersByTime(TURN_TIME_MS);
    expect(ctx.state().phase).toBe('reveal');
    expect(ctx.state().finalReveal).toBe(true);
    ctx.engine.confirmReveal('a');
    expect(ctx.engine.getResult()?.reason).toBe('deck-exhausted');
  });

  it('retains Classic late joining and rejects an action from a stale round', () => {
    const ctx = setup({ popOrder: [card(1950), card(1960), card(1970), card(1980), card(1990)] });
    addSpectator(ctx, 'late');
    expect(ctx.state().turnOrder).toEqual(['a', 'late', 'b']);
    expect(ctx.room.players.late.timeline).toHaveLength(1);
    const oldScope = { matchId: ctx.state().matchId!, roundId: ctx.state().roundId! };
    expect(ctx.engine.skipSong('a')).toEqual({});
    expect(ctx.state().currentTurnPlayerId).toBe('late');
    const stale = vi.fn();
    expect(ctx.engine.dispatch('a', 'place-card', oldScope, stale).code).toBe('ROUND_MOVED_ON');
    expect(stale).not.toHaveBeenCalled();
  });
});

describe('Mode requirements and explicit outcomes', () => {
  it('requires Pro title and artist, without awarding a card for a correct placement alone', () => {
    const ctx = setup({ settings: { mode: 'pro' } });
    const song = ctx.state().currentSong!;
    ctx.engine.nameSong('a', { title: song.title, artist: '' });
    ctx.engine.placeCard('a', 1);
    ctx.engine.passChallenge('b');
    expect(ctx.state().reveal?.modeResult).toMatchObject({ placementCorrect: true, songNamed: false });
    expect(ctx.state().reveal?.winnerId).toBeNull();

    ctx.engine.confirmReveal('a');
    audioReady(ctx);
    const next = ctx.state().currentSong!;
    ctx.engine.nameSong('b', { title: next.title, artist: next.artist });
    ctx.engine.placeCard('b', 1);
    ctx.engine.passChallenge('a');
    expect(ctx.state().reveal?.winnerId).toBe('b');
  });

  it('rejects a missing/incomplete Expert year without spending the naming attempt', () => {
    const ctx = setup({ settings: { mode: 'expert' } });
    const { title, artist, year } = ctx.state().currentSong!;
    expect(ctx.engine.nameSong('a', { title, artist }).code).toBe('EXPERT_YEAR_REQUIRED');
    expect(ctx.engine.nameSong('a', { title, artist, year: 20 }).code).toBe('EXPERT_YEAR_REQUIRED');
    expect(ctx.views.get('a')?.gameState.classic?.myNamed).toBe(false);
    expect(ctx.engine.nameSong('a', { title, artist, year })).toEqual({});
    expect(ctx.views.get('a')?.gameState.classic?.myNamingResult?.correct).toBe(true);
    expect(ctx.views.get('b')?.gameState.classic?.myNamingResult).toBeUndefined();
    ctx.engine.placeCard('a', 1);
    ctx.engine.passChallenge('b');
    expect(ctx.state().reveal?.modeResult?.yearCorrect).toBe(true);
    expect(ctx.state().reveal?.winnerId).toBe('a');
  });

  it('scores a 1/10 co-op finish as a loss and a successful target as a team win', () => {
    const lost = setup({ settings: { mode: 'coop' }, popOrder: [card(1980), card(2000)] });
    finishGuess(lost, 0);
    expect(lost.room.players.a.tokens).toBe(STARTING_TOKENS - 1);
    expect(lost.state().sharedTimeline).toHaveLength(1);
    expect(lost.state().phase).toBe('reveal');
    lost.engine.confirmReveal('a');
    expect(lost.engine.getResult()).toMatchObject({
      status: 'lost', reason: 'deck-exhausted', winnerIds: [], scores: { a: 1, b: 1 },
    });

    const won = setup({ settings: { mode: 'coop', cardsToWin: 2 }, popOrder: [card(1980), card(2000)] });
    finishGuess(won, 1);
    won.engine.confirmReveal('a');
    expect(won.engine.getResult()).toMatchObject({ status: 'won', reason: 'target-reached', winnerIds: ['a', 'b'] });
  });

  it('records a tied Classic finish by public seat id, even with identical stage names', () => {
    const ctx = setup({ popOrder: [card(1980), card(1985), card(2000)] });
    ctx.room.players.a.name = ctx.room.players.b.name = 'Alex';
    finishGuess(ctx, 0);
    ctx.engine.passChallenge('b');
    ctx.engine.confirmReveal('a');
    expect(ctx.engine.getResult()).toMatchObject({ status: 'tied', winnerIds: ['a', 'b'], margin: 0, decidingSong: null });
  });

  it('preserves a final reveal after a failed result transaction and retries once without rescore', () => {
    const ctx = setup({ settings: { cardsToWin: 2 } });
    const save = vi.fn().mockImplementationOnce(() => { throw Error('simulated transaction failure'); });
    ctx.engine.onGameEnd(save);
    finishGuess(ctx, 1);
    ctx.engine.passChallenge('b');
    expect(ctx.engine.confirmReveal('a').code).toBe('RESULT_SAVE_FAILED');
    expect(ctx.state().phase).toBe('reveal');
    expect(ctx.engine.getResult()).toBeNull();
    expect(ctx.room.players.a.timeline).toHaveLength(2);
    expect(ctx.engine.confirmReveal('a')).toEqual({});
    expect(ctx.engine.confirmReveal('a').error).toBeTruthy();
    expect(ctx.engine.getGameStats().totalRounds).toBe(1);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('allows only the controller to end an active match and records abandonment idempotently', () => {
    const ctx = setup();
    const save = vi.fn();
    ctx.engine.onGameEnd(save);
    const { matchId, roundId } = ctx.state();
    const scope = { matchId: matchId!, roundId: roundId!, actionId: 'end' };
    expect(ctx.engine.dispatch('b', 'end-match', scope, () => ctx.engine.endMatch('b')).error).toBeTruthy();
    expect(ctx.state().phase).toBe('playing');

    const end = () => ctx.engine.dispatch('a', 'end-match', scope, () => ctx.engine.endMatch('a'));
    expect(end()).toEqual({});
    expect(end()).toEqual({});
    expect(ctx.state().phase).toBe('game_over');
    expect(ctx.state().audio?.status).toBe('idle');
    expect(ctx.engine.getResult()).toMatchObject({ status: 'abandoned', reason: 'abandoned', winnerIds: [] });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed abandonment active and preserves a final scoring result', () => {
    const ctx = setup({ settings: { cardsToWin: 2 } });
    const save = vi.fn().mockImplementationOnce(() => { throw Error('database unavailable'); });
    ctx.engine.onGameEnd(save);
    expect(ctx.engine.endMatch('a').code).toBe('RESULT_SAVE_FAILED');
    expect(ctx.state().phase).toBe('playing');
    expect(ctx.state().audio?.status).toBe('playing');
    finishGuess(ctx, 1);
    ctx.engine.passChallenge('b');
    expect(ctx.engine.endMatch('a').error).toBeTruthy();
    expect(ctx.state().phase).toBe('reveal');
    ctx.engine.confirmReveal('a');
    expect(ctx.engine.getResult()?.winnerIds).toEqual(['a']);
  });
});

describe('Audio handoff and recovery', () => {
  it('keeps a healthy speaker running when the controller alone goes away', () => {
    const ctx = setup({});
    ctx.engine.assignSpeaker('a', 'b');
    audioReady(ctx);
    const deadline = ctx.state().timing!.deadline;
    ctx.room.players.a.connected = false;
    ctx.room.hostId = 'b';
    ctx.engine.handlePlayerDisconnect('a');
    expect(ctx.state().audio).toMatchObject({ operatorId: 'b', status: 'playing' });
    expect(ctx.state().timing?.deadline).toBe(deadline);
  });

  it('freezes the exact challenge clock and ignores old acknowledgements when audio returns', () => {
    const ctx = setup();
    finishGuess(ctx, 1);
    const firstCue = ctx.state().audio!.cueId!;
    vi.advanceTimersByTime(6000);
    ctx.room.players.a.connected = false;
    ctx.engine.handlePlayerDisconnect('a');
    expect(ctx.state().audio?.status).toBe('paused');
    expect(ctx.state().timing).toEqual({ deadline: null, remainingMs: CHALLENGE_WINDOW_MS - 6000 });

    vi.advanceTimersByTime(360000);
    ctx.room.players.a.connected = true;
    ctx.engine.handlePlayerReconnect('a');
    expect(ctx.state().pendingPlacement).toBe(1);
    expect(ctx.engine.audioReady('a', firstCue).error).toBeTruthy();
    expect(ctx.engine.resumeAudio('a', firstCue)).toEqual({});
    expect(ctx.state().audio?.cueId).not.toBe(firstCue);
    expect(ctx.engine.audioReady('a', firstCue).code).toBe('CUE_MOVED_ON');

    audioReady(ctx);
    expect(ctx.state().timing?.deadline).toBe(Date.now() + CHALLENGE_WINDOW_MS - 6000);
    vi.advanceTimersByTime(CHALLENGE_WINDOW_MS - 6000);
    expect(ctx.state().phase).toBe('reveal');
    expect(ctx.state().reveal?.winnerId).toBe('a');
  });

  it('rotates the manual DJ without allowing the DJ to name, place or challenge', () => {
    const ctx = setup({ playback: 'manual', startAudio: false });
    const first = ctx.state().audio!.cueId!;
    expect(ctx.state().audio?.operatorId).toBe('b');
    expect(ctx.views.get('b')?.gameState.audio?.recording?.title).toBe(ctx.deck[2].title);
    expect(ctx.views.get('a')?.gameState.audio?.recording).toBeUndefined();
    expect(ctx.views.get('b')?.gameState.audio?.source).toBeUndefined();
    expect(ctx.engine.audioReady('a', first).error).toBeTruthy();

    ctx.room.players.b.connected = false;
    ctx.engine.handlePlayerDisconnect('b');
    vi.advanceTimersByTime(60000);
    expect(ctx.state().audio?.cueId).toBe(first);
    ctx.room.players.b.connected = true;
    ctx.engine.handlePlayerReconnect('b');
    expect(audioReady(ctx)).toEqual({});
    expect(ctx.engine.nameSong('b', { title: ctx.deck[2].title, artist: ctx.deck[2].artist }).error).toBeTruthy();
    expect(ctx.engine.placeCard('b', 1).error).toBeTruthy();
    finishGuess(ctx, 1);
    expect(ctx.state().phase).toBe('reveal');
    ctx.engine.confirmReveal('a');
    expect(ctx.state().audio?.operatorId).toBe('a');
    expect(ctx.state().currentTurnPlayerId).toBe('b');
  });

  it('replaces a wrong recording without retaining its challenge or naming costs', () => {
    const ctx = setup({
      players: ['a', 'b', 'c', 'd'], playback: 'manual',
      popOrder: [card(1980), card(1980), card(1980), card(1980), card(2000), card(2010)],
    });
    const originalCue = ctx.state().audio!.cueId!;
    ctx.engine.nameSong('a', { title: ctx.deck[4].title, artist: '' });
    ctx.engine.placeCard('a', 0);
    ctx.engine.challenge('c', 1);
    expect(ctx.engine.assignSpeaker('a', 'c')).toEqual({});
    expect(ctx.state().audio?.operatorId).toBe('c');
    expect(ctx.state().audio?.cueId).not.toBe(originalCue);
    expect(ctx.state().pendingPlacement).toBeNull();
    expect(ctx.room.players.a.tokens).toBe(STARTING_TOKENS);
    expect(ctx.room.players.c.tokens).toBe(STARTING_TOKENS);
    expect(ctx.engine.getGameStats().totalRounds).toBe(0);
    expect(ctx.engine.getSongHistory()).toHaveLength(0);
  });

  it('pauses a recording that loses its authorization and closes a spent deck without scoring it', () => {
    const rightsUntil = new Date(Date.now() + 10000).toISOString();
    const ctx = setup({ popOrder: [card(1980), card(1980), card(2000, { rightsUntil })] });
    vi.advanceTimersByTime(10000);
    const audio = ctx.state().audio!;
    expect(audio.status).toBe('paused');
    expect(ctx.views.get('a')?.gameState.audio?.source).toBeUndefined();
    expect(ctx.engine.resumeAudio('a', audio.cueId!).error).toBeTruthy();
    expect(ctx.engine.replaceSong('a', audio.cueId!)).toEqual({});
    expect(ctx.engine.getResult()).toMatchObject({ reason: 'deck-exhausted' });
    expect(ctx.engine.getSongHistory()).toHaveLength(0);
  });

  it('restores an unclean restart as a paused listening cue, then restores reveal and results', () => {
    const ctx = setup({ settings: { cardsToWin: 2 } });
    vi.advanceTimersByTime(4800);
    const roomAfterRestart = structuredClone(ctx.room);
    const saved = ctx.engine.serialize();
    ctx.engine.dispose();
    vi.advanceTimersByTime(360000);
    const restored = new GameEngine(roomAfterRestart, fakeIo);
    restored.restore(saved);
    expect(restored.publicRoom('b').gameState.currentSong).toBeNull();
    expect(roomAfterRestart.gameState.audio).toMatchObject({ status: 'paused', reason: 'server-restart' });
    expect(roomAfterRestart.gameState.timing).toEqual({ deadline: null, remainingMs: TURN_TIME_MS - 4800 });
    const { cueId, operatorId } = roomAfterRestart.gameState.audio!;
    expect(restored.resumeAudio(operatorId!, cueId!)).toEqual({});
    restored.audioReady(operatorId!, roomAfterRestart.gameState.audio!.cueId!);
    restored.doneGuessing('a');
    restored.placeCard('a', 1);
    restored.passChallenge('b');

    const reveal = new GameEngine(roomAfterRestart, fakeIo);
    reveal.restore(restored.serialize());
    expect(reveal.publicRoom('b').gameState.reveal?.correct).toBe(true);
    expect(roomAfterRestart.gameState.audio?.status).toBe('idle');
    reveal.confirmReveal('a');
    const results = new GameEngine(roomAfterRestart, fakeIo);
    results.restore(reveal.serialize());
    expect(results.publicRoom('a').gameState.result?.winnerIds).toEqual(['a']);
    expect(results.publicRoom('a').gameState.stats?.totalRounds).toBe(1);
  });

  it('pauses anchor preview while everyone is away and returns to the same anchor preview', () => {
    const ctx = setup({ skipAnchors: false });
    vi.advanceTimersByTime(1000);
    for (const player of Object.values(ctx.room.players)) {
      player.connected = false;
      ctx.engine.handlePlayerDisconnect(player.id);
    }
    vi.advanceTimersByTime(360000);
    expect(ctx.state().phase).toBe('anchor_preview');
    expect(ctx.state().timing?.remainingMs).toBe(ANCHOR_PREVIEW_MS - 1000);
    ctx.room.players.a.connected = true;
    ctx.engine.handlePlayerReconnect('a');
    vi.advanceTimersByTime(ANCHOR_PREVIEW_MS - 1000);
    expect(ctx.state().phase).toBe('playing');
    expect(ctx.state().currentSong).toEqual(ctx.deck[2]);
  });
});

describe('Dinner Set', () => {
  it('allows secret revisions, locks each seat, and accepts two equal-year gaps', () => {
    const ctx = setup({
      players: ['a', 'b', 'c'],
      settings: { mode: 'dinner', dinnerRounds: 2 },
      popOrder: [card(1940), card(1990), card(1990), card(1990), card(2020)],
    });
    expect(ctx.state().sharedTimeline.map(({ year }) => year)).toEqual([1940, 1990, 2020]);
    expect(ctx.state().currentTurnPlayerId).toBeNull();
    expect(ctx.engine.dinnerGuess('a', 0)).toEqual({});
    expect(ctx.engine.dinnerGuess('a', 1)).toEqual({});
    expect(ctx.engine.lockGuess('a')).toEqual({});
    expect(ctx.engine.dinnerGuess('a', 3).error).toBeTruthy();
    expect(ctx.views.get('a')?.gameState.dinner).toMatchObject({ myPosition: 1, myLocked: true, submittedCount: 1 });
    expect(ctx.views.get('b')?.gameState.dinner).toMatchObject({ myPosition: null, myLocked: false, submittedCount: 1 });

    addSpectator(ctx, 'late');
    expect(ctx.engine.lockGuess('late', 1).error).toBeTruthy();
    expect(ctx.engine.lockGuess('b', 2)).toEqual({});
    expect(ctx.engine.lockGuess('c', 1)).toEqual({});
    expect(ctx.state().reveal?.correctPositions).toEqual([1, 2]);
    expect(ctx.state().reveal?.dinnerGuesses).toEqual({
      a: { position: 1, correct: true, points: 1 },
      b: { position: 2, correct: true, points: 1 },
      c: { position: 1, correct: true, points: 1 },
    });
    expect(ctx.state().sharedTimeline).toHaveLength(4);
    expect(ctx.views.get('late')?.gameState.dinner?.eligiblePlayerIds).toEqual(['a', 'b', 'c']);
  });

  it('honors an accepted guess after disconnect and rejects a final arrival at the deadline', () => {
    const ctx = setup({
      players: ['a', 'b', 'c'],
      settings: { mode: 'dinner', dinnerRounds: 1 },
      popOrder: [card(1940), card(1980), card(2000), card(2020)],
    });
    const { matchId, roundId, timing } = ctx.state();
    expect(ctx.engine.lockGuess('b', 0)).toEqual({});
    ctx.room.players.b.connected = false;
    ctx.engine.handlePlayerDisconnect('b');
    const validGap = ctx.state().sharedTimeline.findIndex((other) => other.year > ctx.state().currentSong!.year);
    expect(validGap).toBeGreaterThan(0);
    expect(ctx.engine.dinnerGuess('a', validGap)).toEqual({});
    vi.setSystemTime(timing!.deadline!);
    const late = ctx.engine.dispatch('c', 'lock-guess', { matchId: matchId!, roundId: roundId! },
      () => ctx.engine.lockGuess('c', validGap));
    expect(late.code).toBe('ROUND_MOVED_ON');
    expect(ctx.state().reveal?.dinnerGuesses).toEqual({
      a: { position: null, correct: false, points: 0 },
      b: { position: 0, correct: false, points: 0 },
      c: { position: null, correct: false, points: 0 },
    });
    expect(ctx.state().sharedTimeline).toHaveLength(4);
    expect(ctx.engine.getGameStats().totalRounds).toBe(1);
    expect(ctx.state().finalReveal).toBe(true);
    expect(ctx.engine.confirmReveal('a')).toEqual({});
    expect(ctx.engine.getResult()).toMatchObject({ status: 'tied', reason: 'set-complete', winnerIds: ['a', 'b', 'c'] });
  });

  it('runs even manual rotations and switches a leaked cue without counting it', () => {
    const ctx = setup({
      players: ['a', 'b', 'c', 'd'], playback: 'manual',
      settings: { mode: 'dinner' }, skipAnchors: true, startAudio: false,
      popOrder: Array.from({ length: 13 }, (_, ix) => card(1940 + ix * 7)),
    });
    const firstCue = ctx.state().audio!.cueId;
    const firstSong = ctx.state().currentSong;
    expect(ctx.state().audio?.operatorId).toBe('a');
    expect(ctx.engine.assignSpeaker('a', 'c')).toEqual({});
    expect(ctx.state().audio?.cueId).not.toBe(firstCue);
    expect(ctx.state().currentSong).not.toEqual(firstSong);
    const djs: string[] = [];
    for (let i = 0; i < 8; i++) {
      const operator = ctx.state().audio!.operatorId!;
      djs.push(operator);
      expect(audioReady(ctx)).toEqual({});
      expect(ctx.engine.lockGuess(operator, 0).error).toBeTruthy();
      const eligible = ['a', 'b', 'c', 'd'].filter((id) => id !== operator);
      for (const id of eligible) expect(ctx.engine.lockGuess(id, 0)).toEqual({});
      expect(ctx.state().phase).toBe('reveal');
      expect(Object.keys(ctx.state().reveal!.dinnerGuesses!)).toEqual(eligible);
      expect(ctx.engine.confirmReveal('a')).toEqual({});
    }
    expect(djs).toEqual(['c', 'b', 'a', 'd', 'a', 'b', 'c', 'd']);
    expect(ctx.engine.getSongHistory()).toHaveLength(8);
    expect(ctx.state().phase).toBe('game_over');
    expect(ctx.engine.setRematchConsent('b', true)).toEqual({});
    expect(ctx.engine.setRematchConsent('b', true)).toEqual({});
    expect(ctx.engine.setRematchConsent('late', true).error).toBeTruthy();
    expect(ctx.state().rematchPlayerIds).toEqual(['b']);
    expect(ctx.engine.setRematchConsent('b', false)).toEqual({});
    expect(ctx.state().rematchPlayerIds).toEqual([]);
  });

  it('lets a dedicated DJ cue every track without appearing on the score board', () => {
    const ctx = setup({
      players: ['dj', 'a', 'b'], settings: { mode: 'dinner', dedicatedDjId: 'dj', dinnerRounds: 1 },
      playback: 'manual',
    });
    expect(ctx.state().audio?.operatorId).toBe('dj');
    expect(ctx.views.get('a')?.gameState.dinner?.eligiblePlayerIds).toEqual(['a', 'b']);
    expect(ctx.views.get('a')?.gameState.dinner?.scores).toEqual({ a: 0, b: 0 });
    expect(ctx.engine.lockGuess('dj', 0).error).toBeTruthy();
  });
});

describe('Durable transitions and permanent departures', () => {
  it('restores the exact action state on checkpoint failure and accepts a retried receipt', () => {
    const ctx = setup();
    ctx.room.players.a.tokens = BUY_CARD_COST;
    const before = ctx.engine.serialize();
    const { matchId, roundId } = ctx.state();
    const scope = { matchId: matchId!, roundId: roundId!, actionId: 'durable-purchase' };
    const buy = () => ctx.engine.dispatch('a', 'buy-card', scope, () => ctx.engine.buyCard('a'));
    ctx.onChange.mockImplementationOnce(() => { throw Error('checkpoint failure'); });

    expect(buy).toThrow('checkpoint failure');
    expect(ctx.engine.serialize()).toEqual(before);
    expect(ctx.room.players.a.tokens).toBe(BUY_CARD_COST);
    expect(ctx.views.get('b')?.gameState.deckSize).toBe(1);
    expect(buy()).toEqual({});
    expect(buy()).toEqual({});
    expect(ctx.views.get('b')?.gameState.deckSize).toBe(0);
    expect(ctx.room.players.a.tokens).toBe(0);
  });

  it('retries a missed timed write without double scoring or extending the challenge deadline', () => {
    const ctx = setup();
    finishGuess(ctx, 1);
    const oldDeadline = ctx.state().timing?.deadline;
    let failed = false;
    ctx.onChange.mockImplementation(() => {
      if (ctx.state().phase === 'reveal' && !failed) {
        failed = true;
        throw Error('checkpoint failure');
      }
    });
    vi.advanceTimersByTime(CHALLENGE_WINDOW_MS);
    expect(failed).toBe(true);
    expect(ctx.state().timing?.deadline).toBe(oldDeadline);
    expect(ctx.state().phase).toBe('challenge');
    expect(ctx.room.players.a.timeline).toHaveLength(1);
    expect(ctx.engine.getSongHistory()).toHaveLength(0);
    vi.advanceTimersByTime(1000);
    expect(ctx.state().phase).toBe('reveal');
    expect(ctx.room.players.a.timeline).toHaveLength(2);
    expect(ctx.engine.getSongHistory()).toHaveLength(1);
  });

  it('rotates away from a voluntarily departed Classic guesser without spending their token', () => {
    const ctx = setup({ players: ['a', 'b', 'c'], popOrder: [card(1980), card(1985), card(1990), card(2000), card(2010)] });
    ctx.engine.assignSpeaker('a', 'c');
    audioReady(ctx);
    ctx.room.players.a.connected = false;
    ctx.room.hostId = 'b';
    ctx.engine.handlePlayerVoluntaryLeave('a');
    expect(ctx.state().currentTurnPlayerId).toBe('b');
    expect(ctx.state().audio?.operatorId).toBe('c');
    expect(ctx.room.players.a.tokens).toBe(STARTING_TOKENS);
    expect(ctx.engine.getGameStats().totalRounds).toBe(0);

    audioReady(ctx);
    finishGuess(ctx, 1);
    expect(ctx.engine.publicRoom('c').gameState.classic?.eligibleChallengerIds).toEqual(['c']);
    ctx.engine.passChallenge('c');
    expect(ctx.state().phase).toBe('reveal');
  });

  it('keeps an accepted Classic placement when its guesser leaves during challenge', () => {
    const ctx = setup({ players: ['a', 'b', 'c'], popOrder: [card(1980), card(1985), card(1990), card(2000)] });
    ctx.engine.assignSpeaker('a', 'c');
    audioReady(ctx);
    ctx.engine.placeCard('a', 1);
    ctx.engine.passChallenge('b');
    ctx.room.players.a.connected = false;
    ctx.room.hostId = 'b';
    ctx.engine.handlePlayerVoluntaryLeave('a');
    expect(ctx.state().pendingPlacement).toBe(1);
    ctx.engine.passChallenge('c');
    expect(ctx.state().reveal?.winnerId).toBe('a');
    expect(ctx.state().phase).toBe('reveal');
  });

  it('keeps a Classic late arrival as spectator when offering an anchor would consume the last playable song', () => {
    const ctx = setup();
    const deckSize = ctx.state().deckSize;
    addSpectator(ctx, 'late');
    expect(ctx.state().deckSize).toBe(deckSize);
    expect(ctx.state().turnOrder).not.toContain('late');
    expect(ctx.room.players.late.timeline).toEqual([]);
  });

  it('preserves Dinner Set opportunities for remaining players when a rotating DJ leaves permanently', () => {
    const ctx = setup({
      players: ['a', 'b', 'c', 'd'], settings: { mode: 'dinner' }, playback: 'manual',
      popOrder: Array.from({ length: 13 }, (_, ix) => card(1940 + ix * 7)),
    });
    ctx.room.players.a.connected = false;
    ctx.room.hostId = 'b';
    ctx.engine.handlePlayerVoluntaryLeave('a');
    expect(ctx.state().audio?.operatorId).toBe('b');
    expect(ctx.engine.getSongHistory()).toHaveLength(0);
    expect(ctx.engine.publicRoom('c').gameState.dinner?.roundCount).toBe(6);
    expect(ctx.engine.publicRoom('c').gameState.dinner?.eligiblePlayerIds).toEqual(['c', 'd']);
    const djs: string[] = [];
    for (let i = 0; i < 6; i++) {
      djs.push(ctx.state().audio!.operatorId!);
      expect(audioReady(ctx)).toEqual({});
      for (const id of ['b', 'c', 'd'].filter(pid => pid !== djs[i])) ctx.engine.lockGuess(id, 0);
      expect(ctx.state().phase).toBe('reveal');
      expect(ctx.engine.confirmReveal('b')).toEqual({});
    }
    expect(djs).toEqual(['b', 'c', 'd', 'b', 'c', 'd']);
    expect(ctx.engine.getGameStats().totalRounds).toBe(6);
    expect(ctx.engine.getResult()?.reason).toBe('set-complete');
  });

  it('restores the exact anchors and the remaining anchor timer after a process restart', () => {
    const ctx = setup({ skipAnchors: false });
    vi.advanceTimersByTime(700);
    const saved = ctx.engine.serialize();
    const room = structuredClone(ctx.room);
    ctx.engine.dispose();
    vi.advanceTimersByTime(6 * 60 * 1000);
    const restored = new GameEngine(room, fakeIo);
    restored.restore(saved);
    expect(room.gameState.phase).toBe('anchor_preview');
    expect(room.gameState.deckSize).toBe(2);
    expect(room.players.a.timeline).toEqual(ctx.room.players.a.timeline);
    restored.handlePlayerReconnect('b');
    vi.advanceTimersByTime(ANCHOR_PREVIEW_MS - 701);
    expect(room.gameState.phase).toBe('anchor_preview');
    vi.advanceTimersByTime(1);
    expect(room.gameState.currentSong?.recordingId).toBe(ctx.deck[2].recordingId);
  });

  it('restores a frozen challenge with existing decisions and the current pack authorization', () => {
    const ctx = setup({
      players: ['a', 'b', 'c'],
      popOrder: [card(1980), card(1985), card(1990), card(2000), card(2010)],
    });
    finishGuess(ctx, 0);
    ctx.engine.challenge('b', 1);
    vi.advanceTimersByTime(700);
    const saved = ctx.engine.serialize();
    const room = structuredClone(ctx.room);
    ctx.engine.dispose();
    const restored = new GameEngine(room, fakeIo);
    restored.restore(saved);
    expect(room.gameState.phase).toBe('challenge');
    expect(room.gameState.timing).toEqual({ deadline: null, remainingMs: CHALLENGE_WINDOW_MS - 700 });
    expect(restored.publicRoom('c').gameState.classic?.challengePositions).toEqual({ b: 1 });
    const cue = room.gameState.audio!.cueId!;
    restored.resumeAudio('a', cue);
    restored.audioReady('a', room.gameState.audio!.cueId!);
    restored.passChallenge('c');
    expect(room.gameState.reveal?.stolenBy).toBe('b');

    const restrictedRoom = structuredClone(ctx.room);
    const retiredId = saved.state.currentSong?.id;
    const restricted = new GameEngine(restrictedRoom, fakeIo, { canPlay: (song) => song.id !== retiredId });
    restricted.restore(saved);
    expect(restricted.publicRoom('a').gameState.audio).toMatchObject({ status: 'paused', reason: 'audio-unavailable' });
    expect(restricted.publicRoom('a').gameState.audio?.source).toBeUndefined();
    expect(restricted.resumeAudio('a', cue).error).toBeTruthy();
    expect(restricted.replaceSong('a', cue)).toEqual({});
    expect(restrictedRoom.gameState.audio?.status).toBe('awaiting_audio');
    expect(restrictedRoom.gameState.currentSong?.year).toBe(2010);
    expect(restrictedRoom.players.b.tokens).toBe(STARTING_TOKENS);
  });
});
