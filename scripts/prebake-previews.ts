/**
 * One-time script to pre-bake Spotify preview URLs into songs.json.
 *
 * Usage:
 *   npx tsx scripts/prebake-previews.ts <SPOTIFY_ACCESS_TOKEN>
 *
 * Or via environment variable:
 *   SPOTIFY_TOKEN=<token> npx tsx scripts/prebake-previews.ts
 *
 * Get a token from: https://developer.spotify.com/console/
 */

import * as fs from 'fs';
import * as path from 'path';

interface Song {
  title: string;
  artist: string;
  year: number;
  genre?: string;
  region?: string;
  previewUrl?: string | null;
  spotifyTrackId?: string | null;
}

const SONGS_PATH = path.join(__dirname, '..', 'data', 'songs.json');
const CONCURRENCY = 3;
const BATCH_DELAY_MS = 200;
const LOG_INTERVAL = 50;

async function searchSpotify(
  song: Song,
  token: string,
): Promise<{ trackId: string; previewUrl: string | null } | null> {
  const query = encodeURIComponent(`track:${song.title} artist:${song.artist}`);
  const url = `https://api.spotify.com/v1/search?q=${query}&type=track&limit=1`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 429) {
      // Rate limited — read Retry-After header and wait
      const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10);
      console.warn(`  Rate limited. Waiting ${retryAfter}s...`);
      await sleep(retryAfter * 1000);
      return searchSpotify(song, token); // retry once
    }

    if (!res.ok) {
      console.warn(`  Spotify API error ${res.status} for "${song.title}" by ${song.artist}`);
      return null;
    }

    const data = await res.json();
    const track = data.tracks?.items?.[0];
    if (!track?.id) return null;

    return {
      trackId: track.id,
      previewUrl: track.preview_url || null,
    };
  } catch (err) {
    console.warn(`  Fetch error for "${song.title}": ${err}`);
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const token = process.argv[2] || process.env.SPOTIFY_TOKEN;

  if (!token) {
    console.error(
      'Usage: npx tsx scripts/prebake-previews.ts <SPOTIFY_ACCESS_TOKEN>\n' +
      '  Or set SPOTIFY_TOKEN env var.\n' +
      '  Get a token from: https://developer.spotify.com/console/',
    );
    process.exit(1);
  }

  // Read songs
  console.log(`Reading songs from ${SONGS_PATH}`);
  const raw = fs.readFileSync(SONGS_PATH, 'utf-8');
  const songs: Song[] = JSON.parse(raw);
  console.log(`Loaded ${songs.length} songs`);

  // Filter to songs that need resolving (no previewUrl set, or explicitly null)
  const needsResolving = songs.filter(
    (s) => !s.previewUrl && !s.spotifyTrackId,
  );
  const alreadyResolved = songs.length - needsResolving.length;

  console.log(`${alreadyResolved} songs already have preview data`);
  console.log(`${needsResolving.length} songs need Spotify lookup\n`);

  if (needsResolving.length === 0) {
    console.log('Nothing to do!');
    return;
  }

  let resolved = 0;
  let withPreview = 0;
  let withoutPreview = 0;
  let failed = 0;
  let processed = 0;

  // Process in batches with concurrency limit
  for (let i = 0; i < needsResolving.length; i += CONCURRENCY) {
    const batch = needsResolving.slice(i, i + CONCURRENCY);

    const results = await Promise.all(
      batch.map((song) => searchSpotify(song, token)),
    );

    for (let j = 0; j < batch.length; j++) {
      const song = batch[j];
      const result = results[j];
      processed++;

      if (result) {
        song.spotifyTrackId = result.trackId;
        song.previewUrl = result.previewUrl;
        resolved++;
        if (result.previewUrl) {
          withPreview++;
        } else {
          withoutPreview++;
        }
      } else {
        // Mark as attempted so we don't retry needlessly
        song.previewUrl = null;
        song.spotifyTrackId = null;
        failed++;
      }

      if (processed % LOG_INTERVAL === 0 || processed === needsResolving.length) {
        console.log(
          `Progress: ${processed}/${needsResolving.length} ` +
          `(resolved: ${resolved}, with preview: ${withPreview}, failed: ${failed})`,
        );
      }
    }

    // Delay between batches to respect rate limits
    if (i + CONCURRENCY < needsResolving.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  // Write updated songs back
  console.log(`\nWriting updated songs to ${SONGS_PATH}`);
  fs.writeFileSync(SONGS_PATH, JSON.stringify(songs, null, 2) + '\n', 'utf-8');

  // Summary
  console.log('\n=== Summary ===');
  console.log(`Total songs:           ${songs.length}`);
  console.log(`Already resolved:      ${alreadyResolved}`);
  console.log(`Newly resolved:        ${resolved}`);
  console.log(`  With preview URL:    ${withPreview}`);
  console.log(`  Without preview URL: ${withoutPreview}`);
  console.log(`Failed to resolve:     ${failed}`);
  console.log(`\nDone!`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
