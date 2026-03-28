# Implementation Plan — Feature Sprint

## Status: COMPLETE (14 features + audit + preview mode + bug fixes)

---

## Feature Dependency Graph & Execution Order

Features are grouped into **4 parallel batches** based on dependencies:

```
Batch 1 (independent — can all be built in parallel):
  ├── Feature 1: Fuzzy song name matching
  ├── Feature 4: Volume control slider
  ├── Feature 5: Disconnect grace period
  └── Feature 9: Shareable invite links

Batch 2 (depends on server-side song history from Batch 1 infra):
  ├── Feature 2: Round recap / song history browser
  └── Feature 3: End-of-game stats

Batch 3 (content — independent of Batch 1-2):
  ├── Feature 6: Genre packs, decade packs, combos
  └── Feature 7: Regional packs

Batch 4 (UX — independent):
  ├── Feature 8: Better waiting state
  └── Feature 10: "I know this!" buzz button
```

---

## Feature 1: Fuzzy Song Name Matching

**Goal:** Allow minor typos, missing articles, punctuation differences when guessing song names in Pro/Expert modes.

### Changes

**`server/src/game.ts`** — Replace exact `normalize()` with fuzzy matching:
- New function `fuzzyMatch(guess: string, actual: string): boolean`
  - Normalize both: lowercase, strip punctuation, collapse whitespace
  - Strip leading articles ("the", "a", "an")
  - Use Levenshtein distance with threshold: `distance <= max(1, floor(actual.length * 0.2))`
  - Also try substring match for partial artist names (e.g. "Beatles" matches "The Beatles")
- Update `nameSong()` method: replace `normalize(guess.title) === normalize(gs.currentSong.title)` with `fuzzyMatch(guess.title, gs.currentSong.title)` (same for artist)

**`server/src/fuzzy.ts`** (new file):
- `levenshteinDistance(a: string, b: string): number` — standard DP implementation
- `normalizeName(s: string): string` — strip articles, punctuation, extra whitespace
- `fuzzyMatch(guess: string, actual: string): boolean` — combines the above
- Export for use in game.ts

**No shared type changes needed.** Server-only logic.

### Test cases to verify:
- "Beatles" ≈ "The Beatles" ✓
- "dont stop" ≈ "Don't Stop" ✓
- "Bohemain Rhapsody" ≈ "Bohemian Rhapsody" ✓ (1 char typo)
- "completely wrong" ≈ "Bohemian Rhapsody" ✗

---

## Feature 2: Round Recap / Song History Browser

**Goal:** During or after a game, let players scroll through all songs that were played.

### Changes

**`shared/src/types.ts`** — New types:
```ts
export interface PlayedSong {
  song: SongCard;
  turnPlayerId: string;
  correct: boolean;
  stolenBy: string | null;
  roundNumber: number;
}
```

**`shared/src/events.ts`** — New events:
```ts
// ServerToClientEvents:
'song-history': (data: { history: PlayedSong[] }) => void;
```

**`server/src/game.ts`**:
- Add `private songHistory: PlayedSong[] = []` array to GameEngine
- In `resolveRound()` and `resolveCoopRound()`: push to songHistory after each reveal
- Add `private roundNumber = 0` counter, increment each turn
- Add `getSongHistory(): PlayedSong[]` getter
- In `resetGame()`: clear songHistory

**`server/src/rooms.ts`**:
- On `game-over` event, emit `song-history` with the full history
- Also emit on `rejoin-room` if game is in progress

**`app/src/store.ts`**:
- Add `songHistory: PlayedSong[]` to store
- Add `setSongHistory` action

**`app/src/hooks/useSocket.ts`**:
- Listen for `song-history` event

**`app/src/components/SongHistory.tsx`** (new):
- Scrollable modal/drawer showing all played songs
- Each entry: song title, artist, year, who played it, correct/incorrect badge
- Accessible from Game screen (icon button) and Results screen

