import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { SongCard, SongData } from '@hitster/shared';
import { DECK_SIZE } from '@hitster/shared';
import { logger } from './logger';
import { fisherYatesShuffle } from './shuffle';

let allSongs: SongData[] = [];
/** The resolved path to songs.json (set during loadSongs) */
let songsFilePath: string | null = null;

// In-memory cache: "title::artist" → { trackId, previewUrl }
const trackCache = new Map<string, { trackId: string; previewUrl?: string }>();

function cacheKey(song: SongData): string {
  return `${song.title.toLowerCase()}::${song.artist.toLowerCase()}`;
}

export function loadSongs() {
  logger.debug('Song loader paths', { __dirname, cwd: process.cwd() });

  // Try multiple possible locations for songs.json
  const candidates = [
    path.join(__dirname, '..', '..', 'data', 'songs.json'),   // from server/src or server/dist
    path.join(__dirname, '..', 'data', 'songs.json'),          // from server/
    path.join(process.cwd(), 'data', 'songs.json'),            // from project root (npm workspaces)
  ];

  logger.debug('Song file candidates', {
    candidates: candidates.map(c => ({ path: c, exists: fs.existsSync(c) })),
  });

  songsFilePath = candidates.find(p => fs.existsSync(p)) || candidates[0];
  logger.info('Loading songs', { path: songsFilePath });

  try {
    const raw = fs.readFileSync(songsFilePath, 'utf-8');
    allSongs = JSON.parse(raw);
    logger.info('Songs loaded successfully', { count: allSongs.length });
  } catch (err) {
    logger.error('Failed to load songs', { error: String(err) });
    allSongs = [];
  }
}

/**
 * Select a game deck from the built-in song database.
 * @param decades - Optional array of decade start years to filter by (e.g. [1980, 1990])
 * @param genres - Optional array of genres to filter by (e.g. ['rock', 'pop'])
 * @param regions - Optional array of regions to filter by (e.g. ['global', 'uk'])
 */
export function selectGameDeck(
  count: number = DECK_SIZE,
  decades?: number[],
  genres?: string[],
  regions?: string[],
): SongCard[] {
  if (allSongs.length === 0) {
    logger.warn('No songs loaded, returning empty deck');
    return [];
  }

  // Filter by selected decades, genres, and regions
  let pool = allSongs;

  if (decades && decades.length > 0) {
    pool = pool.filter((song) => {
      const decade = Math.floor(song.year / 10) * 10;
      return decades.includes(decade);
    });
  }

  if (genres && genres.length > 0) {
    pool = pool.filter((song) => song.genre && genres.includes(song.genre));
  }

  if (regions && regions.length > 0) {
    pool = pool.filter((song) => song.region && regions.includes(song.region));
  }

  if (pool.length === 0) {
    logger.warn('No songs match the selected decades', { decades });
    return [];
  }

  // Group songs by decade for balanced selection
  const byDecade = new Map<number, SongData[]>();
  for (const song of pool) {
    const decade = Math.floor(song.year / 10) * 10;
    if (!byDecade.has(decade)) byDecade.set(decade, []);
    byDecade.get(decade)!.push(song);
  }

  const selected: SongData[] = [];
  const decadeKeys = [...byDecade.keys()].sort();
  const perDecade = Math.max(1, Math.ceil(count / decadeKeys.length));

  // Pick from each decade
  for (const decade of decadeKeys) {
    const songs = byDecade.get(decade)!;
    const shuffled = fisherYatesShuffle([...songs]);
    selected.push(...shuffled.slice(0, perDecade));
  }

  // Shuffle and trim to count
  const deck: SongCard[] = fisherYatesShuffle(selected)
    .slice(0, count)
    .map((song) => ({
      ...song,
      id: uuidv4(),
      // Preserve pre-baked Spotify data from songs.json if available
      spotifyTrackId: song.spotifyTrackId || undefined,
      previewUrl: song.previewUrl || undefined,
    }));

  return deck;
}

/**
 * Fetch tracks from a Spotify playlist and convert them to a game deck.
 * Returns SongCards with spotifyTrackId already set (no search needed).
 */
