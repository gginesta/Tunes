/**
 * Guards for socket payloads. Payloads are attacker-controlled: handlers
 * must never destructure them before checking shape (a `null` payload
 * would throw and kill the process), and strings must be length-capped
 * before reaching regex-heavy code like the fuzzy matcher.
 */

export const MAX_STRING_LEN = 500;

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function isShortString(v: unknown, max: number = MAX_STRING_LEN): v is string {
  return typeof v === 'string' && v.length <= max;
}

export function isBoundedInt(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

/**
 * Identity is guest-name based: stats are keyed by the lower-cased display
 * name. Anyone using the same name shares (and inherits) that stat line.
 */
export function guestNameKey(name: string): string {
  return name.trim().toLowerCase();
}
