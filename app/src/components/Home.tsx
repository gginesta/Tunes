import { useState, useEffect, useCallback } from 'react';
import { Music, Loader2, LogIn, LogOut, UserPlus, Wifi, WifiOff } from 'lucide-react';
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
    <div className="relative flex flex-col items-center min-h-screen px-6 py-8 text-white scanlines">
      {/* Connection indicator */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-1.5 text-[10px] font-bold tracking-[0.2em]">
        {connected ? (
          <>
            <span className="conn-dot" />
            <span className="text-neon-cyan/90">CONNECTED</span>
          </>
        ) : (
          <>
            <span className="conn-dot conn-red" />
            <span className="text-red-400">OFFLINE</span>
          </>
        )}
      </div>

      {/* Vinyl hero */}
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 22 }}
        className="relative mt-8 mb-6"
        style={{ width: 220, height: 220 }}
      >
        <div className="vinyl">
          <div className="vinyl-label">
            <div>
              <div className="font-chunky text-xl leading-none">TUNES</div>
              <div className="text-[8px] tracking-[0.3em] mt-1 opacity-80 font-sans">A MUSIC PARTY</div>
            </div>
          </div>
          <div className="vinyl-hole" />
        </div>
        <div className="tonearm" />
      </motion.div>

      {/* Headline */}
      <motion.div
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.08, type: 'spring', stiffness: 200, damping: 22 }}
        className="text-center"
      >
        <h1 className="font-heading text-[2.25rem] leading-[1.05] font-black tracking-tight">
          <span className="needle text-neon-pink text-glow-pink">Drop</span> the needle.
        </h1>
        <p className="text-white/55 text-sm mt-2">
          Host a room. Share the code. Guess the year.
        </p>
      </motion.div>

      <motion.div
        initial={{ y: 14, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.15, type: 'spring', stiffness: 200, damping: 22 }}
        className="w-full max-w-sm space-y-5 mt-8"
      >
        {/* Stage name */}
        <div className="space-y-2">
          <label className="text-[10px] tracking-[0.3em] text-neon-cyan font-bold block">
            YOUR STAGE NAME
          </label>
          <div className="relative">
            <input
              type="search"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your nickname..."
              maxLength={20}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="words"
              className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-lg font-medium text-white placeholder-white/30 focus:outline-none focus:border-neon-pink focus:bg-neon-pink/5 transition-all"
            />
            <span className="eq absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
              <i /><i /><i /><i /><i />
            </span>
          </div>
        </div>

        {/* Account section */}
        {signedInAs ? (
          <div className="flex items-center justify-between panel px-4 py-3">
            <span className="text-sm text-white/70">
              Signed in as <span className="text-white font-semibold">{signedInAs}</span>
            </span>
            <button
              onClick={handleSignOut}
              className="text-xs text-white/50 hover:text-white flex items-center gap-1 transition-colors py-1 px-2 rounded-lg hover:bg-white/5"
            >
              <LogOut className="w-3 h-3" />
              Sign out
            </button>
          </div>
        ) : authMode !== 'none' ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="space-y-3 panel p-5"
          >
            <div className="flex gap-1 bg-black/30 rounded-xl p-1">
              <button
                onClick={() => { setAuthMode('login'); setError(null); }}
                className={`flex-1 text-xs font-bold py-2 rounded-lg transition-all ${authMode === 'login' ? 'bg-white/10 text-white' : 'text-white/45 hover:text-white/80'}`}
              >
                Sign In
              </button>
              <button
                onClick={() => { setAuthMode('register'); setError(null); }}
                className={`flex-1 text-xs font-bold py-2 rounded-lg transition-all ${authMode === 'register' ? 'bg-white/10 text-white' : 'text-white/45 hover:text-white/80'}`}
              >
                Create Account
              </button>
            </div>
            <input
              type="search"
              value={authUsername}
              onChange={(e) => setAuthUsername(e.target.value)}
              placeholder="Username"
              maxLength={20}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-neon-pink transition-all"
            />
            <input
              type="password"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              placeholder="Password"
              onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
              autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
              autoCapitalize="off"
              className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-neon-pink transition-all"
            />
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { setAuthMode('none'); setError(null); }}
                className="btn btn-ghost flex-1"
              >
                Cancel
              </button>
              <button
                onClick={handleAuth}
                disabled={!authUsername.trim() || !authPassword.trim() || authLoading}
                className="btn btn-primary flex-[2]"
              >
                {authLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : authMode === 'register' ? (
                  <><UserPlus className="w-4 h-4" />Create</>
                ) : (
                  <><LogIn className="w-4 h-4" />Sign In</>
                )}
              </button>
            </div>
          </motion.div>
        ) : (
          <button
            onClick={() => setAuthMode('login')}
            className="text-sm text-white/50 hover:text-white/80 transition-colors py-2 px-4 rounded-xl hover:bg-white/5 mx-auto block"
          >
            Have an account? Sign in
          </button>
        )}

        {/* Invite banner */}
        {inviteMessage && mode === 'join' && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-neon-cyan text-sm text-center bg-neon-cyan/10 border border-neon-cyan/30 rounded-xl px-4 py-2.5 font-medium"
          >
            {inviteMessage}
          </motion.p>
        )}

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.p
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="text-red-400 text-sm text-center bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5"
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
              className="space-y-3 pt-1"
            >
              <button
                onClick={() => {
                  if (!name.trim()) return;
                  setMode('host');
                }}
                disabled={!name.trim() || !connected}
                className="btn btn-primary btn-lg w-full"
              >
                HOST A ROOM
              </button>
              <button
                onClick={() => {
                  if (!name.trim()) return;
                  setMode('join');
                }}
                disabled={!name.trim() || !connected}
                className="btn btn-secondary btn-lg w-full"
              >
                JOIN WITH CODE
              </button>
            </motion.div>
          ) : mode === 'host' ? (
            <motion.div
              key="host"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-3 pt-1"
            >
              <p className="text-white/55 text-sm text-center leading-relaxed">
                Choose how you want to host your game.
              </p>
              <button
                onClick={handleSpotifyLogin}
                disabled={connecting}
                className="btn btn-primary w-full py-5 flex-col gap-1"
              >
                {connecting ? (
                  <span className="flex items-center gap-3">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Connecting...
                  </span>
                ) : (
                  <>
                    <span className="flex items-center gap-3 font-chunky text-lg">
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                      </svg>
                      HOST WITH SPOTIFY
                    </span>
                    <span className="text-[11px] font-medium text-[#0a0318]/70">Full tracks, all features</span>
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
                className="btn btn-ghost w-full py-5 flex-col gap-1"
              >
                <span className="flex items-center gap-3 font-bold">
                  <Music className="w-5 h-5" />
                  Host without Spotify
                </span>
                <span className="text-[11px] font-medium text-white/50">30s preview clips, no account needed</span>
              </button>
              <button
                onClick={() => { setMode('idle'); setError(null); }}
                className="w-full text-white/50 hover:text-white font-medium py-3 transition-colors rounded-xl hover:bg-white/5"
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
              className="space-y-4 pt-1"
            >
              <div className="space-y-3">
                <label className="text-[10px] tracking-[0.3em] text-neon-cyan font-bold text-center block">
                  ENTER ROOM CODE
                </label>
                <div className="flex justify-center gap-3">
                  {[0, 1, 2, 3].map((i) => (
                    <input
                      key={i}
                      id={`code-${i}`}
                      type="search"
                      maxLength={1}
                      value={code[i]}
                      onChange={(e) => handleCodeChange(i, e.target.value)}
                      onKeyDown={(e) => handleCodeKeyDown(i, e)}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="characters"
                      className={`code-box ${code[i] ? 'is-filled' : ''}`}
                    />
                  ))}
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setMode('idle')}
                  className="btn btn-ghost flex-1"
                >
                  Back
                </button>
                <button
                  onClick={handleJoin}
                  disabled={code.join('').length !== 4}
                  className="btn btn-primary flex-[2]"
                >
                  Join Room
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Footer chips */}
      <div className="mt-auto pt-8 flex items-center justify-center gap-2 text-xs">
        <button
          onClick={() => setScreen('rules')}
          className="btn btn-ghost px-3 py-2 text-xs"
        >
          📖 Rules
        </button>
        <button
          onClick={() => setScreen('leaderboard')}
          className="btn btn-ghost px-3 py-2 text-xs"
        >
          🏆 Leaderboard
        </button>
        {signedInAs && (
          <button
            onClick={() => setScreen('profile')}
            className="btn btn-ghost px-3 py-2 text-xs"
          >
            📊 My Stats
          </button>
        )}
      </div>
      <p className="text-center text-[10px] text-white/25 mt-3 tabular-nums">
        TUNES v2.3.0 · 33⅓ rpm {connected ? <Wifi className="inline w-3 h-3" /> : <WifiOff className="inline w-3 h-3" />}
      </p>
    </div>
  );
}
