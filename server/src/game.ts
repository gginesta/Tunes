import { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  Room,
  SongCard,
  SongGuess,
  PlayedSong,
  PlayerStats,
  GameStats,
} from '@hitster/shared';
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
} from '@hitster/shared';
import { logger } from './logger';
import { fuzzyMatch } from './fuzzy';
import { fisherYatesShuffle } from './shuffle';

type HitsterServer = Server<ClientToServerEvents, ServerToClientEvents>;

export class GameEngine {
  private room: Room;
  private io: HitsterServer;
  private deck: SongCard[] = [];
  private spotifyAccessToken: string | null = null;
  private challengeTimer: ReturnType<typeof setTimeout> | null = null;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private songNamed = new Set<string>();
  /** Tracks whether each player's song name guess was correct this round */
  private songNameCorrect = new Map<string, boolean>();
  /** Tracks the active player's year guess for Expert mode */
  private yearGuess: number | null = null;
  /** Grace period timers for disconnected players */
  private disconnectTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  /** Per-player stats tracked throughout the game */
  private playerStats: Map<string, PlayerStats> = new Map();
  /** Timestamp when the current turn started (for fastest placement tracking) */
  private turnStartTime: number = 0;
  /** Total rounds played */
  private totalRounds: number = 0;
  /** History of all played songs */
  private songHistory: PlayedSong[] = [];
  /** Current round number */
  private roundNumber: number = 0;
  /** Callback invoked after game ends */
  private onGameEndCallback: (() => void) | null = null;

  constructor(room: Room, io: HitsterServer) {
    this.room = room;
    this.io = io;
  }

  onGameEnd(callback: () => void) {
    this.onGameEndCallback = callback;
  }

  private get mode() {
    return this.room.settings.mode;
  }

  private get isCoop() {
    return this.mode === 'coop';
  }

  setSpotifyToken(token: string) {
    this.spotifyAccessToken = token;
  }

  getSongHistory(): PlayedSong[] {
    return this.songHistory;
  }

  getGameStats(): { playerStats: Map<string, PlayerStats>; totalRounds: number } {
    return { playerStats: this.playerStats, totalRounds: this.totalRounds };
  }

  getWinnerId(): string {
    if (this.isCoop) {
      return this.room.gameState.turnOrder[0] || '';
    }
    let winnerId = '';
    let maxCards = 0;
    for (const [id, player] of Object.entries(this.room.players)) {
      if (player.timeline.length > maxCards) {
        maxCards = player.timeline.length;
        winnerId = id;
      }
    }
    return winnerId;
  }

  getRoom(): Room {
    return this.room;
  }

  resetGame() {
    // Clear timers
    if (this.challengeTimer) {
      clearTimeout(this.challengeTimer);
      this.challengeTimer = null;
    }
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }

    // Clear disconnect timers
    for (const timer of this.disconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.disconnectTimers.clear();

    // Clear engine state
    this.deck = [];
    this.songNamed.clear();
    this.songNameCorrect.clear();
    this.yearGuess = null;
    this.songHistory = [];
    this.roundNumber = 0;
    this.playerStats.clear();
    this.totalRounds = 0;
    this.turnStartTime = 0;

    // Reset all players: clear timelines, restore starting tokens
    for (const player of Object.values(this.room.players)) {
      player.timeline = [];
      player.tokens = STARTING_TOKENS;
    }

    // Reset game state to lobby defaults
    this.room.gameState = {
      phase: 'lobby',
      currentTurnPlayerId: null,
      currentSong: null,
      pendingPlacement: null,
      challengers: [],
      turnOrder: [],
      turnIndex: 0,
      deckSize: 0,
      sharedTimeline: [],
    };
  }

