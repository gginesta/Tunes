import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  GameSettings,
  GameState,
  GameStats,
  MatchResult,
  PlayerStats,
  PlayedSong,
  Room,
  RoundAction,
  RoundAudio,
  RoundReveal,
  ServerToClientEvents,
  SongCard,
  SongGuess,
} from '@tunes/shared';
import {
  ANCHOR_PREVIEW_MS,
  BUY_CARD_COST,
  CHALLENGE_COST,
  CHALLENGE_WINDOW_MS,
  COOP_WRONG_PENALTY,
  DINNER_ANCHOR_COUNT,
  getDinnerRoundCount,
  MAX_TOKENS,
  SKIP_COST,
  STARTING_TOKENS,
  TURN_TIME_MS,
} from '@tunes/shared';
import { fuzzyMatch } from './fuzzy';
import { logger } from './logger';
import { fisherYatesShuffle } from './shuffle';

type TunesServer = Server<ClientToServerEvents, ServerToClientEvents>;
type Timer = ReturnType<typeof setTimeout>;
type Placement = { position: number; locked: boolean };
type Naming = { guess: SongGuess; correct: boolean; titleMatch: boolean; artistMatch: boolean };
type MatchEnd = MatchResult['reason'];
type ActionResult = { error?: string; code?: string };
type GameHooks = {
  onChange?: () => void;
  send?: (playerId: string, room: Room) => void;
  canPlay?: (song: SongCard, settings: GameSettings) => boolean;
  canPlaySpotify?: (song: SongCard) => boolean;
};

type RoundState = {
  attempts: Record<string, Naming>;
  namingDone: string[];
  decisions: Record<string, number | null>;
  guesses: Record<string, Placement>;
  eligible: string[];
  cueSeenBy: string[];
  /** Names/tokens given for this particular cue, for a penalty-free void. */
  namingTokens: string[];
  placementElapsed: number | null;
};

export type PersistedGame = {
  version: 1;
  deck: SongCard[];
  round: RoundState;
  participants: string[];
  departed: string[];
  djRotation: string[];
  djSchedule: string[];
  actionReceipts: string[];
  dinnerCount: number;
  scores: Record<string, number>;
  heard: string[];
  history: PlayedSong[];
  stats: GameStats;
  finishPending: MatchEnd | null;
  leadChange: { playerId: string; song: SongCard } | null;
  clockRemaining: number | null;
  state: GameState;
};

function freshRound(): RoundState {
  return {
    attempts: {}, namingDone: [], decisions: {}, guesses: {},
    eligible: [], cueSeenBy: [], namingTokens: [], placementElapsed: null,
  };
}

function newStats(): PlayerStats {
  return {
    correctPlacements: 0, totalPlacements: 0, challengesWon: 0, challengesLost: 0,
    longestStreak: 0, currentStreak: 0, fastestPlacementMs: null, decadeAccuracy: {}, songsNamed: 0,
  };
}

/** Recording facts contain no clip URL, provider identifier or source credentials. */
function recordingFacts(card: SongCard): SongCard {
  const { id, title, artist, year, genre, region, recordingId, version, source, sourceUrl, recordingNote, license, licenseUrl } = card;
  return { id, title, artist, year, genre, region, recordingId, version, source, sourceUrl, recordingNote, license, licenseUrl };
}

function validPosition(position: number, timeline: SongCard[]): boolean {
  return Number.isInteger(position) && position >= 0 && position <= timeline.length;
}

function correctPositions(song: SongCard, timeline: SongCard[]): number[] {
  const positions: number[] = [];
  for (let position = 0; position <= timeline.length; position++) {
    const before = timeline[position - 1];
    const after = timeline[position];
    if ((!before || before.year <= song.year) && (!after || song.year <= after.year)) positions.push(position);
  }
  return positions;
}

function insertCard(timeline: SongCard[], card: SongCard) {
  const next = timeline.findIndex((other) => other.year > card.year);
  timeline.splice(next === -1 ? timeline.length : next, 0, recordingFacts(card));
}

const reject = (error: string, code = 'ACTION_REJECTED'): ActionResult => ({ error, code });

export class GameEngine {
  private deck: SongCard[] = [];
  private round = freshRound();
  private participants: string[] = [];
  private departed = new Set<string>();
  private djRotation: string[] = [];
  private djSchedule: string[] = [];
  private actionReceipts: string[] = [];
  private dinnerCount = 0;
  private scores: Record<string, number> = {};
  private heard = new Set<string>();
  private history: PlayedSong[] = [];
  private stats: GameStats = { playerStats: {}, totalRounds: 0 };
  private finishPending: MatchEnd | null = null;
  private leadChange: PersistedGame['leadChange'] = null;
  private clock: Timer | null = null;
  private checkpoint: Timer | null = null;
  private saveRetry: Timer | null = null;
  private gameEnded: (() => void) | null = null;
  private deferred = false;
  private dirty = false;
  private strictPersistence = false;

  constructor(private room: Room, _io: TunesServer, private hooks: GameHooks = {}) {}

  private get gs() { return this.room.gameState; }
  private get mode() { return this.room.settings.mode; }
  private get manual() { return this.room.playbackMode === 'manual'; }
  private get coop() { return this.mode === 'coop'; }
  private get dinner() { return this.mode === 'dinner'; }
  private get operator() { return this.gs.audio?.operatorId; }
  private get onTable() {
    return Object.values(this.room.players).some((player) => player.connected);
  }

  onGameEnd(callback: () => void) { this.gameEnded = callback; }
  getRoom() { return this.room; }
  getSongHistory() { return this.history; }
  getGameStats() { return { playerStats: new Map(Object.entries(this.stats.playerStats)), totalRounds: this.stats.totalRounds }; }
  getResult() { return this.gs.result ?? null; }
  getHeardRecordingIds() { return [...this.heard]; }
  inheritHeardRecordingIds(ids: readonly string[]) {
    for (const id of ids) this.heard.add(id);
  }

  serialize(): PersistedGame {
    return structuredClone({
      version: 1, deck: this.deck, round: this.round, participants: this.participants,
      departed: [...this.departed],
      djRotation: this.djRotation, dinnerCount: this.dinnerCount, scores: this.scores,
      djSchedule: this.djSchedule, actionReceipts: this.actionReceipts,
      heard: [...this.heard], history: this.history, stats: this.stats,
      finishPending: this.finishPending, leadChange: this.leadChange,
      clockRemaining: this.remainingTime(), state: this.gs,
    });
  }

