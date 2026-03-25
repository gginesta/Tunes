import { useEffect } from 'react';
import { useSocket } from './hooks/useSocket';
import { useGameStore } from './store';
import { Home } from './components/Home';
import { Lobby } from './components/Lobby';
import { Game } from './components/Game';
import { Results } from './components/Results';
import { Rules } from './components/Rules';
import { Leaderboard } from './components/Leaderboard';
import { PlayerProfile } from './components/PlayerProfile';

export default function App() {
  useSocket();
  const screen = useGameStore((s) => s.screen);
  const setPendingJoinCode = useGameStore((s) => s.setPendingJoinCode);

  useEffect(() => {
    const match = window.location.pathname.match(/^\/join\/([a-zA-Z]{4})$/);
    if (match) {
      setPendingJoinCode(match[1].toUpperCase());
      window.history.replaceState({}, '', '/');
    }
  }, [setPendingJoinCode]);

  return (
    <div className="font-sans antialiased bg-[#1a1a2e] min-h-screen text-white selection:bg-[#1DB954] selection:text-black">
      {screen === 'home' && <Home />}
      {screen === 'lobby' && <Lobby />}
      {screen === 'game' && <Game />}
      {screen === 'results' && <Results />}
      {screen === 'rules' && <Rules />}
      {screen === 'leaderboard' && <Leaderboard />}
      {screen === 'profile' && <PlayerProfile />}
    </div>
  );
}
