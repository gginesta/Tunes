import { useState, useEffect, useCallback } from 'react';
import { Music, Headphones, BookOpen, Wifi, WifiOff, Loader2, LogIn, LogOut, UserPlus, Trophy, BarChart3 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getSocket } from '../services/socket';
import { openSpotifyLogin, refreshAccessToken } from '../services/spotify';
import { useGameStore } from '../store';

export function Home() {
  const [name, setName] = useState(() => localStorage.getItem('tunes_display_name') || '');
  const [mode, setMode] = useState<'idle' | 'host' | 'join'>('idle');
  const [code, setCode] = useState(['', '', '', '']);
  const [connecting, setConnecting] = useState(false);
  const [authMode, setAuthMode] = useState<'none' | 'login' | 'register'>('none');
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [signedInAs, setSignedInAs] = useState<string | null>(() => localStorage.getItem('tunes_username'));
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const error = useGameStore((s) => s.error);
  const connected = useGameStore((s) => s.connected);
  const setScreen = useGameStore((s) => s.setScreen);
  const setError = useGameStore((s) => s.setError);
  const pendingJoinCode = useGameStore((s) => s.pendingJoinCode);
  const setPendingJoinCode = useGameStore((s) => s.setPendingJoinCode);

  const handleAuthResult = useCallback((data: { success: boolean; error?: string; displayName?: string }) => {
    setAuthLoading(false);
    if (data.success) {
      localStorage.setItem('tunes_username', authUsername);
      setSignedInAs(authUsername);
      if (data.displayName) {
        setName(data.displayName);
        localStorage.setItem('tunes_display_name', data.displayName);
      }
      setAuthMode('none');
      setAuthPassword('');
      setError(null);
    } else {
      setError(data.error || 'Authentication failed');
    }
  }, [authUsername, setError]);

  useEffect(() => {
    const socket = getSocket();
    socket.on('auth-result', handleAuthResult);
    return () => {
      socket.off('auth-result', handleAuthResult);
    };
  }, [handleAuthResult]);

  useEffect(() => {
    if (pendingJoinCode) {
      setMode('join');
      setCode(pendingJoinCode.split('') as [string, string, string, string]);
      setInviteMessage(`You've been invited to room ${pendingJoinCode}!`);
      setPendingJoinCode(null);
    }
  }, [pendingJoinCode, setPendingJoinCode]);

  const handleAuth = () => {
    if (!authUsername.trim() || !authPassword.trim()) return;
    setAuthLoading(true);
    setError(null);
    const socket = getSocket();
    if (authMode === 'register') {
      socket.emit('register', {
        username: authUsername.trim(),
        password: authPassword,
        displayName: name.trim() || authUsername.trim(),
      });
    } else {
      socket.emit('login', { username: authUsername.trim(), password: authPassword });
    }
  };

  const handleSignOut = () => {
    localStorage.removeItem('tunes_username');
    localStorage.removeItem('tunes_display_name');
    setSignedInAs(null);
    setName('');
    setError(null);
  };

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
      const savedRefresh = localStorage.getItem('spotify_refresh_token');
      if (savedRefresh) {
        try {
          const refreshed = await refreshAccessToken(savedRefresh);
          createRoomWithToken(refreshed.accessToken, refreshed.refreshToken);
          return;
        } catch {
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
    <div className="flex flex-col items-center justify-center min-h-screen p-6 text-white bg-[#1a1a2e] bg-pattern">
      {/* Connection indicator */}
      <div className="absolute top-4 right-4">
        {connected ? (
          <div className="flex items-center gap-1.5 text-xs text-green-400 font-medium">
            <Wifi className="w-3.5 h-3.5" />
            Connected
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-red-400 animate-pulse font-medium">
            <WifiOff className="w-3.5 h-3.5" />
            Connecting...
          </div>
        )}
      </div>

      {/* Logo */}
      <motion.div
        initial={{ y: -30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        className="flex flex-col items-center mb-10"
      >
        <div className="relative mb-2">
          <div className="absolute inset-0 bg-[#1DB954] blur-2xl opacity-20 rounded-full scale-150" />
          <Music className="w-20 h-20 text-[#1DB954] relative z-10" />
        </div>
        <h1 className="text-5xl font-black tracking-tighter bg-gradient-to-r from-white via-white to-gray-400 bg-clip-text text-transparent">
          TUNES
        </h1>
        <p className="text-gray-500 mt-1 font-medium tracking-widest uppercase text-xs">
          The Music Party Game
        </p>
      </motion.div>

      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1, type: 'spring', stiffness: 200, damping: 20 }}
        className="w-full max-w-sm space-y-5"
      >
        {/* Name input */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider ml-1">
            Your Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your nickname..."
            maxLength={20}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="words"
            spellCheck={false}
            className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-lg text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-[#1DB954]/50 focus:border-[#1DB954]/50 focus:bg-white/[0.07] transition-all"
          />
        </div>

        {/* Account section */}
        {signedInAs ? (
          <div className="flex items-center justify-between bg-white/5 rounded-xl px-4 py-3 border border-white/5">
            <span className="text-sm text-gray-300">
              Signed in as <span className="text-white font-semibold">{signedInAs}</span>
            </span>
            <button
              onClick={handleSignOut}
              className="text-xs text-gray-500 hover:text-white flex items-center gap-1 transition-colors py-1 px-2 rounded-lg hover:bg-white/5"
            >
              <LogOut className="w-3 h-3" />
              Sign out
            </button>
          </div>
        ) : authMode !== 'none' ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="space-y-3 bg-white/5 rounded-2xl p-5 border border-white/10"
          >
            <div className="flex gap-1 bg-black/30 rounded-xl p-1">
              <button
                onClick={() => { setAuthMode('login'); setError(null); }}
                className={`flex-1 text-xs font-bold py-2 rounded-lg transition-all ${authMode === 'login' ? 'bg-white/10 text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}
              >
                Sign In
              </button>
              <button
                onClick={() => { setAuthMode('register'); setError(null); }}
                className={`flex-1 text-xs font-bold py-2 rounded-lg transition-all ${authMode === 'register' ? 'bg-white/10 text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}
              >
                Create Account
              </button>
            </div>
            <input
              type="text"
              value={authUsername}
              onChange={(e) => setAuthUsername(e.target.value)}
              placeholder="Username"
              maxLength={20}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="w-full bg-black/20 border border-white/5 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-[#1DB954]/50 transition-all"
            />
            <input
              type="password"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              placeholder="Password"
              onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="w-full bg-black/20 border border-white/5 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-[#1DB954]/50 transition-all"
            />
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { setAuthMode('none'); setError(null); }}
                className="flex-1 text-sm text-gray-500 hover:text-white py-2.5 rounded-xl transition-colors hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={handleAuth}
                disabled={!authUsername.trim() || !authPassword.trim() || authLoading}
                className="flex-[2] bg-[#1DB954] hover:bg-[#1ed760] disabled:opacity-50 text-black text-sm font-bold py-2.5 rounded-xl transition-all flex items-center justify-center gap-1.5"
              >
                {authLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : authMode === 'register' ? (
                  <>
                    <UserPlus className="w-4 h-4" />
                    Create
                  </>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" />
                    Sign In
                  </>
                )}
              </button>
            </div>
          </motion.div>
        ) : (
          <button
            onClick={() => setAuthMode('login')}
            className="text-sm text-gray-500 hover:text-gray-300 transition-colors py-2 px-4 rounded-xl hover:bg-white/5 mx-auto block"
          >
            Have an account? Sign in
          </button>
        )}

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.p
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="text-red-400 text-sm text-center bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        {/* Main actions */}
        <AnimatePresence mode="wait">
          {mode === 'idle' ? (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-3 pt-2"
            >
              <button
                onClick={() => {
                  if (!name.trim()) return;
                  setMode('host');
                }}
                disabled={!name.trim() || !connected}
                className="w-full bg-[#1DB954] hover:bg-[#1ed760] disabled:opacity-40 text-black font-bold text-lg py-4 rounded-2xl flex items-center justify-center gap-3 transition-all transform active:scale-[0.97] shadow-[0_4px_20px_rgba(29,185,84,0.3)]"
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
                className="w-full bg-white/[0.07] hover:bg-white/[0.12] disabled:opacity-40 text-white font-bold text-lg py-4 rounded-2xl transition-all transform active:scale-[0.97] border border-white/[0.08]"
              >
                Join Game
              </button>
              <button
                onClick={() => setScreen('rules')}
                className="w-full text-gray-500 hover:text-gray-300 font-medium text-sm py-3 flex items-center justify-center gap-2 transition-colors rounded-xl hover:bg-white/5"
              >
                <BookOpen className="w-4 h-4" />
                How to Play
              </button>
              <div className="flex gap-3">
                <button
                  onClick={() => setScreen('leaderboard')}
                  className="flex-1 text-gray-500 hover:text-yellow-400 font-medium text-sm py-3 flex items-center justify-center gap-2 transition-colors rounded-xl hover:bg-white/5 border border-white/[0.05]"
                >
                  <Trophy className="w-4 h-4" />
                  Leaderboard
                </button>
                {signedInAs && (
                  <button
                    onClick={() => setScreen('profile')}
                    className="flex-1 text-gray-500 hover:text-[#1DB954] font-medium text-sm py-3 flex items-center justify-center gap-2 transition-colors rounded-xl hover:bg-white/5 border border-white/[0.05]"
                  >
                    <BarChart3 className="w-4 h-4" />
                    My Stats
                  </button>
                )}
              </div>
            </motion.div>
          ) : mode === 'host' ? (
            <motion.div
              key="host"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4 pt-2"
            >
              <p className="text-gray-400 text-sm text-center leading-relaxed">
                Choose how you want to host your game.
              </p>
              <button
                onClick={handleSpotifyLogin}
                disabled={connecting}
                className="w-full bg-[#1DB954] hover:bg-[#1ed760] disabled:opacity-70 text-black font-bold text-lg py-4 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all transform active:scale-[0.97] shadow-[0_4px_20px_rgba(29,185,84,0.3)]"
              >
                {connecting ? (
                  <span className="flex items-center gap-3">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Connecting...
                  </span>
                ) : (
                  <>
                    <span className="flex items-center gap-3">
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                      </svg>
                      Host with Spotify
                    </span>
                    <span className="text-xs font-medium text-black/60">Full tracks, all features</span>
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  if (!name.trim()) return;
                  setError(null);
                  const socket = getSocket();
                  socket.emit('create-room', { playerName: name.trim() });
                }}
                disabled={!connected}
                className="w-full bg-white/[0.07] hover:bg-white/[0.12] disabled:opacity-40 text-white font-bold text-lg py-4 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all transform active:scale-[0.97] border border-white/[0.08]"
              >
                <span className="flex items-center gap-3">
                  <Music className="w-5 h-5" />
                  Host without Spotify
                </span>
                <span className="text-xs font-medium text-gray-400">30s preview clips, no account needed</span>
              </button>
              <button
                onClick={() => { setMode('idle'); setError(null); }}
                className="w-full text-gray-500 hover:text-white font-medium py-3 transition-colors rounded-xl hover:bg-white/5"
              >
                Back
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="join"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-5 pt-2"
            >
              {inviteMessage && (
                <motion.p
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-[#1DB954] text-sm text-center bg-[#1DB954]/10 border border-[#1DB954]/20 rounded-xl px-4 py-2.5 font-medium"
                >
                  {inviteMessage}
                </motion.p>
              )}
              <div className="space-y-3">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider text-center block">
                  Enter Room Code
                </label>
                <div className="flex justify-center gap-3">
                  {[0, 1, 2, 3].map((i) => (
                    <input
                      key={i}
                      id={`code-${i}`}
                      type="text"
                      maxLength={1}
                      value={code[i]}
                      onChange={(e) => handleCodeChange(i, e.target.value)}
                      onKeyDown={(e) => handleCodeKeyDown(i, e)}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      className="w-14 h-16 bg-white/5 border-2 border-white/10 rounded-xl text-center text-2xl font-black text-white focus:outline-none focus:border-[#1DB954] focus:bg-[#1DB954]/10 transition-all uppercase"
                    />
                  ))}
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setMode('idle')}
                  className="flex-1 bg-white/[0.07] hover:bg-white/[0.12] text-white font-bold py-4 rounded-2xl transition-all border border-white/[0.08]"
                >
                  Back
                </button>
                <button
                  onClick={handleJoin}
                  disabled={code.join('').length !== 4}
                  className="flex-[2] bg-[#1DB954] hover:bg-[#1ed760] disabled:opacity-40 text-black font-bold py-4 rounded-2xl transition-all shadow-[0_4px_20px_rgba(29,185,84,0.3)]"
                >
                  Join Room
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
