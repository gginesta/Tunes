import { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  Room,
  SongCard,
  SongGuess,
} from '@hitster/shared';
import {
  STARTING_TOKENS,
  MAX_TOKENS,
  SKIP_COST,
  CHALLENGE_COST,
  BUY_CARD_COST,
  CHALLENGE_WINDOW_MS,
} from '@hitster/shared';

type HitsterServer = Server<ClientToServerEvents, ServerToClientEvents>;

export class GameEngine {
  private room: Room;
  private io: HitsterServer;
  private deck: SongCard[] = [];
  private spotifyAccessToken: string | null = null;
  private challengeTimer: ReturnType<typeof setTimeout> | null = null;
  private songNamed = new Set<string>();

  constructor(room: Room, io: HitsterServer) {
    this.room = room;
    this.io = io;
  }

  setSpotifyToken(token: string) {
    this.spotifyAccessToken = token;
  }

  startGame(deck: SongCard[]) {
    this.deck = [...deck];
    const playerIds = Object.keys(this.room.players);

    // Give each player a starting card
    for (const id of playerIds) {
      const card = this.deck.pop();
      if (card) {
        this.room.players[id].timeline = [card];
        this.room.players[id].tokens = STARTING_TOKENS;
      }
    }

    // Shuffle turn order
    const turnOrder = [...playerIds].sort(() => Math.random() - 0.5);
    this.room.gameState = {
      phase: 'playing',
      currentTurnPlayerId: turnOrder[0],
      currentSong: null,
      pendingPlacement: null,
      challengers: [],
      turnOrder,
      turnIndex: 0,
      deckSize: this.deck.length,
    };

    this.io.to(this.room.code).emit('game-started', { gameState: this.room.gameState });

    // Sync each player's starting timeline
    for (const id of playerIds) {
      this.io.to(this.room.code).emit('timeline-updated', {
        playerId: id,
        timeline: this.room.players[id].timeline,
      });
    }

    this.startTurn();
  }

  private startTurn() {
    const song = this.deck.pop();
    if (!song) {
      this.endGame();
      return;
    }

    this.room.gameState.currentSong = song;
    this.room.gameState.phase = 'playing';
    this.room.gameState.pendingPlacement = null;
    this.room.gameState.challengers = [];
    this.room.gameState.deckSize = this.deck.length;
    this.songNamed.clear();

    const turnPlayerId = this.room.gameState.currentTurnPlayerId!;

    // Send song info to all players (year hidden for active player)
    this.io.to(this.room.code).emit('new-turn', {
      turnPlayerId,
      songCard: { id: song.id },
    });

    // Tell host to play the song
    if (song.spotifyTrackId) {
      this.io.to(this.room.code).emit('play-song', {
        spotifyTrackId: song.spotifyTrackId,
      });
    }
  }

  placeCard(playerId: string, position: number) {
    const gs = this.room.gameState;
    if (gs.phase !== 'playing' || gs.currentTurnPlayerId !== playerId) return;

    gs.pendingPlacement = position;
    gs.phase = 'challenge';

    this.io.to(this.room.code).emit('card-placed', { playerId, position });

    // Start challenge window
    this.challengeTimer = setTimeout(() => {
      this.resolveRound();
    }, CHALLENGE_WINDOW_MS);
  }

  challenge(challengerId: string) {
    const gs = this.room.gameState;
    if (gs.phase !== 'challenge') return;
    if (challengerId === gs.currentTurnPlayerId) return;

    const player = this.room.players[challengerId];
    if (!player || player.tokens < CHALLENGE_COST) return;

    if (!gs.challengers.includes(challengerId)) {
      gs.challengers.push(challengerId);
      player.tokens -= CHALLENGE_COST;

      this.io.to(this.room.code).emit('challenge-made', { challengerId });
      this.io.to(this.room.code).emit('tokens-updated', {
        playerId: challengerId,
        tokens: player.tokens,
      });
    }
  }

  nameSong(playerId: string, guess: SongGuess) {
    const gs = this.room.gameState;
    if (!gs.currentSong) return;
    if (this.songNamed.has(playerId)) return;

    this.songNamed.add(playerId);

    const titleMatch = normalize(guess.title) === normalize(gs.currentSong.title);
    const artistMatch = normalize(guess.artist) === normalize(gs.currentSong.artist);
    const correct = titleMatch && artistMatch;

    if (correct) {
      const player = this.room.players[playerId];
      if (player && player.tokens < MAX_TOKENS) {
        player.tokens += 1;
        this.io.to(this.room.code).emit('tokens-updated', {
          playerId,
          tokens: player.tokens,
        });
      }
    }

    this.io.to(this.room.code).emit('song-named', { playerId, correct });
  }

