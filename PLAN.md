# Spotify Integration Plan

## Status: COMPLETE

Spotify integration is fully implemented and working. This document now serves as a reference for the architecture decisions made and key lessons learned during implementation.

---

## Architecture (Implemented)

```
Host clicks "Host Game"
  -> Spotify OAuth popup (PKCE flow, client-side only)
  -> Lightweight callback.html exchanges code for tokens, posts to opener
  -> Access token stored in Zustand store (memory)
  -> Refresh token stored in sessionStorage (survives refresh)
  -> Token sent to server via create-room
  -> Token also used client-side for Web Playback SDK

Game starts:
  -> Server resolves Spotify track IDs for entire deck (batch, cached)
  -> Songs that fail resolution are filtered out of the deck
  -> Server emits play-song with trackId each turn

Host's browser receives play-song:
  -> Calls Spotify Web API to play track on the matched device
  -> UI shows play/pause controls on the mystery card
  -> All other metadata hidden until reveal

Fallback:
  -> If Web Playback SDK is unavailable, HTML5 Audio plays preview URLs
  -> Preview URLs (30s clips) work without Spotify Premium

Token refresh:
  -> SDK's getOAuthToken callback triggers client-side refresh
  -> All track IDs resolved upfront so server never needs a fresh token
```

---

## Key Files

| File | Purpose |
|------|---------|
| `app/src/services/spotify.ts` | OAuth PKCE flow + token refresh |
| `app/src/services/spotifyPlayer.ts` | Web Playback SDK wrapper (singleton) |
| `app/src/services/audioFallback.ts` | HTML5 Audio fallback for preview URLs |
| `app/src/services/sounds.ts` | Web Audio API sound effects |
| `app/public/callback.html` | Lightweight OAuth callback (vanilla JS) |
| `app/src/hooks/useSpotifyPlayer.ts` | React hook for SDK lifecycle + auto-play |
| `app/src/hooks/useSocket.ts` | Socket.io event wiring including play-song |
| `server/src/songs.ts` | Song loading, deck selection, track ID resolution |

---

## Key Learnings

### 1. Device ID Mismatch

The Spotify Web Playback SDK provides a `device_id` via its `ready` event, but this ID is unreliable for targeting playback via the Web API. The `/me/player/play` endpoint would frequently reject the SDK-provided device ID.

**Solution:** Device polling. Instead of using the SDK's device ID directly, the app polls the `/me/player/devices` endpoint and matches the device by name (the name passed to `new Spotify.Player({ name: '...' })`). This reliably finds the correct device even when the SDK device ID changes or is stale.

### 2. React StrictMode Double-Initialization

React 19's StrictMode mounts and unmounts components twice in development. This caused the Spotify Web Playback SDK to initialize twice, creating duplicate players and race conditions with the `onSpotifyWebPlaybackSDKReady` callback.

**Solution:** The `spotifyPlayer.ts` service is a singleton with guards against double-initialization. The `initPlayer()` function checks if a player is already connected before creating a new one, and cleanup properly disconnects the player on unmount.

### 3. PKCE Flow (No Backend Secret)

Since this is a client-side app, the Spotify OAuth flow uses PKCE (Proof Key for Code Exchange) instead of a client secret. The code verifier is stored in sessionStorage (shared with the popup since it is same-origin) and used during the token exchange.

### 4. Preview URL Fallback

Not all users have Spotify Premium, and the Web Playback SDK requires it. The app falls back to HTML5 Audio using Spotify's 30-second preview URLs. These are fetched from the Spotify Web API track metadata and do not require Premium.

### 5. Auto-Pause/Resume by Game Phase

Playback is tied to the game phase:

| Phase | Playback Action |
|-------|----------------|
| `playing` (new track) | Play the track |
| `challenge` | Pause |
| `reveal` | Pause |
| Skip | Stop (next turn auto-plays) |

This is handled in the `useSpotifyPlayer` hook by watching Zustand store state changes.

---

## Spotify Configuration

### Scopes

`streaming`, `user-read-email`, `user-read-private`, `user-modify-playback-state`, `user-read-playback-state`

### Environment

- `VITE_SPOTIFY_CLIENT_ID` -- Set in `app/.env`
- Redirect URI in Spotify Dashboard must match: `{origin}/callback.html`

### Requirements

- **HTTPS** is required in production (localhost is the only HTTP exception)
- **Spotify Premium** is required for Web Playback SDK (preview URL fallback works without it)

---

## Error Handling (Implemented)

| Scenario | Behavior |
|----------|----------|
| Popup blocked | Show "Please allow popups" message |
| Popup closed early | Show "Spotify login cancelled" |
| Free Spotify account | SDK emits auth error; falls back to preview URLs |
| Song not found on Spotify | Filtered out of deck before game starts |
| Token expires mid-game | SDK's getOAuthToken callback triggers refresh |
| Host refreshes browser | Re-init SDK from sessionStorage refresh token; server re-syncs state |
| playTrack API fails | Retry once, then skip |

---

## SQLite Persistent Storage (Implemented)

### Architecture

```
Server startup:
  -> database.ts initializes SQLite at data/hitster.db (WAL mode)
  -> Creates rooms and accounts tables if not present
  -> restoreRoomsFromDatabase() recreates GameEngine instances for saved rooms
  -> Accounts migrated from legacy JSON files to SQLite automatically

During gameplay:
  -> Room state saved to SQLite on: create, join, start-game, place-card, reveal, restart, leave
  -> Rooms deleted from database when all players disconnect

Accounts:
  -> Stored in SQLite (migrated from JSON on first startup)
  -> Same API surface, transparent to the rest of the server
```

### Key Design Decisions

- **better-sqlite3** chosen for synchronous API (simpler code, no async overhead for small writes)
- **WAL mode** enables concurrent reads during writes, avoids lock contention
- **Room serialization** -- Full GameEngine state serialized to JSON for storage; deserialized and hydrated on restore
- **Automatic migration** -- On first startup, if legacy JSON account files exist, they are imported into SQLite and the JSON files are left in place as backups

---

## Turn Timer (Implemented)

### Architecture

```
Server emits turn-started:
  -> Includes deadline timestamp (Date.now() + TURN_TIME_MS)
  -> TURN_TIME_MS = 45000 (shared constant)

Client renders circular countdown on the song card:
  -> Blue (normal) -> Orange (10s remaining) -> Red (5s remaining)
  -> Visible to all players

On timeout:
  -> Server auto-skips the turn (no token cost to the player)
  -> Timer cleared when player places card or manually skips
```

---

## Structured Logging (Implemented)

### Architecture

```
server/src/logger.ts:
  -> JSON structured logger with debug/info/warn/error levels
  -> LOG_LEVEL environment variable (default: "info")
  -> Pretty-print format in development, JSON in production

Request logging:
  -> Express middleware logs method, path, status, and duration
  -> Skips /health and /socket.io paths to reduce noise

Game event logging:
  -> Logs: game start, turn changes, card placements, challenges, game over
  -> Includes room code and player info for traceability
```

### Health Check

- **GET /health** returns `{ status, uptime, rooms, players, version }`
- Useful for load balancer health probes and monitoring dashboards