  restore(saved: PersistedGame): void {
    const state = structuredClone(saved);
    this.loadState(state);
    this.gs.timing = { deadline: null, remainingMs: state.clockRemaining };
    if (this.gs.phase === 'playing' || this.gs.phase === 'challenge') {
      const { audio, currentSong } = this.gs;
      const unavailable = !this.manual && currentSong && !this.automaticSource(currentSong);
      if (audio) this.gs.audio = { ...audio, status: 'paused', reason: unavailable ? 'audio-unavailable' : 'server-restart' };
    }
  }

  private loadState(state: PersistedGame): void {
    this.dispose();
    this.room.gameState = state.state;
    this.deck = state.deck;
    this.round = state.round;
    this.participants = state.participants;
    this.departed = new Set(state.departed);
    this.djRotation = state.djRotation;
    this.djSchedule = state.djSchedule ?? [];
    this.actionReceipts = state.actionReceipts ?? [];
    this.dinnerCount = state.dinnerCount;
    this.scores = state.scores;
    this.heard = new Set(state.heard);
    this.history = state.history;
    this.stats = state.stats;
    this.finishPending = state.finishPending;
    this.leadChange = state.leadChange;
  }

  dispose() {
    this.stopClock();
    if (this.saveRetry) clearTimeout(this.saveRetry);
    this.saveRetry = null;
  }

  private stopClock() {
    if (this.clock) clearTimeout(this.clock);
    if (this.checkpoint) clearInterval(this.checkpoint);
    this.clock = null;
    this.checkpoint = null;
  }

  publicRoom(playerId: string): Room {
    const gs = this.gs;
    const view = structuredClone(this.room);
    for (const player of Object.values(view.players)) player.timeline = player.timeline.map(recordingFacts);
    view.gameState.currentSong = gs.phase === 'reveal' && gs.currentSong ? recordingFacts(gs.currentSong) : null;
    view.gameState.sharedTimeline = gs.sharedTimeline.map(recordingFacts);
    view.gameState.history = this.history.map((entry) => ({ ...entry, song: recordingFacts(entry.song) }));
    const { reveal, result } = view.gameState;
    if (reveal) {
      reveal.song = recordingFacts(reveal.song);
      reveal.timeline = reveal.timeline.map(recordingFacts);
    }
    if (result?.decidingSong) result.decidingSong = recordingFacts(result.decidingSong);
    if (gs.phase === 'game_over') view.gameState.stats = structuredClone(this.stats);
    view.gameState.audio = this.publicAudio(playerId);
    if (this.dinner && gs.matchId) {
      const guess = this.round.guesses[playerId];
      view.gameState.dinner = {
        roundCount: this.dinnerCount, completedRounds: this.stats.totalRounds,
        scores: { ...this.scores }, eligiblePlayerIds: [...this.round.eligible],
        submittedCount: Object.values(this.round.guesses).filter(({ locked }) => locked).length,
        myPosition: guess?.position ?? null, myLocked: guess?.locked ?? false,
      };
    } else if (gs.matchId) {
      const named = this.round.attempts[playerId];
      view.gameState.classic = {
        eligibleChallengerIds: [...this.round.eligible],
        respondedPlayerIds: Object.keys(this.round.decisions),
        myNamed: !!named,
        myNamingDone: this.round.namingDone.includes(playerId),
        myNamingResult: named && { correct: named.correct, titleMatch: named.titleMatch, artistMatch: named.artistMatch },
        challengePositions: Object.fromEntries(
          Object.entries(this.round.decisions).filter((entry): entry is [string, number] => entry[1] !== null),
        ),
      };
    }
    return view;
  }

  private publicAudio(playerId: string): RoundAudio | undefined {
    const { audio, currentSong } = this.gs;
    if (!audio) return;
    const base: RoundAudio = {
      status: audio.status, kind: audio.kind, cueId: audio.cueId,
      operatorId: audio.operatorId, reason: audio.reason,
    };
    if (playerId !== audio.operatorId || !this.room.players[playerId]?.connected || !currentSong || audio.status === 'idle') return base;
    if (audio.kind === 'manual') return { ...base, recording: recordingFacts(currentSong) };
    const source = this.automaticSource(currentSong);
    return source ? { ...base, source } : base;
  }

  private automaticSource(song: SongCard): RoundAudio['source'] {
    if (this.room.playbackMode === 'spotify') {
      if (!this.dinner && song.spotifyTrackId && this.hooks.canPlaySpotify?.(song)) {
        return { spotifyTrackId: song.spotifyTrackId };
      }
      return;
    }
    if (this.room.playbackMode !== 'licensed' || !song.audioUrl) return;
    if (!(this.audioExpiry(song) > Date.now())) return;
    if (this.hooks.canPlay && !this.hooks.canPlay(song, this.room.settings)) return;
    return { url: song.audioUrl };
  }

  private audioExpiry(song: SongCard): number {
    return Math.min(
      song.rightsUntil ? Date.parse(song.rightsUntil) : Infinity,
      song.audioExpiresAt ? Date.parse(song.audioExpiresAt) : Infinity,
    );
  }

  sync(): void {
    if (!this.hooks.send) return;
    for (const [playerId, player] of Object.entries(this.room.players)) {
      if (!player.connected) continue;
      try {
        this.hooks.send(playerId, this.publicRoom(playerId));
      } catch (error) {
        logger.error('Table view could not be sent', { matchId: this.gs.matchId, playerId, error: String(error) });
      }
    }
  }

  private changed() {
    if (this.deferred) {
      this.dirty = true;
      return;
    }
    this.gs.revision = (this.gs.revision ?? 0) + 1;
    this.persistAndSync();
  }

  private persistAndSync(): void {
    try {
      this.hooks.onChange?.();
    } catch (error) {
      if (this.strictPersistence) throw error;
      logger.error('Table state could not be saved', { matchId: this.gs.matchId, error: String(error) });
      if (!this.saveRetry) {
        this.saveRetry = setTimeout(() => {
          this.saveRetry = null;
          this.persistAndSync();
        }, 1000);
        this.saveRetry.unref?.();
      }
      return;
    }
    if (this.saveRetry) clearTimeout(this.saveRetry);
    this.saveRetry = null;
    this.sync();
  }