**`app/src/components/Game.tsx`** and **`Results.tsx`**:
- Add button to open SongHistory modal

---

## Feature 3: End-of-Game Stats

**Goal:** Show "Fastest correct placement", "Most challenges won", "Best decade accuracy", "Longest streak" on results screen.

### Changes

**`shared/src/types.ts`** — New types:
```ts
export interface PlayerStats {
  correctPlacements: number;
  totalPlacements: number;
  challengesWon: number;
  challengesLost: number;
  longestStreak: number;
  fastestPlacementMs: number | null;
  decadeAccuracy: Record<number, { correct: number; total: number }>;
  songsNamed: number;
}

export interface GameStats {
  playerStats: Record<string, PlayerStats>;
  totalRounds: number;
}
```

**`shared/src/events.ts`**:
```ts
// ServerToClientEvents:
'game-stats': (data: GameStats) => void;
```

**`server/src/game.ts`**:
- Add `private stats: Record<string, PlayerStats>` initialized per player at game start
- Track in `resolveRound()`: correct/incorrect, streak, decade accuracy
- Track timing: record `turnStartTime` in `startTurn()`, compute duration in `placeCard()`
- Track challenges: increment `challengesWon`/`Lost` based on resolve outcome
- Emit `game-stats` alongside `game-over`

**`app/src/store.ts`**:
- Add `gameStats: GameStats | null` to store

**`app/src/components/Results.tsx`**:
- Add stats section below rankings:
  - "Awards" cards with icons:
    - ⚡ Fastest Fingers: player with lowest fastestPlacementMs
    - 🎯 Decade Expert: player with highest overall accuracy
    - 🔥 Hot Streak: player with longest streak
    - 🏴‍☠️ Master Challenger: player with most challenges won
    - 🎵 Name That Tune: player with most songs named
  - Show personal stats breakdown per player

---

## Feature 4: Volume Control Slider

**Goal:** Add adjustable music volume slider in game screen.

### Changes

**`app/src/store.ts`**:
- Add `volume: number` (default 0.8) to store
- Add `setVolume: (volume: number) => void` action
- Persist volume in localStorage

**`app/src/services/spotifyPlayer.ts`**:
- Add `setVolume(volume: number)` function that calls `player.setVolume(volume)`
- Call it whenever volume changes

**`app/src/services/audioFallback.ts`**:
- Update audio element volume when store volume changes

**`app/src/hooks/useSpotifyPlayer.ts`**:
- Subscribe to volume changes, call `setVolume` on the Spotify player instance

**`app/src/components/Game.tsx`**:
- Add volume slider next to the mute toggle button
- Use `<input type="range" min="0" max="1" step="0.05">` styled with Tailwind
- Show Volume2/Volume1/VolumeX icon based on level
- Mute button sets volume to 0, remembers previous volume

---

## Feature 5: Disconnect Grace Period

**Goal:** If a player disconnects mid-game, give them 30-60s to rejoin before skipping their turn.

### Changes

**`shared/src/constants.ts`**:
```ts
export const DISCONNECT_GRACE_MS = 30000; // 30 seconds
```

**`server/src/rooms.ts`**:
- Add `disconnectTimers: Map<string, ReturnType<typeof setTimeout>>` — keyed by `roomCode:playerId`
- In `handleLeave()`: instead of immediately calling `engine.handlePlayerDisconnect()`, start a grace period timer
- Emit `player-disconnected` (with `gracePeriodMs`) to room instead of `player-left`
- If player rejoins within grace period (in `rejoin-room`): clear the timer, emit `player-reconnected`
- If timer expires: call `engine.handlePlayerDisconnect()`, emit `player-timed-out`

**`shared/src/events.ts`** — New events:
```ts
// ServerToClientEvents:
'player-disconnected': (data: { playerId: string; gracePeriodMs: number }) => void;
'player-reconnected': (data: { playerId: string }) => void;
'player-timed-out': (data: { playerId: string }) => void;
```

**`app/src/hooks/useSocket.ts`**:
- Listen for new events, update player state

