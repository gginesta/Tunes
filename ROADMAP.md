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

---

## Future: Content Expansion

- [ ] **Genre packs** -- Rock, Hip-Hop, Pop, Country, Electronic, etc.
- [ ] **Decade packs** -- Focus on specific eras (60s, 80s, 2000s, etc.)
- [ ] **Regional packs** -- UK hits, Latin music, K-pop, Bollywood
- [ ] **Custom playlists** -- Host imports a Spotify playlist as the song source

## Future: Social Features

- [ ] **Spectator mode** -- Join a room as an observer
- [ ] **Chat / reactions** -- Quick reactions during gameplay
- [ ] **Player avatars** -- Custom images or preset avatar selection

## Future: Persistence and Accounts

- [ ] **Persistent storage** -- Rooms are currently in-memory; move to a database
- [ ] **Leaderboards** -- Global and friend-based rankings
- [ ] **Game history** -- Track wins, streaks, and favourite decades
- [ ] **Statistics** -- Which decades you're strongest at, most challenged songs, etc.

## Future: Deployment and Infrastructure

- [ ] **Production deployment** -- Docker, cloud hosting (Railway, Fly.io, or similar)
- [ ] **Database** -- Move rooms/game state to Redis for horizontal scaling
- [ ] **CDN** -- Serve the frontend via CDN for fast global access
- [ ] **Monitoring** -- Error tracking and basic analytics
- [ ] **Mobile app** -- Native mobile client

---

## Known Limitations

- No persistent storage -- rooms are lost if the server restarts
- Account data is stored in a JSON file (not suitable for production)
- Spotify Premium is required for the host to use the Web Playback SDK
