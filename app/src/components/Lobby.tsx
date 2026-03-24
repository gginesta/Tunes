import { Users, Crown, Settings, LogOut, Play } from 'lucide-react';
import { motion } from 'motion/react';
import { getSocket, clearSession } from '../services/socket';
import { useGameStore } from '../store';
import { requestActivation } from '../services/spotifyPlayer';
import type { GameMode } from '@hitster/shared';
import { MIN_CARDS_TO_WIN, MAX_CARDS_TO_WIN, MIN_PLAYERS } from '@hitster/shared';

export function Lobby() {
  const players = useGameStore((s) => s.players);
  const myId = useGameStore((s) => s.myId);
  const roomCode = useGameStore((s) => s.roomCode);
  const hostId = useGameStore((s) => s.hostId);
  const settings = useGameStore((s) => s.settings);
  const error = useGameStore((s) => s.error);
  const reset = useGameStore((s) => s.reset);

  const isHost = hostId === myId;
  const playerList = Object.values(players);
  const socket = getSocket();

  const handleLeave = () => {
    socket.emit('leave-room');
    clearSession();
    reset();
  };

  const handleStart = () => {
    // Pre-activate Spotify audio element during this user gesture
    // so autoplay works when the first song arrives
    requestActivation();
    socket.emit('start-game');
  };

  const handleUpdateMode = (mode: GameMode) => {
    socket.emit('update-settings', { mode });
  };

  const handleUpdateCards = (cardsToWin: number) => {
    socket.emit('update-settings', { cardsToWin });
  };

  const modes: { value: GameMode; label: string; desc: string }[] = [
    { value: 'original', label: 'Original', desc: 'Place correctly to keep the card' },
    { value: 'pro', label: 'Pro', desc: 'Must also name the song' },
    { value: 'expert', label: 'Expert', desc: 'Name song + guess exact year' },
    { value: 'coop', label: 'Co-op', desc: 'Shared timeline, work together' },
  ];

  return (
    <div className="flex flex-col min-h-screen p-6 text-white bg-[#1a1a2e]">
      <div className="flex justify-between items-center mb-8">
        <button
          onClick={handleLeave}
          className="p-2 bg-white/5 rounded-full hover:bg-white/10 transition-colors"
        >
          <LogOut className="w-5 h-5 text-gray-400" />
        </button>
        <div className="text-center">
          <p className="text-xs text-gray-400 uppercase tracking-widest font-bold mb-1">
            Room Code
          </p>
          <h2 className="text-4xl font-black tracking-widest text-[#1DB954]">
            {roomCode}
          </h2>
        </div>
        <div className="w-9" />
      </div>

      {error && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-red-400 text-sm text-center bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2 mb-4"
        >
          {error}
        </motion.p>
      )}

      <div className="flex-1 space-y-8 max-w-lg mx-auto w-full">
        {/* Player list */}
        <div className="bg-white/5 rounded-3xl p-6 border border-white/10">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Users className="w-5 h-5 text-[#1DB954]" />
              Players
            </h3>
            <span className="text-sm text-gray-400 font-medium">
              {playerList.length}/10
            </span>
          </div>

          <div className="space-y-3">
            {playerList.map((player) => (
              <motion.div
                key={player.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center justify-between bg-black/20 p-3 rounded-2xl"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#1DB954] to-blue-600 flex items-center justify-center font-bold text-lg">
                    {player.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="font-medium text-lg">{player.name}</span>
                  {player.id === myId && (
                    <span className="text-xs bg-white/10 px-2 py-1 rounded-full text-gray-300">
                      You
                    </span>
                  )}
                  {!player.connected && (
                    <span className="text-xs bg-red-500/20 px-2 py-1 rounded-full text-red-400">
                      Offline
                    </span>
                  )}
                </div>
                {player.isHost && <Crown className="w-5 h-5 text-[#FFD700]" />}
              </motion.div>
            ))}
          </div>
        </div>

        {/* Settings */}
        {isHost ? (
          <div className="bg-white/5 rounded-3xl p-6 border border-white/10 space-y-6">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Settings className="w-5 h-5 text-gray-400" />
              Game Settings
            </h3>

            <div className="space-y-4">
              <div>
                <label className="text-sm text-gray-400 font-medium mb-2 block">
                  Game Mode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {modes.map(({ value, label, desc }) => (
                    <button
                      key={value}
                      onClick={() => handleUpdateMode(value)}
                      className={`py-3 px-3 rounded-xl text-left transition-all ${
                        settings.mode === value
                          ? 'bg-[#1DB954] text-black'
                          : 'bg-black/30 text-gray-300 hover:bg-black/50'
                      }`}
                    >
                      <span className="text-sm font-bold block">{label}</span>
                      <span className={`text-[10px] block mt-0.5 ${
                        settings.mode === value ? 'text-black/60' : 'text-gray-500'
                      }`}>{desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-sm text-gray-400 font-medium">
                    Cards to Win
                  </label>
                  <span className="text-[#1DB954] font-bold">
                    {settings.cardsToWin}
                  </span>
                </div>
                <input
                  type="range"
                  min={MIN_CARDS_TO_WIN}
                  max={MAX_CARDS_TO_WIN}
                  value={settings.cardsToWin}
                  onChange={(e) => handleUpdateCards(parseInt(e.target.value))}
                  className="w-full accent-[#1DB954]"
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white/5 rounded-3xl p-6 border border-white/10">
            <div className="text-center space-y-2 text-gray-400 mb-4">
              <p className="text-sm">
                Mode: <span className="text-white font-medium">{modes.find(m => m.value === settings.mode)?.label ?? settings.mode}</span>
                {' · '}
                Cards to win: <span className="text-white font-medium">{settings.cardsToWin}</span>
              </p>
              <p className="text-xs text-gray-500">
                {modes.find(m => m.value === settings.mode)?.desc}
              </p>
            </div>
            <div className="flex flex-col items-center justify-center py-6 text-gray-400">
              <div className="animate-pulse flex space-x-2 mb-4">
                <div className="w-3 h-3 bg-[#1DB954] rounded-full" />
                <div className="w-3 h-3 bg-[#1DB954] rounded-full" style={{ animationDelay: '200ms' }} />
                <div className="w-3 h-3 bg-[#1DB954] rounded-full" style={{ animationDelay: '400ms' }} />
              </div>
              <p className="font-medium">Waiting for host to start...</p>
            </div>
          </div>
        )}
      </div>

      {isHost && (
        <div className="mt-6 max-w-lg mx-auto w-full">
          <button
            onClick={handleStart}
            disabled={playerList.length < MIN_PLAYERS}
            className="w-full bg-[#1DB954] hover:bg-[#1ed760] disabled:opacity-50 disabled:hover:bg-[#1DB954] text-black font-black text-xl py-5 rounded-2xl flex items-center justify-center gap-2 shadow-[0_0_30px_rgba(29,185,84,0.4)] transition-all transform active:scale-95"
          >
            <Play className="w-6 h-6 fill-current" />
            START GAME
          </button>
        </div>
      )}
    </div>
  );
}