**`app/src/components/Game.tsx`**:
- Show "Player X disconnected — waiting 30s..." banner with countdown when a player disconnects
- If it's the disconnected player's turn, show waiting state instead of timer
- On reconnect, clear the banner

---

## Feature 6: Genre Packs, Decade Packs, Genre+Decade Combos

**Goal:** Let host pick genre/decade filters from the lobby.

### Changes

**`data/songs.json`** — Add `genre` field to song entries:
- Script to tag existing 500+ songs with genres: `data/tag-genres.ts`
- Categories: rock, pop, hip-hop, r-and-b, country, electronic, jazz, classical, latin, other

**`shared/src/types.ts`**:
```ts
export type SongGenre = 'rock' | 'pop' | 'hip-hop' | 'r-and-b' | 'country' | 'electronic' | 'jazz' | 'classical' | 'latin' | 'other';

export interface SongData {
  title: string;
  artist: string;
  year: number;
  genre?: SongGenre;     // NEW
  region?: string;       // NEW (for Feature 7)
}

export type SongPack = 'standard' | 'decades' | 'playlist' | 'genre' | 'genre-decade';

export interface GameSettings {
  mode: GameMode;
  cardsToWin: number;
  songPack: SongPack;
  decades?: number[];
  genres?: SongGenre[];       // NEW
  playlistUrl?: string;
}
```

**`server/src/songs.ts`**:
- Update `selectGameDeck()` to accept `genres?: SongGenre[]` parameter
- Filter by genre before decade-balanced selection
- Combined genre+decade: filter by both

**`server/src/rooms.ts`**:
- Pass `genres` from settings to `selectGameDeck()`

**`app/src/components/Lobby.tsx`**:
- Add "Song Pack" selector with options: Standard, By Decade, By Genre, Genre+Decade, Playlist
- Genre picker: multi-select chips for each genre
- Decade picker already exists — show alongside genre picker for combo mode

---

## Feature 7: Regional Packs

**Goal:** Add UK, Latin, K-pop, Bollywood song collections.

### Changes

**`data/songs-regional.json`** (new file) or extend `data/songs.json`**:
- Add ~50-100 songs per region with `region` field:
  - `"uk"` — British chart hits
  - `"latin"` — Latin music (reggaeton, salsa, etc.)
  - `"kpop"` — Korean pop
  - `"bollywood"` — Indian film music
- Each entry: `{ title, artist, year, genre, region }`

**`shared/src/types.ts`**:
```ts
export type SongRegion = 'global' | 'uk' | 'latin' | 'kpop' | 'bollywood';

export interface GameSettings {
  // ... existing fields ...
  regions?: SongRegion[];    // NEW
}
```

**`server/src/songs.ts`**:
- Load regional songs alongside main songs
- Update `selectGameDeck()` to accept `regions?: SongRegion[]`
- Default region for existing songs: `'global'`

**`app/src/components/Lobby.tsx`**:
- Add regional pack selector (multi-select chips)
- Show alongside genre/decade pickers

---

## Feature 8: Better Waiting State

**Goal:** When it's not your turn, show engaging content instead of an empty screen.

### Changes

**`app/src/components/WaitingState.tsx`** (new):
- Rotating content shown to non-active players during `playing` phase:
  1. **Music trivia question** — Random trivia from a static pool (e.g. "What year was the first Grammy awarded?" with multiple choice)
  2. **Fun facts** — About the current decade being played, music history
  3. **Audio visualizer** — Animated bars/waves synced to music (CSS animation, no actual audio analysis needed)
  4. **Player standings** — Mini scoreboard showing current card counts
- Cycle between these every 8-10 seconds with fade transitions
- Touch/click to skip to next content

**`app/src/data/trivia.ts`** (new):
- Static array of ~50 trivia questions with answers
- Structure: `{ question: string, options: string[], correctIndex: number, funFact: string }`