  private withRollback<T>(run: () => T, retryDeadline = false): T {
    if (!this.hooks.onChange || this.strictPersistence) return run();
    const saved = this.serialize();
    const players = structuredClone(this.room.players);
    const speakerId = this.room.speakerId;
    this.strictPersistence = true;
    try {
      return run();
    } catch (error) {
      this.loadState(saved);
      this.room.players = players;
      this.room.speakerId = speakerId;
      const deadline = this.gs.timing?.deadline;
      if (deadline != null) {
        if (retryDeadline && deadline <= Date.now()) {
          this.clock = setTimeout(() => this.onDeadline(), 1000);
          this.clock.unref?.();
        } else {
          this.armClock(Math.max(0, deadline - Date.now()));
        }
      }
      throw error;
    } finally {
      this.strictPersistence = false;
    }
  }

  /** Validate the round before any mutation and remember completed actions through reconnects. */
  dispatch(playerId: string, action: string, scope: RoundAction, run: () => ActionResult): ActionResult {
    const { matchId, roundId } = this.gs;
    if (!this.room.players[playerId]?.connected) return reject('Your seat is disconnected.');
    const receipt = scope.actionId && [scope.roundId, playerId, action, scope.actionId].join(':');
    if (scope.matchId === matchId && receipt && this.actionReceipts.includes(receipt)) return {};
    if (scope.matchId !== matchId || scope.roundId !== roundId) {
      return reject('That round has moved on. Try again on the current screen.', 'ROUND_MOVED_ON');
    }
    const { audio, currentSong } = this.gs;
    if (!this.manual && currentSong && audio?.status === 'playing' && !this.automaticSource(currentSong)) {
      this.pause('audio-unavailable');
      this.changed();
    }
    if (this.gs.timing?.deadline != null && this.gs.timing.deadline <= Date.now()) {
      this.onDeadline();
      return reject('The round clock has expired.', 'ROUND_MOVED_ON');
    }
    return this.withRollback(() => {
      this.deferred = true;
      if (receipt) this.actionReceipts.push(receipt);
      try {
        const result = run();
        if (receipt && result.error) this.actionReceipts = this.actionReceipts.filter((stored) => stored !== receipt);
        else if (this.actionReceipts.length > 1024) this.actionReceipts.shift();
        this.deferred = false;
        if (this.dirty) this.changed();
        return result;
      } finally {
        this.deferred = false;
        this.dirty = false;
      }
    });
  }

  resetGame() {
    this.dispose();
    this.deck = [];
    this.round = freshRound();
    this.participants = [];
    this.departed.clear();
    this.djRotation = [];
    this.djSchedule = [];
    this.actionReceipts = [];
    this.dinnerCount = 0;
    this.scores = {};
    this.history = [];
    this.stats = { playerStats: {}, totalRounds: 0 };
    this.finishPending = null;
    this.leadChange = null;
    for (const player of Object.values(this.room.players)) {
      player.timeline = [];
      player.tokens = STARTING_TOKENS;
    }
    this.room.gameState = {
      phase: 'lobby', currentTurnPlayerId: null, currentSong: null, pendingPlacement: null,
      challengers: [], turnOrder: [], turnIndex: 0, deckSize: 0, sharedTimeline: [],
      revision: this.gs.revision,
    };
  }

  startGame(deck: SongCard[], playerIds = Object.keys(this.room.players).filter((id) => this.room.players[id].connected)) {
    this.withRollback(() => this.beginMatch(deck, playerIds));
  }

  private beginMatch(deck: SongCard[], playerIds: string[]) {
    this.resetGame();
    this.deck = [...deck];
    const dedicated = this.room.settings.dedicatedDjId;
    this.participants = playerIds.filter((id) => this.room.players[id] && (!this.manual || id !== dedicated));
    this.djRotation = fisherYatesShuffle([...this.participants]);
    const gs = this.gs;
    Object.assign(gs, {
      phase: 'anchor_preview', matchId: randomUUID(), roundId: 0,
      turnOrder: [...this.djRotation], rematchPlayerIds: [],
      audio: this.idleAudio(), reveal: null, result: null,
    });
    for (const id of this.participants) {
      this.stats.playerStats[id] = newStats();
      if (this.dinner) this.scores[id] = 0;
      if (!this.coop && !this.dinner) {
        const card = this.deck.pop();
        if (card) this.room.players[id].timeline = [recordingFacts(card)];
      }
    }
    if (this.dinner) {
      this.dinnerCount = getDinnerRoundCount(this.room.settings, this.room.playbackMode, this.participants.length);
      if (this.manual && !dedicated && this.djRotation.length) {
        this.djSchedule = Array.from({ length: this.dinnerCount }, (_, index) => this.djRotation[index % this.djRotation.length]);
      }
      this.dealDinnerAnchors();
    } else if (this.coop) {
      const card = this.deck.pop();
      if (card) gs.sharedTimeline = [recordingFacts(card)];
    }
    gs.deckSize = this.deck.length;
    gs.currentTurnPlayerId = this.dinner ? null : gs.turnOrder[0] ?? null;
    this.armClock(ANCHOR_PREVIEW_MS);
    this.changed();
  }

  private dealDinnerAnchors() {
    const candidates = [...this.deck].sort((a, b) => a.year - b.year);
    const anchors: SongCard[] = [];
    for (let i = 0; i < DINNER_ANCHOR_COUNT && i < candidates.length; i++) {
      const card = candidates[Math.round(i * (candidates.length - 1) / (DINNER_ANCHOR_COUNT - 1))];
      if (!anchors.includes(card)) anchors.push(card);
    }
    const selected = new Set(anchors);
    this.gs.sharedTimeline = anchors.map(recordingFacts);
    this.deck = this.deck.filter((card) => !selected.has(card));
  }

  addLatecomer(playerId: string) {
    const player = this.room.players[playerId];
    const gs = this.gs;
    if (!player || !gs.matchId || this.dinner || gs.phase === 'game_over' || this.finishPending ||
      this.participants.includes(playerId) || (!this.coop && this.deck.length < 2)) return;
    this.participants.push(playerId);
    this.stats.playerStats[playerId] = newStats();
    if (!this.coop) player.timeline = [recordingFacts(this.deck.pop()!)];
    gs.turnOrder.splice(gs.turnIndex + 1, 0, playerId);
    gs.deckSize = this.deck.length;
    this.changed();
  }

  skipAnchors(playerId = this.room.hostId): ActionResult {
    if (playerId !== this.room.hostId || this.gs.phase !== 'anchor_preview') {
      return reject('Only the controller can continue from the starting cards.');
    }
    this.startTurn();
    return {};
  }

