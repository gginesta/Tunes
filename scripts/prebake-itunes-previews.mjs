/**
 * Bake durable, CORS-enabled Apple Music Store preview URLs into songs.json.
 * Spotify's search API now commonly returns null preview_url values, so these
 * clips keep the no-login preview game mode usable.
 *
 * Usage: node scripts/prebake-itunes-previews.mjs [per-decade target]
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const songsPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'songs.json');
const targetPerDecade = Number.parseInt(process.argv[2] || '18', 10);
const batchSize = 5;

const normalize = (value) => value
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\b(feat|featuring|ft)\.?\b.*$/i, '')
  .replace(/\([^)]*(remaster|version|edit|mix|live)[^)]*\)/gi, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const tokenScore = (wanted, actual) => {
  const left = new Set(normalize(wanted).split(' ').filter(Boolean));
  const right = new Set(normalize(actual).split(' ').filter(Boolean));
  if (!left.size || !right.size) return 0;
  const overlap = [...left].filter((token) => right.has(token)).length;
  return overlap / Math.max(left.size, right.size);
};

function matchScore(song, result) {
  const wantedTitle = normalize(song.title);
  const actualTitle = normalize(result.trackName || '');
  const wantedArtist = normalize(song.artist);
  const actualArtist = normalize(result.artistName || '');
  const title = wantedTitle === actualTitle ? 1 : tokenScore(song.title, result.trackName || '');
  const artist = wantedArtist === actualArtist ? 1 : tokenScore(song.artist, result.artistName || '');
  return title * 0.65 + artist * 0.35;
}

async function lookup(song, attempt = 0) {
  const params = new URLSearchParams({
    term: `${song.title} ${song.artist}`,
    entity: 'song',
    limit: '5',
    country: 'US',
  });
  const response = await fetch(`https://itunes.apple.com/search?${params}`, {
    headers: { 'User-Agent': 'TunesPreviewBaker/1.0' },
  });
  if ((response.status === 429 || response.status >= 500) && attempt < 3) {
    await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    return lookup(song, attempt + 1);
  }
  if (!response.ok) return null;
  const payload = await response.json();
  const ranked = (payload.results || [])
    .filter((result) => result.previewUrl)
    .map((result) => ({ result, score: matchScore(song, result) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.score >= 0.72 ? ranked[0].result.previewUrl : null;
}

const songs = JSON.parse(await readFile(songsPath, 'utf8'));
const byDecade = new Map();
for (const song of songs) {
  const decade = Math.floor(song.year / 10) * 10;
  if (!byDecade.has(decade)) byDecade.set(decade, []);
  byDecade.get(decade).push(song);
}

let baked = songs.filter((song) => song.previewUrl).length;
for (const [decade, decadeSongs] of [...byDecade].sort(([a], [b]) => a - b)) {
  let available = decadeSongs.filter((song) => song.previewUrl).length;
  const candidates = decadeSongs.filter((song) => !song.previewUrl);
  for (let offset = 0; available < targetPerDecade && offset < candidates.length; offset += batchSize) {
    const batch = candidates.slice(offset, offset + batchSize);
    const previews = await Promise.all(batch.map((song) => lookup(song).catch(() => null)));
    for (let i = 0; i < batch.length && available < targetPerDecade; i++) {
      if (!previews[i]) continue;
      batch[i].previewUrl = previews[i];
      available++;
      baked++;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.log(`${decade}s: ${available} baked previews`);
}

await writeFile(songsPath, JSON.stringify(songs, null, 2) + '\n');
console.log(`Total baked previews: ${baked}/${songs.length}`);
