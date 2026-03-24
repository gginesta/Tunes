import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { SongCard, SongData } from '@hitster/shared';
import { DECK_SIZE } from '@hitster/shared';

let allSongs: SongData[] = [];

// In-memory cache: "title::artist" → spotifyTrackId
const trackIdCache = new Map<string, string>();

function cacheKey(song: SongData): string {
  return `${song.title.toLowerCase()}::${song.artist.toLowerCase()}`;
}

export function loadSongs() {
  const songsPath = path.join(__dirname, '../..', 'data', 'songs.json');
  try {
    const raw = fs.readFileSync(songsPath, 'utf-8');
    allSongs = JSON.parse(raw);
    console.log(`Loaded ${allSongs.length} songs from database`);
  } catch (err) {
    console.error('Failed to load songs:', err);
    allSongs = [];
  }
}

export function selectGameDeck(count: number = DECK_SIZE): SongCard[] {
  if (allSongs.length === 0) {
    console.warn('No songs loaded, returning empty deck');
    return [];
  }

  // Group songs by decade for balanced selection
  const byDecade = new Map<number, SongData[]>();
  for (const song of allSongs) {
    const decade = Math.floor(song.year / 10) * 10;
    if (!byDecade.has(decade)) byDecade.set(decade, []);
    byDecade.get(decade)!.push(song);
  }

  const selected: SongData[] = [];
  const decades = [...byDecade.keys()].sort();
  const perDecade = Math.max(1, Math.ceil(count / decades.length));

  // Pick from each decade
  for (const decade of decades) {
    const songs = byDecade.get(decade)!;
    const shuffled = [...songs].sort(() => Math.random() - 0.5);
    selected.push(...shuffled.slice(0, perDecade));
  }

  // Shuffle and trim to count
  const deck: SongCard[] = selected
    .sort(() => Math.random() - 0.5)
    .slice(0, count)
    .map((song) => ({
      ...song,
      id: uuidv4(),
      spotifyTrackId: undefined,
    }));

  return deck;
}

export async function resolveSpotifyTrackId(
  song: SongData,
  accessToken: string
): Promise<string | null> {
  try {
    const query = encodeURIComponent(`track:${song.title} artist:${song.artist}`);
    const res = await fetch(
      `https://api.spotify.com/v1/search?q=${query}&type=track&limit=1`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const track = data.tracks?.items?.[0];
    return track?.id || null;
  } catch {
    return null;
  }
}

/**
 * Batch-resolve Spotify track IDs for a deck.
 * Uses cache to avoid redundant API calls.
 * Filters out songs that couldn't be resolved.
 * Returns only playable songs.
 */
export async function resolveTrackIds(
  deck: SongCard[],
  accessToken: string,
): Promise<SongCard[]> {
  const CONCURRENCY = 5;
  let resolved = 0;
  let cached = 0;

  // First pass: fill from cache
  for (const card of deck) {
    const key = cacheKey(card);
    const cachedId = trackIdCache.get(key);
    if (cachedId) {
      card.spotifyTrackId = cachedId;
      cached++;
      resolved++;
    }
  }

  // Collect uncached cards
  const uncached = deck.filter((c) => !c.spotifyTrackId);

  // Resolve in batches with concurrency limit
  for (let i = 0; i < uncached.length; i += CONCURRENCY) {
    const batch = uncached.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (card) => {
        const trackId = await resolveSpotifyTrackId(card, accessToken);
        if (trackId) {
          card.spotifyTrackId = trackId;
          trackIdCache.set(cacheKey(card), trackId);
          resolved++;
        }
        return trackId;
      }),
    );

    // Brief pause between batches to be nice to rate limits
    if (i + CONCURRENCY < uncached.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const playable = deck.filter((c) => c.spotifyTrackId);
  console.log(
    `Track resolution: ${resolved}/${deck.length} resolved (${cached} cached), ${playable.length} playable`,
  );

  return playable;
}