  private idleAudio(): RoundAudio {
    return { kind: this.manual ? 'manual' : 'automatic', status: 'idle', cueId: null, operatorId: null };
  }

  private startTurn(overrideDj?: string, dinnerEligible?: string[]) {
    this.clearClock();
    const gs = this.gs;
    if (!this.deck.length) {
      this.finish('deck-exhausted');
      return;
    }
    if (!this.dinner && !this.room.players[gs.currentTurnPlayerId ?? '']?.connected) {
      this.selectNextPlayer(false);
    }
    const song = this.deck.pop()!;
    const operatorId = this.manual ? overrideDj ?? this.nextDj() : this.room.speakerId ?? null;
    this.round = freshRound();
    gs.roundId = (gs.roundId ?? 0) + 1;
    gs.currentSong = song;
    gs.phase = 'playing';
    gs.reveal = null;
    gs.finalReveal = false;
    gs.pendingPlacement = null;
    gs.challengers = [];
    gs.deckSize = this.deck.length;
    if (this.dinner) {
      this.round.eligible = dinnerEligible ?? this.participants.filter((id) => !this.departed.has(id) && (!this.manual || id !== operatorId));
    }
    this.issueCue(operatorId);
    this.changed();
  }

  private nextDj(): string | null {
    const dedicated = this.room.settings.dedicatedDjId;
    if (dedicated && this.room.players[dedicated]) return dedicated;
    if (this.dinner) return this.djSchedule[this.stats.totalRounds] ?? this.djRotation[this.stats.totalRounds % this.djRotation.length] ?? null;
    const { turnOrder, turnIndex, currentTurnPlayerId } = this.gs;
    const alternatives = turnOrder.slice(turnIndex + 1).concat(turnOrder.slice(0, turnIndex + 1))
      .filter((id) => id !== currentTurnPlayerId && this.room.players[id]?.connected);
    return alternatives[0] ?? null;
  }

  private issueCue(operatorId: string | null) {
    const gs = this.gs;
    const song = gs.currentSong!;
    const isAvailable = !!operatorId && this.room.players[operatorId]?.connected &&
      (this.manual || !!this.automaticSource(song));
    gs.audio = {
      kind: this.manual ? 'manual' : 'automatic',
      status: isAvailable ? (this.manual ? 'cueing' : 'awaiting_audio') : 'paused',
      cueId: randomUUID(), operatorId,
      reason: isAvailable ? undefined : (this.onTable ? 'audio-unavailable' : 'all-away'),
    };
    if (this.manual && operatorId && !this.round.cueSeenBy.includes(operatorId)) this.round.cueSeenBy.push(operatorId);
  }

  resumeAudio(playerId: string, cueId: string): ActionResult {
    const audio = this.gs.audio;
    if (!audio || audio.cueId !== cueId || this.operator !== playerId || audio.status !== 'paused') {
      return reject('Only the current music device can resume this song.');
    }
    if (this.manual) return this.audioReady(playerId, cueId);
    if (!this.gs.currentSong || !this.automaticSource(this.gs.currentSong)) {
      return reject('This recording is unavailable. Replace the recording to continue.');
    }
    this.issueCue(playerId);
    this.changed();
    return {};
  }

  audioReady(playerId: string, cueId: string): ActionResult {
    const audio = this.gs.audio;
    if (!audio || audio.cueId !== cueId || this.operator !== playerId || audio.status === 'idle') {
      return reject('This cue belongs to another song or music device.', 'CUE_MOVED_ON');
    }
    if (audio.status === 'playing') return {};
    const song = this.gs.currentSong;
    if (!song || (!this.manual && (audio.status !== 'awaiting_audio' || !this.automaticSource(song)))) {
      return reject('Playback did not start. Resume music or replace the recording.');
    }
    this.heard.add(song.recordingId || song.id);
    this.gs.audio = { ...audio, status: 'playing', reason: undefined };
    this.armClock(this.remainingTime() ?? TURN_TIME_MS);
    if (this.gs.phase === 'challenge') this.finishClassicIfReady();
    else if (this.dinner && this.everyoneHasLocked()) this.resolveDinner();
    else this.changed();
    return {};
  }

  audioInterrupted(playerId: string, cueId: string): ActionResult {
    const audio = this.gs.audio;
    if (!audio || audio.cueId !== cueId || this.operator !== playerId || audio.status === 'idle') {
      return reject('This cue belongs to another song or music device.', 'CUE_MOVED_ON');
    }
    if (audio.status === 'paused') return {};
    this.pause('audio-unavailable');
    this.changed();
    return {};
  }

  assignSpeaker(playerId: string, speakerId: string): ActionResult {
    if (playerId !== this.room.hostId || !this.room.players[speakerId]?.connected) {
      return reject('The controller can assign music to a connected seat.');
    }
    const gs = this.gs;
    if (this.manual) {
      if (gs.phase !== 'playing' && gs.phase !== 'challenge') return reject('There is no active cue to hand off.');
      if (speakerId === this.operator) return {};
      if (speakerId === gs.currentTurnPlayerId) return reject('The active guesser cannot cue this recording.');
      if (!this.deck.length) return reject('There are no replacement recordings left.');
      let eligible = this.round.eligible;
      if (this.dinner && eligible.includes(speakerId)) {
        const currentSlot = this.stats.totalRounds;
        const futureSlot = this.djSchedule.indexOf(speakerId, currentSlot + 1);
        if (futureSlot === -1) return reject('Choose a spectator or a player who still has a DJ turn in this set.');
        const originalDj = this.djSchedule[currentSlot];
        this.djSchedule[currentSlot] = speakerId;
        this.djSchedule[futureSlot] = originalDj;
        eligible = this.participants.filter((id) => !this.departed.has(id) && id !== speakerId);
      }
      return this.voidRound(speakerId, eligible);
    }
    if (this.room.speakerId === speakerId) return {};
    this.room.speakerId = speakerId;
    if (gs.phase === 'playing' || gs.phase === 'challenge') {
      this.pause('audio-unavailable');
      this.issueCue(speakerId);
    }
    this.changed();
    return {};
  }

  replaceSong(playerId: string, cueId: string): ActionResult {
    const { audio, phase } = this.gs;
    if ((phase !== 'playing' && phase !== 'challenge') || audio?.cueId !== cueId ||
      (playerId !== this.room.hostId && playerId !== this.operator)) {
      return reject('Only the controller or the current music device can replace this recording.');
    }
    return this.voidRound(this.manual ? this.operator ?? undefined : undefined, this.dinner ? this.round.eligible : undefined);
  }

