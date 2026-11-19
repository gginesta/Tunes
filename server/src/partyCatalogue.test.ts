import {existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {GameSettings} from '@tunes/shared';
import {getPartyDeck, isAuthorizedSpotifyRecording, spotifyClassicAvailable} from './partyCatalogue';

const settings: GameSettings = {mode: 'dinner', cardsToWin: 10, songPack: 'standard'};

describe('party recordings', () => {
  it('supplies the credited local clips and keeps provider assets out of the manual deck', () => {
    const deck = getPartyDeck(settings, 'licensed');
    expect(deck).toHaveLength(24);
    for (const song of deck) {
      expect(song.licenseUrl).toBe('https://creativecommons.org/licenses/by/4.0/');
      expect(song.audioUrl).toMatch(/^\/listening\/[a-f0-9]+\.mp3$/);
      expect(existsSync(join(__dirname, '../../app/public', song.audioUrl!))).toBe(true);
    }
    const manual = getPartyDeck(settings, 'manual');
    expect(manual.length).toBeGreaterThan(40);
    expect(new Set(manual.map(s => s.recordingId)).size).toBe(manual.length);
    expect(manual.every(s => s.sourceUrl?.startsWith('https://musicbrainz.org/recording/') && !s.audioUrl && !s.previewUrl && !s.spotifyTrackId)).toBe(true);
    expect(getPartyDeck(settings, 'spotify')).toEqual([]);
    expect(getPartyDeck({...settings, songPack:'playlist'}, 'manual')).toEqual([]);
    const heard = manual.slice(0, 2).map(s => s.recordingId!);
    expect(new Set(getPartyDeck(settings, 'manual', heard).slice(0, 2).map(s => s.recordingId))).toEqual(new Set(heard));
  });

  const folders: string[] = [];
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    for (const dir of folders.splice(0)) rmSync(dir, {recursive:true, force:true});
  });

  it('admits only explicitly mapped Spotify recordings and revokes a withdrawn manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tunes-spotify-manifest-'));
    folders.push(dir);
    const manifest = join(dir, 'spotify.json');
    const classic: GameSettings = {...settings, mode: 'original'};
    const tracks = getPartyDeck(classic).slice(0, 6).map(({recordingId}, index) => ({
      recordingId, spotifyTrackId: String(index + 1).padStart(22, 'T'),
    }));
    writeFileSync(manifest, JSON.stringify({tracks}));
    vi.stubEnv('TUNES_SPOTIFY_MANIFEST', manifest);
    vi.stubEnv('TUNES_SPOTIFY_CLASSIC_ENABLED', undefined);
    expect(spotifyClassicAvailable()).toBe(false);
    expect(getPartyDeck(classic, 'spotify')).toEqual([]);

    vi.stubEnv('TUNES_SPOTIFY_CLASSIC_ENABLED', 'true');
    expect(spotifyClassicAvailable()).toBe(true);
    expect(getPartyDeck(settings, 'spotify')).toEqual([]);
    expect(getPartyDeck({...classic, songPack: 'playlist'}, 'spotify')).toEqual([]);
    const deck = getPartyDeck(classic, 'spotify');
    expect(deck.map(({spotifyTrackId}) => spotifyTrackId).sort()).toEqual(tracks.map((track) => track.spotifyTrackId));
    for (const card of deck) {
      expect(isAuthorizedSpotifyRecording(card)).toBe(true);
      expect(isAuthorizedSpotifyRecording({...card, spotifyTrackId: 'Z'.repeat(22)})).toBe(false);
    }
    const invalidRow = {recordingId: 'unverified-recording', spotifyTrackId: 'Z'.repeat(22)};
    writeFileSync(manifest, JSON.stringify({tracks: [...tracks, invalidRow]}));
    expect(spotifyClassicAvailable()).toBe(false);
    expect(isAuthorizedSpotifyRecording(deck[0])).toBe(false);
    unlinkSync(manifest);
    expect(isAuthorizedSpotifyRecording(deck[0])).toBe(false);
  });

  it('fails closed on expired grants, expired files, territorial restrictions and lost files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tunes-pack-test-'));
    folders.push(dir);
    writeFileSync(join(dir,'local.mp3'),'fixture');
    const pack = {id:'pilot', name:'Pilot', tracks: [
      ['allowed', undefined, undefined, 'HK'], ['grant-expired','2020-01-01',undefined,'*'],
      ['clip-expired','2099-01-01','2020-01-01','*'], ['elsewhere',undefined,undefined,'US'],
    ].map(([recordingId, rightsUntil, audioExpiresAt, territory]) => ({
      title:'Private title', artist:'Musician', year:2019, sourceUrl:'https://example.org/track',
      license:'Pilot fixture', audioFile:'local.mp3', territories:[territory], recordingId, rightsUntil, audioExpiresAt,
    }))};
    const manifest = join(dir, 'pack.json');
    writeFileSync(manifest, JSON.stringify(pack));
    vi.stubEnv('TUNES_LICENSED_AUDIO_DIR',dir);
    vi.stubEnv('TUNES_LICENSED_MANIFEST',manifest);
    vi.stubEnv('TUNES_GEO_FENCED_TERRITORY','HK');
    vi.resetModules();
    const catalogue = await import('./partyCatalogue');
    const chosen = {...settings, packId:'pilot'};
    const deck = catalogue.getPartyDeck(chosen, 'licensed');
    expect(deck).toHaveLength(1);
    expect(deck[0].recordingId).toBe('allowed');
    expect(deck[0].audioUrl).toMatch(/^\/licensed-audio\/pilot\/[a-f0-9]{64}$/);
    expect(catalogue.isAuthorizedRecording(deck[0], chosen)).toBe(true);
    vi.stubEnv('TUNES_GEO_FENCED_TERRITORY','US');
    expect(catalogue.isAuthorizedRecording(deck[0], chosen)).toBe(false);
    vi.stubEnv('TUNES_GEO_FENCED_TERRITORY','HK');
    unlinkSync(join(dir,'local.mp3'));
    expect(catalogue.isAuthorizedRecording(deck[0], chosen)).toBe(false);
  });
});
