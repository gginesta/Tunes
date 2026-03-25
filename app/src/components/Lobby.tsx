import { useState } from 'react';
import { Users, Crown, Settings, LogOut, Play, Music, ListMusic, Link, Share2, Check } from 'lucide-react';
import { motion } from 'motion/react';
import { getSocket, clearSession } from '../services/socket';
import { useGameStore } from '../store';
import { requestActivation } from '../services/spotifyPlayer';
import type { GameMode, SongPack } from '@hitster/shared';
import { MIN_CARDS_TO_WIN, MAX_CARDS_TO_WIN, MIN_PLAYERS } from '@hitster/shared';

const AVAILABLE_DECADES = [
  { value: 1950, label: '50s' },
  { value: 1960, label: '60s' },
  { value: 1970, label: '70s' },
  { value: 1980, label: '80s' },
  { value: 1990, label: '90s' },
  { value: 2000, label: '00s' },
  { value: 2010, label: '10s' },
  { value: 2020, label: '20s' },
];

/** Curated Spotify playlists for genre packs */
const GENRE_PACKS = [
  { label: 'Summer Hits', icon: '\u2600', playlistId: '37i9dQZF1DXdwTUxmGKrdN' },
  { label: 'Movie Soundtracks', icon: '\uD83C\uDFAC', playlistId: '37i9dQZF1DX4dyzvuaRJ0n' },
  { label: 'Rock Classics', icon: '\uD83E\uDD18', playlistId: '37i9dQZF1DWXRqgorJj26U' },
  { label: 'Hip-Hop', icon: '\uD83C\uDFA4', playlistId: '37i9dQZF1DX48TTZL62Yht' },
  { label: 'Latin Hits', icon: '\uD83D\uDD25', playlistId: '37i9dQZF1DX10zKzsJ2jva' },
];