  private voidRound(operatorId?: string, dinnerEligible?: string[]): ActionResult {
    for (const id of this.gs.challengers) {
      const player = this.room.players[id];
      if (player) player.tokens += CHALLENGE_COST;
    }
    for (const id of this.round.namingTokens) {
      const player = this.room.players[id];
      if (player) player.tokens = Math.max(0, player.tokens - 1);
    }
    for (const [id, attempt] of Object.entries(this.round.attempts)) {
      if (attempt.correct && this.stats.playerStats[id]) this.stats.playerStats[id].songsNamed--;
    }
    if (!this.deck.length) {
      this.round = freshRound();
      this.gs.challengers = [];
      this.gs.pendingPlacement = null;
      this.pause('audio-unavailable');
      return this.finish('deck-exhausted');
    }
    this.startTurn(operatorId, dinnerEligible);
    return {};
  }

  private liveClassic(playerId: string) {
    return !this.dinner && this.gs.audio?.status === 'playing' && this.room.players[playerId]?.connected &&
      this.participants.includes(playerId) && !this.round.cueSeenBy.includes(playerId);
  }

  placeCard(playerId: string, position: number): ActionResult {
    const gs = this.gs;
    if (gs.phase === 'challenge' && gs.currentTurnPlayerId === playerId && gs.pendingPlacement === position) return {};
    const player = this.room.players[playerId];
    if (!player || !this.liveClassic(playerId) || gs.phase !== 'playing' || playerId !== gs.currentTurnPlayerId) {
      return reject('You cannot place this card now.');
    }
    if (!validPosition(position, this.coop ? gs.sharedTimeline : player.timeline)) {
      return reject('Select a gap in the timeline.');
    }
    this.round.placementElapsed = TURN_TIME_MS - (this.remainingTime() ?? TURN_TIME_MS);
    gs.pendingPlacement = position;
    gs.phase = 'challenge';
    this.round.eligible = this.coop ? [] : this.participants.filter((id) => {
      const opponent = this.room.players[id];
      return id !== playerId && opponent && opponent.tokens >= CHALLENGE_COST &&
        !this.departed.has(id) && !this.round.cueSeenBy.includes(id);
    });
    this.armClock(CHALLENGE_WINDOW_MS);
    this.finishClassicIfReady();
    return {};
  }

  challenge(playerId: string, position: number): ActionResult {
    if (this.round.decisions[playerId] === position) return {};
    if (!this.liveClassic(playerId) || this.gs.phase !== 'challenge' || !this.round.eligible.includes(playerId)) {
      return reject('You cannot challenge this placement.');
    }
    const player = this.room.players[playerId];
    if (player.tokens < CHALLENGE_COST || playerId in this.round.decisions) return reject('Your response has already been recorded.');
    const timeline = this.room.players[this.gs.currentTurnPlayerId!].timeline;
    if (!validPosition(position, timeline) || position === this.gs.pendingPlacement) {
      return reject('Choose a different gap from the current placement.', 'CHALLENGE_COLLISION');
    }
    if (Object.values(this.round.decisions).includes(position)) {
      return reject('That gap is already taken by another challenger.', 'CHALLENGE_COLLISION');
    }
    this.round.decisions[playerId] = position;
    this.gs.challengers.push(playerId);
    player.tokens -= CHALLENGE_COST;
    this.finishClassicIfReady();
    return {};
  }

  passChallenge(playerId: string): ActionResult {
    if (this.round.decisions[playerId] === null) return {};
    if (!this.liveClassic(playerId) || this.gs.phase !== 'challenge' || !this.round.eligible.includes(playerId) || playerId in this.round.decisions) {
      return reject('You cannot pass this challenge.');
    }
    this.round.decisions[playerId] = null;
    this.finishClassicIfReady();
    return {};
  }

  nameSong(playerId: string, guess: SongGuess): ActionResult {
    const current = this.gs.currentSong;
    if (this.round.attempts[playerId]) return {};
    if (!current || !this.liveClassic(playerId) || !['playing', 'challenge'].includes(this.gs.phase) ||
      this.round.namingDone.includes(playerId)) return reject('You cannot name this recording now.');
    if (this.mode === 'expert' && this.gs.currentTurnPlayerId === playerId &&
      (!Number.isInteger(guess.year) || guess.year! < 1000 || guess.year! > 3000)) {
      return reject('Enter a complete four-digit release year.', 'EXPERT_YEAR_REQUIRED');
    }
    if (!guess.title.trim()) return reject('Enter a song title.');
    const titleMatch = fuzzyMatch(guess.title, current.title);
    const artistMatch = !!guess.artist.trim() && fuzzyMatch(guess.artist, current.artist);
    const correct = titleMatch && (this.mode === 'original' || this.coop || artistMatch);
    this.round.attempts[playerId] = { guess, correct, titleMatch, artistMatch };
    this.round.namingDone.push(playerId);
    if (correct) {
      this.stats.playerStats[playerId].songsNamed++;
      const player = this.room.players[playerId];
      if (player.tokens < MAX_TOKENS) {
        player.tokens++;
        this.round.namingTokens.push(playerId);
      }
    }
    this.finishClassicIfReady();
    return {};
  }

  doneGuessing(playerId: string): ActionResult {
    if (this.round.namingDone.includes(playerId)) return {};
    if (!this.liveClassic(playerId) || this.gs.currentTurnPlayerId !== playerId ||
      !['playing', 'challenge'].includes(this.gs.phase)) return reject('Only the active guesser can finish naming.');
    this.round.namingDone.push(playerId);
    this.finishClassicIfReady();
    return {};
  }

  private finishClassicIfReady() {
    const active = this.gs.currentTurnPlayerId!;
    if (this.gs.phase === 'challenge' && this.gs.audio?.status === 'playing' && this.round.namingDone.includes(active) &&
      this.round.eligible.every((id) => id in this.round.decisions)) {
      this.resolveClassic();
    } else {
      this.changed();
    }
  }

  dinnerGuess(playerId: string, position: number): ActionResult {
    const available = this.validateDinnerGuess(playerId);
    if (available.error) return available;
    if (!validPosition(position, this.gs.sharedTimeline)) return reject('Select a gap in the timeline.');
    if (this.round.guesses[playerId]?.position === position) return {};
    this.round.guesses[playerId] = { position, locked: false };
    this.changed();
    return {};
  }

