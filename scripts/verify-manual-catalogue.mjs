// Refine the pilot seed against MusicBrainz core recording data. Run at most one
// request at a time. A credited recording and its first release date travel together.
import {readFileSync, writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';

const root = new URL('../', import.meta.url);
const seeds = JSON.parse(readFileSync(new URL('data/songs.json', root), 'utf8'));
const path = new URL('data/manual-recordings.json', root);
const clean = s => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const key = s => clean(s.title) + '|' + clean(s.artist);
const alternate = /\blive\b|part of|dj.mix|remix|demo|instrumental|karaoke|re.record|cover version|atmos|360 reality|promo|video|k.tel|sampled|japanese version|chinese version|banda version|rehearsal|backing track|medley|orchestral version|sped up|slowed/i;
let existing = [];
try { existing = JSON.parse(readFileSync(path,'utf8')); } catch { /* initial catalogue */ }
const ready = new Map(existing.filter(s => !alternate.test(s.version || '')).map(s => [key(s), s]));
const pinned = new Set();
for (const seed of seeds.filter(s => s.recordingId && s.sourceUrl && s.version)) {
  const {title, artist, year, genre, region, recordingId, version, sourceUrl} = seed;
  ready.set(key(seed), {title,artist,year,genre,region,recordingId,version,sourceUrl,
    recordingNote:'First catalogued release of this edition.'});
  pinned.add(key(seed));
}
const save = () => writeFileSync(path,JSON.stringify([...ready.values()],null,2)+'\n');
save();
const groups = new Map();
for (const seed of seeds) {
  const bucket = Math.floor(seed.year/10) + '-' + (seed.region || 'global');
  if (!groups.has(bucket)) groups.set(bucket,[]);
  groups.get(bucket).push(seed);
}
const queue = [];
for (let i = 0; i < Math.max(...[...groups.values()].map(g => g.length)); i++) {
  for (const group of groups.values()) if (group[i]) queue.push(group[i]);
}
const limit = Number(process.argv[2]) || 150;
const refresh = process.argv.includes('--refresh');
const since = Number(process.argv.find(arg => arg.startsWith('--since='))?.slice(8)) || 0;
const quoted = s => '"' + s.replace(/["\\]/g, '\\$&') + '"';
const visited = new Set();
for (const seed of queue) {
  if (seed.year < since) continue;
  if (ready.size >= limit && !refresh) break;
  if (pinned.has(key(seed)) || visited.has(key(seed))) continue;
  if (ready.has(key(seed)) && !refresh) continue;
  if (refresh && ready.size >= limit && !existing.some(s => key(s) === key(seed))) continue;
  visited.add(key(seed));
  const query = 'recording:' + quoted(seed.title) + ' AND artist:' + quoted(seed.artist);
  const params = new URLSearchParams({fmt:'json',limit:'80', query});
  try {
    const res = await fetch('https://musicbrainz.org/ws/2/recording/?'+params, {
      headers:{'User-Agent':'TunesDinner/1.0 (https://github.com/gginesta/Tunes)'}, signal:AbortSignal.timeout(15000)});
    if (res.status === 429 || res.status === 503) { await delay(4500); continue; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const {recordings} = await res.json();
    const hits = recordings.filter(r => clean(r.title) === clean(seed.title) &&
      r['artist-credit']?.some(c => clean(c.name || c.artist.name) === clean(seed.artist)) &&
      !r.video && !alternate.test(r.disambiguation || '') && r['first-release-date'] &&
      Math.abs(Number(r['first-release-date'].slice(0,4)) - seed.year) <= 3);
    hits.sort((a,b) => Number(a['first-release-date'].slice(0,4))-Number(b['first-release-date'].slice(0,4)) ||
      (b['release-count'] || b.releases?.length || 0) - (a['release-count'] || a.releases?.length || 0));
    const hit = hits[0];
    if (hit) {
      const {title,artist,genre,region} = seed;
      const year = Number(hit['first-release-date'].slice(0,4));
      const firstRelease = hit.releases?.find(release => release.date?.slice(0,4) === String(year) && release.title);
      ready.set(key(seed),{title,artist,year,genre,region,recordingId:hit.id,
        version:hit.disambiguation || (firstRelease ? 'Recording on “' + firstRelease.title + '”' : 'Catalogued recording'),
        sourceUrl:'https://musicbrainz.org/recording/'+hit.id,
        recordingNote:'First catalogued release of this recording.'});
      save();
    }
  } catch (error) {console.error(seed.title, error.message);}
  await delay(1150);
}
console.log('Verified recording count:',ready.size);
