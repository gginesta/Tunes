import { useEffect, lazy, Suspense } from 'react';
import { useSocket } from './hooks/useSocket';
import { useGameStore } from './store';
import { ensureSpotifySession } from './services/spotifySession';
import { Home } from './components/Home';
import { Lobby } from './components/Lobby';
import { Game } from './components/Game';

// Secondary screens are code-split so they don't weigh down the initial bundle
const Results = lazy(() => import('./components/Results').then((m) => ({ default: m.Results })));
const Rules = lazy(() => import('./components/Rules').then((m) => ({ default: m.Rules })));
const Leaderboard = lazy(() => import('./components/Leaderboard').then((m) => ({ default: m.Leaderboard })));
const PlayerProfile = lazy(() => import('./components/PlayerProfile').then((m) => ({ default: m.PlayerProfile })));

export default function App() {
  useSocket();
  const screen = useGameStore((s) => s.screen);
  const setPendingJoinCode = useGameStore((s) => s.setPendingJoinCode);
  const spotifyToken = useGameStore((s) => s.spotifyToken);
  const hostId = useGameStore((s) => s.hostId);
  const myId = useGameStore((s) => s.myId);
  const isHost = myId !== '' && myId === hostId;

  // Initialize Spotify SDK early (in lobby) so it's ready when the game starts
  useEffect(() => {
    if (!isHost || !spotifyToken) return;
    ensureSpotifySession();
  }, [isHost, spotifyToken]);

  useEffect(() => {
    const match = window.location.pathname.match(/^\/join\/([a-zA-Z]{4})$/);
    if (match) {
      setPendingJoinCode(match[1].toUpperCase());
      window.history.replaceState({}, '', '/');
    }
  }, [setPendingJoinCode]);

  return (
    <div className="font-sans antialiased min-h-screen text-white selection:bg-neon-pink selection:text-[#0a0318] relative">
      <div className="ambient" aria-hidden="true" />
      {screen === 'home' && <Home />}
      {screen === 'lobby' && <Lobby />}
      {screen === 'game' && <Game />}
      <Suspense fallback={null}>
        {screen === 'results' && <Results />}
        {screen === 'rules' && <Rules />}
        {screen === 'leaderboard' && <Leaderboard />}
        {screen === 'profile' && <PlayerProfile />}
      </Suspense>
    </div>
  );
}
