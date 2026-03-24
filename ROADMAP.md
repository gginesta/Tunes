# Development Roadmap

## Current Status

The game is fully playable as a real-time multiplayer experience with Spotify integration. Players can host/join rooms, listen to songs via Spotify, place cards on their timeline, challenge each other, name songs for bonus tokens, and see final results with rankings.

### What's Built

- [x] Real-time multiplayer via Socket.io (2-10 players)
- [x] Room creation and joining with 4-letter codes
- [x] Full game loop: turns, placement, challenges, reveals, scoring
- [x] Token economy (skip, challenge, buy, name-song bonus)
- [x] 4 game modes fully implemented (Original, Pro, Expert, Co-op)
- [x] 500+ song database spanning 1930s-2020s
- [x] Decade-balanced deck selection
- [x] Zustand state management with typed Socket.io events
- [x] Connection tracking and host reassignment
- [x] Animated UI with Motion library
- [x] How to Play / Rules screen
- [x] Responsive mobile-first design with Tailwind CSS 4
- [x] Spotify OAuth (PKCE flow, client-side)
- [x] Spotify Web Playback SDK integration
- [x] Device polling (matches by name, not SDK device ID)
- [x] HTML5 Audio fallback for preview URLs
- [x] Track resolution on game start
- [x] Song naming (optional in Original, required in Pro/Expert)
- [x] Exact year guessing (Expert mode)
- [x] Co-op mode with shared timeline and wrong-placement penalties
- [x] Challenge countdown timer (circular, turns red at 5s, synced from server)
- [x] "No Challenge" button alongside Challenge button
- [x] Sound effects via Web Audio API (correct, wrong, challenge, stolen, tick, start) with mute toggle
- [x] Post-game rankings screen with 1st/2nd/3rd medal colors and staggered animations
- [x] Play Again button (host-only, restarts game in same room)
- [x] Optional account creation (username/password, JSON file storage) with guest fallback
- [x] Turn timer (45s countdown with circular visual, color transitions, auto-skip on timeout)
- [x] Persistent storage (SQLite via better-sqlite3, WAL mode, rooms survive restarts)
- [x] Account migration from JSON files to SQLite (automatic on first startup)
- [x] Structured JSON logging with configurable LOG_LEVEL
- [x] Health check endpoint (GET /health)
- [x] Auto-reconnect with session resumption (rejoin room after disconnect)
- [x] Host crash recovery (game continues, turn skips immediately)
- [x] Challenge placement visibility (challengers see where card was placed)
- [x] Spotify autoplay fix (pre-activate on user gesture, tap-to-play indicator)
- [x] iOS keyboard fix (no sensitive text field behavior on inputs)

---

## Future: Gameplay Improvements

- [ ] **Fuzzy song name matching** -- Allow minor typos, missing "The", punctuation differences when guessing song names in Pro/Expert modes (e.g. "Beatles" ≈ "The Beatles", "dont stop" ≈ "Don't Stop")
- [ ] **Streak bonus** -- Reward consecutive correct placements with bonus tokens or visual flair; adds excitement and a "hot hand" feeling
- [ ] **Difficulty scaling** -- In Original mode, start with songs from widely different decades (easy to place) and gradually narrow the gaps as timelines grow; makes early game accessible and late game tense
- [ ] **Round recap / song history** -- During or after a game, let players scroll through all songs that were played, showing which ones each player got right/wrong
- [ ] **End-of-game stats** -- Beyond rankings: "Fastest correct placement", "Most challenges won", "Best decade accuracy", "Longest streak" on the results screen
- [ ] **Volume control** -- Add a slider in the game screen for music volume (currently hardcoded to 0.8/0.35)
- [ ] **Disconnect grace period** -- If a player disconnects mid-game, give them 30-60 seconds to rejoin before skipping their turn

## Future: Content Expansion

- [ ] **Genre packs** -- Rock, Hip-Hop, Pop, Country, Electronic, etc.
- [ ] **Decade packs** -- Focus on specific eras (60s, 80s, 2000s, etc.)
- [ ] **Genre + decade combos** -- Curated packs like "80s Rock", "2000s Hip-Hop" for themed game nights
- [ ] **Regional packs** -- UK hits, Latin music, K-pop, Bollywood
- [ ] **Custom playlists** -- Host imports a Spotify playlist as the song source

## Future: Social & UX Features

- [ ] **Shareable invite links** -- Generate a link like `hitster.app/join/ABCD` that players can share via messaging apps, instead of just a 4-letter code
- [ ] **Spectator mode** -- Join a room as an observer without being in the turn order; great for parties where people arrive late
- [ ] **"I know this!" buzz button** -- During another player's turn, let non-active players tap a button to signal they know the song (for fun/bragging, no game effect); adds engagement when waiting
- [ ] **Better waiting state** -- When it's not your turn, show a mini music trivia question, fun fact about the current decade, or an animated visualization instead of an empty screen
- [ ] **Chat / reactions** -- Quick reactions during gameplay
- [ ] **Player avatars** -- Custom images or preset avatar selection

## Future: Persistence and Accounts

- [x] **Persistent storage** -- SQLite database at data/hitster.db; rooms saved on state changes, restored on startup via restoreRoomsFromDatabase()
- [ ] **Leaderboards** -- Global and friend-based rankings
- [ ] **Game history** -- Track wins, streaks, and favourite decades
- [ ] **Statistics** -- Which decades you're strongest at, most challenged songs, etc.

## Future: Deployment and Infrastructure

- [x] **Production deployment** -- Live on Railway
- [x] **Database** -- SQLite for room/game state persistence (Redis for horizontal scaling is a future option)
- [ ] **CDN** -- Serve the frontend via CDN for fast global access
- [x] **Monitoring** -- Structured logging with game event tracking; health check endpoint
- [ ] **Mobile app** -- Native mobile client

---

## Known Limitations

- Spotify Premium is required for the host to use the Web Playback SDK
- SQLite limits horizontal scaling to a single server instance (Redis would be needed for multi-instance)
