import { useSocket } from './hooks/useSocket';
import { useGameStore } from './store';
import { Home } from './components/Home';
import { Lobby } from './components/Lobby';
import { Game } from './components/Game';
import { Results } from './components/Results';
import { Rules } from './components/Rules';

export default function App() {
  useSocket();
  const screen = useGameStore((s) => s.screen);

  return (
    <div className="font-sans antialiased bg-[#1a1a2e] min-h-screen text-white selection:bg-[#1DB954] selection:text-black">
      {screen === 'home' && <Home />}
      {screen === 'lobby' && <Lobby />}
      {screen === 'game' && <Game />}
      {screen === 'results' && <Results />}
      {screen === 'rules' && <Rules />}
    </div>
  );
}
