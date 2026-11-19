import { useEffect, lazy, Suspense } from 'react';
import { useSocket } from './hooks/useSocket';
import { useGameStore } from './store';
import { useTableAudio } from './hooks/useTableAudio';
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
  useTableAudio();

  useEffect(() => {
    const match = window.location.pathname.match(/^\/join\/([a-zA-Z]{4})\/?$/);
    if (match) {
      setPendingJoinCode(match[1].toUpperCase());
      // Preserve the invite until the server confirms the new seat.
    }
  }, [setPendingJoinCode]);

  return (
    <div className="tunes-app">
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
