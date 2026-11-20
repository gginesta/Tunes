# Tunes

Tunes is a browser-based music game for 2–12 people. Pick the first release year of the recording you hear by placing it on a timeline.

## Start a table

Every music choice uses the room created on Home. In a deployment enabled for Spotify Classic, the host can connect Spotify in the Classic lobby. The existing QR, guest seats, turn order and recovery flow all belong to that room. The Spotify sign-in window returns the host to Tunes.

1. On Home, enter a stage name and choose **Host a room**. Share the QR code, invite link or four-letter room code. Guests can join without an account.
2. The default is **Manual DJ**. The DJ sees the private artist, title and recording version, plays that recording using a source the group may use, and taps **Music is playing**. Cueing is untimed.
3. Choose **Customize** to change the game mode, pack or DJ. The table checks the connected roster and playable recordings before Start. A dedicated DJ requires at least two scoring players in addition to the DJ.
4. Use **Leave** to free your seat and host or join again. After an interruption, reconnect or choose **Resume your table** on the same browser. The server keeps an all-away room for 30 minutes. Keep the site's browser data to retain your seat, private stats and saved tables.

The controller starts the match and advances reveals. In automatic mode, the speaker's device plays audio. In manual mode, the DJ sits out the song they cue. A healthy speaker can continue when only the controller loses their connection. Losing required audio freezes the listening or challenge clock until playback resumes. A completed reveal stays readable in silence.

### Game modes

| Mode | Play |
| --- | --- |
| Classic Original | Place a card on your own timeline. Optional naming earns a token. An eligible opponent can spend a token to claim a different gap and steal the card if your placement misses and theirs fits. |
| Classic Pro | Place the card and name the title and artist. |
| Classic Expert | Place the card, name the title and artist, and enter the four-digit recording release year. |
| Classic Co-op | Build one shared timeline. An incorrect placement costs the active player a token. Reaching the target earns the co-op win. |
| Dinner Set | Everyone eligible privately picks a gap on a shared timeline. Revise until you lock the pick. The reveal shows all guesses together. A correct guess earns one point. The highest score wins and ties share the title. |

The listening clock runs for up to 60 seconds after the cue is confirmed. Classic opponents have up to 15 seconds to respond, and play can resolve earlier once eligible opponents and the active player finish their inputs. The controller advances the final reveal before the podium appears.

Dinner Set defaults to eight rounds with automatic audio. With a rotating manual DJ, it uses whole rotations so everyone cues the same number of songs. From Results, players can opt into a same-room rematch. The controller can save the table so its members can reopen it on another evening with private standings and head-to-head history. Decks prefer recordings that the table has yet to hear. Stage-name changes preserve guest identity, while older name-based records remain in the legacy leaderboard.

### Music choices

- **Manual DJ** uses a catalogue of familiar recordings and their sourced release facts. The audio comes from the group's own permitted listening source. Check the exact version in the cue, especially for covers, remasters and alternate takes.
- **Automatic music** includes a 24-track independent instrumental pack bundled under CC BY 4.0. These are different recordings from the familiar-song catalogue. The game plays clips on the designated speaker device. [Recording credits and sources](app/public/music-credits.html)
- **Additional automatic packs** require a written decision covering recording list, territories, interactive-game use, excerpt and delivery terms, attribution, expiry and fees. Confirm rights for the intended territory before exposing a pack.

### Spotify Classic

