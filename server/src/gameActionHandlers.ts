import { Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, Room } from '@tunes/shared';
import type { GameEngine } from './game';
import { isBoundedInt, isRecord, isShortString } from './validate';

type TunesSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export interface GameActionDeps {
  getEngine: (socket: TunesSocket) => GameEngine | null;
  getMapping: (socketId: string) => { code: string; playerId: string } | undefined;
  getRoom: (code: string) => Room | undefined;
  persistRoom: (code: string) => void;
}

/** In-game actions: placing, challenging, naming, skipping, buying. */
export function registerGameActionHandlers(socket: TunesSocket, deps: GameActionDeps): void {
  const { getEngine, getMapping, getRoom, persistRoom } = deps;

  socket.on('play-anchor', (payload) => {
    if (!isRecord(payload) || !isBoundedInt(payload.index, 0, 100)) return;
    const index = payload.index;
    const engine = getEngine(socket);
    const mapping = getMapping(socket.id);
    if (!engine || !mapping) return;
    const room = getRoom(mapping.code.toUpperCase());
    if (room && mapping.playerId === room.hostId) {
      engine.playAnchor(index);
    }
  });

  socket.on('skip-anchors', () => {
    const engine = getEngine(socket);
    const mapping = getMapping(socket.id);
    if (!engine || !mapping) return;
    const room = getRoom(mapping.code.toUpperCase());
    if (room && mapping.playerId === room.hostId) {
      engine.skipAnchors();
    }
  });

  socket.on('place-card', (payload) => {
    if (!isRecord(payload) || !isBoundedInt(payload.position, 0, 100)) return;
    const engine = getEngine(socket);
    const mapping = getMapping(socket.id);
    if (!engine || !mapping) return;
    engine.placeCard(mapping.playerId, payload.position);
    persistRoom(mapping.code);
  });

  socket.on('challenge', (data) => {
    const engine = getEngine(socket);
    const mapping = getMapping(socket.id);
    if (!engine || !mapping) return;
    const position = isBoundedInt(data?.position, 0, 100) ? data.position : 0;
    const result = engine.challenge(mapping.playerId, position);
    if (result.error) {
      socket.emit('error', { message: result.error });
    }
  });

  socket.on('name-song', (guess) => {
    // Length caps protect the regex-heavy fuzzy matcher from CPU-burn payloads
    if (!isRecord(guess)) return;
    if (!isShortString(guess.title) || !isShortString(guess.artist)) return;
    if (guess.year !== undefined && !isBoundedInt(guess.year, 1000, 3000)) return;
    const engine = getEngine(socket);
    const mapping = getMapping(socket.id);
    if (!engine || !mapping) return;
    engine.nameSong(mapping.playerId, { title: guess.title, artist: guess.artist, year: guess.year });
  });

  socket.on('skip-song', () => {
    const engine = getEngine(socket);
    const mapping = getMapping(socket.id);
    if (!engine || !mapping) return;
    engine.skipSong(mapping.playerId);
  });

  socket.on('buy-card', () => {
    const engine = getEngine(socket);
    const mapping = getMapping(socket.id);
    if (!engine || !mapping) return;
    engine.buyCard(mapping.playerId);
  });

  socket.on('confirm-reveal', () => {
    const engine = getEngine(socket);
    const mapping = getMapping(socket.id);
    if (!engine || !mapping) return;
    engine.confirmReveal(mapping.playerId);
    persistRoom(mapping.code);
  });
}