export async function fetchPlaylistDeck(
  playlistUrl: string,
  accessToken: string,
  count: number = DECK_SIZE,
): Promise<SongCard[]> {
  // Extract playlist ID from URL or bare ID
  const playlistId = extractPlaylistId(playlistUrl);
  if (!playlistId) {
    logger.warn('Invalid playlist URL', { playlistUrl });
    return [];
  }

  logger.info('Fetching Spotify playlist', { playlistId });

  const cards: SongCard[] = [];
  let totalItemsSeen = 0;
  let skippedNoTrack = 0;
  let skippedNoDate = 0;
  let url: string | null = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?fields=items(track(id,name,artists,album(release_date),preview_url)),next&limit=100`;

  while (url && cards.length < count * 2) {
    try {
      const res: Response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) {
        const body: string = await res.text().catch(() => '');
        logger.warn('Playlist fetch failed', { status: res.status, body });
        break;
      }

      const data: { items?: PlaylistItem[]; next?: string } = await res.json();
      const items: PlaylistItem[] = data.items || [];

      for (const item of items) {
        totalItemsSeen++;
        const track = item.track;
        if (!track?.id || !track.name) {
          skippedNoTrack++;
          continue;
        }
        if (!track.album?.release_date) {
          skippedNoDate++;
          continue;
        }

        const year = parseInt(track.album.release_date.slice(0, 4), 10);
        if (isNaN(year)) continue;

        const artist = track.artists?.map((a: { name: string }) => a.name).join(', ') || 'Unknown';

        cards.push({
          id: uuidv4(),
          title: track.name,
          artist,
          year,
          spotifyTrackId: track.id,
          previewUrl: track.preview_url || undefined,
        });
      }

      url = data.next || null;
    } catch (err) {
      logger.warn('Playlist fetch error', { error: String(err) });
      break;
    }
  }

  // Log track statistics
  logger.info('Playlist track scan complete', {
    playlistId,
    totalItemsSeen,
    usableTracks: cards.length,
    skippedNoTrack,
    skippedNoDate,
  });

  if (cards.length === 0) {
    logger.warn('No usable tracks from playlist', {
      playlistId,
      hint: 'Possible reasons: playlist is empty, playlist is private/deleted, all tracks lack release dates, or the Spotify token lacks permissions.',
    });
    return [];
  }

  // Shuffle and trim
  const deck = fisherYatesShuffle(cards).slice(0, count);

  logger.info('Playlist deck created', { playlistId, total: cards.length, selected: deck.length });
  return deck;
}

interface PlaylistItem {
  track: {
    id: string;
    name: string;
    artists: { name: string }[];
    album: { release_date: string };
    preview_url: string | null;
  } | null;
}

function extractPlaylistId(input: string): string | null {
  // Handle full URLs: https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=...
  const urlMatch = input.match(/playlist\/([a-zA-Z0-9]+)/);
  if (urlMatch) return urlMatch[1];

  // Handle spotify: URIs: spotify:playlist:37i9dQZF1DXcBWIGoYBM5M
  const uriMatch = input.match(/spotify:playlist:([a-zA-Z0-9]+)/);
  if (uriMatch) return uriMatch[1];

  // Bare ID (alphanumeric, 22 chars typical)
  if (/^[a-zA-Z0-9]{10,}$/.test(input.trim())) return input.trim();

  return null;
}

export async function resolveSpotifyTrack(
  song: SongData,
  accessToken: string
): Promise<{ trackId: string; previewUrl?: string } | null> {
  try {
    const query = encodeURIComponent(`track:${song.title} artist:${song.artist}`);
    const res = await fetch(
      `https://api.spotify.com/v1/search?q=${query}&type=track&limit=1`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const track = data.tracks?.items?.[0];
    if (!track?.id) return null;
    return { trackId: track.id, previewUrl: track.preview_url || undefined };
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
    const cachedEntry = trackCache.get(key);
    if (cachedEntry) {
      card.spotifyTrackId = cachedEntry.trackId;
      card.previewUrl = cachedEntry.previewUrl;
      cached++;
      resolved++;
    }
  }

  // Collect uncached cards
  const uncached = deck.filter((c) => !c.spotifyTrackId);

  // Resolve in batches with concurrency limit
  for (let i = 0; i < uncached.length; i += CONCURRENCY) {
    const batch = uncached.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (card) => {
        const result = await resolveSpotifyTrack(card, accessToken);
        if (result) {
          card.spotifyTrackId = result.trackId;
          card.previewUrl = result.previewUrl;
          trackCache.set(cacheKey(card), result);
          resolved++;
        }
      }),
    );

    // Brief pause between batches to be nice to rate limits
    if (i + CONCURRENCY < uncached.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const playable = deck.filter((c) => c.spotifyTrackId);
  logger.info('Track resolution complete', {
    resolved,
    total: deck.length,
    cached,
    playable: playable.length,
  });

  // Persist newly resolved preview URLs back to songs.json for preview mode
  persistPreviewUrls();

  // Opportunistically resolve more uncached songs in the background
  // so preview mode fills up faster (doesn't block the game start)
  backgroundResolveUncached(accessToken);

  return playable;
}

