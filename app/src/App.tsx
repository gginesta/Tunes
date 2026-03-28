import { useEffect, useCallback } from 'react';
import { useSocket } from './hooks/useSocket';
import { useGameStore } from './store';
import { refreshAccessToken } from './services/spotify';
import {
  initPlayer,
  isInitialized,
} from './services/spotifyPlayer';
import {
  initFallbackAudio,
} from './services/audioFallback';
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
  const spotifyToken = useGameStore((s) => s.spotifyToken);
  const spotifyRefreshToken = useGameStore((s) => s.spotifyRefreshToken);
  const hostId = useGameStore((s) => s.hostId);
  const myId = useGameStore((s) => s.myId);
  const isHost = myId !== '' && myId === hostId;

  // Token ref for the SDK's getOAuthToken callback
  const getToken = useCallback(async (): Promise<string> => {
    const current = useGameStore.getState().spotifyToken;
    if (current) return current;
    const refresh = useGameStore.getState().spotifyRefreshToken
      || localStorage.getItem('spotify_refresh_token');
    if (!refresh) throw new Error('No token available');
    const result = await refreshAccessToken(refresh);
    useGameStore.setState({
      spotifyToken: result.accessToken,
      spotifyRefreshToken: result.refreshToken,
    });
    localStorage.setItem('spotify_refresh_token', result.refreshToken);
    return result.accessToken;
  }, []);

  // Initialize Spotify SDK early (in lobby) so it's ready when the game starts
  useEffect(() => {
    if (!isHost || !spotifyToken || isInitialized()) return;

    initFallbackAudio({
      onStateChange: (paused) => {
        useGameStore.setState({ isPlaying: !paused });
      },
    });

    initPlayer(getToken, {
      onReady: (_deviceId) => {
        useGameStore.setState({ spotifyDeviceId: _deviceId, spotifyError: null });
        console.log('[Tunes] SDK ready (early init), waiting for device confirmation...');
      },
      onDeviceConfirmed: () => {
        console.log('[Tunes] Device confirmed (early init) — ready to play!');
        useGameStore.setState({ spotifyReady: true, spotifyError: null });
      },
      onNotReady: () => {
        useGameStore.setState({ spotifyDeviceId: null });
      },
      onError: (message) => {
        useGameStore.setState({ spotifyError: message });
      },
      onAutoplayFailed: () => {
        useGameStore.setState({ isPlaying: false, autoplayBlocked: true });
      },
      onStateChange: (paused) => {
        useGameStore.setState({ isPlaying: !paused });
      },
      onActive: () => {},
    });
  }, [isHost, spotifyToken, getToken]);

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
