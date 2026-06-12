import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameSettings, Player, Room, SongCard } from '@tunes/shared';
import {
  STARTING_TOKENS,
  MAX_TOKENS,
  SKIP_COST,
  CHALLENGE_COST,
  BUY_CARD_COST,
  CHALLENGE_WINDOW_MS,
  TURN_TIME_MS,
  COOP_WRONG_PENALTY,
  DISCONNECT_GRACE_MS,
} from '@tunes/shared';

// Silence structured logging during tests
vi.mock('./logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Make turn order deterministic: identity "shuffle" keeps player insertion order
vi.mock('./shuffle', () => ({
  fisherYatesShuffle: <T>(array: T[]): T[] => array,
}));

import { GameEngine } from './game';

const ANCHOR_PREVIEW_MS = 3500; // game.ts hard-codes this delay before the first turn
const COOP_RESOLVE_DELAY_MS = 2000; // game.ts hard-codes this resolve delay in co-op

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface EmittedEvent {
  event: string;
  payload: unknown;
}

function createFakeIo() {
  const events: EmittedEvent[] = [];
  const io = {
    to: (_room: string) => ({
      emit: (event: string, payload?: unknown) => {
        events.push({ event, payload });
        return true;
      },
    }),
  };
  return {
    io: io as unknown as ConstructorParameters<typeof GameEngine>[1],
    events,
    eventsOf: (name: string) => events.filter((e) => e.event === name),
    lastEvent: (name: string) => {
      const all = events.filter((e) => e.event === name);
      return all.length > 0 ? all[all.length - 1].payload : undefined;
    },
    clearEvents: () => {
      events.length = 0;
    },
  };
}

let cardSeq = 0;

function makeCard(year: number, overrides: Partial<SongCard> = {}): SongCard {
  cardSeq++;
  return {
    id: `card-${cardSeq}`,
    title: `Song ${cardSeq}`,
    artist: `Artist ${cardSeq}`,
    year,
    ...overrides,
  };
}

function makePlayer(id: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    name: `Name-${id}`,
    timeline: [],
    tokens: STARTING_TOKENS,
    isHost: false,
    connected: true,
    ...overrides,
  };
}

function makeRoom(playerIds: string[], settings: Partial<GameSettings> = {}): Room {
  const players: Record<string, Player> = {};
  for (const id of playerIds) {
    players[id] = makePlayer(id, { isHost: id === playerIds[0] });
  }
  return {
    code: 'TEST',
    players,
    hostId: playerIds[0],
    originalHostId: playerIds[0],
    settings: { mode: 'original', cardsToWin: 10, songPack: 'standard', ...settings },
    gameState: {
      phase: 'lobby',
      currentTurnPlayerId: null,
      currentSong: null,
      pendingPlacement: null,
      challengers: [],
      turnOrder: [],
      turnIndex: 0,
      deckSize: 0,
      sharedTimeline: [],
    },
  };
}

/**
 * GameEngine consumes the deck with pop() (last element first). This helper
 * lets tests list cards in the order they will actually be drawn:
 * popOrder[0] is the first card dealt, popOrder[1] the second, and so on.
 *
 * In original/pro/expert, the first N cards are anchor cards for the N players
 * (in player insertion order). In co-op the first card seeds the shared
 * timeline. Cards after that are the per-turn songs in order.
 */
function deckFromPopOrder(cards: SongCard[]): SongCard[] {
  return [...cards].reverse();
}

function setupGame(opts: {
  players?: string[];
  settings?: Partial<GameSettings>;
  popOrder: SongCard[];
}) {
  const room = makeRoom(opts.players ?? ['p1', 'p2'], opts.settings);
  const fake = createFakeIo();
  const engine = new GameEngine(room, fake.io);
  engine.startGame(deckFromPopOrder(opts.popOrder));
  return { room, engine, ...fake };
}

/** startGame + skip the anchor preview so the first turn begins synchronously. */
function setupAtFirstTurn(opts: Parameters<typeof setupGame>[0]) {
  const ctx = setupGame(opts);
  ctx.engine.skipAnchors();
  return ctx;
}

function years(timeline: SongCard[]): number[] {
  return timeline.map((c) => c.year);
}

