import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const pack = JSON.parse(readFileSync(new URL('data/independent-instrumentals.json',root),'utf8').replace(/^\uFEFF/,''));
const escape = value => value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const rows = pack.tracks.map(t =>
  '<li><a href="'+escape(t.sourceUrl)+'">'+escape(t.title)+'</a><span>'+t.year+'</span></li>').join('\n');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#151313">
<title>Music credits · Tunes</title>
<style>*{box-sizing:border-box}body{margin:0;background:#161414;color:#f9f3dd;font:1rem/1.6 system-ui,sans-serif}main{max-width:48rem;margin:auto;padding:2rem clamp(1.2rem,5vw,4rem) 5rem}h1{font-size:clamp(2.25rem,8vw,4rem);letter-spacing:-.06em;line-height:1.05;margin:2rem 0 1rem}a{color:#f7ce87;text-underline-offset:.22em}a:focus-visible{outline:3px solid white;outline-offset:3px}ul{list-style:none;padding:0}li{display:flex;justify-content:space-between;gap:1rem;border-bottom:1px solid #49403e;padding:.7rem 0}li span{font-variant-numeric:tabular-nums}p{max-width:61ch}</style></head>
<body><main><a href="/">Return to Tunes</a><h1>Music credits</h1>
<p>“Independent instrumentals” features original music by <a href="https://www.scottbuckley.com.au/">Scott Buckley</a>. Each recording below is released under <a href="https://creativecommons.org/licenses/by/4.0/">Creative Commons Attribution 4.0 International</a>.</p>
<p>Tunes uses a 32-second excerpt of each recording, beginning at 0:12, with short fades and MP3 compression. The years are the publication years in the artist’s library. <a href="https://www.scottbuckley.com.au/library/using-this-music/">Artist’s license notes</a>.</p>
<ul>${rows}</ul><p>Manual DJ cards link to the specific recording. Recording facts are sourced from <a href="https://musicbrainz.org/doc/About/Data_License">MusicBrainz core data (CC0)</a>. Tunes does not supply the sound recording for manual cards.</p></main></body></html>\n`;
writeFileSync(new URL('app/public/music-credits.html',root), html);
