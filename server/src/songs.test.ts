import { describe, expect, it } from 'vitest';
import type { SongData } from '@tunes/shared';
import {
  applyResolvedTrackMetadata,
  getBuiltInDeckFilters,
  getEffectiveSongPack,
} from './songs';

describe('applyResolvedTrackMetadata', () => {
  it('preserves a baked preview when Spotify omits preview_url', () => {
    const song: SongData = {
      title: 'Dreams',
      artist: 'Fleetwood Mac',
      year: 1977,
      previewUrl: 'https://audio-ssl.itunes.apple.com/baked-preview.m4a',
    };

    applyResolvedTrackMetadata(song, { trackId: 'spotify-track-id' });

    expect(song.spotifyTrackId).toBe('spotify-track-id');
    expect(song.previewUrl).toBe('https://audio-ssl.itunes.apple.com/baked-preview.m4a');
  });

  it('uses a fresh Spotify preview when one is available', () => {
    const song: SongData = {
      title: 'Dreams',
      artist: 'Fleetwood Mac',
      year: 1977,
      previewUrl: 'https://audio-ssl.itunes.apple.com/baked-preview.m4a',
    };

    applyResolvedTrackMetadata(song, {
      trackId: 'spotify-track-id',
      previewUrl: 'https://p.scdn.co/fresh-preview.mp3',
    });

    expect(song.previewUrl).toBe('https://p.scdn.co/fresh-preview.mp3');
  });
});

describe('getBuiltInDeckFilters', () => {
  it('removes unsupported filters from credential-free preview games', () => {
    expect(getBuiltInDeckFilters('genre-decade', [1980], ['rock'], ['uk'], true)).toEqual({});
  });

  it('keeps requested filters for Spotify-hosted games', () => {
    expect(getBuiltInDeckFilters('genre-decade', [1980], ['rock'], ['uk'], false)).toEqual({
      decades: [1980],
      genres: ['rock'],
      regions: ['uk'],
    });
  });

  it('normalizes inherited Spotify-only packs for preview hosts', () => {
    expect(getEffectiveSongPack('playlist', true)).toBe('standard');
    expect(getEffectiveSongPack('genre-decade', true)).toBe('standard');
    expect(getEffectiveSongPack('playlist', false)).toBe('playlist');
  });
});