beforeEach(() => {
  vi.useFakeTimers();
  cardSeq = 0;
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// startGame
// ---------------------------------------------------------------------------

describe('startGame (original mode)', () => {
  it('deals one anchor card per player, sets tokens, turn order, phase and deck size', () => {
    const a1 = makeCard(1990);
    const a2 = makeCard(1985);
    const s1 = makeCard(2000);
    const { room, eventsOf } = setupGame({ popOrder: [a1, a2, s1] });

    expect(room.players.p1.timeline).toEqual([a1]);
    expect(room.players.p2.timeline).toEqual([a2]);
    expect(room.players.p1.tokens).toBe(STARTING_TOKENS);
    expect(room.players.p2.tokens).toBe(STARTING_TOKENS);

    const gs = room.gameState;
    expect(gs.phase).toBe('playing');
    expect(gs.turnOrder).toEqual(['p1', 'p2']);
    expect(gs.turnIndex).toBe(0);
    expect(gs.currentTurnPlayerId).toBe('p1');
    expect(gs.currentSong).toBeNull(); // first turn starts after the anchor preview
    expect(gs.deckSize).toBe(1); // 3 cards minus 2 anchors

    const started = eventsOf('game-started');
    expect(started).toHaveLength(1);
    const payload = started[0].payload as { anchorCards: Record<string, SongCard> };
    expect(payload.anchorCards).toEqual({ p1: a1, p2: a2 });
  });

  it('starts the first turn after the anchor preview delay', () => {
    const { room } = setupGame({
      popOrder: [makeCard(1990), makeCard(1985), makeCard(2000)],
    });

    expect(room.gameState.currentSong).toBeNull();
    vi.advanceTimersByTime(ANCHOR_PREVIEW_MS);

    expect(room.gameState.currentSong?.year).toBe(2000);
    expect(room.gameState.phase).toBe('playing');
    expect(room.gameState.deckSize).toBe(0);
  });

  it('skipAnchors starts the first turn immediately and is a no-op when no preview is pending', () => {
    const ctx = setupGame({
      popOrder: [makeCard(1990), makeCard(1985), makeCard(2000), makeCard(2010)],
    });

    ctx.engine.skipAnchors();
    expect(ctx.room.gameState.currentSong?.year).toBe(2000);

    // Second call must not pop another song
    ctx.engine.skipAnchors();
    expect(ctx.room.gameState.currentSong?.year).toBe(2000);
    expect(ctx.room.gameState.deckSize).toBe(1);
  });
});

describe('startGame (co-op mode)', () => {
  it('seeds the shared timeline with one card and leaves player timelines empty', () => {
    const anchor = makeCard(1975);
    const { room, eventsOf } = setupGame({
      settings: { mode: 'coop' },
      popOrder: [anchor, makeCard(2000)],
    });

    expect(room.gameState.sharedTimeline).toEqual([anchor]);
    expect(room.players.p1.timeline).toEqual([]);
    expect(room.players.p2.timeline).toEqual([]);

    const payload = eventsOf('game-started')[0].payload as {
      anchorCards: Record<string, SongCard>;
    };
    expect(payload.anchorCards).toEqual({ __shared__: anchor });
  });
});

// ---------------------------------------------------------------------------
// Placement — original mode
// ---------------------------------------------------------------------------

describe('placeCard / resolveRound (original mode)', () => {
  it('adds the card to the timeline on a chronologically valid placement', () => {
    const { room, engine, lastEvent } = setupAtFirstTurn({
      popOrder: [makeCard(1990), makeCard(1985), makeCard(2000)],
    });

    engine.placeCard('p1', 1); // after the 1990 anchor — correct
    expect(room.gameState.phase).toBe('challenge');
    expect(room.gameState.pendingPlacement).toBe(1);

    vi.advanceTimersByTime(CHALLENGE_WINDOW_MS);

    expect(years(room.players.p1.timeline)).toEqual([1990, 2000]);
    expect(room.gameState.phase).toBe('reveal');
    const reveal = lastEvent('reveal') as { correct: boolean; winnerId: string | null };
    expect(reveal.correct).toBe(true);
    expect(reveal.winnerId).toBe('p1');
    expect(engine.getSongHistory()).toHaveLength(1);
    expect(engine.getSongHistory()[0].correct).toBe(true);
  });

  it('discards the card on an incorrect placement with no challengers', () => {
    const { room, engine, lastEvent } = setupAtFirstTurn({
      popOrder: [makeCard(1990), makeCard(1985), makeCard(2000)],
    });

    engine.placeCard('p1', 0); // 2000 before 1990 — wrong
    vi.advanceTimersByTime(CHALLENGE_WINDOW_MS);

    expect(years(room.players.p1.timeline)).toEqual([1990]);
    expect(room.gameState.phase).toBe('reveal');
    const reveal = lastEvent('reveal') as { correct: boolean; winnerId: string | null };
    expect(reveal.correct).toBe(false);
    expect(reveal.winnerId).toBeNull();
    expect(engine.getSongHistory()[0].correct).toBe(false);
  });

  it('accepts a placement between two cards only when the year fits', () => {
    // p1 anchor 1980; first turn we win a 2000 card, then place 1990 between them.
    const { room, engine } = setupAtFirstTurn({
      popOrder: [makeCard(1980), makeCard(1970), makeCard(2000), makeCard(1990)],
    });

    engine.placeCard('p1', 1); // 2000 after 1980 — correct
    vi.advanceTimersByTime(CHALLENGE_WINDOW_MS);
    expect(years(room.players.p1.timeline)).toEqual([1980, 2000]);

    engine.confirmReveal('p1'); // host advances; p2's turn with the 1990 song
    engine.placeCard('p2', 1); // p2 anchor 1970 → [1970, 1990] correct
    vi.advanceTimersByTime(CHALLENGE_WINDOW_MS);
    expect(years(room.players.p2.timeline)).toEqual([1970, 1990]);
  });

  it('ignores placements from non-active players, out-of-bounds positions and wrong phases', () => {
    const { room, engine } = setupAtFirstTurn({
      popOrder: [makeCard(1990), makeCard(1985), makeCard(2000)],
    });

    engine.placeCard('p2', 0); // not p2's turn
    expect(room.gameState.phase).toBe('playing');

    engine.placeCard('p1', 5); // out of bounds (timeline length 1)
    engine.placeCard('p1', -1);
    expect(room.gameState.phase).toBe('playing');
    expect(room.gameState.pendingPlacement).toBeNull();

    engine.placeCard('p1', 1); // valid → challenge phase
    engine.placeCard('p1', 0); // already placed, must be ignored
    expect(room.gameState.pendingPlacement).toBe(1);
  });

  it('auto-advances the turn when the active player runs out of time', () => {
    const { room } = setupAtFirstTurn({
      popOrder: [makeCard(1990), makeCard(1985), makeCard(2000), makeCard(2010)],
    });

    expect(room.gameState.currentTurnPlayerId).toBe('p1');
    vi.advanceTimersByTime(TURN_TIME_MS);

    expect(room.gameState.currentTurnPlayerId).toBe('p2');
    expect(room.gameState.currentSong?.year).toBe(2010);
    // p1's timeline untouched, no card lost or gained
    expect(years(room.players.p1.timeline)).toEqual([1990]);
  });
});

// ---------------------------------------------------------------------------
// Placement — pro mode
// ---------------------------------------------------------------------------

describe('placeCard / resolveRound (pro mode)', () => {
  function proSetup() {
    return setupAtFirstTurn({
      settings: { mode: 'pro' },
      popOrder: [
        makeCard(1990),
        makeCard(1985),
        makeCard(2000, { title: 'Bohemian Rhapsody', artist: 'Queen' }),
      ],
    });
  }

  it('discards the card when placement is correct but the song was not named', () => {
    const { room, engine, lastEvent } = proSetup();

    engine.placeCard('p1', 1);
    vi.advanceTimersByTime(CHALLENGE_WINDOW_MS);

    expect(years(room.players.p1.timeline)).toEqual([1990]);
    const reveal = lastEvent('reveal') as {
      correct: boolean;
      modeResult: { placementCorrect: boolean; songNamed: boolean };
    };
    expect(reveal.correct).toBe(false);
    expect(reveal.modeResult.placementCorrect).toBe(true);
    expect(reveal.modeResult.songNamed).toBe(false);
  });

  it('discards the card when only the title was named (artist required in pro)', () => {
    const { room, engine } = proSetup();

    engine.nameSong('p1', { title: 'Bohemian Rhapsody', artist: '' });
    engine.placeCard('p1', 1);
    vi.advanceTimersByTime(CHALLENGE_WINDOW_MS);

    expect(years(room.players.p1.timeline)).toEqual([1990]);
  });

  it('keeps the card when placement is correct and title+artist were named', () => {
    const { room, engine } = proSetup();

    engine.nameSong('p1', { title: 'Bohemian Rhapsody', artist: 'Queen' });
    engine.placeCard('p1', 1);
    vi.advanceTimersByTime(CHALLENGE_WINDOW_MS);

    expect(years(room.players.p1.timeline)).toEqual([1990, 2000]);
  });
});

// ---------------------------------------------------------------------------
// Placement — expert mode
// ---------------------------------------------------------------------------

describe('placeCard / resolveRound (expert mode)', () => {
  function expertSetup() {
    return setupAtFirstTurn({
      settings: { mode: 'expert' },
      popOrder: [
        makeCard(1990),
        makeCard(1985),
        makeCard(2000, { title: 'Yellow', artist: 'Coldplay' }),
      ],
    });
  }

  it('discards the card when the exact year guess is wrong', () => {
    const { room, engine, lastEvent } = expertSetup();

    engine.nameSong('p1', { title: 'Yellow', artist: 'Coldplay', year: 1999 });
    engine.placeCard('p1', 1);
    vi.advanceTimersByTime(CHALLENGE_WINDOW_MS);

    expect(years(room.players.p1.timeline)).toEqual([1990]);
    const reveal = lastEvent('reveal') as {
      correct: boolean;
      modeResult: { placementCorrect: boolean; songNamed: boolean; yearCorrect?: boolean };
    };
    expect(reveal.modeResult.placementCorrect).toBe(true);
    expect(reveal.modeResult.songNamed).toBe(true);
    expect(reveal.modeResult.yearCorrect).toBe(false);
  });

  it('keeps the card when placement, name and exact year are all correct', () => {
    const { room, engine } = expertSetup();

    engine.nameSong('p1', { title: 'Yellow', artist: 'Coldplay', year: 2000 });
    engine.placeCard('p1', 1);
    vi.advanceTimersByTime(CHALLENGE_WINDOW_MS);

    expect(years(room.players.p1.timeline)).toEqual([1990, 2000]);
  });
});

// ---------------------------------------------------------------------------
// Placement — co-op mode
// ---------------------------------------------------------------------------

describe('placeCard / resolveRound (co-op mode)', () => {
  function coopSetup() {
    return setupAtFirstTurn({
      settings: { mode: 'coop' },
      popOrder: [makeCard(1980), makeCard(2000), makeCard(1990)],
    });
  }

  it('adds a correct placement to the shared timeline after the short resolve delay', () => {
    const { room, engine } = coopSetup();

    engine.placeCard('p1', 1); // 2000 after the 1980 shared anchor — correct
    expect(room.gameState.phase).toBe('challenge');

    vi.advanceTimersByTime(COOP_RESOLVE_DELAY_MS);

    expect(years(room.gameState.sharedTimeline)).toEqual([1980, 2000]);
    expect(room.players.p1.timeline).toEqual([]); // personal timelines unused in co-op
    expect(room.players.p1.tokens).toBe(STARTING_TOKENS); // no penalty
    expect(room.gameState.phase).toBe('reveal');
  });

  it('keeps the shared timeline unchanged and deducts a token on a wrong placement', () => {
    const { room, engine } = coopSetup();

    engine.placeCard('p1', 0); // 2000 before 1980 — wrong
    vi.advanceTimersByTime(COOP_RESOLVE_DELAY_MS);

    expect(years(room.gameState.sharedTimeline)).toEqual([1980]);
    expect(room.players.p1.tokens).toBe(STARTING_TOKENS - COOP_WRONG_PENALTY);
  });

  it('does not push tokens below zero on a wrong placement', () => {
    const { room, engine } = coopSetup();
    room.players.p1.tokens = 0;

    engine.placeCard('p1', 0);
    vi.advanceTimersByTime(COOP_RESOLVE_DELAY_MS);

    expect(room.players.p1.tokens).toBe(0);
  });

  it('rejects challenges entirely in co-op mode', () => {
    const { room, engine } = coopSetup();

    engine.placeCard('p1', 1);
    const result = engine.challenge('p2', 0);

    expect(result.error).toBeUndefined();
    expect(room.gameState.challengers).toEqual([]);
    expect(room.players.p2.tokens).toBe(STARTING_TOKENS);
  });
});

// ---------------------------------------------------------------------------
// Challenge flow
// ---------------------------------------------------------------------------

describe('challenge flow (original mode)', () => {
  it('lets a challenger with the correct position steal the card into their own timeline', () => {
    const { room, engine, lastEvent } = setupAtFirstTurn({
      popOrder: [makeCard(1990), makeCard(1980), makeCard(2000)],
    });

    engine.placeCard('p1', 0); // wrong (2000 before 1990)
    const result = engine.challenge('p2', 1); // correct against p1's [1990]
    expect(result.error).toBeUndefined();
    expect(room.gameState.challengers).toEqual(['p2']);
    expect(room.players.p2.tokens).toBe(STARTING_TOKENS - CHALLENGE_COST);

    vi.advanceTimersByTime(CHALLENGE_WINDOW_MS);

    // Stolen card is inserted chronologically into the challenger's timeline
    expect(years(room.players.p2.timeline)).toEqual([1980, 2000]);
    expect(years(room.players.p1.timeline)).toEqual([1990]);

    const reveal = lastEvent('reveal') as { stolenBy: string | null; winnerId: string | null };
    expect(reveal.stolenBy).toBe('p2');
    expect(reveal.winnerId).toBe('p2');

    const stats = engine.getGameStats().playerStats.get('p2')!;
    expect(stats.challengesWon).toBe(1);
    expect(stats.challengesLost).toBe(0);
  });

  it('costs the challenger a token without refund when the active player was right', () => {
    const { room, engine, lastEvent } = setupAtFirstTurn({
      popOrder: [makeCard(1990), makeCard(1980), makeCard(2000)],
    });

    engine.placeCard('p1', 1); // correct
    engine.challenge('p2', 0); // challenger picks the wrong spot

    vi.advanceTimersByTime(CHALLENGE_WINDOW_MS);

    expect(years(room.players.p1.timeline)).toEqual([1990, 2000]);
    expect(years(room.players.p2.timeline)).toEqual([1980]);
    expect(room.players.p2.tokens).toBe(STARTING_TOKENS - CHALLENGE_COST);

    const reveal = lastEvent('reveal') as { stolenBy: string | null };
    expect(reveal.stolenBy).toBeNull();

    const stats = engine.getGameStats().playerStats.get('p2')!;
    expect(stats.challengesLost).toBe(1);
    expect(stats.challengesWon).toBe(0);
  });

  it('discards the card when neither the active player nor any challenger was right', () => {
    const { room, engine } = setupAtFirstTurn({
      popOrder: [makeCard(1990), makeCard(1980), makeCard(2000)],
    });

    engine.placeCard('p1', 0); // wrong
    engine.challenge('p2', 0); // also wrong (same semantics: 2000 before 1990)

    vi.advanceTimersByTime(CHALLENGE_WINDOW_MS);

    expect(years(room.players.p1.timeline)).toEqual([1990]);
    expect(years(room.players.p2.timeline)).toEqual([1980]);
  });

  it('rejects a duplicate challenge position with an error and takes no token', () => {
    const { room, engine } = setupAtFirstTurn({
      players: ['p1', 'p2', 'p3'],
      popOrder: [makeCard(1990), makeCard(1980), makeCard(1970), makeCard(2000)],
    });

    engine.placeCard('p1', 0);
    expect(engine.challenge('p2', 1).error).toBeUndefined();

    const dup = engine.challenge('p3', 1);
    expect(dup.error).toMatch(/already taken/i);
    expect(room.gameState.challengers).toEqual(['p2']);
    expect(room.players.p3.tokens).toBe(STARTING_TOKENS);
  });

  it('ignores challenges from the active player, broke players, and outside the challenge phase', () => {
    const { room, engine } = setupAtFirstTurn({
      players: ['p1', 'p2', 'p3'],
      popOrder: [makeCard(1990), makeCard(1980), makeCard(1970), makeCard(2000)],
    });

    // Outside challenge phase
    expect(engine.challenge('p2', 0)).toEqual({});
    expect(room.gameState.challengers).toEqual([]);

    engine.placeCard('p1', 1);

    // Active player cannot challenge themselves
    engine.challenge('p1', 0);
    expect(room.gameState.challengers).toEqual([]);

    // Player without tokens cannot challenge
    room.players.p3.tokens = 0;
    engine.challenge('p3', 0);
    expect(room.gameState.challengers).toEqual([]);

    // Out-of-bounds position is ignored
    engine.challenge('p2', 5);
    expect(room.gameState.challengers).toEqual([]);
  });

  it('resolves the round when the challenge window times out', () => {
    const { room, engine } = setupAtFirstTurn({
      popOrder: [makeCard(1990), makeCard(1980), makeCard(2000)],
    });

    engine.placeCard('p1', 1);
    expect(room.gameState.phase).toBe('challenge');

    vi.advanceTimersByTime(CHALLENGE_WINDOW_MS - 1);
    expect(room.gameState.phase).toBe('challenge');

    vi.advanceTimersByTime(1);
    expect(room.gameState.phase).toBe('reveal');
  });
});

// ---------------------------------------------------------------------------
// Token economy
// ---------------------------------------------------------------------------

describe('token economy', () => {
  it('buyCard costs BUY_CARD_COST tokens and inserts the bought card chronologically', () => {
    const { room, engine } = setupAtFirstTurn({
      popOrder: [makeCard(1990), makeCard(1980), makeCard(2000), makeCard(1985)],
    });
    room.players.p1.tokens = BUY_CARD_COST;

    engine.buyCard('p1');

    expect(room.players.p1.tokens).toBe(0);
    // 1985 bought card slots before the 1990 anchor
    expect(years(room.players.p1.timeline)).toEqual([1985, 1990]);
  });

  it('buyCard is a no-op with insufficient tokens or in the lobby', () => {
    const { room, engine } = setupAtFirstTurn({
      popOrder: [makeCard(1990), makeCard(1980), makeCard(2000), makeCard(1985)],
    });

    room.players.p1.tokens = BUY_CARD_COST - 1;
    engine.buyCard('p1');
    expect(room.players.p1.tokens).toBe(BUY_CARD_COST - 1);
    expect(years(room.players.p1.timeline)).toEqual([1990]);

    // Lobby phase rejects buying outright
    const lobbyRoom = makeRoom(['a', 'b']);
    lobbyRoom.players.a.tokens = MAX_TOKENS;
    const lobbyEngine = new GameEngine(lobbyRoom, createFakeIo().io);
    lobbyEngine.buyCard('a');
    expect(lobbyRoom.players.a.tokens).toBe(MAX_TOKENS);
    expect(lobbyRoom.players.a.timeline).toEqual([]);
  });

  it('skipSong costs SKIP_COST and advances the turn', () => {
    const { room, engine } = setupAtFirstTurn({
      popOrder: [makeCard(1990), makeCard(1980), makeCard(2000), makeCard(2010)],
    });

    engine.skipSong('p1');

    expect(room.players.p1.tokens).toBe(STARTING_TOKENS - SKIP_COST);
    expect(room.gameState.currentTurnPlayerId).toBe('p2');
    expect(room.gameState.currentSong?.year).toBe(2010);
  });

  it('skipSong with no tokens does not advance the turn (and stalls the turn timer — current behavior)', () => {
    const { room, engine } = setupAtFirstTurn({
      popOrder: [makeCard(1990), makeCard(1980), makeCard(2000), makeCard(2010)],
    });
    room.players.p1.tokens = 0;

    engine.skipSong('p1');

    expect(room.players.p1.tokens).toBe(0);
    expect(room.gameState.currentTurnPlayerId).toBe('p1');
    expect(room.gameState.currentSong?.year).toBe(2000);

    // Suspected bug: skipSong clears the turn timer BEFORE the token check,
    // so a failed skip leaves no auto-advance timer. We assert the actual
    // (stalling) behavior here; if the source is fixed this expectation flips.
    vi.advanceTimersByTime(TURN_TIME_MS * 2);
    expect(room.gameState.currentTurnPlayerId).toBe('p1');
  });

  it('skipSong from a non-active player is ignored', () => {
    const { room, engine } = setupAtFirstTurn({
      popOrder: [makeCard(1990), makeCard(1980), makeCard(2000)],
    });

    engine.skipSong('p2');
    expect(room.players.p2.tokens).toBe(STARTING_TOKENS);
    expect(room.gameState.currentTurnPlayerId).toBe('p1');
  });

  it('naming the song correctly earns a token via fuzzy matching', () => {
    const { room, engine } = setupAtFirstTurn({
      popOrder: [
        makeCard(1990),
        makeCard(1980),
        makeCard(2000, { title: 'Bohemian Rhapsody', artist: 'Queen' }),
      ],
    });

    // Typo + missing artist is fine in original mode
    engine.nameSong('p2', { title: 'bohemian rapsody', artist: '' });

    expect(room.players.p2.tokens).toBe(STARTING_TOKENS + 1);
    const stats = engine.getGameStats().playerStats.get('p2')!;
    expect(stats.songsNamed).toBe(1);
  });

  it('an incorrect guess earns nothing and each player only gets one attempt per round', () => {
    const { room, engine } = setupAtFirstTurn({
      popOrder: [
        makeCard(1990),
        makeCard(1980),
        makeCard(2000, { title: 'Bohemian Rhapsody', artist: 'Queen' }),
      ],
    });

    engine.nameSong('p2', { title: 'Stairway to Heaven', artist: '' });
    expect(room.players.p2.tokens).toBe(STARTING_TOKENS);

    // Second attempt — even a correct one — is ignored
    engine.nameSong('p2', { title: 'Bohemian Rhapsody', artist: 'Queen' });
    expect(room.players.p2.tokens).toBe(STARTING_TOKENS);
    expect(engine.getGameStats().playerStats.get('p2')!.songsNamed).toBe(0);
  });

  it('tokens are capped at MAX_TOKENS when naming songs', () => {
    const { room, engine } = setupAtFirstTurn({
      popOrder: [
        makeCard(1990),
        makeCard(1980),
        makeCard(2000, { title: 'Yellow', artist: 'Coldplay' }),
      ],
    });
    room.players.p2.tokens = MAX_TOKENS;

    engine.nameSong('p2', { title: 'Yellow', artist: '' });
    expect(room.players.p2.tokens).toBe(MAX_TOKENS);
    // Stat still counts even though the token was capped
    expect(engine.getGameStats().playerStats.get('p2')!.songsNamed).toBe(1);
  });

  it('pro mode requires both title and artist for the naming token', () => {
    const { room, engine } = setupAtFirstTurn({
      settings: { mode: 'pro' },
      popOrder: [
        makeCard(1990),
        makeCard(1980),
        makeCard(2000, { title: 'Yellow', artist: 'Coldplay' }),
      ],
    });

    engine.nameSong('p2', { title: 'Yellow', artist: '' });
    expect(room.players.p2.tokens).toBe(STARTING_TOKENS);
  });
});

// ---------------------------------------------------------------------------
// Turn advancement
// ---------------------------------------------------------------------------

describe('turn advancement', () => {
  it('confirmReveal by the host advances to the next player; non-hosts are ignored', () => {
    const { room, engine } = setupAtFirstTurn({
      popOrder: [makeCard(1990), makeCard(1980), makeCard(2000), makeCard(2010)],
    });

    engine.placeCard('p1', 1);
    vi.advanceTimersByTime(CHALLENGE_WINDOW_MS);
    expect(room.gameState.phase).toBe('reveal');

    engine.confirmReveal('p2'); // p2 is not the host
    expect(room.gameState.phase).toBe('reveal');

    engine.confirmReveal('p1'); // host
    expect(room.gameState.currentTurnPlayerId).toBe('p2');
    expect(room.gameState.currentSong?.year).toBe(2010);

    // Double-tap protection: phase already left 'reveal'
    engine.confirmReveal('p1');
    expect(room.gameState.currentTurnPlayerId).toBe('p2');
  });

  it('skips disconnected players when advancing', () => {
    const { room, engine } = setupAtFirstTurn({
      players: ['p1', 'p2', 'p3'],
      popOrder: [
        makeCard(1990),
        makeCard(1980),
        makeCard(1970),
        makeCard(2000),
        makeCard(2010),
      ],
    });

    room.players.p2.connected = false;
    engine.skipSong('p1');

    expect(room.gameState.currentTurnPlayerId).toBe('p3');
  });

  it('wraps around the turn order', () => {
    const { room, engine } = setupAtFirstTurn({
      popOrder: [
        makeCard(1990),
        makeCard(1980),
        makeCard(2000),
        makeCard(2010),
        makeCard(2020),
      ],
    });
    room.players.p1.tokens = MAX_TOKENS;
    room.players.p2.tokens = MAX_TOKENS;

    engine.skipSong('p1');
    expect(room.gameState.currentTurnPlayerId).toBe('p2');
    engine.skipSong('p2');
    expect(room.gameState.currentTurnPlayerId).toBe('p1');
  });

  it('ends the game when the deck runs out', () => {
    const { room, engine, eventsOf } = setupAtFirstTurn({
      popOrder: [makeCard(1990), makeCard(1980), makeCard(2000)], // single song
    });

    engine.skipSong('p1'); // next startTurn finds an empty deck

    expect(room.gameState.phase).toBe('game_over');
    expect(eventsOf('game-over')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Win condition / endGame
// ---------------------------------------------------------------------------

describe('win condition', () => {
  it('ends the game when a player reaches cardsToWin and reports the winner', () => {
    const onEnd = vi.fn();
    const { room, engine, lastEvent } = setupAtFirstTurn({
      settings: { cardsToWin: 2 },
      popOrder: [makeCard(1990), makeCard(1980), makeCard(2000)],
    });
    engine.onGameEnd(onEnd);

    engine.placeCard('p1', 1);
    vi.advanceTimersByTime(CHALLENGE_WINDOW_MS);

    expect(room.gameState.phase).toBe('game_over');
    expect(engine.getWinnerId()).toBe('p1');
    expect(onEnd).toHaveBeenCalledTimes(1);
    const over = lastEvent('game-over') as { winnerId: string };
    expect(over.winnerId).toBe('p1');
  });

  it('ends a co-op game when the shared timeline reaches cardsToWin', () => {
    const { room, engine } = setupAtFirstTurn({
      settings: { mode: 'coop', cardsToWin: 2 },
      popOrder: [makeCard(1980), makeCard(2000)],
    });

    engine.placeCard('p1', 1);
    vi.advanceTimersByTime(COOP_RESOLVE_DELAY_MS);

    expect(room.gameState.phase).toBe('game_over');
    expect(years(room.gameState.sharedTimeline)).toEqual([1980, 2000]);
  });
});

// ---------------------------------------------------------------------------
// resetGame
// ---------------------------------------------------------------------------

describe('resetGame', () => {
  it('returns the room to lobby defaults and clears every pending timer', () => {
    const { room, engine, clearEvents, events } = setupAtFirstTurn({
      popOrder: [makeCard(1990), makeCard(1980), makeCard(2000), makeCard(2010)],
    });

    // Put the engine in a state with live timers: challenge timer + a
    // disconnect grace timer for p2.
    engine.placeCard('p1', 1);
    room.players.p2.connected = false;
    engine.handlePlayerDisconnect('p2');
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    engine.resetGame();

    expect(vi.getTimerCount()).toBe(0);
    expect(room.gameState.phase).toBe('lobby');
    expect(room.gameState.currentTurnPlayerId).toBeNull();
    expect(room.gameState.currentSong).toBeNull();
    expect(room.gameState.turnOrder).toEqual([]);
    expect(room.gameState.deckSize).toBe(0);
    expect(room.gameState.sharedTimeline).toEqual([]);
    for (const p of Object.values(room.players)) {
      expect(p.timeline).toEqual([]);
      expect(p.tokens).toBe(STARTING_TOKENS);
    }
    expect(engine.getSongHistory()).toEqual([]);

    // No stray timer may fire later (no advanceTurn / resolveRound / timeouts)
    clearEvents();
    vi.advanceTimersByTime(TURN_TIME_MS * 10);
    expect(events).toEqual([]);
    expect(room.gameState.phase).toBe('lobby');
  });
});

// ---------------------------------------------------------------------------
// Disconnect / reconnect handling
// ---------------------------------------------------------------------------

describe('disconnect handling', () => {
  function disconnectSetup() {
    return setupAtFirstTurn({
      popOrder: [makeCard(1990), makeCard(1980), makeCard(2000), makeCard(2010)],
    });
  }

  it('skips the active player after the grace period expires', () => {
    const { room, engine, eventsOf } = disconnectSetup();

    room.players.p1.connected = false;
    engine.handlePlayerDisconnect('p1');

    vi.advanceTimersByTime(DISCONNECT_GRACE_MS);

    expect(eventsOf('player-timed-out')).toHaveLength(1);
    expect(room.gameState.currentTurnPlayerId).toBe('p2');
  });

  it('reconnecting within the grace period keeps the turn and restarts the turn timer', () => {
    const { room, engine, eventsOf } = disconnectSetup();

    room.players.p1.connected = false;
    engine.handlePlayerDisconnect('p1');
    vi.advanceTimersByTime(DISCONNECT_GRACE_MS - 1000);

    room.players.p1.connected = true;
    engine.handlePlayerReconnect('p1');

    vi.advanceTimersByTime(5000); // past the original grace deadline
    expect(eventsOf('player-timed-out')).toHaveLength(0);
    expect(room.gameState.currentTurnPlayerId).toBe('p1');

    // The restarted turn timer still auto-advances eventually
    vi.advanceTimersByTime(TURN_TIME_MS);
    expect(room.gameState.currentTurnPlayerId).toBe('p2');
  });

  it('a double disconnect leaves exactly one live timer, and reconnect cancels it', () => {
    const { room, engine, eventsOf } = disconnectSetup();

    room.players.p1.connected = false;
    engine.handlePlayerDisconnect('p1');
    engine.handlePlayerDisconnect('p1');

    // Turn timer was cleared (p1 is the active player); only one grace timer
    // may remain — the first one must have been cleared before rescheduling.
    expect(vi.getTimerCount()).toBe(1);

    room.players.p1.connected = true;
    engine.handlePlayerReconnect('p1');

    // Advance past both potential grace deadlines (but below TURN_TIME_MS so
    // the restarted turn timer does not interfere with the assertion).
    vi.advanceTimersByTime(DISCONNECT_GRACE_MS + 5000);
    expect(eventsOf('player-timed-out')).toHaveLength(0);
    expect(room.gameState.currentTurnPlayerId).toBe('p1');
  });

  it('restores the challenge timer when the active player reconnects mid-challenge', () => {
    const { room, engine } = disconnectSetup();

    engine.placeCard('p1', 1);
    expect(room.gameState.phase).toBe('challenge');

    room.players.p1.connected = false;
    engine.handlePlayerDisconnect('p1'); // pauses the challenge timer
    vi.advanceTimersByTime(CHALLENGE_WINDOW_MS);
    expect(room.gameState.phase).toBe('challenge'); // paused, not resolved

    room.players.p1.connected = true;
    engine.handlePlayerReconnect('p1');
    vi.advanceTimersByTime(CHALLENGE_WINDOW_MS);

    expect(room.gameState.phase).toBe('reveal');
    expect(years(room.players.p1.timeline)).toEqual([1990, 2000]);
  });

  it('a non-active player disconnect does not disturb the current turn', () => {
    const { room, engine, eventsOf } = disconnectSetup();

    room.players.p2.connected = false;
    engine.handlePlayerDisconnect('p2');

    vi.advanceTimersByTime(DISCONNECT_GRACE_MS);

    expect(eventsOf('player-timed-out')).toHaveLength(1);
    expect(room.gameState.currentTurnPlayerId).toBe('p1');
    expect(room.gameState.currentSong?.year).toBe(2000);
  });

  it('is a no-op in the lobby', () => {
    const room = makeRoom(['p1', 'p2']);
    const fake = createFakeIo();
    const engine = new GameEngine(room, fake.io);

    engine.handlePlayerDisconnect('p1');
    expect(vi.getTimerCount()).toBe(0);
    expect(fake.events).toEqual([]);
  });

  it('voluntary leave advances the turn immediately without a grace period', () => {
    const { room, engine } = disconnectSetup();

    room.players.p1.connected = false;
    engine.handlePlayerVoluntaryLeave('p1');

    expect(room.gameState.currentTurnPlayerId).toBe('p2');
    expect(room.gameState.currentSong?.year).toBe(2010);
  });
});

// ---------------------------------------------------------------------------
// Late joiners
// ---------------------------------------------------------------------------

describe('addLatecomer', () => {
  it('deals an anchor card and inserts the player after the current turn index', () => {
    const { room, engine } = setupAtFirstTurn({
      popOrder: [
        makeCard(1990),
        makeCard(1980),
        makeCard(2000),
        makeCard(2010),
        makeCard(1975),
      ],
    });

    room.players.p3 = makePlayer('p3');
    engine.addLatecomer('p3');

    expect(room.players.p3.timeline).toHaveLength(1);
    expect(room.players.p3.timeline[0].year).toBe(2010); // next card off the deck
    expect(room.players.p3.tokens).toBe(STARTING_TOKENS);
    expect(room.gameState.turnOrder).toEqual(['p1', 'p3', 'p2']);
    expect(room.gameState.deckSize).toBe(1);
  });
});