**`app/src/components/Game.tsx`**:
- When `!isMyTurn && phase === 'playing'`: render `<WaitingState />` instead of the current minimal waiting UI
- Still show the turn timer and current player indicator above the waiting content

---

## Feature 9: Shareable Invite Links

**Goal:** Generate links like `tunes.app/join/ABCD` for easy sharing.

### Changes

**`app/src/App.tsx`**:
- Parse URL on load: if path matches `/join/:code`, auto-populate room code and navigate to join flow
- Use `window.location.pathname` (no need for a router library)

**`app/src/components/Lobby.tsx`**:
- Add "Share Invite" button that copies link to clipboard
- Use `navigator.clipboard.writeText()` with fallback
- Show toast "Link copied!" on success
- Link format: `${window.location.origin}/join/${roomCode}`

**`app/src/components/Home.tsx`**:
- Accept `initialRoomCode` prop
- If provided, auto-switch to join mode and pre-fill the code

**`server/src/index.ts`**:
- The catch-all route `app.get('*')` already serves `index.html` for all paths in production
- No server changes needed — client-side routing handles it

---

## Feature 10: "I Know This!" Buzz Button

**Goal:** Non-active players can tap a button to signal they know the song (fun/bragging, no game effect).

### Changes

**`shared/src/events.ts`** — New events:
```ts
// ClientToServerEvents:
'buzz': () => void;

// ServerToClientEvents:
'player-buzzed': (data: { playerId: string }) => void;
```

**`server/src/rooms.ts`** (or `game.ts`):
- Handle `buzz` event: validate player is in room and not the active player
- Broadcast `player-buzzed` to room
- Rate limit: max 1 buzz per player per turn (track with a Set, clear on `startTurn`)

**`app/src/store.ts`**:
- Add `buzzedPlayers: string[]` to store
- Clear on new turn

**`app/src/hooks/useSocket.ts`**:
- Listen for `player-buzzed`, add to `buzzedPlayers`

**`app/src/components/Game.tsx`**:
- When not active player and phase is `playing`:
  - Show a "🎵 I Know This!" button (pulsing animation)
  - On tap: emit `buzz`, disable button for this turn
  - Show avatars/names of players who buzzed (animated pop-in)
- Brief visual flash / confetti when someone buzzes

---

## Implementation Order (Recommended)

### Phase 1 — Parallel batch (sub-agents can build simultaneously):
| Agent | Feature | Estimated Complexity |
|-------|---------|---------------------|
| Agent A | Feature 1: Fuzzy matching | Small (server only) |
| Agent B | Feature 4: Volume slider | Small (client only) |
| Agent C | Feature 5: Disconnect grace | Medium (server + client) |
| Agent D | Feature 9: Invite links | Small (client only) |

### Phase 2 — Depends on song history infra:
| Agent | Feature | Estimated Complexity |
|-------|---------|---------------------|
| Agent E | Feature 2: Song history | Medium (full stack) |
| Agent F | Feature 3: End-game stats | Medium (full stack) |

### Phase 3 — Content expansion (parallel):
| Agent | Feature | Estimated Complexity |
|-------|---------|---------------------|
| Agent G | Feature 6: Genre/decade packs | Medium (data + full stack) |
| Agent H | Feature 7: Regional packs | Medium (data + full stack) |

### Phase 4 — UX polish (parallel):
| Agent | Feature | Estimated Complexity |
|-------|---------|---------------------|
| Agent I | Feature 8: Waiting state | Medium (client only) |
| Agent J | Feature 10: Buzz button | Small (full stack) |

---

## Shared Infrastructure Changes (Do First)

Before launching parallel agents, these shared type changes should be committed:

1. Update `shared/src/types.ts` with new types (PlayedSong, PlayerStats, GameStats, SongGenre, SongRegion)
2. Update `shared/src/events.ts` with new events (song-history, game-stats, buzz, player-buzzed, disconnect events)
3. Update `shared/src/constants.ts` with DISCONNECT_GRACE_MS

This prevents merge conflicts between parallel agents.
