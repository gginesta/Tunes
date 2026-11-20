# Release the new Tunes game at `/play/`

This release adds a second service to the domain. A host can choose Classic, Classic Pro, Classic Expert, Classic Co-op, or Dinner Set. The included Independent instrumentals pack plays automatically on the designated speaker. Real Spotify playback is off in this release.

## Build and start the service

1. Use a separate checkout of `https://github.com/gginesta/Tunes.git`. Fetch the branch `feature/dinner-table-edition` and check out the **exact commit in the release handoff**. Keep the existing production checkout and data directory in place.
2. Inspect the existing Caddy and game containers' network memberships. Select their shared Docker network and export its name as `TUNES_CADDY_NETWORK`. Confirm the service name `tunes-play` is unused there. The [playtest Compose file](compose.play.yaml) joins that network, publishes no host ports, and uses its own named volume `tunes-play_play-data` at `/app/data`.
3. From the new checkout, run the following commands. They select the `tunes-play` Compose project and use the Dockerfile in this repository.

```sh
export BUILD_REVISION="$(git rev-parse HEAD)"
docker compose -f deploy/compose.play.yaml config --quiet
docker compose -f deploy/compose.play.yaml up -d --build --wait
docker compose -f deploy/compose.play.yaml ps
```

Required operator environment variables are `BUILD_REVISION` and `TUNES_CADDY_NETWORK`. Compose supplies the `VITE_BASE_PATH` build argument. The automatic instrumental pack ships in the image.

## Route the new service

Make [play.caddy](play.caddy) available to the Caddy container. Import it at Caddyfile top level. Inside the existing Tunes site block add `import tunes_play tunes-play:3000` before the current wildcard proxy. Use the existing validation and graceful reload procedure. The original game's upstream continues serving the other paths.

Check connected players immediately before the proxy reload and use a quiet moment. Caddy's default reload closes existing WebSocket connections even when the upstream game is healthy. [Caddy WebSocket reload behavior](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#streaming)

| Incoming request | Destination |
| --- | --- |
| `/play` | Permanent redirect to `/play/` (308). |
| `/play/`, `/play/join/CODE`, `/play/assets/*` | New UI, deep links, fonts, JavaScript and CSS. |
| `/play/health`, `/play/socket.io/*` | New server health and room API. Most game actions use Socket.IO. Both WebSocket upgrades and HTTP polling use this path. |
| `/play/listening/*`, `/play/licensed-audio/*`, `/play/music-credits.html` | Bundled clips, optional operator-provided audio and recording credits. Audio byte-range requests pass through. |
| `/play/callback.html` | New client's Spotify sign-in return page for a separately authorized deployment. The new client validates the popup, state and same origin. |
| `/`, `/join/CODE`, `/health`, `/socket.io/*`, `/callback.html` | Existing game. Its Spotify callback uses its original sign-in protocol. |

Caddy removes the leading `/play` before forwarding to the new container. Both games can run in the same Safari browser. The new client namespaces guest IDs, seat recovery, and speaker credentials by deployment path.

## Accept or roll back the route

- Confirm the original root, health endpoint and sign-in callback still reach the original service. Confirm `/play/health` returns JSON with `status` equal to `ok` and `revision` equal to the handoff commit. The original site's fallback can return HTML with status 200 for an unknown URL.
- On the iPhone, open `/play/` in Safari and host a Classic room. Have a second phone scan the lobby QR. Under **Customize → Music source** choose **Independent instrumentals**, then start the match and enable sound when prompted. During a song, lock the iPhone and wait for the guest to see **Table paused**. Unlock, return to the same Safari tab (or reopen the game in that browser), and tap **Resume music**. Check the same room, seats, turn, recording and remaining time, then finish the turn.
- To roll back, remove the new Caddy route and its snippet import, validate and reload Caddy, then run `docker compose -f deploy/compose.play.yaml stop` in the new checkout. The private volume retains the new table data.

## Spotify scope

The existing game's registered root callback and the new game's path-specific callback implement different popup protocols. For a future deployment with Spotify authorization covering game use, register the exact `https://tunes.buzzrounds.com/play/callback.html` separately. Optional build variable names are `VITE_SPOTIFY_CLIENT_ID` and `VITE_SPOTIFY_REDIRECT_URI`. Optional runtime variable names are `TUNES_SPOTIFY_CLASSIC_ENABLED` and `TUNES_SPOTIFY_MANIFEST`. That deployment also needs a permitted recording list. The browser uses PKCE and requires no client secret. [Spotify Developer Policy](https://developer.spotify.com/policy#iii-some-prohibited-applications)