  startGame(deck: SongCard[]) {
    this.deck = [...deck];
    this.totalRounds = 0;
    const playerIds = Object.keys(this.room.players);

    // Initialize player stats
    this.playerStats.clear();
    for (const id of playerIds) {
      this.playerStats.set(id, {
        correctPlacements: 0,
        totalPlacements: 0,
        challengesWon: 0,
        challengesLost: 0,
        longestStreak: 0,
        currentStreak: 0,
        fastestPlacementMs: null,
        decadeAccuracy: {},
        songsNamed: 0,
      });
    }

    // Give each player a starting card (or shared timeline for co-op)
    if (this.isCoop) {
      const card = this.deck.pop();
      for (const id of playerIds) {
        this.room.players[id].timeline = [];
        this.room.players[id].tokens = STARTING_TOKENS;
      }
      // Shared timeline starts with one card
      const sharedTimeline = card ? [card] : [];
      this.room.gameState.sharedTimeline = sharedTimeline;
    } else {
      for (const id of playerIds) {
        const card = this.deck.pop();
        if (card) {
          this.room.players[id].timeline = [card];
          this.room.players[id].tokens = STARTING_TOKENS;
        }
      }
    }

    // Shuffle turn order
    const turnOrder = fisherYatesShuffle([...playerIds]);
    this.room.gameState = {
      ...this.room.gameState,
      phase: 'playing',
      currentTurnPlayerId: turnOrder[0],
      currentSong: null,
      pendingPlacement: null,
      challengers: [],
      turnOrder,
      turnIndex: 0,
      deckSize: this.deck.length,
      sharedTimeline: this.room.gameState.sharedTimeline || [],
    };

    logger.info('Game started', {
      roomCode: this.room.code,
      playerCount: playerIds.length,
      mode: this.mode,
      deckSize: this.deck.length,
    });

    this.io.to(this.room.code).emit('game-started', { gameState: this.room.gameState });

    // Sync each player's starting timeline
    if (this.isCoop) {
      this.io.to(this.room.code).emit('shared-timeline-updated', {
        timeline: this.room.gameState.sharedTimeline,
      });
    } else {
      for (const id of playerIds) {
        this.io.to(this.room.code).emit('timeline-updated', {
          playerId: id,
          timeline: this.room.players[id].timeline,
        });
      }
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
    this.songNameCorrect.clear();
    this.yearGuess = null;
    this.turnStartTime = Date.now();
    this.roundNumber++;

    const turnPlayerId = this.room.gameState.currentTurnPlayerId!;
    const turnPlayer = this.room.players[turnPlayerId];

    logger.info('Turn started', {
      roomCode: this.room.code,
      playerName: turnPlayer?.name,
      songTitle: song.title,
      songArtist: song.artist,
      cardsRemaining: this.deck.length,
    });

    // Send song info to all players (year hidden for active player)
    this.io.to(this.room.code).emit('new-turn', {
      turnPlayerId,
      songCard: { id: song.id },
    });

    // Emit turn-started with deadline for countdown
    const turnDeadline = Date.now() + TURN_TIME_MS;
    this.io.to(this.room.code).emit('turn-started', {
      turnPlayerId,
      turnDeadline,
    });

    // Start turn timer — auto-skip on timeout (no token cost)
    this.turnTimer = setTimeout(() => {
      this.turnTimer = null;
      if (this.room.gameState.phase === 'playing' && this.room.gameState.currentTurnPlayerId === turnPlayerId) {
        this.advanceTurn();
      }
    }, TURN_TIME_MS);

    // Tell host to play the song
    if (song.spotifyTrackId || song.previewUrl) {
      this.io.to(this.room.code).emit('play-song', {
        spotifyTrackId: song.spotifyTrackId || '',
        previewUrl: song.previewUrl,
      });
    }
  }

  placeCard(playerId: string, position: number) {
    const gs = this.room.gameState;
    if (gs.phase !== 'playing' || gs.currentTurnPlayerId !== playerId) return;

    // Bounds-check position
    const timeline = this.isCoop ? gs.sharedTimeline : this.room.players[playerId]?.timeline;
    if (!timeline || position < 0 || position > timeline.length) return;

    // Clear turn timer since player acted
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }

    // Track placement speed for stats
    const placementMs = Date.now() - this.turnStartTime;
    const stats = this.playerStats.get(playerId);
    if (stats && (stats.fastestPlacementMs === null || placementMs < stats.fastestPlacementMs)) {
      stats.fastestPlacementMs = placementMs;
    }

    gs.pendingPlacement = position;
    gs.phase = 'challenge';

    const challengeDeadline = this.isCoop ? undefined : Date.now() + CHALLENGE_WINDOW_MS;
    this.io.to(this.room.code).emit('card-placed', { playerId, position, challengeDeadline });

    if (this.isCoop) {
      // Co-op: no challenge window, resolve immediately after a short delay
      this.challengeTimer = setTimeout(() => {
        this.resolveRound();
      }, 2000);
    } else {
      // Start challenge window
      this.challengeTimer = setTimeout(() => {
        this.resolveRound();
      }, CHALLENGE_WINDOW_MS);
    }
  }