Spotify’s standard developer policy prohibits games, including trivia. A Premium account and a development allowlist entry enable technical access. Using the service in this game requires separate authorization covering Tunes. The public playtest keeps this source off. [Spotify Developer Policy, section III](https://developer.spotify.com/policy#iii-some-prohibited-applications)

For an authorized deployment, register the stable game origin’s exact `/callback.html` URL, build with its public app ID and redirect URI, and provide a recording manifest covered by the agreement. The server reloads `TUNES_SPOTIFY_MANIFEST` when the file changes. Its JSON object has a `tracks` array. Each entry maps a `recordingId` in `data/manual-recordings.json` to the 22-character `spotifyTrackId` of the same recording and edition. Set `TUNES_SPOTIFY_CLASSIC_ENABLED=true` on that deployment. When using Compose, put the manifest in the mounted data directory and specify its in-container path. [Spotify redirect URI requirements](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri)

The speaker signs in on its own phone. The room server receives cue confirmations, and its SQLite checkpoint contains game state and the selected recording. Spotify account tokens stay on the speaker’s browser. When required audio stops, the table pauses. Reopen the room on the same browser, then tap **Resume music** if prompted.

## Run locally

Use Node.js 24 LTS and npm. The server uses SQLite through the native `better-sqlite3` module. On platforms without a prebuilt binary, npm needs a native compiler toolchain.

```sh
npm ci
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Vite proxies the socket connection to the development server on port 3000. For a production-style rehearsal, build all workspaces and start the compiled server on port 3000.

```sh
npm run build
npm start
```

The server serves the built client on the same origin. A successful `GET /health` reports status, uptime, connected players, room count and server build revision. Home also displays the server build. Docker uses the lockfile and Node 24 in both stages. `docker compose up --build` starts the service and mounts `./data` for SQLite.

### Host the new game at `/play/`

Use the [operator handoff](deploy/README.md) to deploy alongside the original game with Docker and Caddy. It covers build inputs, the private network and separate volume, URL routing, acceptance on an iPhone, and rollback.

### Configuration and licensed packs

Set runtime variables in the shell or hosting service. To load a local copy of the example with the compiled server, use `node --env-file=.env scripts/start.mjs`. [Configuration example](.env.example)

| Setting | Purpose |
| --- | --- |
| `PORT`, `DATA_DIR` | Default port 3000 and repository `data/`. Set `DATA_DIR` to a writable persistent directory on the host. |
| `ALLOWED_ORIGINS` | Comma-separated list for a separately hosted client. Same-origin production hosting works with it unset. |
| `BUILD_REVISION` | Server build stamp in logs, health and Home. Pass it as a build argument in Docker. |
| `VITE_BASE_PATH` | Public path with leading and trailing slashes, such as `/play/`. Defaults to `/`. The edge proxy strips this prefix before forwarding. |
| `VITE_SPOTIFY_CLIENT_ID`, `VITE_SPOTIFY_REDIRECT_URI` | Public client ID and exact same-origin callback for an authorized Spotify Classic deployment. Pass as build arguments in Docker. |
| `TUNES_SPOTIFY_CLASSIC_ENABLED`, `TUNES_SPOTIFY_MANIFEST` | Server opt-in and absolute path to the deployment’s permitted recording list. Default is off. |
| `TUNES_DINNER_ENABLED=false`, `TUNES_LICENSED_ENABLED=false` | Disable new starts for the respective pilot feature. Existing snapshots can still recover and finish, subject to recording eligibility. |
| `TUNES_LICENSED_MANIFEST`, `TUNES_LICENSED_AUDIO_DIR` | Absolute paths to an optional JSON manifest and the clip directory. Restart the process to load a changed manifest. |
| `TUNES_GEO_FENCED_TERRITORY` | Optional country code, for example `HK`, for an instance whose upstream access is already restricted to that territory. An unrestricted service should leave this unset and use tracks with `territories: ["*"]`. |
| `LOG_LEVEL` | Defaults to `info`. Use `debug` during a rehearsal to capture checkpoint timing and event-loop delay. |

The licensed manifest accepts one pack object or an array of packs. Each pack has an `id`, `name` and `tracks` array. Each track needs a stable `recordingId`, `title`, `artist`, release `year`, `sourceUrl`, `license`, `territories` and an `audioFile` relative to the clip directory. Include `licenseUrl`, version, relevant pack filters, and ISO `rightsUntil` or `audioExpiresAt` values where applicable. Serve only files and recordings covered by the pack decision. Titles and credits should match the exact clip.

### Tests and diagnostics

```sh
npm test
npm run lint
npm run build
npm run test:multiplayer
npm run test:spotify-room
npm run test:prefixed-room
```

The test and multiplayer commands use loopback sockets and disposable SQLite files. The production rehearsal starts the compiled server, exercises concurrent 2-, 6- and 12-seat rooms, and reports snapshot payload sizes, SQLite checkpoint latency, and time to simulated first-audio acknowledgement by source. It checks the automatic audio route with byte ranges. CI also starts the production container, checks the matching health revision and SQLite integrity, and fetches the client route.

`npm run test:spotify-room` uses installed Chrome and the compiled server. It builds a temporary client with a loopback callback and creates two seats. The test intercepts authorization, token and playback requests, verifies PKCE, waits for track confirmation, simulates a background interruption and reload, and checks the same guest, room, round and track after resume. Real Spotify approval, account playback and physical iPhone audio remain separate acceptance checks.

At `LOG_LEVEL=debug`, capture checkpoint duration and the one-minute event-loop delay report. For a live pilot, use the matching build revision and pseudonymous room/match/seat IDs to correlate starts, first audio acknowledgements, disconnects, resumed phase, completions, abandonments and rematches. Record actual first sound and silent turns separately during the physical test.

### Browser regression checks

Run against a disposable production server and a headless Chrome session with an isolated profile. Start the server in one PowerShell window from the repository root.

```powershell
npm run build
$env:PORT = '5199'
$env:DATA_DIR = Join-Path ([System.IO.Path]::GetTempPath()) ('tunes-browser-db-' + [guid]::NewGuid())
npm start
```

Launch Chrome in another window. Set `$tunesChrome` to the installed Chrome executable on your system.

```powershell
$tunesChrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$tunesProfile = Join-Path ([System.IO.Path]::GetTempPath()) ('tunes-browser-profile-' + [guid]::NewGuid())
& $tunesChrome --headless=new --remote-debugging-address=127.0.0.1 --remote-debugging-port=9227 "--user-data-dir=$tunesProfile" --no-first-run --no-default-browser-check about:blank
```

Run the regression from the repository root in a third window. It accepts loopback endpoints only. Use `TUNES_BROWSER_TEST_ORIGIN` and `TUNES_BROWSER_TEST_CDP` if you chose other ports. The optional argument sets the screenshot directory.

```powershell
$tunesScreenshots = Join-Path ([System.IO.Path]::GetTempPath()) ('tunes-browser-checks-' + [guid]::NewGuid())
node scripts/verify-browser-flow.mjs $tunesScreenshots
```

Stop the disposable server and Chrome session when the check finishes. Emulated mobile widths and playback instrumentation complement the physical checks below.

### Back up and rehearse a migration

Take a SQLite online backup before upgrading a persistent volume. Run from the repository root, supplying the real source path and a fresh destination. Keep the backup private because it contains room and guest records.

```sh
node -e "const db = new (require('better-sqlite3'))(process.argv[1], {readonly:true,fileMustExist:true}); db.backup(process.argv[2]).then(() => db.close(), error => { db.close(); console.error(error); process.exitCode = 1 })" ./data/tunes.db ./tunes-backup.db
```

Put a copy of that backup at `tunes.db` inside a disposable directory. Start the new build with `DATA_DIR` pointing to that directory and a free `PORT`. Startup runs the migrations. Check the migrated file with the following command. Replace the last argument with the path to the disposable database.

```sh
node -e "const db = new (require('better-sqlite3'))(process.argv[1], {readonly:true,fileMustExist:true}); const check = db.pragma('quick_check', {simple:true}); db.close(); console.log(check); if (check !== 'ok') process.exitCode = 1" ./rehearsal/tunes.db
```

Verify a new room, an already-finished match, a compatible active room and an old browser seat. A pre-upgrade room without a recoverable deck offers a fresh-start choice. Restart the rehearsal server and verify one result and one set of stats increments per match. Preserve the source backup for a restore rehearsal or rollback.

Active game state checkpoints after changes and every five seconds while a clock is running. An unclean restart restores the last checkpoint and pauses active audio. The clock can regain up to the time since the last periodic checkpoint. Reveals and results should restore with the same recording, guesses and scores.

## Pilot acceptance checklist

### Two real phones

- [ ] Serve the candidate over HTTPS. Use Guillermo's iPhone 17 Pro Max and a second real phone. Record the build revision, model, OS, browser, source and assigned roles. Test leave and immediate rehost or rejoin from both Lobby and Results. Refresh while seated and verify that the same seat returns.
- [ ] In Classic, test natural screen sleep, 10- and 45-second deliberate locks, a two-minute call, app switching, Low Power Mode, reload or tab eviction, Wi-Fi loss and Bluetooth handoff. Cover listening, challenge, reveal and results across the matrix. Include a controller-only disconnect with the speaker still online and a required-audio interruption.
- [ ] Disconnect all devices for six minutes, resume before expiry and check the 30-minute boundary in a separate room. Restart the candidate server during anchors, listening, challenge, reveal and results. Record the recording actually heard, phase, clock, submitted guesses and score before and after each interruption. Confirm a preserved score and phase, no progress while paused, and at most one resume gesture if the source remains available.
- [ ] Verify manual cue privacy and automatic speaker controls. Play one available track on the physical speaker, recover or replace one unavailable track, and confirm a single audio stream. Check that the final reveal stays visible until the controller advances.
- [ ] Have a new host start a Manual DJ room while two guests join via QR without coaching. Target first audible music within 90 seconds. Check timeline placement at 320- and 390-pixel widths, large text, keyboard open, VoiceOver and TalkBack, plus reduced motion.

### Dinner trial and wider hosting

- [ ] Recruit six to eight tables of four to six people. Alternate which mode each table tries first. Use comparable recordings and the same source, with a newcomer hosting. Record elapsed time to audio, help requests, failed cues, eligible guesses submitted, waiting time, rounds played and whether people remember the deciding song.
- [ ] Record whether each table voluntarily plays the same mode again, switches mode or stops before asking for comparisons. Count voluntary same-mode rematches against completed first matches that had an opportunity to continue. Review observed failures and replay choices before changing the default.
- [ ] Before expanding hosting, rehearse migration and restore on a disposable database, complete the phone matrix, and record first-audio median and p95 by source. Confirm catalogue, territorial eligibility, attribution and audio delivery on actual speakers for every automatic pack offered.

## License

Tunes is a private project. The bundled automatic recordings carry the individual licenses listed in the music credits. [Music credits](app/public/music-credits.html)