  lockGuess(playerId: string, position?: number): ActionResult {
    if (this.round.guesses[playerId]?.locked) return {};
    const available = this.validateDinnerGuess(playerId);
    if (available.error) return available;
    const selected = position ?? this.round.guesses[playerId]?.position;
    if (selected == null || !validPosition(selected, this.gs.sharedTimeline)) return reject('Select a gap in the timeline first.');
    this.round.guesses[playerId] = { position: selected, locked: true };
    if (this.everyoneHasLocked()) this.resolveDinner();
    else this.changed();
    return {};
  }

  private validateDinnerGuess(playerId: string): ActionResult {
    if (!this.dinner || this.gs.phase !== 'playing' || this.gs.audio?.status !== 'playing' ||
      !this.round.eligible.includes(playerId) || this.round.cueSeenBy.includes(playerId) || !this.room.players[playerId]?.connected) {
      return reject('You cannot guess on this recording.');
    }
    if (this.round.guesses[playerId]?.locked) return reject('Your guess is locked.');
    return {};
  }

  private everyoneHasLocked(): boolean {
    return this.round.eligible.every((id) => this.round.guesses[id]?.locked || this.departed.has(id));
  }

  skipSong(playerId: string): ActionResult {
    const player = this.room.players[playerId];
    if (!this.liveClassic(playerId) || this.gs.phase !== 'playing' || this.gs.currentTurnPlayerId !== playerId ||
      player.tokens < SKIP_COST) return reject('Skipping costs a token and is available on your turn.');
    player.tokens -= SKIP_COST;
    this.advanceTurn(true);
    return {};
  }

  buyCard(playerId: string): ActionResult {
    const gs = this.gs;
    const player = this.room.players[playerId];
    if (!this.liveClassic(playerId) || gs.phase !== 'playing' || player.tokens < BUY_CARD_COST || !this.deck.length) {
      return reject('Buying is available while listening and costs three tokens.');
    }
    const card = this.deck.pop()!;
    const timeline = this.coop ? gs.sharedTimeline : player.timeline;
    const before = [...timeline];
    const leaders = this.leaders();
    player.tokens -= BUY_CARD_COST;
    gs.deckSize = this.deck.length;
    insertCard(timeline, card);
    this.trackLead(leaders, card);
    if (timeline.length >= this.room.settings.cardsToWin) {
      gs.currentSong = card;
      this.finishPending = 'target-reached';
      this.showReveal({
        song: recordingFacts(card), correct: true, winnerId: playerId, stolenBy: null,
        timeline: before, position: null, correctPositions: correctPositions(card, before),
      });
    } else {
      this.changed();
    }
    return {};
  }

  flagRecording(playerId: string): ActionResult {
    const reveal = this.gs.reveal;
    if (this.gs.phase !== 'reveal' || !reveal || !this.room.players[playerId]) return reject('Flag a recording from its reveal.');
    const flagged = reveal.flaggedBy ?? [];
    if (flagged.includes(playerId)) return {};
    reveal.flaggedBy = [...flagged, playerId];
    const played = this.history.find((round) => round.roundNumber === this.gs.roundId);
    if (played) played.flaggedBy = reveal.flaggedBy;
    logger.info('Recording disputed', { matchId: this.gs.matchId, roundId: this.gs.roundId, recordingId: reveal.song.recordingId ?? reveal.song.id });
    this.changed();
    return {};
  }

  confirmReveal(playerId: string): ActionResult {
    if (this.gs.phase !== 'reveal' || playerId !== this.room.hostId) return reject('Only the controller can advance a reveal.');
    if (this.finishPending) return this.finish(this.finishPending);
    this.advanceTurn();
    return {};
  }

  setRematchConsent(playerId: string, accept: boolean): ActionResult {
    if (this.gs.phase !== 'game_over' || !this.room.players[playerId]?.connected) return reject('Rematch voting opens at Results.');
    const votes = new Set(this.gs.rematchPlayerIds);
    if (votes.has(playerId) === accept) return {};
    if (accept) votes.add(playerId);
    else votes.delete(playerId);
    this.gs.rematchPlayerIds = [...votes];
    this.changed();
    return {};
  }

  private resolveClassic() {
    const gs = this.gs;
    const playerId = gs.currentTurnPlayerId!;
    const player = this.room.players[playerId];
    const song = gs.currentSong!;
    const position = gs.pendingPlacement!;
    const timeline = this.coop ? gs.sharedTimeline : player.timeline;
    const before = [...timeline];
    const positions = correctPositions(song, before);
    const placementCorrect = positions.includes(position);
    const attempt = this.round.attempts[playerId];
    const songNamed = attempt?.correct === true;
    const yearCorrect = this.mode === 'expert' ? attempt?.guess.year === song.year : undefined;
    const correct = placementCorrect &&
      (this.mode !== 'pro' && this.mode !== 'expert' || songNamed) &&
      (this.mode !== 'expert' || yearCorrect === true);

    const challengeResults: NonNullable<RoundReveal['challengeResults']> = {};
    let stolenBy: string | null = null;
    for (const id of gs.challengers) {
      const alternative = this.round.decisions[id];
      if (alternative == null) continue;
      const won = !correct && !stolenBy && alternative !== position && positions.includes(alternative);
      challengeResults[id] = { position: alternative, correct: won };
      if (won) {
        this.stats.playerStats[id].challengesWon++;
        stolenBy = id;
      } else {
        this.stats.playerStats[id].challengesLost++;
      }
    }
    const winnerId = correct ? playerId : stolenBy;
    const priorLeaders = this.leaders();
    let coopPenalty = false;
    if (correct) timeline.splice(position, 0, recordingFacts(song));
    else if (stolenBy) insertCard(this.room.players[stolenBy].timeline, song);
    else if (this.coop && player.tokens > 0) {
      player.tokens = Math.max(0, player.tokens - COOP_WRONG_PENALTY);
      coopPenalty = true;
    }
    this.trackLead(priorLeaders, song);
    this.recordPlacement(playerId, song, correct, placementCorrect, this.round.placementElapsed);
    this.recordRound(song, playerId, correct, stolenBy);
    if (winnerId && (this.coop ? gs.sharedTimeline : this.room.players[winnerId].timeline).length >= this.room.settings.cardsToWin) {
      this.finishPending = 'target-reached';
    }
    this.showReveal({
      song: recordingFacts(song), correct, winnerId, stolenBy, position, timeline: before,
      correctPositions: positions, modeResult: { placementCorrect, songNamed, yearCorrect, coopPenalty },
      challengeResults,
    });
  }

