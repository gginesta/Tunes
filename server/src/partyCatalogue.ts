import {createHash, randomUUID} from 'node:crypto';
import {existsSync, readFileSync, realpathSync} from 'node:fs';
import path from 'node:path';
import type {Express} from 'express';
import type {GameSettings, PlaybackMode, SongCard, SongData} from '@tunes/shared';
import {fisherYatesShuffle} from './shuffle';
import {logger} from './logger';

interface ClearedTrack extends SongData {
  recordingId: string;
  audioFile?: string;
  license: string;
  licenseUrl?: string;
}
interface Pack { id: string; name: string; tracks: ClearedTrack[]; }
interface Catalogue { manual: SongData[]; licensed: Pack[]; }
let cache: Catalogue | null = null;

function readSeed(name: string): unknown {
  // Railway's persistent data can predate this release. Load the versioned image seed first.
  const root = path.resolve(__dirname, '../..');
  const file = [path.join(root, 'data-seed', name), path.join(root, 'data', name)]
    .find(candidate => existsSync(candidate));
  return file ? JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,'')) : null;
}
function validatePack(data: unknown): data is Pack {
  if (!data || typeof data !== 'object') return false;
  const pack = data as Partial<Pack>;
  return typeof pack.id === 'string' && /^[a-zA-Z0-9-]+$/.test(pack.id) &&
    typeof pack.name === 'string' && Array.isArray(pack.tracks) && pack.tracks.length > 0 &&
    pack.tracks.every(track => track && typeof track.recordingId === 'string' && !!track.title &&
      !!track.artist && Number.isInteger(track.year) && track.year >= 1877 &&
      !!track.sourceUrl && /^https?:\/\//.test(track.sourceUrl) && !!track.license &&
      Array.isArray(track.territories) && track.territories.length > 0);
}
function allowed(track: ClearedTrack): boolean {
  const territory = process.env.TUNES_GEO_FENCED_TERRITORY?.toUpperCase();
  const current = [track.rightsUntil, track.audioExpiresAt].every(date => !date || Date.parse(date) > Date.now());
  return current &&
    !!track.territories?.some(t => t === '*' || (territory && t === territory));
}
function operatorFile(track: ClearedTrack): string | null {
  const root = process.env.TUNES_LICENSED_AUDIO_DIR;
  if (!root || !track.audioFile || !existsSync(root)) return null;
  const base = realpathSync(root);
  const candidate = path.resolve(base, track.audioFile);
  if (!existsSync(candidate)) return null;
  const file = realpathSync(candidate);
  const rel = path.relative(base, file);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) && /\.(mp3|m4a|ogg|wav)$/i.test(file) ? file : null;
}
function available(track: ClearedTrack): boolean {
  if (!allowed(track)) return false;
  if (track.audioFile) return !!operatorFile(track);
  if (!track.audioUrl || !/^\/listening\/[0-9a-f]+\.mp3$/.test(track.audioUrl)) return false;
  const client = process.env.NODE_ENV === 'production' ? 'app/dist' : 'app/public';
  return existsSync(path.join(__dirname, '../..', client, track.audioUrl));
}

function clipAlias(packId: string, recordingId: string): string {
  return createHash('sha256').update(JSON.stringify([packId, recordingId])).digest('hex');
}

function load(): Catalogue {
  if (cache) return cache;
  const manual = readSeed('manual-recordings.json');
  const bundled = readSeed('independent-instrumentals.json');
  const licensed: Pack[] = validatePack(bundled) ? [bundled] : [];
  const external = process.env.TUNES_LICENSED_MANIFEST;
  if (external) {
    try {
      const contents: unknown = JSON.parse(readFileSync(external,'utf8').replace(/^\uFEFF/,''));
      for (const pack of Array.isArray(contents) ? contents : [contents]) {
        if (!validatePack(pack) || licensed.some(p => p.id === pack.id)) continue;
        const tracks = pack.tracks.filter(t => operatorFile(t)).map(t => ({
          ...t, audioUrl: '/licensed-audio/' + pack.id + '/' + clipAlias(pack.id, t.recordingId),
        }));
        if (tracks.length) licensed.push({...pack,tracks});
      }
    } catch (e) { logger.warn('Optional licensed pack unavailable', {reason: String(e)}); }
  }
  cache = {manual: Array.isArray(manual) ? manual : [], licensed};
  return cache;
}
export function getLicensedPacks() {
  return load().licensed.map(p => ({id:p.id,name:p.name,trackCount:p.tracks.filter(available).length})).filter(p => p.trackCount > 0);
}
export function hasLicensedPack() { return getLicensedPacks().length > 0; }

export function getPartyDeck(settings: GameSettings, mode: PlaybackMode = 'manual', heardKeys: readonly string[] = []): SongCard[] {
  if (!['manual','licensed'].includes(mode) || settings.songPack === 'playlist') return [];
  const all = load();
  const candidates = mode === 'manual' ? all.manual :
    (all.licensed.find(p => p.id === (settings.packId || getLicensedPacks()[0]?.id))?.tracks.filter(available) ?? []);
  const seen = new Set<string>();
  const heard = new Set(heardKeys);
  const fresh: SongCard[] = [];
  const repeats: SongCard[] = [];
  for (const s of candidates) {
    if (!s.recordingId || seen.has(s.recordingId)) continue;
    if (settings.regions?.length && !settings.regions.includes(s.region || 'global')) continue;
    if (['decades','genre-decade'].includes(settings.songPack) && settings.decades?.length &&
        !settings.decades.includes(Math.floor(s.year/10)*10)) continue;
    if (['genre','genre-decade'].includes(settings.songPack) && settings.genres?.length &&
        (!s.genre || !settings.genres.includes(s.genre))) continue;
    seen.add(s.recordingId);
    const {title,artist,year,genre,region,recordingId,version,sourceUrl,recordingNote} = s;
    const card: SongCard = {id:randomUUID(),title,artist,year,genre,region,recordingId,version,sourceUrl,recordingNote};
    if (mode === 'licensed') {
      card.audioUrl = s.audioUrl;
      card.license = s.license;
      card.licenseUrl = s.licenseUrl;
      card.rightsUntil = [s.rightsUntil, s.audioExpiresAt].filter((date): date is string => !!date)
        .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
    }
    (heard.has(s.recordingId) ? repeats : fresh).push(card);
  }
  // The engine deals from the end of the array.
  return [...fisherYatesShuffle(repeats), ...fisherYatesShuffle(fresh)];
}

export function isAuthorizedRecording(song: SongCard, settings: GameSettings): boolean {
  const pack = load().licensed.find(p => p.id === (settings.packId || getLicensedPacks()[0]?.id));
  const track = pack?.tracks.find(t => t.recordingId === song.recordingId);
  return !!track && track.audioUrl === song.audioUrl && available(track);
}

export function registerLicensedAudioRoutes(app: Express) {
  app.get('/licensed-audio/:pack/:id', (req,res) => {
    const pack = load().licensed.find(p => p.id === req.params.pack);
    const track = pack?.tracks.find(t => clipAlias(pack.id, t.recordingId) === req.params.id);
    const file = track && allowed(track) ? operatorFile(track) : null;
    if (!file) { res.sendStatus(404); return; }
    res.set('Cache-Control','private, no-store').sendFile(file);
  });
}
