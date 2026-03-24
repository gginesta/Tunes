import { useState } from 'react';
import { Music, Headphones, BookOpen, Wifi, WifiOff, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { getSocket } from '../services/socket';
import { openSpotifyLogin, refreshAccessToken } from '../services/spotify';
import { useGameStore } from '../store';

export function Home() {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'idle' | 'host' | 'join'>('idle');
  const [code, setCode] = useState(['', '', '', '']);
  const [connecting, setConnecting] = useState(false);
  const error = useGameStore((s) => s.error);
  const connected = useGameStore((s) => s.connected);
  const setScreen = useGameStore((s) => s.setScreen);
  const setError = useGameStore((s) => s.setError);

  const createRoomWithToken = (accessToken: string, refreshToken: string) => {
    useGameStore.setState({
      spotifyToken: accessToken,
      spotifyRefreshToken: refreshToken,
    });
    localStorage.setItem('spotify_refresh_token', refreshToken);

    const socket = getSocket();
    socket.emit('create-room', {
      playerName: name.trim(),
      spotifyAccessToken: accessToken,
    });
  };

  const handleSpotifyLogin = async () => {
    if (!name.trim()) return;
    setConnecting(true);
    setError(null);

    try {
      // Try to reuse a saved refresh token first
      const savedRefresh = localStorage.getItem('spotify_refresh_token');
      if (savedRefresh) {
        try {
          const refreshed = await refreshAccessToken(savedRefresh);
          createRoomWithToken(refreshed.accessToken, refreshed.refreshToken);
          return;
        } catch {
          // Refresh failed — fall through to full login
          localStorage.removeItem('spotify_refresh_token');
        }
      }

      const { accessToken, refreshToken } = await openSpotifyLogin();
      createRoomWithToken(accessToken, refreshToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Spotify login failed');
    } finally {
      setConnecting(false);
    }
  };

  const handleJoin = () => {
    const fullCode = code.join('');
    if (fullCode.length !== 4 || !name.trim()) return;
    setError(null);
    const socket = getSocket();
    socket.emit('join-room', { code: fullCode, playerName: name.trim() });
  };

  const handleCodeChange = (index: number, value: string) => {
    if (value.length > 1) return;
    const newCode = [...code];
    newCode[index] = value.toUpperCase();
    setCode(newCode);
    if (value && index < 3) {
      document.getElementById(`code-${index + 1}`)?.focus();
    }
  };

  const handleCodeKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      document.getElementById(`code-${index - 1}`)?.focus();
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 text-white bg-[#1a1a2e]">
      {/* Connection indicator */}
      <div className="absolute top-4 right-4">
        {connected ? (
          <div className="flex items-center gap-1.5 text-xs text-green-400">
            <Wifi className="w-3.5 h-3.5" />
            Connected
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-red-400 animate-pulse">
            <WifiOff className="w-3.5 h-3.5" />
            Connecting...
          </div>
        )}
      </div>

      <motion.div
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="flex flex-col items-center mb-12"
      >
        <div className="relative">
          <div className="absolute inset-0 bg-[#1DB954] blur-xl opacity-20 rounded-full" />
          <Music className="w-24 h-24 text-[#1DB954] mb-4 relative z-10" />
        </div>
        <h1 className="text-5xl font-black tracking-tighter bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
          HITSTER
        </h1>
        <p className="text-gray-400 mt-2 font-medium tracking-wide uppercase text-sm">
          The Music Party Game
        </p>
      </motion.div>

      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-semibold text-gray-300 uppercase tracking-wider ml-1">
            Your Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your nickname..."
            maxLength={20}
            className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#1DB954] focus:border-transparent transition-all"
          />
        </div>

        {error && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-red-400 text-sm text-center bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2"
          >
            {error}
          </motion.p>
        )}

        {mode === 'idle' ? (
          <div className="space-y-4 pt-4">
            <button
              onClick={() => {
                if (!name.trim()) return;
                setMode('host');
              }}
              disabled={!name.trim() || !connected}
              className="w-full bg-[#1DB954] hover:bg-[#1ed760] disabled:opacity-50 disabled:hover:bg-[#1DB954] text-black font-bold text-lg py-4 px-6 rounded-2xl flex items-center justify-center gap-3 transition-all transform active:scale-95 shadow-[0_0_20px_rgba(29,185,84,0.3)]"
            >
              <Headphones className="w-6 h-6" />
              Host Game
            </button>
            <button
              onClick={() => {
                if (!name.trim()) return;
                setMode('join');
              }}
              disabled={!name.trim() || !connected}
              className="w-full bg-white/10 hover:bg-white/15 disabled:opacity-50 text-white font-bold text-lg py-4 px-6 rounded-2xl transition-all transform active:scale-95"
            >
              Join Game
            </button>
            <button
              onClick={() => setScreen('rules')}
              className="w-full bg-transparent text-gray-400 hover:text-white font-medium text-base py-3 flex items-center justify-center gap-2 transition-all"
            >
              <BookOpen className="w-5 h-5" />
              How to Play
            </button>
          </div>
        ) : mode === 'host' ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="space-y-4 pt-4 text-center"
          >
            <p className="text-gray-300 text-sm">
              Connect your Spotify Premium account to play music for the room.
            </p>
            <button
              onClick={handleSpotifyLogin}
              disabled={connecting}
              className="w-full bg-[#1DB954] hover:bg-[#1ed760] disabled:opacity-70 text-black font-bold text-lg py-4 px-6 rounded-2xl flex items-center justify-center gap-3 transition-all transform active:scale-95 shadow-[0_0_20px_rgba(29,185,84,0.3)]"
            >
              {connecting ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin" />
                  Connecting to Spotify...
                </>
              ) : (
                <>
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                  </svg>
                  Connect Spotify & Create Room
                </>
              )}
            </button>
            <button
              onClick={() => { setMode('idle'); setError(null); }}
              className="w-full bg-transparent text-gray-400 hover:text-white font-bold py-2 transition-all"
            >
              Cancel
            </button>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="space-y-6 pt-4"
          >
            <div className="space-y-3">
              <label className="text-sm font-semibold text-gray-300 uppercase tracking-wider ml-1 text-center block">
                Enter Room Code
              </label>
              <div className="flex justify-between gap-3">
                {[0, 1, 2, 3].map((i) => (
                  <input
                    key={i}
                    id={`code-${i}`}
                    type="text"
                    maxLength={1}
                    value={code[i]}
                    onChange={(e) => handleCodeChange(i, e.target.value)}
                    onKeyDown={(e) => handleCodeKeyDown(i, e)}
                    className="w-16 h-20 bg-white/5 border-2 border-white/10 rounded-2xl text-center text-3xl font-black text-white focus:outline-none focus:border-[#1DB954] focus:bg-[#1DB954]/10 transition-all uppercase"
                  />
                ))}
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setMode('idle')}
                className="flex-1 bg-white/10 hover:bg-white/15 text-white font-bold py-4 rounded-2xl transition-all"
              >
                Back
              </button>
              <button
                onClick={handleJoin}
                disabled={code.join('').length !== 4}
                className="flex-[2] bg-[#1DB954] hover:bg-[#1ed760] disabled:opacity-50 text-black font-bold py-4 rounded-2xl transition-all shadow-[0_0_20px_rgba(29,185,84,0.3)]"
              >
                Join Room
              </button>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