  private resolveDinner() {
    const gs = this.gs;
    const song = gs.currentSong!;
    const before = [...gs.sharedTimeline];
    const positions = correctPositions(song, before);
    const guesses: NonNullable<RoundReveal['dinnerGuesses']> = {};
    const priorLeaders = this.leaders();
    for (const id of this.round.eligible) {
      const guess = this.round.guesses[id];
      const position = guess?.locked ? guess.position : null;
      const correct = position !== null && positions.includes(position);
      const points = correct ? 1 : 0;
      guesses[id] = { position, correct, points };
      this.scores[id] += points;
      this.recordPlacement(id, song, correct, correct);
    }
    this.trackLead(priorLeaders, song);
    insertCard(gs.sharedTimeline, song);
    const correct = Object.values(guesses).some((guess) => guess.correct);
    this.recordRound(song, this.operator ?? '', correct, null);
    if (this.stats.totalRounds >= this.dinnerCount) this.finishPending = 'set-complete';
    this.showReveal({
      song: recordingFacts(song), correct, winnerId: null, stolenBy: null, position: null,
      correctPositions: positions, timeline: before, dinnerGuesses: guesses,
    });
  }

  private recordPlacement(playerId: string, song: SongCard, correct: boolean, placementCorrect: boolean, elapsed: number | null = null) {
    const stats = this.stats.playerStats[playerId];
    if (!stats) return;
    stats.totalPlacements++;
    const decade = Math.floor(song.year / 10) * 10;
    const decadeStats = stats.decadeAccuracy[decade] ??= { correct: 0, total: 0 };
    decadeStats.total++;
    if (placementCorrect) decadeStats.correct++;
    if (correct) {
      stats.correctPlacements++;
      stats.currentStreak++;
      stats.longestStreak = Math.max(stats.longestStreak, stats.currentStreak);
    } else {
      stats.currentStreak = 0;
    }
    if (elapsed !== null && (stats.fastestPlacementMs === null || elapsed < stats.fastestPlacementMs)) {
      stats.fastestPlacementMs = elapsed;
    }
  }

  private recordRound(song: SongCard, playerId: string, correct: boolean, stolenBy: string | null) {
    this.stats.totalRounds++;
    this.history.push({
      song: recordingFacts(song), turnPlayerId: playerId, correct, stolenBy, roundNumber: this.gs.roundId!,
    });
  }

  private showReveal(reveal: RoundReveal) {
    this.clearClock();
    this.gs.audio = this.idleAudio();
    this.gs.phase = 'reveal';
    this.gs.reveal = reveal;
    if (!this.finishPending && !this.deck.length) this.finishPending = 'deck-exhausted';
    this.gs.finalReveal = !!this.finishPending;
    this.changed();
  }

  private selectNextPlayer(increment = true) {
    const gs = this.gs;
    const length = gs.turnOrder.length;
    const start = gs.turnIndex + (increment ? 1 : 0);
    const order = gs.turnOrder.slice(start % length).concat(gs.turnOrder.slice(0, start % length));
    const next = order.find((id) => this.room.players[id]?.connected);
    if (next) {
      gs.turnIndex = gs.turnOrder.indexOf(next);
      gs.currentTurnPlayerId = next;
    }
  }

  private advanceTurn(revealIfLast = false) {
    const { currentSong, currentTurnPlayerId, sharedTimeline } = this.gs;
    if (revealIfLast && !this.deck.length && currentSong && currentTurnPlayerId) {
      const timeline = [...(this.coop ? sharedTimeline : this.room.players[currentTurnPlayerId].timeline)];
      this.finishPending = 'deck-exhausted';
      this.showReveal({
        song: recordingFacts(currentSong), correct: false, winnerId: null, stolenBy: null,
        position: null, correctPositions: correctPositions(currentSong, timeline), timeline,
      });
      return;
    }
    if (!this.dinner) this.selectNextPlayer();
    this.startTurn();
  }

  private scoreBoard(): Record<string, number> {
    return Object.fromEntries(this.participants.map((id) => [
      id,
      this.dinner ? this.scores[id] : this.coop ? this.gs.sharedTimeline.length : this.room.players[id]?.timeline.length ?? 0,
    ]));
  }

  private leaders(scores = this.scoreBoard()): string[] {
    const high = Math.max(...Object.values(scores));
    return Object.keys(scores).filter((id) => scores[id] === high);
  }

  private trackLead(previous: string[], song: SongCard) {
    const current = this.leaders();
    if (current.length !== 1) this.leadChange = null;
    else if (previous.length !== 1 || previous[0] !== current[0]) {
      this.leadChange = { playerId: current[0], song: recordingFacts(song) };
    }
  }

  abandon(): ActionResult {
    if (!this.gs.matchId || this.gs.phase === 'game_over') return {};
    return this.finish('abandoned');
  }

  endMatch(playerId: string): ActionResult {
    if (playerId !== this.room.hostId || !this.gs.matchId || this.gs.phase === 'game_over') {
      return reject('Only the controller can end an active match.');
    }
    if (this.gs.finalReveal) return reject('Choose See results to finish this match.');
    return this.abandon();
  }

  private finish(reason: MatchEnd): ActionResult {
    const gs = this.gs;
    if (gs.phase === 'game_over' || !gs.matchId) return {};
    const scores = this.scoreBoard();
    const abandoned = reason === 'abandoned';
    const coopWon = this.coop && this.gs.sharedTimeline.length >= this.room.settings.cardsToWin;
    const winnerIds = abandoned ? [] : this.coop ? (coopWon ? this.participants : []) : this.leaders(scores);
    const sorted = Object.values(scores).sort((a, b) => b - a);
    const margin = this.coop || abandoned || sorted.length < 2 ? null : sorted[0] - sorted[1];
    const decidingSong = reason === 'target-reached' && gs.reveal ? gs.reveal.song :
      winnerIds.length === 1 && this.leadChange?.playerId === winnerIds[0] ? this.leadChange.song : null;
    const before = { phase: gs.phase, audio: gs.audio, timing: gs.timing, result: gs.result, revision: gs.revision };
    this.clearClock();
    Object.assign(gs, {
      phase: 'game_over', audio: this.idleAudio(), revision: (gs.revision ?? 0) + 1,
      result: {
        matchId: gs.matchId, status: abandoned ? 'abandoned' : !winnerIds.length ? 'lost' :
          (!this.coop && winnerIds.length > 1) ? 'tied' : 'won',
        reason, winnerIds, scores, margin, decidingSong,
      } satisfies MatchResult,
    });
    try {
      this.gameEnded?.();
    } catch (error) {
      Object.assign(gs, before);
      if (before.timing?.deadline != null) this.armClock(Math.max(0, before.timing.deadline - Date.now()));
      logger.error('Match result write failed', { matchId: gs.matchId, error: String(error) });
      return reject(reason === 'abandoned' ? 'The match could not be ended yet. Try again.' :
        'The result could not be saved yet. Try again.', 'RESULT_SAVE_FAILED');
    }
    if (this.gameEnded) this.sync();
    else this.persistAndSync();
    return {};
  }

