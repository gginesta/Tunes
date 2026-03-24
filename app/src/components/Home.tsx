import { useState } from 'react';
import { Music, Headphones, BookOpen, Wifi, WifiOff } from 'lucide-react';
import { motion } from 'motion/react';
import { getSocket } from '../services/socket';
import { useGameStore } from '../store';

export function Home() {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'idle' | 'host' | 'join'>('idle');
  const [code, setCode] = useState(['', '', '', '']);
  const error = useGameStore((s) => s.error);
  const connected = useGameStore((s) => s.connected);
  const setScreen = useGameStore((s) => s.setScreen);
  const setError = useGameStore((s) => s.setError);

  const handleHost = () => {
    if (!name.trim()) return;
    setError(null);
    const socket = getSocket();
    socket.emit('create-room', { playerName: name.trim() });
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
            className="space-y-6 pt-4 text-center"
          >
            <p className="text-gray-300 mb-4">
              Hosts need Spotify Premium to play music for the room.
            </p>
            <button
              onClick={handleHost}
              className="w-full bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold text-lg py-4 px-6 rounded-2xl flex items-center justify-center gap-3 transition-all transform active:scale-95 shadow-[0_0_20px_rgba(29,185,84,0.3)]"
            >
              <Headphones className="w-6 h-6" />
              Create Room
            </button>
            <button
              onClick={() => setMode('idle')}
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
