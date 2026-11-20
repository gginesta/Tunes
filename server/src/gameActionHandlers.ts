import type { Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, Room, RoundAction } from '@tunes/shared';
import type { GameEngine } from './game';
import { logger } from './logger';
import { isBoundedInt, isRecord, isShortString } from './validate';

type TunesSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type ActionResult = { error?: string; code?: string };
type Handler = (engine: GameEngine, playerId: string, payload: Record<string, unknown>) => ActionResult;

export interface GameActionDeps {
  getEngine: (socket: TunesSocket) => GameEngine | null;
  getMapping: (socketId: string) => { code: string; playerId: string } | undefined;
  getRoom?: (code: string) => Room | undefined;
  persistRoom?: (code: string) => void;
}

function readScope(payload: Record<string, unknown>): RoundAction | null {
  const { actionId, matchId, roundId } = payload;
  if (!isShortString(matchId, 64) || !matchId || !isBoundedInt(roundId, 0, Number.MAX_SAFE_INTEGER)) return null;
  if (actionId !== undefined && (!isShortString(actionId, 64) || !actionId)) return null;
  return { matchId, roundId, actionId };
}

const invalidPosition = { error: 'Select a valid timeline gap.', code: 'INVALID_POSITION' };

export function registerGameActionHandlers(socket: TunesSocket, { getEngine, getMapping }: GameActionDeps): void {
  const handlers: Partial<Record<keyof ClientToServerEvents, Handler>> = {
    'skip-anchors': (engine, id) => engine.skipAnchors(id),
    'place-card': (engine, id, { position }) =>
      isBoundedInt(position, 0, 1000) ? engine.placeCard(id, position) : invalidPosition,
    'challenge': (engine, id, { position }) =>
      isBoundedInt(position, 0, 1000) ? engine.challenge(id, position) : invalidPosition,
    'pass-challenge': (engine, id) => engine.passChallenge(id),
    'name-song': (engine, id, { title, artist, year }) => {
      if (!isShortString(title) || !isShortString(artist)) {
        return { error: 'Enter a valid title and artist.' };
      }
      if (year !== undefined && !isBoundedInt(year, 1000, 3000)) {
        return { error: 'Enter a complete four-digit release year.', code: 'EXPERT_YEAR_REQUIRED' };
      }
      return engine.nameSong(id, { title, artist, year });
    },
    'done-guessing': (engine, id) => engine.doneGuessing(id),
    'skip-song': (engine, id) => engine.skipSong(id),
    'buy-card': (engine, id, { actionId }) => actionId
      ? engine.buyCard(id)
      : { error: 'Refresh and rejoin to use the current purchase control.', code: 'REFRESH_REQUIRED' },
    'confirm-reveal': (engine, id) => engine.confirmReveal(id),
    'end-match': (engine, id) => engine.endMatch(id),
    'dinner-guess': (engine, id, { position }) =>
      isBoundedInt(position, 0, 1000) ? engine.dinnerGuess(id, position) : invalidPosition,
    'lock-guess': (engine, id, { position }) =>
      position === undefined || isBoundedInt(position, 0, 1000) ? engine.lockGuess(id, position) : invalidPosition,
    'audio-ready': cueAction((engine, id, cueId) => engine.audioReady(id, cueId)),
    'audio-interrupted': cueAction((engine, id, cueId) => engine.audioInterrupted(id, cueId)),
    'resume-audio': cueAction((engine, id, cueId) => engine.resumeAudio(id, cueId)),
    'replace-song': cueAction((engine, id, cueId) => engine.replaceSong(id, cueId)),
    'assign-speaker': (engine, id, { playerId }) =>
      isShortString(playerId, 64) ? engine.assignSpeaker(id, playerId) : { error: 'Select a connected seat.' },
    'rematch-consent': (engine, id, { accept }) =>
      typeof accept === 'boolean' ? engine.setRematchConsent(id, accept) : { error: 'Choose a rematch response.' },
    'flag-recording': (engine, id) => engine.flagRecording(id),
    'play-anchor': () => ({ error: 'Starting cards are for reading the timeline.' }),
  };
  for (const [event, handler] of Object.entries(handlers)) {
    socket.on(event as keyof ClientToServerEvents, (payload: unknown) => {
      const engine = getEngine(socket);
      const mapping = getMapping(socket.id);
      if (!engine || !mapping) return;
      const scope = isRecord(payload) ? readScope(payload) : null;
      if (!scope || !isRecord(payload)) {
        socket.emit('error', { message: 'Refresh and rejoin to use the current game controls.', code: 'REFRESH_REQUIRED', action: event });
        return;
      }
      try {
        const result = engine.dispatch(mapping.playerId, event, scope, () => handler(engine, mapping.playerId, payload));
        if (result.error) socket.emit('error', { message: result.error, code: result.code, action: event });
      } catch (error) {
        logger.error('Game action failed', { action: event, matchId: scope.matchId, error: String(error) });
        socket.emit('error', { message: 'The table could not save that action. Try again.', code: 'ACTION_SAVE_FAILED', action: event });
      }
    });
  }
}

function cueAction(run: (engine: GameEngine, playerId: string, cueId: string) => ActionResult): Handler {
  return (engine, id, { cueId }) => isShortString(cueId, 64) && cueId
    ? run(engine, id, cueId)
    : { error: 'This music cue has expired.', code: 'CUE_MOVED_ON' };
}