  skipSong(playerId: string) {
    const gs = this.room.gameState;
    if (gs.phase !== 'playing' || gs.currentTurnPlayerId !== playerId) return;

    const player = this.room.players[playerId];
    if (!player || player.tokens < SKIP_COST) return;

    player.tokens -= SKIP_COST;
    this.io.to(this.room.code).emit('tokens-updated', {
      playerId,
      tokens: player.tokens,
    });

    this.advanceTurn();
  }

  buyCard(playerId: string) {
    const player = this.room.players[playerId];
    if (!player || player.tokens < BUY_CARD_COST) return;

    const card = this.deck.pop();
    if (!card) return;

    player.tokens -= BUY_CARD_COST;

    // Insert card in correct chronological position
    this.insertCardInTimeline(player.timeline, card);

    this.io.to(this.room.code).emit('tokens-updated', { playerId, tokens: player.tokens });
    this.io.to(this.room.code).emit('timeline-updated', { playerId, timeline: player.timeline });

    if (player.timeline.length >= this.room.settings.cardsToWin) {
      this.endGame();
    }
  }

  confirmReveal() {
    if (this.room.gameState.phase === 'reveal') {
      this.advanceTurn();
    }
  }

  private resolveRound() {
    if (this.challengeTimer) {
      clearTimeout(this.challengeTimer);
      this.challengeTimer = null;
    }

    const gs = this.room.gameState;
    const song = gs.currentSong!;
    const activePlayerId = gs.currentTurnPlayerId!;
    const activePlayer = this.room.players[activePlayerId];
    const position = gs.pendingPlacement!;

    const correct = this.isPlacementCorrect(activePlayer.timeline, song, position);

    let stolenBy: string | null = null;
    let winnerId: string | null = null;

    if (correct) {
      // Active player keeps the card
      activePlayer.timeline.splice(position, 0, song);
      winnerId = activePlayerId;
    } else if (gs.challengers.length > 0) {
      // First challenger gets the card
      const stealerId = gs.challengers[0];
      const stealer = this.room.players[stealerId];
      this.insertCardInTimeline(stealer.timeline, song);
      stolenBy = stealerId;
      winnerId = stealerId;

      this.io.to(this.room.code).emit('timeline-updated', {
        playerId: stealerId,
        timeline: stealer.timeline,
      });
    }
    // If incorrect and no challengers, card is discarded

    gs.phase = 'reveal';

    this.io.to(this.room.code).emit('reveal', {
      song,
      correct,
      winnerId,
      stolenBy,
    });

    if (winnerId) {
      this.io.to(this.room.code).emit('timeline-updated', {
        playerId: winnerId,
        timeline: this.room.players[winnerId].timeline,
      });
    }

    // Check win condition
    if (winnerId && this.room.players[winnerId].timeline.length >= this.room.settings.cardsToWin) {
      this.endGame();
      return;
    }
  }

  private isPlacementCorrect(timeline: SongCard[], song: SongCard, position: number): boolean {
    const before = position > 0 ? timeline[position - 1] : null;
    const after = position < timeline.length ? timeline[position] : null;

    if (before && song.year < before.year) return false;
    if (after && song.year > after.year) return false;

    return true;
  }

  private insertCardInTimeline(timeline: SongCard[], card: SongCard) {
    let insertAt = 0;
    for (let i = 0; i < timeline.length; i++) {
      if (timeline[i].year <= card.year) {
        insertAt = i + 1;
      }
    }
    timeline.splice(insertAt, 0, card);
  }

  private advanceTurn() {
    const gs = this.room.gameState;
    gs.turnIndex = (gs.turnIndex + 1) % gs.turnOrder.length;

    // Skip disconnected players
    let attempts = 0;
    while (attempts < gs.turnOrder.length) {
      const pid = gs.turnOrder[gs.turnIndex];
      if (this.room.players[pid]?.connected) break;
      gs.turnIndex = (gs.turnIndex + 1) % gs.turnOrder.length;
      attempts++;
    }

    gs.currentTurnPlayerId = gs.turnOrder[gs.turnIndex];
    this.startTurn();
  }

  private endGame() {
    this.room.gameState.phase = 'game_over';

    // Find winner (most cards, or first to reach target)
    let winnerId = '';
    let maxCards = 0;
    for (const [id, player] of Object.entries(this.room.players)) {
      if (player.timeline.length > maxCards) {
        maxCards = player.timeline.length;
        winnerId = id;
      }
    }

    this.io.to(this.room.code).emit('game-over', {
      winnerId,
      players: this.room.players,
    });
  }
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}
