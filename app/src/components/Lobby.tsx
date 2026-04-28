import { useState, useCallback, useEffect } from 'react';
import { Users, Crown, Settings, LogOut, Play, Music, ListMusic, Link, Share2, Check, Globe, CheckCircle, XCircle, ArrowDownToLine } from 'lucide-react';
import { motion } from 'motion/react';
import { getSocket, clearSession } from '../services/socket';
import { useGameStore } from '../store';
import { requestActivation, preUnlockAudio } from '../services/spotifyPlayer';
import { refreshAccessToken } from '../services/spotify';
import type { GameMode, SongPack, SongGenre, SongRegion } from '@tunes/shared';
import { MIN_CARDS_TO_WIN, MAX_CARDS_TO_WIN, MIN_PLAYERS } from '@tunes/shared';

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

const AVAILABLE_GENRES: { value: SongGenre; label: string }[] = [
  { value: 'rock', label: 'Rock' },
  { value: 'pop', label: 'Pop' },
  { value: 'hip-hop', label: 'Hip-Hop' },
  { value: 'r-and-b', label: 'R&B' },
  { value: 'country', label: 'Country' },
  { value: 'electronic', label: 'Electronic' },
  { value: 'jazz', label: 'Jazz' },
  { value: 'latin', label: 'Latin' },
];

const AVAILABLE_REGIONS: { value: SongRegion; label: string }[] = [
  { value: 'uk', label: 'UK' },
  { value: 'latin', label: 'Latin' },
  { value: 'kpop', label: 'K-Pop' },
  { value: 'bollywood', label: 'Bollywood' },
];