  private remainingTime(): number | null {
    const timing = this.gs.timing;
    if (!timing) return null;
    return timing.deadline === null ? timing.remainingMs : Math.max(0, timing.deadline - Date.now());
  }

  private armClock(ms: number) {
    this.stopClock();
    this.gs.timing = { deadline: Date.now() + ms, remainingMs: ms };
    const song = this.gs.currentSong;
    const rightsDelay = !this.manual && song ? Math.max(0, this.audioExpiry(song) - Date.now()) : Infinity;
    this.clock = rightsDelay <= ms
      ? setTimeout(() => {
        this.pause('audio-unavailable');
        this.changed();
      }, rightsDelay)
      : setTimeout(() => this.onDeadline(), ms);
    if (this.hooks.onChange) {
      this.checkpoint = setInterval(() => {
        const { currentSong, audio } = this.gs;
        if (!this.manual && currentSong && audio?.status === 'playing' && !this.automaticSource(currentSong)) {
          this.pause('audio-unavailable');
          this.changed();
        } else {
          try {
            this.hooks.onChange?.();
          } catch (error) {
            logger.error('Match clock checkpoint failed', { matchId: this.gs.matchId, error: String(error) });
          }
        }
      }, 5000);
      this.checkpoint.unref?.();
    }
    this.clock.unref?.();
  }

  private clearClock() {
    this.stopClock();
    this.gs.timing = { deadline: null, remainingMs: null };
  }

  private onDeadline() {
    try {
      this.withRollback(() => {
        if (!this.manual && this.gs.currentSong && this.gs.audio?.status === 'playing' &&
          !this.automaticSource(this.gs.currentSong)) {
          this.pause('audio-unavailable');
          this.changed();
          return;
        }
        this.clearClock();
        if (this.gs.phase === 'anchor_preview') this.startTurn();
        else if (this.gs.audio?.status !== 'playing') return;
        else if (this.gs.phase === 'challenge') this.resolveClassic();
        else if (this.gs.phase === 'playing' && this.dinner) this.resolveDinner();
        else if (this.gs.phase === 'playing') this.advanceTurn(true);
      }, true);
    } catch (error) {
      logger.error('Timed game transition could not be saved', { matchId: this.gs.matchId, error: String(error) });
    }
  }

  private pause(reason: NonNullable<RoundAudio['reason']>) {
    const remainingMs = this.remainingTime();
    this.stopClock();
    this.gs.timing = { deadline: null, remainingMs };
    if (this.gs.audio && this.gs.audio.status !== 'idle') {
      this.gs.audio = { ...this.gs.audio, status: 'paused', reason };
    }
  }

  handlePlayerDisconnect(playerId: string) {
    const phase = this.gs.phase;
    if (!this.onTable || (this.operator === playerId && (phase === 'playing' || phase === 'challenge'))) {
      this.pause(this.onTable ? 'audio-unavailable' : 'all-away');
    }
    this.changed();
  }

  handlePlayerReconnect(_playerId: string) {
    if (this.gs.phase === 'anchor_preview' && this.gs.timing?.deadline == null) {
      this.armClock(this.remainingTime() ?? ANCHOR_PREVIEW_MS);
    } else if (!this.dinner && this.gs.phase === 'playing' && this.departed.has(this.gs.currentTurnPlayerId!)) {
      this.advanceTurn(true);
      return;
    }
    this.changed();
  }

  handlePlayerVoluntaryLeave(playerId: string) {
    const gs = this.gs;
    if (gs.rematchPlayerIds?.includes(playerId)) {
      gs.rematchPlayerIds = gs.rematchPlayerIds.filter((id) => id !== playerId);
    }
    if (gs.phase === 'lobby' || gs.phase === 'game_over') {
      this.handlePlayerDisconnect(playerId);
      return;
    }
    this.departed.add(playerId);
    if (this.participants.every((id) => this.departed.has(id))) {
      this.abandon();
      return;
    }
    if (this.dinner) {
      this.handleDinnerDeparture(playerId);
      return;
    }
    const isTurnOwner = gs.currentTurnPlayerId === playerId;
    if (gs.phase === 'playing' && isTurnOwner && this.onTable) {
      this.advanceTurn(true);
      return;
    }
    if (gs.phase === 'challenge') {
      if (isTurnOwner && !this.round.namingDone.includes(playerId)) this.round.namingDone.push(playerId);
      if (this.round.eligible.includes(playerId) && !(playerId in this.round.decisions)) this.round.decisions[playerId] = null;
      if (this.operator !== playerId && this.onTable && gs.audio?.status === 'playing') {
        this.finishClassicIfReady();
        return;
      }
    }
    this.handlePlayerDisconnect(playerId);
  }

  private handleDinnerDeparture(playerId: string) {
    const gs = this.gs;
    const currentSlot = this.stats.totalRounds;
    const playing = gs.phase === 'playing';
    const departedDj = playing && this.operator === playerId && this.djSchedule[currentSlot] === playerId;
    if (this.djSchedule.length) {
      const futureStart = currentSlot + (playing && !departedDj ? 1 : 0);
      const pending = this.djSchedule.slice(futureStart);
      const kept = pending.filter((id) => id !== playerId);
      this.djSchedule = this.djSchedule.slice(0, futureStart).concat(kept);
      this.dinnerCount -= pending.length - kept.length;
    }
    if (departedDj) {
      if (this.stats.totalRounds < this.dinnerCount) this.voidRound();
      else this.finish('set-complete');
    } else if (playing && this.operator !== playerId && gs.audio?.status === 'playing' && this.everyoneHasLocked()) {
      this.resolveDinner();
    } else {
      if (gs.phase === 'reveal' && this.stats.totalRounds >= this.dinnerCount) {
        this.finishPending = 'set-complete';
        gs.finalReveal = true;
      }
      this.handlePlayerDisconnect(playerId);
    }
  }
}
