import { FUZZY_THRESHOLD_RATIO } from '@tunes/shared';

/**
 * Compute the Levenshtein (edit) distance between two strings using
 * a standard dynamic-programming approach.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // prev and curr represent two consecutive rows of the DP matrix
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);

  for (let j = 0; j <= n; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1];
      } else {
        curr[j] = 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

/**
 * Normalize a song/artist name for fuzzy comparison:
 *  - lowercase
 *  - strip leading articles ("the", "a", "an")
 *  - remove all punctuation
 *  - collapse whitespace to a single space and trim
 */
export function normalizeName(s: string): string {
  let result = s.toLowerCase();
  // Strip parenthetical suffixes like "(Remaster)", "(feat. X)", "(Live)"
  result = result.replace(/\(.*?\)/g, '');
  // Strip "feat.", "ft.", "featuring" and everything after
  result = result.replace(/\b(feat\.?|ft\.?|featuring)\b.*/i, '');
  // Remove punctuation (keep letters, digits, whitespace)
  result = result.replace(/[^\p{L}\p{N}\s]/gu, '');
  // Collapse whitespace
  result = result.replace(/\s+/g, ' ').trim();
  // Strip leading articles
  result = result.replace(/^(the|a|an)\s+/i, '');
  return result;
}

/**
 * Return true when `guess` is close enough to `actual` based on
 * Levenshtein distance relative to the longer string's length.
 *
 * The threshold ratio comes from the shared constant FUZZY_THRESHOLD_RATIO.
 * A ratio of 0 means the strings must match exactly; 0.2 allows roughly
 * one typo per five characters.
 */
export function fuzzyMatch(guess: string, actual: string): boolean {
  const g = normalizeName(guess);
  const a = normalizeName(actual);

  // Short-circuit: exact match after normalization
  if (g === a) return true;

  // Empty guess never matches
  if (g.length === 0) return false;

  // Substring containment: "Beatles" matches "Beatles" in "The Beatles"
  // or "Bohemian Rhapsody" matches even if actual is longer
  if (g.length >= 3 && (a.includes(g) || g.includes(a))) return true;

  const dist = levenshteinDistance(g, a);
  const maxLen = Math.max(g.length, a.length);

  // Avoid division by zero
  if (maxLen === 0) return true;

  return dist / maxLen <= FUZZY_THRESHOLD_RATIO;
}