export function Lobby() {
  const players = useGameStore((s) => s.players);
  const myId = useGameStore((s) => s.myId);
  const roomCode = useGameStore((s) => s.roomCode);
  const hostId = useGameStore((s) => s.hostId);
  const settings = useGameStore((s) => s.settings);
  const error = useGameStore((s) => s.error);
  const reset = useGameStore((s) => s.reset);
  const spotifyToken = useGameStore((s) => s.spotifyToken);

  const isHost = hostId === myId;
  const hasSpotify = !!spotifyToken;
  const playerList = Object.values(players);
  const socket = getSocket();

  const [playlistInput, setPlaylistInput] = useState(settings.playlistUrl || '');
  const [copied, setCopied] = useState(false);

  const handleCopyInviteLink = async () => {
    const link = `${window.location.origin}/join/${roomCode}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: do nothing
    }
  };

  const handleLeave = () => {
    socket.emit('leave-room');
    clearSession();
    reset();
  };

  const handleStart = () => {
    requestActivation();
    socket.emit('start-game');
  };

  const handleUpdateMode = (mode: GameMode) => {
    socket.emit('update-settings', { mode });
  };

  const handleUpdateCards = (cardsToWin: number) => {
    socket.emit('update-settings', { cardsToWin });
  };

  const handleSetSongPack = (songPack: SongPack) => {
    socket.emit('update-settings', { songPack, decades: undefined, playlistUrl: undefined });
  };

  const handleToggleDecade = (decade: number) => {
    const current = settings.decades || [];
    const next = current.includes(decade)
      ? current.filter((d) => d !== decade)
      : [...current, decade];
    socket.emit('update-settings', { songPack: 'decades', decades: next });
  };

  const handleSelectGenrePack = (playlistId: string) => {
    const url = `https://open.spotify.com/playlist/${playlistId}`;
    setPlaylistInput(url);
    socket.emit('update-settings', { songPack: 'playlist', playlistUrl: url });
  };

  const handlePlaylistUrlChange = (url: string) => {
    setPlaylistInput(url);
    socket.emit('update-settings', { songPack: 'playlist', playlistUrl: url });
  };

  const modes: { value: GameMode; label: string; desc: string }[] = [
    { value: 'original', label: 'Original', desc: 'Place correctly to keep the card' },
    { value: 'pro', label: 'Pro', desc: 'Must also name the song' },
    { value: 'expert', label: 'Expert', desc: 'Name song + guess exact year' },
    { value: 'coop', label: 'Co-op', desc: 'Shared timeline, work together' },
  ];

  const songPackLabel = settings.songPack === 'standard'
    ? 'Standard Mix'
    : settings.songPack === 'decades'
      ? `Decades: ${(settings.decades || []).sort().map(d => `${d}s`).join(', ') || 'None'}`
      : 'Spotify Playlist';

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
          <button
            onClick={handleCopyInviteLink}
            className="mt-1.5 flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 mx-auto"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-[#1DB954]" />
                <span className="text-[#1DB954]">Copied!</span>
              </>
            ) : (
              <>
                <Share2 className="w-3.5 h-3.5" />
                Copy Invite Link
              </>
            )}
          </button>
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

      <div className="flex-1 space-y-8 max-w-lg mx-auto w-full overflow-y-auto">
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
          </div>
        )}

        {/* Song Packs — host only, Spotify required */}
        {isHost && hasSpotify ? (
          <div className="bg-white/5 rounded-3xl p-6 border border-white/10 space-y-5">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Music className="w-5 h-5 text-[#1DB954]" />
              Song Source
            </h3>

            {/* Pack type selector */}
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => handleSetSongPack('standard')}
                className={`py-3 px-2 rounded-xl text-center transition-all ${
                  settings.songPack === 'standard'
                    ? 'bg-[#1DB954] text-black'
                    : 'bg-black/30 text-gray-300 hover:bg-black/50'
                }`}
              >
                <ListMusic className={`w-5 h-5 mx-auto mb-1 ${settings.songPack === 'standard' ? 'text-black' : ''}`} />
                <span className="text-xs font-bold block">Standard</span>
              </button>
              <button
                onClick={() => handleSetSongPack('decades')}
                className={`py-3 px-2 rounded-xl text-center transition-all ${
                  settings.songPack === 'decades'
                    ? 'bg-[#1DB954] text-black'
                    : 'bg-black/30 text-gray-300 hover:bg-black/50'
                }`}
              >
                <span className={`text-lg block ${settings.songPack === 'decades' ? 'text-black' : ''}`}>#</span>
                <span className="text-xs font-bold block">Decades</span>
              </button>
              <button
                onClick={() => handleSetSongPack('playlist')}
                className={`py-3 px-2 rounded-xl text-center transition-all ${
                  settings.songPack === 'playlist'
                    ? 'bg-[#1DB954] text-black'
                    : 'bg-black/30 text-gray-300 hover:bg-black/50'
                }`}
              >
                <Link className={`w-5 h-5 mx-auto mb-1 ${settings.songPack === 'playlist' ? 'text-black' : ''}`} />
                <span className="text-xs font-bold block">Playlist</span>
              </button>
            </div>

            {/* Decade chips */}
            {settings.songPack === 'decades' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="space-y-2"
              >
                <label className="text-xs text-gray-400 font-medium block">
                  Select decades (pick at least one)
                </label>
                <div className="flex flex-wrap gap-2">
                  {AVAILABLE_DECADES.map(({ value, label }) => {
                    const selected = (settings.decades || []).includes(value);
                    return (
                      <button
                        key={value}
                        onClick={() => handleToggleDecade(value)}
                        className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${
                          selected
                            ? 'bg-[#1DB954] text-black'
                            : 'bg-black/30 text-gray-300 hover:bg-black/50'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {/* Playlist input + genre presets */}
            {settings.songPack === 'playlist' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="space-y-3"
              >
                {/* Genre presets */}
                <label className="text-xs text-gray-400 font-medium block">
                  Genre Packs
                </label>
                <div className="flex flex-wrap gap-2">
                  {GENRE_PACKS.map(({ label, icon, playlistId }) => {
                    const isActive = playlistInput.includes(playlistId);
                    return (
                      <button
                        key={playlistId}
                        onClick={() => handleSelectGenrePack(playlistId)}
                        className={`px-3 py-2 rounded-full text-sm font-bold transition-all flex items-center gap-1.5 ${
                          isActive
                            ? 'bg-[#1DB954] text-black'
                            : 'bg-black/30 text-gray-300 hover:bg-black/50'
                        }`}
                      >
                        <span>{icon}</span>
                        {label}
                      </button>
                    );
                  })}
                </div>

                <div className="relative">
                  <label className="text-xs text-gray-400 font-medium block mb-1">
                    Or paste a Spotify playlist link
                  </label>
                  <input
                    type="text"
                    placeholder="https://open.spotify.com/playlist/..."
                    value={playlistInput}
                    onChange={(e) => handlePlaylistUrlChange(e.target.value)}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#1DB954] transition-all"
                  />
                </div>
              </motion.div>
            )}

            {settings.songPack === 'standard' && (
              <p className="text-xs text-gray-500">
                500+ songs spanning 1950s–2020s, balanced across decades
              </p>
            )}
          </div>
        ) : isHost ? null : (
          /* Non-host: show what the host picked */
          settings.songPack !== 'standard' && (
            <div className="bg-white/5 rounded-3xl p-4 border border-white/10">
              <p className="text-sm text-gray-400 text-center">
                <Music className="w-4 h-4 inline-block mr-1 -mt-0.5" />
                {songPackLabel}
              </p>
            </div>
          )
        )}

        {/* Non-host waiting message */}
        {!isHost && (
          <div className="bg-white/5 rounded-3xl p-6 border border-white/10">
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
            disabled={playerList.length < MIN_PLAYERS || (settings.songPack === 'decades' && (!settings.decades || settings.decades.length === 0))}
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
