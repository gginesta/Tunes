# Hitster

A real-time multiplayer music party game where players compete to build a chronological timeline of hit songs. Inspired by the popular Hitster card game, powered by Spotify.

## How It Works

1. **Host a room** -- One player connects to Spotify, creates a game room, and shares the 4-letter code
2. **Others join** -- Friends enter the code to join the lobby (no Spotify account needed)
3. **A song plays** -- Each turn, a mystery song plays via Spotify on the host's device
4. **Place it on your timeline** -- The active player guesses where the song falls chronologically among their existing cards
5. **Challenge!** -- Other players have 15 seconds to spend a token and challenge if they think the placement is wrong
6. **First to collect enough cards wins!**

## Features

- **Real-time multiplayer** -- 2-10 players per room via Socket.io
- **Spotify integration** -- Web Playback SDK with PKCE OAuth for the host; HTML5 Audio fallback using preview URLs
- **Device polling** -- Matches playback device by name (not SDK device ID) for reliable device targeting
- **500+ songs** spanning 1930s-2020s with decade-balanced deck selection
- **4 fully implemented game modes** -- Original, Pro, Expert, and Co-op
- **Token economy** -- Skip songs (1 token), challenge placements (1 token), buy cards (3 tokens), or earn tokens by naming songs
- **Challenge system** -- 15-second countdown window with circular timer (turns red at 5s, synced from server); "No Challenge" button alongside Challenge button
- **Song naming** -- Optional in Original mode, required in Pro/Expert
- **Exact year guessing** -- Required in Expert mode
- **Co-op mode** -- Shared timeline for all players with wrong-placement penalties
- **Sound effects** -- Web Audio API sounds (correct, wrong, challenge, stolen, tick, start) with mute toggle
- **Post-game rankings** -- Results screen with 1st/2nd/3rd medal colors and staggered animations
- **Play Again** -- Host-only button to restart the game in the same room
- **Optional accounts** -- Username/password with JSON file storage; guest fallback
- **Connection handling** -- Tracks player online/offline status with automatic host reassignment
- **Responsive UI** -- Tailwind CSS 4 with Motion animations

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite, Tailwind CSS 4, Zustand, Motion |
| Backend | Node.js, Express, Socket.io, TypeScript |
| Music | Spotify Web Playback SDK, PKCE OAuth, Web API, HTML5 Audio fallback |
| Shared | TypeScript types, constants, and typed Socket.io events |
| Monorepo | npm workspaces (shared, server, app) |

## Project Structure

```
hitster/
├── app/                    # React frontend
│   └── src/
│       ├── components/     # Home, Lobby, Game, Results, Rules screens
│       ├── hooks/          # useSocket, useSpotifyPlayer
│       ├── services/       # Socket.io client, Spotify OAuth, Playback SDK, Audio fallback, Sound effects
│       └── store.ts        # Zustand state management
├── server/                 # Express + Socket.io backend
│   └── src/
│       ├── index.ts        # Server entry point
│       ├── rooms.ts        # Room creation, joining, leaving
│       ├── game.ts         # GameEngine — turns, placement, challenges, scoring
│       ├── songs.ts        # Song loading, deck selection, Spotify track resolution
│       ├── accounts.ts     # Account storage (JSON file)
│       └── accounts-handler.ts # Account route handlers
├── shared/                 # Shared TypeScript package
│   └── src/
│       ├── types.ts        # Player, Room, GameState, SongCard, etc.
│       ├── constants.ts    # Game constants (tokens, costs, limits)
│       └── events.ts       # Typed client/server Socket.io events
└── data/
    └── songs.json          # Song database
```

## Getting Started

### Prerequisites

- Node.js 18+
- Spotify Premium account (for the host)
- Spotify Developer App (for the Client ID)

### Spotify Setup

1. Go to https://developer.spotify.com/dashboard
2. Create a new app with Web API and Web Playback SDK enabled
3. Add redirect URI: `http://localhost:5173/callback.html`
4. Copy the Client ID

### Install and Run

```bash
# Install dependencies
npm install

# Create environment file
cp app/.env.example app/.env
# Edit app/.env and add your Spotify Client ID

# Start development (server on :3000, frontend on :5173)
npm run dev
```

Open **http://localhost:5173** in your browser.

### Build for Production

```bash
npm run build:shared
npm run build:server
npm run build:app
```

## Game Rules

### Objective

Be the first player to collect the target number of song cards (default: 10) by placing them in the correct chronological order on your timeline.

### Tokens

Each player starts with 2 tokens (max 5). Use them for:

| Action | Cost |
|--------|------|
| Skip a song | 1 token |
| Challenge a placement | 1 token |
| Buy a card (auto-placed correctly) | 3 tokens |
| Name the song correctly | +1 token |

### Turn Flow

1. A mystery song card is drawn from the deck and plays via Spotify
2. The active player places it on their timeline
3. Other players have 15 seconds to challenge the placement (costs 1 token) or click "No Challenge"
4. The song is revealed:
   - **Correct placement** -- the active player keeps the card
   - **Wrong placement + challenger** -- the first challenger steals the card
   - **Wrong placement + no challenger** -- the card is discarded

### Game Modes

- **Original** -- Place the card. Optionally name the song for a bonus token.
- **Pro** -- Must place correctly AND name the song to keep the card.
- **Expert** -- Must place, name, AND guess the exact year.
- **Co-op** -- Shared timeline for all players. Wrong placements cost the team a token.

## License

Private project.