/** Curated Spotify playlists for genre packs */
const GENRE_PACKS = [
  { label: 'Summer Hits', icon: '\u2600', playlistId: '37i9dQZF1DXdwTUxmGKrdN', color: 'from-amber-500 to-orange-600' },
  { label: 'Movie Soundtracks', icon: '\uD83C\uDFAC', playlistId: '37i9dQZF1DX4dyzvuaRJ0n', color: 'from-purple-600 to-indigo-700' },
  { label: 'Rock Classics', icon: '\uD83E\uDD18', playlistId: '37i9dQZF1DWXRqgorJj26U', color: 'from-red-600 to-rose-800' },
  { label: 'Hip-Hop', icon: '\uD83C\uDFA4', playlistId: '37i9dQZF1DX48TTZL62Yht', color: 'from-yellow-500 to-amber-700' },
  { label: 'Latin Hits', icon: '\uD83D\uDD25', playlistId: '37i9dQZF1DX10zKzsJ2jva', color: 'from-pink-500 to-red-600' },
  { label: '90s Throwback', icon: '\uD83D\uDCFC', playlistId: '37i9dQZF1DXbTxRt5MxAvz', color: 'from-cyan-500 to-blue-600' },
  { label: 'Indie Hits', icon: '\uD83C\uDF3B', playlistId: '37i9dQZF1DX2Nc3B70tvx0', color: 'from-emerald-500 to-teal-700' },
  { label: 'All-Time Greatest', icon: '\uD83C\uDFC6', playlistId: '37i9dQZF1DXcBWIGoYBM5M', color: 'from-yellow-400 to-yellow-600' },
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
  const [playlistImported, setPlaylistImported] = useState(!!settings.playlistUrl);
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);

  // Reset starting state when an error arrives from the server
  useEffect(() => {
    if (error) setStarting(false);
  }, [error]);

  /** Check if a string looks like a valid Spotify playlist URL/URI */
  const isValidPlaylistUrl = useCallback((url: string): boolean => {
    if (!url.trim()) return false;
    return /open\.spotify\.com\/playlist\/[a-zA-Z0-9]+/.test(url)
      || /spotify:playlist:[a-zA-Z0-9]+/.test(url);
  }, []);

  const handleCopyInviteLink = async () => {
    const link = `${window.location.origin}/join/${roomCode}`;
    try {
      // Use native share sheet on mobile — opens as overlay, no app switch needed
      if (navigator.share) {
        await navigator.share({ title: 'Join my Tunes game!', text: `Room code: ${roomCode}`, url: link });
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // User cancelled share or clipboard failed — try clipboard as fallback
      try {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch { /* nothing */ }
    }
  };

  const handleLeave = () => {
    socket.emit('leave-room');
    clearSession();
    reset();
  };

  const handleStart = async () => {
    // Pre-unlock audio synchronously from the click gesture BEFORE any async work
    preUnlockAudio();
    requestActivation();
    setStarting(true);
    useGameStore.getState().setError(null);

    // Refresh Spotify token before starting to handle expiry
    let freshToken: string | undefined;
    if (spotifyToken) {
      try {
        const savedRefresh = localStorage.getItem('spotify_refresh_token');
        if (savedRefresh) {
          const result = await refreshAccessToken(savedRefresh);
          useGameStore.setState({
            spotifyToken: result.accessToken,
            spotifyRefreshToken: result.refreshToken,
          });
          localStorage.setItem('spotify_refresh_token', result.refreshToken);
          freshToken = result.accessToken;
        }
      } catch {
        // Token refresh failed — try with the existing token
      }
    }

    socket.emit('start-game', freshToken ? { spotifyAccessToken: freshToken } : undefined);
    // Reset starting state after a timeout in case server doesn't respond
    setTimeout(() => setStarting(false), 10000);
  };

  const handleUpdateMode = (mode: GameMode) => {
    socket.emit('update-settings', { mode });
  };

  const handleUpdateCards = (cardsToWin: number) => {
    socket.emit('update-settings', { cardsToWin });
  };

  const handleSetSongPack = (songPack: SongPack) => {
    socket.emit('update-settings', { songPack, decades: undefined, genres: undefined, playlistUrl: undefined });
  };

  const handleToggleDecade = (decade: number) => {
    const current = settings.decades || [];
    const next = current.includes(decade)
      ? current.filter((d) => d !== decade)
      : [...current, decade];
    const pack = settings.songPack === 'genre-decade' ? 'genre-decade' : 'decades';
    socket.emit('update-settings', { songPack: pack, decades: next });
  };

  const handleToggleGenre = (genre: SongGenre) => {
    const current = settings.genres || [];
    const next = current.includes(genre)
      ? current.filter((g) => g !== genre)
      : [...current, genre];
    socket.emit('update-settings', { genres: next });
  };

  const handleToggleRegion = (region: SongRegion) => {
    const current = settings.regions || [];
    const next = current.includes(region)
      ? current.filter((r) => r !== region)
      : [...current, region];
    socket.emit('update-settings', { regions: next });
  };

  const handleSelectGenrePack = (playlistId: string) => {
    const url = `https://open.spotify.com/playlist/${playlistId}`;
    setPlaylistInput(url);
    setPlaylistImported(true);
    socket.emit('update-settings', { songPack: 'playlist', playlistUrl: url });
  };

  const handlePlaylistUrlChange = (url: string) => {
    setPlaylistInput(url);
    setPlaylistImported(false);
  };

  const handleImportPlaylist = () => {
    if (!isValidPlaylistUrl(playlistInput)) return;
    setPlaylistImported(true);
    socket.emit('update-settings', { songPack: 'playlist', playlistUrl: playlistInput });
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
      : settings.songPack === 'genre'
        ? `Genre: ${(settings.genres || []).join(', ') || 'None'}`
        : settings.songPack === 'genre-decade'
          ? `Genre+Decade`
          : 'Spotify Playlist';

  const needsGenreSelection = settings.songPack === 'genre' || settings.songPack === 'genre-decade';
  const needsDecadeSelection = settings.songPack === 'decades' || settings.songPack === 'genre-decade';

  return (
    <div className="flex flex-col min-h-screen p-6 text-white">
      <div className="flex justify-between items-center mb-8">
        <button
          onClick={handleLeave}
          className="btn-icon"
          aria-label="Leave"
        >
          <LogOut className="w-5 h-5" />
        </button>
        <div className="text-center">
          <p className="text-[10px] text-neon-cyan uppercase tracking-[0.3em] font-bold mb-1">
            ROOM CODE
          </p>
          <h2 className="font-display text-5xl tracking-widest text-neon-pink text-glow-pink leading-none">
            {roomCode}
          </h2>
          <button
            onClick={handleCopyInviteLink}
            className="mt-2 inline-flex items-center gap-1.5 text-xs text-white/65 hover:text-white transition-colors px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-neon-pink" />
                <span className="text-neon-pink">Copied!</span>
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

      <div className="flex-1 space-y-6 max-w-lg mx-auto w-full overflow-y-auto">
        {/* Player list */}
        <div className="panel p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[10px] uppercase tracking-[0.3em] font-bold text-white/50 flex items-center gap-2">
              <Users className="w-4 h-4 text-neon-pink" />
              PLAYERS · {playerList.length}/12
            </h3>
          </div>

          <div className="space-y-2">
            {playerList.map((player) => (
              <motion.div
                key={player.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center justify-between bg-black/25 p-3 rounded-xl border border-white/[0.04]"
              >
                <div className="flex items-center gap-3">
                  <div className="avatar">
                    {player.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="font-medium text-base">{player.name}</span>
                  {player.id === myId && (
                    <span className="chip chip-mode-cyan text-[9px]">YOU</span>
                  )}
                  {!player.connected && (
                    <span className="text-[9px] bg-red-500/20 border border-red-500/30 px-2 py-0.5 rounded-full text-red-400 font-bold uppercase tracking-wider">
                      Offline
                    </span>
                  )}
                </div>
                {player.isHost && <Crown className="w-5 h-5 text-neon-amber" />}
              </motion.div>
            ))}
          </div>
        </div>

        {/* Settings */}
        {isHost ? (
          <div className="panel p-5 space-y-6">
            <h3 className="text-[10px] uppercase tracking-[0.3em] font-bold text-white/50 flex items-center gap-2">
              <Settings className="w-5 h-5 text-gray-400" />
              Game Settings
            </h3>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-white/60 font-bold uppercase tracking-wider mb-2 block">
                  Game Mode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {modes.map(({ value, label, desc }) => (
                    <button
                      key={value}
                      onClick={() => handleUpdateMode(value)}
                      className={`py-3 px-3 rounded-xl text-left transition-all ${
                        settings.mode === value
                          ? 'bg-neon-pink text-[#0a0318] glow-pink'
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
                  <label className="text-xs text-white/60 font-bold uppercase tracking-wider">
                    Cards to Win
                  </label>
                  <span className="text-neon-amber font-display text-2xl tabular-nums">
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
          <div className="panel p-5">
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

        {/* Song Packs — host only */}
        {isHost && hasSpotify ? (
          <div className="panel p-5 space-y-5">
            <h3 className="text-[10px] uppercase tracking-[0.3em] font-bold text-white/50 flex items-center gap-2">
              <Music className="w-5 h-5 text-neon-pink" />
              Song Source
            </h3>

            {/* Pack type selector */}
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => handleSetSongPack('standard')}
                className={`py-3 px-2 rounded-xl text-center transition-all ${
                  settings.songPack === 'standard'
                    ? 'bg-neon-pink text-[#0a0318] glow-pink'
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
                    ? 'bg-neon-pink text-[#0a0318] glow-pink'
                    : 'bg-black/30 text-gray-300 hover:bg-black/50'
                }`}
              >
                <span className={`text-lg block ${settings.songPack === 'decades' ? 'text-black' : ''}`}>#</span>
                <span className="text-xs font-bold block">Decades</span>
              </button>
              <button
                onClick={() => handleSetSongPack('genre')}
                className={`py-3 px-2 rounded-xl text-center transition-all ${
                  settings.songPack === 'genre'
                    ? 'bg-neon-pink text-[#0a0318] glow-pink'
                    : 'bg-black/30 text-gray-300 hover:bg-black/50'
                }`}
              >
                <Music className={`w-5 h-5 mx-auto mb-1 ${settings.songPack === 'genre' ? 'text-black' : ''}`} />
                <span className="text-xs font-bold block">By Genre</span>
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleSetSongPack('genre-decade')}
                className={`py-3 px-2 rounded-xl text-center transition-all ${
                  settings.songPack === 'genre-decade'
                    ? 'bg-neon-pink text-[#0a0318] glow-pink'
                    : 'bg-black/30 text-gray-300 hover:bg-black/50'
                }`}
              >
                <span className={`text-xs font-bold block ${settings.songPack === 'genre-decade' ? 'text-black' : ''}`}>Genre + Decade</span>
              </button>
              <button
                onClick={() => handleSetSongPack('playlist')}
                className={`py-3 px-2 rounded-xl text-center transition-all ${
                  settings.songPack === 'playlist'
                    ? 'bg-neon-pink text-[#0a0318] glow-pink'
                    : 'bg-black/30 text-gray-300 hover:bg-black/50'
                }`}
              >
                <Link className={`w-5 h-5 mx-auto mb-1 ${settings.songPack === 'playlist' ? 'text-black' : ''}`} />
                <span className="text-xs font-bold block">Playlist</span>
              </button>
            </div>

            {/* Genre chips */}
            {needsGenreSelection && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="space-y-2"
              >
                <label className="text-xs text-white/55 font-bold uppercase tracking-wider block">
                  Select genres (pick at least one)
                </label>
                <div className="flex flex-wrap gap-2">
                  {AVAILABLE_GENRES.map(({ value, label }) => {
                    const selected = (settings.genres || []).includes(value);
                    return (
                      <button
                        key={value}
                        onClick={() => handleToggleGenre(value)}
                        className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${
                          selected
                            ? 'bg-neon-pink text-[#0a0318] glow-pink'
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

            {/* Decade chips */}
            {needsDecadeSelection && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="space-y-2"
              >
                <label className="text-xs text-white/55 font-bold uppercase tracking-wider block">
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
                            ? 'bg-neon-pink text-[#0a0318] glow-pink'
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
                className="space-y-4"
              >
                {/* Genre presets as album-art-style cards */}
                <label className="text-xs text-white/55 font-bold uppercase tracking-wider block">
                  Quick Pick a Playlist
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {GENRE_PACKS.map(({ label, icon, playlistId, color }) => {
                    const isActive = playlistInput.includes(playlistId);
                    return (
                      <button
                        key={playlistId}
                        onClick={() => handleSelectGenrePack(playlistId)}
                        className={`relative overflow-hidden rounded-2xl p-4 text-left transition-all transform hover:scale-[1.02] active:scale-95 ${
                          isActive
                            ? 'ring-2 ring-neon-pink ring-offset-2 ring-offset-bg-base'
                            : ''
                        }`}
                      >
                        <div className={`absolute inset-0 bg-gradient-to-br ${color} opacity-${isActive ? '100' : '80'}`} />
                        <div className="relative z-10">
                          <span className="text-2xl block mb-1">{icon}</span>
                          <span className="text-sm font-bold text-white block leading-tight">{label}</span>
                        </div>
                        {isActive && (
                          <div className="absolute top-2 right-2 z-10">
                            <CheckCircle className="w-5 h-5 text-white drop-shadow" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-white/55 font-bold uppercase tracking-wider block">
                    Or paste a Spotify playlist link
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type="search"
                        placeholder="https://open.spotify.com/playlist/..."
                        value={playlistInput}
                        onChange={(e) => handlePlaylistUrlChange(e.target.value)}
                        onBlur={handleImportPlaylist}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleImportPlaylist(); }}
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        className={`w-full bg-black/30 border rounded-xl px-4 py-3 pr-10 text-sm text-white placeholder-gray-500 focus:outline-none transition-all ${
                          playlistInput.trim() === ''
                            ? 'border-white/10'
                            : isValidPlaylistUrl(playlistInput)
                              ? 'border-green-500/50'
                              : 'border-red-500/50'
                        }`}
                      />
                      {playlistInput.trim() !== '' && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          {isValidPlaylistUrl(playlistInput) ? (
                            <CheckCircle className="w-4 h-4 text-green-500" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-500" />
                          )}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={handleImportPlaylist}
                      disabled={!isValidPlaylistUrl(playlistInput)}
                      className="px-4 py-3 rounded-xl bg-neon-pink hover:bg-[#ff6bd1] disabled:opacity-40 disabled:hover:bg-neon-pink text-black font-bold text-sm transition-all flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <ArrowDownToLine className="w-4 h-4" />
                      Import
                    </button>
                  </div>
                  {playlistImported && isValidPlaylistUrl(playlistInput) && (
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-xs text-green-400 flex items-center gap-1.5"
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                      Playlist loaded — ready to start
                    </motion.p>
                  )}
                  {playlistInput.trim() !== '' && !isValidPlaylistUrl(playlistInput) && (
                    <p className="text-xs text-red-400">
                      Enter a valid Spotify playlist URL (e.g. https://open.spotify.com/playlist/...)
                    </p>
                  )}
                </div>
              </motion.div>
            )}

            {settings.songPack === 'standard' && (
              <p className="text-xs text-gray-500">
                500+ songs spanning 1950s-2020s, balanced across decades
              </p>
            )}

            {/* Regional Packs — combine with any song pack */}
            <div className="space-y-2 pt-2 border-t border-white/10">
              <label className="text-xs text-white/55 font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5" />
                Regional Packs (optional, combines with selection above)
              </label>
              <div className="flex flex-wrap gap-2">
                {AVAILABLE_REGIONS.map(({ value, label }) => {
                  const selected = (settings.regions || []).includes(value);
                  return (
                    <button
                      key={value}
                      onClick={() => handleToggleRegion(value)}
                      className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${
                        selected
                          ? 'bg-neon-pink text-[#0a0318] glow-pink'
                          : 'bg-black/30 text-gray-300 hover:bg-black/50'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-gray-500">
                Select regions to include songs from those regions. Leave empty to include all.
              </p>
            </div>
          </div>
        ) : isHost && !hasSpotify ? (
          <div className="panel p-5 space-y-5">
            <h3 className="text-[10px] uppercase tracking-[0.3em] font-bold text-white/50 flex items-center gap-2">
              <Music className="w-5 h-5 text-neon-pink" />
              Song Source
            </h3>

            <p className="text-xs text-amber-400/80 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
              Preview mode: 30-second clips from the built-in song library
            </p>

            {/* Pack type selector — no playlist option */}
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => handleSetSongPack('standard')}
                className={`py-3 px-2 rounded-xl text-center transition-all ${
                  settings.songPack === 'standard'
                    ? 'bg-neon-pink text-[#0a0318] glow-pink'
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
                    ? 'bg-neon-pink text-[#0a0318] glow-pink'
                    : 'bg-black/30 text-gray-300 hover:bg-black/50'
                }`}
              >
                <span className={`text-lg block ${settings.songPack === 'decades' ? 'text-black' : ''}`}>#</span>
                <span className="text-xs font-bold block">Decades</span>
              </button>
              <button
                onClick={() => handleSetSongPack('genre')}
                className={`py-3 px-2 rounded-xl text-center transition-all ${
                  settings.songPack === 'genre'
                    ? 'bg-neon-pink text-[#0a0318] glow-pink'
                    : 'bg-black/30 text-gray-300 hover:bg-black/50'
                }`}
              >
                <Music className={`w-5 h-5 mx-auto mb-1 ${settings.songPack === 'genre' ? 'text-black' : ''}`} />
                <span className="text-xs font-bold block">By Genre</span>
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2">
              <button
                onClick={() => handleSetSongPack('genre-decade')}
                className={`py-3 px-2 rounded-xl text-center transition-all ${
                  settings.songPack === 'genre-decade'
                    ? 'bg-neon-pink text-[#0a0318] glow-pink'
                    : 'bg-black/30 text-gray-300 hover:bg-black/50'
                }`}
              >
                <span className={`text-xs font-bold block ${settings.songPack === 'genre-decade' ? 'text-black' : ''}`}>Genre + Decade</span>
              </button>
            </div>

            {/* Genre chips */}
            {needsGenreSelection && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="space-y-2"
              >
                <label className="text-xs text-white/55 font-bold uppercase tracking-wider block">
                  Select genres (pick at least one)
                </label>
                <div className="flex flex-wrap gap-2">
                  {AVAILABLE_GENRES.map(({ value, label }) => {
                    const selected = (settings.genres || []).includes(value);
                    return (
                      <button
                        key={value}
                        onClick={() => handleToggleGenre(value)}
                        className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${
                          selected
                            ? 'bg-neon-pink text-[#0a0318] glow-pink'
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

            {/* Decade chips */}
            {needsDecadeSelection && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="space-y-2"
              >
                <label className="text-xs text-white/55 font-bold uppercase tracking-wider block">
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
                            ? 'bg-neon-pink text-[#0a0318] glow-pink'
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

            {settings.songPack === 'standard' && (
              <p className="text-xs text-gray-500">
                500+ songs spanning 1950s-2020s, balanced across decades
              </p>
            )}

            {/* Regional Packs — combine with any song pack */}
            <div className="space-y-2 pt-2 border-t border-white/10">
              <label className="text-xs text-white/55 font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5" />
                Regional Packs (optional, combines with selection above)
              </label>
              <div className="flex flex-wrap gap-2">
                {AVAILABLE_REGIONS.map(({ value, label }) => {
                  const selected = (settings.regions || []).includes(value);
                  return (
                    <button
                      key={value}
                      onClick={() => handleToggleRegion(value)}
                      className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${
                        selected
                          ? 'bg-neon-pink text-[#0a0318] glow-pink'
                          : 'bg-black/30 text-gray-300 hover:bg-black/50'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-gray-500">
                Select regions to include songs from those regions. Leave empty to include all.
              </p>
            </div>
          </div>
        ) : isHost ? null : (
          /* Non-host: show what the host picked */
          settings.songPack !== 'standard' && (
            <div className="panel p-4">
              <p className="text-sm text-gray-400 text-center">
                <Music className="w-4 h-4 inline-block mr-1 -mt-0.5" />
                {songPackLabel}
              </p>
            </div>
          )
        )}

        {/* Non-host waiting message */}
        {!isHost && (
          <div className="panel p-5">
            <div className="flex flex-col items-center justify-center py-6 text-gray-400">
              <div className="animate-pulse flex space-x-2 mb-4">
                <div className="w-3 h-3 bg-neon-pink rounded-full" />
                <div className="w-3 h-3 bg-neon-pink rounded-full" style={{ animationDelay: '200ms' }} />
                <div className="w-3 h-3 bg-neon-pink rounded-full" style={{ animationDelay: '400ms' }} />
              </div>
              <p className="font-medium">Waiting for host to start...</p>
            </div>
          </div>
        )}
      </div>

      {isHost && (
        <div className="mt-6 max-w-lg mx-auto w-full space-y-3">
          {error && (
            <p className="text-red-400 text-sm text-center bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2">
              {error}
            </p>
          )}

          <button
            onClick={handleStart}
            disabled={
              starting
              || playerList.length < MIN_PLAYERS
              || (needsDecadeSelection && (!settings.decades || settings.decades.length === 0))
              || (needsGenreSelection && (!settings.genres || settings.genres.length === 0))
              || (settings.songPack === 'playlist' && !settings.playlistUrl)
            }
            className="w-full bg-neon-pink hover:bg-[#ff6bd1] disabled:opacity-50 disabled:hover:bg-neon-pink text-black font-black text-xl py-5 rounded-2xl flex items-center justify-center gap-2 glow-pink transition-all transform active:scale-95"
          >
            <Play className="w-6 h-6 fill-current" />
            {starting ? 'STARTING...' : 'START GAME'}
          </button>
          {playerList.length < MIN_PLAYERS && (
            <p className="text-gray-500 text-xs text-center">
              Need at least {MIN_PLAYERS} players to start
            </p>
          )}
        </div>
      )}
    </div>
  );
}