/** Whether a background resolve is currently running */
let backgroundResolveRunning = false;

/**
 * Resolve uncached songs in the background so preview mode fills up
 * faster. Runs after each Spotify game start without blocking it.
 * Resolves up to 100 songs per invocation.
 */
async function backgroundResolveUncached(accessToken: string): Promise<void> {
  if (backgroundResolveRunning) return;
  backgroundResolveRunning = true;

  try {
    const uncached = allSongs.filter(
      (s) => !s.spotifyTrackId && s.spotifyTrackId !== null, // skip songs marked null (already attempted)
    );

    if (uncached.length === 0) {
      logger.info('All songs already have Spotify data, nothing to background-resolve');
      return;
    }

    const batch = uncached.slice(0, 100);
    logger.info('Background-resolving uncached songs', {
      batchSize: batch.length,
      totalUncached: uncached.length,
    });

    const CONCURRENCY = 3;
    let resolved = 0;

    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      const chunk = batch.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map(async (song) => {
          const key = cacheKey(song);
          if (trackCache.has(key)) return;

          const result = await resolveSpotifyTrack(song, accessToken);
          if (result) {
            trackCache.set(key, result);
            resolved++;
          } else {
            // Mark as attempted so we don't retry on next game
            trackCache.set(key, { trackId: '', previewUrl: undefined });
          }
        }),
      );
      // Gentle delay to avoid rate limits
      await new Promise((r) => setTimeout(r, 300));
    }

    logger.info('Background resolve complete', { resolved, attempted: batch.length });
    persistPreviewUrls();
  } catch (err) {
    logger.error('Background resolve failed', { error: String(err) });
  } finally {
    backgroundResolveRunning = false;
  }
}

/**
 * Write resolved preview URLs and track IDs from the in-memory cache
 * back to songs.json. This gradually populates preview data so that
 * "Host without Spotify" mode gains audio over time as Spotify games
 * are played.
 */
function persistPreviewUrls(): void {
  if (!songsFilePath || allSongs.length === 0) return;

  let updated = 0;
  for (const song of allSongs) {
    if (song.spotifyTrackId) continue; // already has data
    if (song.spotifyTrackId === null) continue; // already marked as attempted

    const key = cacheKey(song);
    const cached = trackCache.get(key);
    if (!cached) continue;

    if (cached.trackId) {
      song.spotifyTrackId = cached.trackId;
      song.previewUrl = cached.previewUrl ?? null;
    } else {
      // Mark as attempted (failed to resolve)
      song.spotifyTrackId = null;
      song.previewUrl = null;
    }
    updated++;
  }

  if (updated === 0) return;

  try {
    fs.writeFileSync(songsFilePath, JSON.stringify(allSongs, null, 2) + '\n', 'utf-8');
    logger.info('Persisted preview URLs to songs.json', { updated, total: allSongs.length });
  } catch (err) {
    logger.error('Failed to persist preview URLs', { error: String(err) });
  }
}