  challenge(challengerId: string) {
    const gs = this.room.gameState;
    if (gs.phase !== 'challenge') return;
    if (challengerId === gs.currentTurnPlayerId) return;
    // No challenges in co-op mode
    if (this.isCoop) return;

    const player = this.room.players[challengerId];
    if (!player || player.tokens < CHALLENGE_COST) return;

    if (!gs.challengers.includes(challengerId)) {
      gs.challengers.push(challengerId);
      player.tokens -= CHALLENGE_COST;

      logger.info('Challenge made', {
        roomCode: this.room.code,
        challengerName: player.name,
        activePlayerId: gs.currentTurnPlayerId,
      });

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

    const titleMatch = fuzzyMatch(guess.title, gs.currentSong.title);
    const artistMatch = fuzzyMatch(guess.artist, gs.currentSong.artist);
    const correct = titleMatch && artistMatch;

    this.songNameCorrect.set(playerId, correct);

    // Track year guess for Expert mode (only for active player)
    if (this.mode === 'expert' && playerId === gs.currentTurnPlayerId && guess.year != null) {
      this.yearGuess = guess.year;
    }

    if (correct) {
      // Track songsNamed stat
      const stats = this.playerStats.get(playerId);
      if (stats) {
        stats.songsNamed++;
      }

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

    // Clear turn timer since player acted
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }

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
    const gs = this.room.gameState;
    if (gs.phase === 'lobby' || gs.phase === 'game_over') return;

    const player = this.room.players[playerId];
    if (!player || player.tokens < BUY_CARD_COST) return;

    const card = this.deck.pop();
    if (!card) return;

    player.tokens -= BUY_CARD_COST;

    if (this.isCoop) {
      // In co-op, bought cards go to shared timeline
      this.insertCardInTimeline(this.room.gameState.sharedTimeline, card);
      this.io.to(this.room.code).emit('tokens-updated', { playerId, tokens: player.tokens });
      this.io.to(this.room.code).emit('shared-timeline-updated', {
        timeline: this.room.gameState.sharedTimeline,
      });

      if (this.room.gameState.sharedTimeline.length >= this.room.settings.cardsToWin) {
        this.endGame();
      }
    } else {
      // Insert card in correct chronological position
      this.insertCardInTimeline(player.timeline, card);

      this.io.to(this.room.code).emit('tokens-updated', { playerId, tokens: player.tokens });
      this.io.to(this.room.code).emit('timeline-updated', { playerId, timeline: player.timeline });

      if (player.timeline.length >= this.room.settings.cardsToWin) {
        this.endGame();
      }
    }
  }

  confirmReveal(playerId: string) {
    if (this.room.gameState.phase === 'reveal' && playerId === this.room.hostId) {
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

    if (this.isCoop) {
      this.resolveCoopRound(song, activePlayerId, activePlayer, position);
      return;
    }

    const timeline = activePlayer.timeline;
    const placementCorrect = this.isPlacementCorrect(timeline, song, position);

    // Mode-specific checks
    const activePlayerNamedSong = this.songNameCorrect.get(activePlayerId) === true;
    const yearCorrect = this.mode === 'expert' ? this.yearGuess === song.year : undefined;

    let correct = placementCorrect;
    if (this.mode === 'pro') {
      // Pro: must place correctly AND name the song
      correct = placementCorrect && activePlayerNamedSong;
    } else if (this.mode === 'expert') {
      // Expert: must place correctly AND name the song AND guess the exact year
      correct = placementCorrect && activePlayerNamedSong && (yearCorrect === true);
    }

    // Update active player stats
    this.totalRounds++;
    const activeStats = this.playerStats.get(activePlayerId);
    if (activeStats) {
      activeStats.totalPlacements++;
      if (correct) {
        activeStats.correctPlacements++;
        activeStats.currentStreak++;
        if (activeStats.currentStreak > activeStats.longestStreak) {
          activeStats.longestStreak = activeStats.currentStreak;
        }
      } else {
        activeStats.currentStreak = 0;
      }
      // Update decade accuracy
      const decade = Math.floor(song.year / 10) * 10;
      if (!activeStats.decadeAccuracy[decade]) {
        activeStats.decadeAccuracy[decade] = { correct: 0, total: 0 };
      }
      activeStats.decadeAccuracy[decade].total++;
      if (placementCorrect) {
        activeStats.decadeAccuracy[decade].correct++;
      }
    }

    // Update challenger stats
    for (const challengerId of gs.challengers) {
      const challengerStats = this.playerStats.get(challengerId);
      if (challengerStats) {
        if (!correct) {
          // Challenger was right (placement was wrong)
          challengerStats.challengesWon++;
        } else {
          // Challenger was wrong (placement was correct)
          challengerStats.challengesLost++;
        }
      }
    }

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

    logger.info('Card placed', {
      roomCode: this.room.code,
      playerName: activePlayer.name,
      correct,
      placementCorrect,
      stolenBy: stolenBy ? this.room.players[stolenBy]?.name : null,
      songTitle: song.title,
      songYear: song.year,
    });

    gs.phase = 'reveal';

    this.io.to(this.room.code).emit('reveal', {
      song,
      correct,
      winnerId,
      stolenBy,
      modeResult: {
        placementCorrect,
        songNamed: activePlayerNamedSong,
        yearCorrect,
      },
    });

    // Record song history entry
    this.songHistory.push({
      song,
      turnPlayerId: activePlayerId,
      correct,
      stolenBy,
      roundNumber: this.roundNumber,
    });
    this.io.to(this.room.code).emit('song-history', { history: this.songHistory });

    // Only emit timeline-updated for winnerId if the card wasn't stolen
    // (stolen cards already had their timeline-updated emitted above)
    if (winnerId && !stolenBy) {
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

  private resolveCoopRound(
    song: SongCard,
    activePlayerId: string,
    activePlayer: { tokens: number; timeline: SongCard[] },
    position: number,
  ) {
    const gs = this.room.gameState;
    const sharedTimeline = gs.sharedTimeline;
    const placementCorrect = this.isPlacementCorrect(sharedTimeline, song, position);

    // Update active player stats for co-op
    this.totalRounds++;
    const activeStats = this.playerStats.get(activePlayerId);
    if (activeStats) {
      activeStats.totalPlacements++;
      if (placementCorrect) {
        activeStats.correctPlacements++;
        activeStats.currentStreak++;
        if (activeStats.currentStreak > activeStats.longestStreak) {
          activeStats.longestStreak = activeStats.currentStreak;
        }
      } else {
        activeStats.currentStreak = 0;
      }
      const decade = Math.floor(song.year / 10) * 10;
      if (!activeStats.decadeAccuracy[decade]) {
        activeStats.decadeAccuracy[decade] = { correct: 0, total: 0 };
      }
      activeStats.decadeAccuracy[decade].total++;
      if (placementCorrect) {
        activeStats.decadeAccuracy[decade].correct++;
      }
    }

    if (placementCorrect) {
      // Card goes into shared timeline
      sharedTimeline.splice(position, 0, song);
    } else {
      // Penalty: active player loses a token
      if (activePlayer.tokens > 0) {
        activePlayer.tokens -= COOP_WRONG_PENALTY;
        this.io.to(this.room.code).emit('tokens-updated', {
          playerId: activePlayerId,
          tokens: activePlayer.tokens,
        });
      }
    }

    gs.phase = 'reveal';

    this.io.to(this.room.code).emit('reveal', {
      song,
      correct: placementCorrect,
      winnerId: placementCorrect ? activePlayerId : null,
      stolenBy: null,
      modeResult: {
        placementCorrect,
        songNamed: false,
        coopPenalty: !placementCorrect,
      },
    });

    this.io.to(this.room.code).emit('shared-timeline-updated', {
      timeline: sharedTimeline,
    });

    // Record song history entry
    this.songHistory.push({
      song,
      turnPlayerId: activePlayerId,
      correct: placementCorrect,
      stolenBy: null,
      roundNumber: this.roundNumber,
    });
    this.io.to(this.room.code).emit('song-history', { history: this.songHistory });

    // Check co-op win condition
    if (sharedTimeline.length >= this.room.settings.cardsToWin) {
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

  /**
   * Called when a player disconnects. Starts a grace period before skipping their turn.
   */
  handlePlayerDisconnect(playerId: string): void {
    const gs = this.room.gameState;
    if (gs.phase === 'lobby' || gs.phase === 'game_over') return;

    // Check if all remaining connected players are gone
    const connected = Object.values(this.room.players).filter((p) => p.connected);
    if (connected.length === 0) return; // room cleanup handles this

    const reconnectDeadline = Date.now() + DISCONNECT_GRACE_MS;

    // Emit disconnected event so clients can show a countdown
    this.io.to(this.room.code).emit('player-disconnected', { playerId, reconnectDeadline });

    logger.info('Player disconnect grace period started', {
      roomCode: this.room.code,
      playerId,
      playerName: this.room.players[playerId]?.name,
      graceMs: DISCONNECT_GRACE_MS,
    });

    // If it's their turn, pause turn timer and start grace period
    if (gs.currentTurnPlayerId === playerId && (gs.phase === 'playing' || gs.phase === 'challenge')) {
      // Clear any running timers for this turn
      if (this.turnTimer) {
        clearTimeout(this.turnTimer);
        this.turnTimer = null;
      }
      if (this.challengeTimer) {
        clearTimeout(this.challengeTimer);
        this.challengeTimer = null;
      }

      const timer = setTimeout(() => {
        this.disconnectTimers.delete(playerId);
        logger.info('Player disconnect grace period expired, skipping turn', {
          roomCode: this.room.code,
          playerId,
          playerName: this.room.players[playerId]?.name,
        });
        this.io.to(this.room.code).emit('player-timed-out', { playerId });
        this.advanceTurn();
      }, DISCONNECT_GRACE_MS);

      this.disconnectTimers.set(playerId, timer);
    } else {
      // Not their turn — just track a grace timer so we can cancel it on reconnect
      const timer = setTimeout(() => {
        this.disconnectTimers.delete(playerId);
        this.io.to(this.room.code).emit('player-timed-out', { playerId });
      }, DISCONNECT_GRACE_MS);

      this.disconnectTimers.set(playerId, timer);
    }
  }

  /**
   * Called when a player reconnects. Clears any pending disconnect timer
   * and restarts phase-appropriate timers if it was their turn.
   */
  handlePlayerReconnect(playerId: string): void {
    const timer = this.disconnectTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(playerId);

      logger.info('Player reconnected within grace period', {
        roomCode: this.room.code,
        playerId,
        playerName: this.room.players[playerId]?.name,
      });

      this.io.to(this.room.code).emit('player-reconnected', { playerId });

      // Restart phase-appropriate timers if it was the reconnecting player's turn
      const gs = this.room.gameState;
      if (gs.currentTurnPlayerId === playerId) {
        if (gs.phase === 'challenge') {
          this.challengeTimer = setTimeout(() => {
            this.resolveRound();
          }, CHALLENGE_WINDOW_MS);
        } else if (gs.phase === 'playing') {
          const turnPlayerId = playerId;
          this.turnTimer = setTimeout(() => {
            this.turnTimer = null;
            if (this.room.gameState.phase === 'playing' && this.room.gameState.currentTurnPlayerId === turnPlayerId) {
              this.advanceTurn();
            }
          }, TURN_TIME_MS);
        }
      }
    }
  }

  /**
   * Called when a player voluntarily leaves. Skips grace period and
   * immediately advances the turn if it was their turn.
   */
  handlePlayerVoluntaryLeave(playerId: string): void {
    const gs = this.room.gameState;
    if (gs.phase === 'lobby' || gs.phase === 'game_over') return;

    // Clear any existing disconnect timer for this player
    const existingTimer = this.disconnectTimers.get(playerId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.disconnectTimers.delete(playerId);
    }

    // Emit disconnected event (no reconnect expected)
    this.io.to(this.room.code).emit('player-disconnected', { playerId, reconnectDeadline: Date.now() });
    this.io.to(this.room.code).emit('player-timed-out', { playerId });

    // If it's their turn, immediately advance
    if (gs.currentTurnPlayerId === playerId && (gs.phase === 'playing' || gs.phase === 'challenge')) {
      if (this.turnTimer) {
        clearTimeout(this.turnTimer);
        this.turnTimer = null;
      }
      if (this.challengeTimer) {
        clearTimeout(this.challengeTimer);
        this.challengeTimer = null;
      }
      this.advanceTurn();
    }
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

    // If no connected player was found, end the game
    const nextPid = gs.turnOrder[gs.turnIndex];
    if (!this.room.players[nextPid]?.connected) {
      logger.warn('No connected players remaining, ending game', { roomCode: this.room.code });
      this.endGame();
      return;
    }

    gs.currentTurnPlayerId = gs.turnOrder[gs.turnIndex];
    this.startTurn();
  }

  private endGame() {
    this.room.gameState.phase = 'game_over';

    let winnerId = '';

    if (this.isCoop) {
      // Co-op: everyone wins (or first player as representative)
      winnerId = this.room.gameState.turnOrder[0];
    } else {
      // Find winner (most cards, or first to reach target)
      let maxCards = 0;
      for (const [id, player] of Object.entries(this.room.players)) {
        if (player.timeline.length > maxCards) {
          maxCards = player.timeline.length;
          winnerId = id;
        }
      }
    }

    const finalScores: Record<string, number> = {};
    for (const [id, player] of Object.entries(this.room.players)) {
      finalScores[player.name] = this.isCoop
        ? this.room.gameState.sharedTimeline.length
        : player.timeline.length;
    }
    const winnerName = winnerId ? this.room.players[winnerId]?.name : 'unknown';

    logger.info('Game over', {
      roomCode: this.room.code,
      winner: winnerName,
      mode: this.mode,
      finalScores,
    });

    // Build and emit game stats
    const playerStatsObj: Record<string, PlayerStats> = {};
    for (const [id, stats] of this.playerStats.entries()) {
      playerStatsObj[id] = { ...stats };
    }
    const gameStats: GameStats = {
      playerStats: playerStatsObj,
      totalRounds: this.totalRounds,
    };
    this.io.to(this.room.code).emit('game-stats', gameStats);

    // Emit final song history
    this.io.to(this.room.code).emit('song-history', { history: this.songHistory });

    this.io.to(this.room.code).emit('game-over', {
      winnerId,
      players: this.room.players,
    });

    if (this.onGameEndCallback) {
      this.onGameEndCallback();
    }
  }
}
