import { describe, expect, it } from 'vitest';
import { fuzzyMatch, levenshteinDistance, normalizeName } from './fuzzy';

describe('levenshteinDistance', () => {
  it('is 0 for identical strings', () => {
    expect(levenshteinDistance('abba', 'abba')).toBe(0);
  });

  it('counts substitutions, insertions and deletions', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
    expect(levenshteinDistance('abc', 'ab')).toBe(1);
    expect(levenshteinDistance('ab', 'abc')).toBe(1);
  });

  it('handles empty strings', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
    expect(levenshteinDistance('', '')).toBe(0);
  });
});

describe('normalizeName', () => {
  it('lowercases and trims', () => {
    expect(normalizeName('  Bohemian Rhapsody  ')).toBe('bohemian rhapsody');
  });

  it('strips parenthetical suffixes', () => {
    expect(normalizeName('Africa (Remastered 2019)')).toBe('africa');
  });

  it('strips feat./ft./featuring and everything after', () => {
    expect(normalizeName('Umbrella feat. Jay-Z')).toBe('umbrella');
    expect(normalizeName('Umbrella ft. Jay-Z')).toBe('umbrella');
    expect(normalizeName('Umbrella featuring Jay-Z')).toBe('umbrella');
  });

  it('removes punctuation but keeps unicode letters and digits', () => {
    expect(normalizeName("Livin' On A Prayer!")).toBe('livin on a prayer');
    expect(normalizeName('99 Luftballons')).toBe('99 luftballons');
    expect(normalizeName('Édith Piaf')).toBe('édith piaf');
  });

  it('strips leading articles', () => {
    expect(normalizeName('The Beatles')).toBe('beatles');
    expect(normalizeName('A Hard Days Night')).toBe('hard days night');
    expect(normalizeName('An Innocent Man')).toBe('innocent man');
  });

  it('collapses internal whitespace', () => {
    expect(normalizeName('Hey   Jude')).toBe('hey jude');
  });
});

describe('fuzzyMatch', () => {
  it('matches exact names regardless of case and punctuation', () => {
    expect(fuzzyMatch('bohemian rhapsody', 'Bohemian Rhapsody')).toBe(true);
    expect(fuzzyMatch("Don't Stop Believin'", 'dont stop believin')).toBe(true);
  });

  it('tolerates small typos', () => {
    expect(fuzzyMatch('Bohemian Rapsody', 'Bohemian Rhapsody')).toBe(true);
    expect(fuzzyMatch('Stairway to Heavan', 'Stairway to Heaven')).toBe(true);
  });

  it('rejects clearly different titles', () => {
    expect(fuzzyMatch('Wonderwall', 'Bohemian Rhapsody')).toBe(false);
    expect(fuzzyMatch('abc', 'xyz')).toBe(false);
  });

  it('matches by substring containment for guesses of 3+ chars', () => {
    expect(fuzzyMatch('Beatles', 'The Beatles')).toBe(true);
    expect(fuzzyMatch('Rhapsody', 'Bohemian Rhapsody')).toBe(true);
  });

  it('does not substring-match very short guesses', () => {
    // 2-char guess must clear the levenshtein threshold instead
    expect(fuzzyMatch('he', 'Hey Jude')).toBe(false);
  });

  it('never matches an empty or punctuation-only guess', () => {
    expect(fuzzyMatch('', 'Hey Jude')).toBe(false);
    expect(fuzzyMatch('!!!', 'Hey Jude')).toBe(false);
  });

  it('ignores remaster/feat noise on the actual title', () => {
    expect(fuzzyMatch('Africa', 'Africa (Remastered)')).toBe(true);
    expect(fuzzyMatch('Umbrella', 'Umbrella (feat. Jay-Z)')).toBe(true);
  });
});
