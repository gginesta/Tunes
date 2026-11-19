import { useId } from 'react';
import { ArrowUpRight } from 'lucide-react';

const CLASSIC_URL = 'https://tunes.buzzrounds.com/';

function classicHostUrl(currentOrigin: string) {
  for (const candidate of [import.meta.env.VITE_SPOTIFY_CLASSIC_URL, CLASSIC_URL]) {
    if (!candidate?.trim().match(/^https:\/\//i)) continue;
    try {
      const url = new URL(candidate.trim());
      if (url.protocol === 'https:' && url.origin !== currentOrigin && !url.username && !url.password) return url.href;
    } catch { /* Try the original deployment if the configured URL is invalid. */ }
  }
}

export function SpotifyClassicHost({ lobby = false }: { lobby?: boolean }) {
  const instructionsId = useId();
  const href = classicHostUrl(window.location.origin);
  if (!href) return null;

  return (
    <div className="tunes-spotify-host">
      <a
        className={`tunes-button ${lobby ? 'tunes-button-secondary' : 'tunes-button-primary'}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-describedby={instructionsId}
      >
        Host Classic with Spotify <ArrowUpRight size={19} aria-hidden="true" />
      </a>
      <p className="tunes-muted" id={instructionsId}>
        Opens the original Tunes in a new tab. Enter a stage name, choose <b>Host a room</b>, then <b>Host with Spotify</b>.
        {' '}It creates a separate room. Share that room’s own invite with your guests.
      </p>
    </div>
  );
}
