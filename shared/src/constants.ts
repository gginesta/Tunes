import type { GameSettings, PlaybackMode } from './types';

export const MAX_PLAYERS = 12;
export const MIN_PLAYERS = 2;
export const DEFAULT_CARDS_TO_WIN = 10;
export const MIN_CARDS_TO_WIN = 5;
export const MAX_CARDS_TO_WIN = 15;
export const STARTING_TOKENS = 2;
export const MAX_TOKENS = 5;
export const SKIP_COST = 1;
export const CHALLENGE_COST = 1;
export const BUY_CARD_COST = 3;
export const ROOM_CODE_LENGTH = 4;
export const DECK_SIZE = 100;
export const CHALLENGE_WINDOW_MS = 15000;
export const TURN_TIME_MS = 60000;
export const COOP_WRONG_PENALTY = 1;
export const DISCONNECT_GRACE_MS = 30000;
export const FUZZY_THRESHOLD_RATIO = 0.3;

export const ANCHOR_PREVIEW_MS = 3500;
export const ROOM_RECOVERY_MS = 30 * 60 * 1000;
export const DEFAULT_DINNER_ROUNDS = 8;
export const DINNER_ANCHOR_COUNT = 3;

export function getDinnerRoundCount(settings: GameSettings, playbackMode: PlaybackMode | undefined, playerCount: number): number {
  if (playbackMode === 'manual' && !settings.dedicatedDjId && playerCount > 0) {
    const requested = settings.dinnerRounds;
    if (requested && requested % playerCount === 0 && requested <= 2 * playerCount) return requested;
    return playerCount * (playerCount <= 6 ? 2 : 1);
  }
  return settings.dinnerRounds ?? DEFAULT_DINNER_ROUNDS;
}
