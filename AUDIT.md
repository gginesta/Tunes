# Tunes — Repository Audit

> Audit date: 2026-06-11 · Branch: `claude/confident-goldberg-7b0to6` (clean tree, HEAD `3f3c56a`)
> Analysis only — no source code was modified. Every `file:line` citation was verified against the working tree; commands run are listed in §7.

---

## 1. Executive Summary

**Overall health: C+.** Tunes is an impressively feature-complete hobby product — a real-time multiplayer music game with 4 game modes, Spotify integration, reconnect handling, and a 614-song dataset — built in ~88 commits over roughly 5 weeks. The whole monorepo type-checks and builds cleanly (`tsc --noEmit` passes, zero errors), SQL is fully parameterized, and the README is unusually accurate. What drags the grade down is not the product code but the engineering perimeter: **passwords are hashed with unsalted SHA-256**, Spotify tokens sit in plaintext in SQLite and in browser localStorage, CORS is wide open, there are **zero tests of any kind**, and the only CI workflow **auto-merges every `claude/**` push straight to `main` with no build or test gate**. Top 3 risks: (1) credential compromise — any DB leak cracks user passwords in seconds; (2) open trust boundary — no rate limiting or input validation on socket events; (3) no safety net — a 1,079-line game engine with no tests, where every push ships to `main` unverified. Top 3 opportunities: a CI build gate (under 2 hours, transforms the risk profile), a focused security sprint (bcrypt + CORS + `npm audit fix`, ~1 day), and unit tests around `GameEngine` to make the planned refactors safe.

---

## 2. Repo Map

**Purpose:** Real-time multiplayer party game ("Hitster"-style): players place mystery songs chronologically on a timeline; host plays audio via Spotify. Maturity: **deployed hobby project with real user accounts** (Docker production setup, accounts, leaderboards) — judged at that bar, not enterprise.

**Stack:** npm workspaces monorepo. React 19 + Vite 6 + Tailwind 4 + Zustand + Motion (frontend); Node + Express 4 + Socket.io 4 + better-sqlite3 (backend); shared TypeScript types/events package. Node 20 Alpine multi-stage Dockerfile.

**Architecture sketch:** Client ⇄ Socket.io (typed events from `shared/src/events.ts`) ⇄ in-memory `Map`s of rooms/engines in `server/src/rooms.ts`, snapshotted to SQLite (`server/src/database.ts`) for restart survival. `GameEngine` (`server/src/game.ts`) is authoritative for all game logic; Spotify playback happens client-side on the host's device via Web Playback SDK with PKCE OAuth (`app/src/services/spotify.ts`, `app/public/callback.html`).

| Path | What it is |
|---|---|
| `app/src/components/` | Screen components — `Game.tsx` (1,162 lines) and `Lobby.tsx` (854) dominate |
| `app/src/services/` | Socket client, Spotify OAuth/SDK, audio fallback, sound FX |
| `server/src/` | `index.ts` (HTTP+health), `rooms.ts` (794 — all socket handlers), `game.ts` (1,079 — engine), `songs.ts`, `accounts*.ts`, `database.ts`, `logger.ts`, `fuzzy.ts` |
| `shared/src/` | Types, constants, typed Socket.io event maps |
| `data/songs.json` | 614 songs (verified count — matches README claim) |
| `mockups/`, `DESIGN-BRIEF.md`, `PLAN*.md`, `ROADMAP.md` | Design/planning artifacts |
| `.github/workflows/auto-merge.yml` | The **only** CI workflow — see finding D1 |

**Churn hotspots** (`git log --format= --name-only | sort | uniq -c`): `Game.tsx` (24 commits), `rooms.ts` (14), `songs.ts` (13), `Lobby.tsx` (13), `game.ts` (12) — change concentrates exactly in the largest, least-tested files.

**Surprises:** `hitster-clone.zip` (39 KB, the original prototype) committed at repo root; total source is compact (~10,070 lines across app+server+shared); no lint config, no test config, no test files anywhere.

---

## 3. Audit Report

Findings are facts with citations unless marked `[judgment]`.

### 3.1 Security (worst first)

**S1 — CRITICAL: Passwords hashed with unsalted, single-round SHA-256.**
`server/src/accounts.ts:22-24`:
```ts
function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}
```
No salt, no work factor; identical passwords produce identical hashes; GPU attackers test billions of guesses/sec against this. Compounded by a 3-character minimum (`accounts.ts:64-66`). Consequence: any leak of the SQLite file (or `accounts.json.migrated` remnant) exposes most user passwords — which users reuse elsewhere. Fact.

**S2 — HIGH: Spotify refresh token stored in localStorage.**
`app/public/callback.html:69` (`localStorage.setItem('spotify_refresh_token', ...)`), read back in `app/src/services/spotify.ts:79`. A refresh token is a long-lived credential to the host's Spotify account; localStorage is readable by any XSS on the origin. Mitigated by React's escaping and no `dangerouslySetInnerHTML` in the codebase, but it's the wrong place for a months-lived credential. Fact.

**S3 — HIGH: Spotify access tokens persisted in plaintext to SQLite and held in plaintext Maps.**
`server/src/database.ts:34` (`spotify_token TEXT` column), written at `database.ts:126-145`, mirrored in memory at `server/src/rooms.ts:36` (`roomSpotifyTokens`). The logger truncates tokens (good — `server/src/songs.ts:383`), but anyone with the DB file gets live tokens to hosts' Spotify accounts. Fact.

**S4 — HIGH: CORS wide open on both HTTP and Socket.io.**
`server/src/index.ts:15` (`app.use(cors())`) and `index.ts:40` (`cors: { origin: '*', ... }`). Any website can open a socket to the server and drive the full event API on behalf of a visitor. Fact.

**S5 — HIGH: No rate limiting anywhere — including login.**
`server/src/accounts-handler.ts:25-31` accepts unlimited `login` attempts per socket; combined with S1's weak hashing, online brute-force is practical. Game events (`place-card`, `name-song`, `buzz` — `server/src/rooms.ts:561-650`) are likewise unthrottled. Fact.

**S6 — MEDIUM: Socket payloads are not validated before use.**
`server/src/rooms.ts:580-585` passes the client's `guess` object straight to `engine.nameSong()`; `server/src/fuzzy.ts:41-54` then runs multiple Unicode-aware regexes over it with no length cap. A client sending a megabyte string burns server CPU on a single-threaded event loop. (Player names *are* validated: `rooms.ts:197-201`, 1–30 chars — the pattern exists, it's just not applied to all events.) Fact.

**S7 — MEDIUM: Spotify client ID hardcoded in the Dockerfile.**
`Dockerfile:22` bakes `VITE_SPOTIFY_CLIENT_ID=e33859f1...` into the image instead of a build `ARG`. Client IDs are semi-public, so impact is limited, but it couples the image to one Spotify app and normalizes baking config into layers. Fact.

**S8 — MEDIUM: Vulnerable dependencies — 14 advisories (2 critical, 2 high, 10 moderate).**
From `npm audit` (full output in §7). Calibration matters: the two criticals (`shell-quote` via `concurrently`) and the high (`vite` dev-server path traversal) are **dev-time only**. The production-relevant one is `ws` 8.x "uninitialized memory disclosure" (GHSA-58qx-3vcg-4xpx, moderate) reached through `engine.io`/`socket.io-adapter` — i.e., the live game server. `npm audit fix` resolves it without breaking changes. Fact.

**S9 — LOW: Non-constant-time password comparison** (`accounts.ts:92`, `!==` on hex strings) and **room codes from `Math.random()`** (`rooms.ts:45-53`). Both theoretically guessable; negligible for a party game but free to fix alongside S1. Fact.

### 3.2 Architecture & Design

**A1 — MEDIUM `[judgment]`: Four god files hold 41% of the codebase and absorb most churn.**
`app/src/components/Game.tsx` (1,162 lines; ~15 `useState`, ~9 `useEffect`, 700+ lines of JSX), `server/src/game.ts` (1,079; `resolveRound` alone spans `game.ts:598-762`), `app/src/components/Lobby.tsx` (854), `server/src/rooms.ts` (794; `registerRoomHandlers` contains essentially every socket handler, `rooms.ts:195` onward). The sizes and churn counts are facts; the risk assessment is judgment: these are exactly the files changed most often (24/12/13/14 commits respectively) with zero test coverage, so regressions concentrate where the blast radius is largest.

**A2 — MEDIUM: Duplicated Spotify token/init logic on the client.**
`getToken` is implemented twice with near-identical refresh logic (`app/src/App.tsx:31-44` and `app/src/hooks/useSpotifyPlayer.ts:43-58`), and `initPlayer` is invoked from both `App.tsx:47-79` and `useSpotifyPlayer.ts:72-125` with different callback sets. A future change to refresh behavior must be made twice or the two paths diverge. Fact (duplication); Medium because token refresh is a known-fragile area.

**A3 — LOW `[judgment]`: Single-instance design.** All live state is in process-level `Map`s (`rooms.ts:33-41`) with SQLite as a restart snapshot. This caps the app at one server process — which is fine at this maturity (see Non-goals), but worth stating so nobody adds a load balancer and wonders why rooms vanish.

### 3.3 Code Quality

**Q1 — MEDIUM: Orphaned disconnect timers.**
`server/src/game.ts:903-923`: `handlePlayerDisconnect` does `this.disconnectTimers.set(playerId, timer)` without clearing any existing timer for that player. `Map.set` overwrites the *reference*, but the old `setTimeout` still fires — and the in-turn branch's callback calls `this.advanceTurn()` (`game.ts:911`). A rapid disconnect/reconnect/disconnect sequence leaves a ghost timer that can skip a turn after the player is back. Fact (verified by reading the function; not reproduced live).

**Q2 — LOW: `restart-game` fallback branch doesn't clear engine timers.**
`server/src/rooms.ts:623-632`: when no engine exists the room is reset manually without timer cleanup. The branch is defensive (an engine is created with every room at `rooms.ts:230-232`), so likely unreachable — but it's a trap if room/engine lifecycles ever diverge. Fact.

**Q3 — LOW: Inconsistent store mutation pattern.** Client code mixes Zustand action methods with raw `useGameStore.setState()` calls (e.g. `app/src/hooks/useSpotifyPlayer.ts:51-54, 86, 96`; `app/src/components/Game.tsx:91, 253`), making "where did this state change come from" harder to answer. Fact (pattern), Low `[judgment]` on impact.

Otherwise quality is solid for the maturity level: no `any`-typed public APIs in shared events, optional chaining used defensively, dead code minimal.

### 3.4 Testing

**T1 — HIGH: There are zero tests.** No `*.test.*`/`*.spec.*` files, no test runner config, no `"test"` script in any of the four `package.json` files (verified by `find`/`grep`, §7). The 1,079-line `GameEngine` — placement scoring, challenge resolution with steal mechanics, token economy, disconnect grace, four game modes — is exercised only by playing the game. Combined with D1 (auto-merge to main), every refactor is a leap of faith. Fact.

The only verification currently enforced is the TypeScript compiler, which to its credit passes strictly across all three workspaces.

### 3.5 Performance

Healthy overall for ≤12-player rooms; two real items:

**P1 — MEDIUM:** Unbounded client strings hit the fuzzy-match regexes (same as S6 — the performance face of that finding).
**P2 — LOW:** The client ships as one 501.74 KB JS chunk (build output, §7); `app/src/data/trivia.ts` (1,115 lines of static trivia) and all screens are bundled eagerly. A dynamic import for trivia + route-level splitting would cut initial load meaningfully on party-guest phones. Fact.
Minor: `rememberRecent` does `indexOf`+`splice` per song (`server/src/songs.ts:23-40`) — O(n²)-ish but bounded at 250 entries; not worth fixing on its own.

### 3.6 Dependencies

Covered in S8 for vulnerabilities. Beyond that: lockfile is present and consistent (`npm install` is clean); versions are recent — outdated majors are limited to deliberate-looking holds (`express` 4→5, `vite` 6→8, `uuid` 10→14, `motion` 11→12; full table in §7). Nothing unmaintained or duplicated. One hygiene item: **`hitster-clone.zip` (39 KB prototype snapshot) is committed at the repo root** — dead weight and confusing for newcomers. Fact.

### 3.7 DevEx & Operations

**D1 — HIGH: The only CI workflow auto-merges to `main` with no checks.**
`.github/workflows/auto-merge.yml` triggers on any push to `claude/**`, then `git merge` + `git push origin main` — no build, no type-check, nothing. A push that doesn't even compile lands on `main` (and presumably the deploy branch) immediately. Note: *this very audit branch will auto-merge when pushed.* Fact.

**D2 — MEDIUM: No lint or format enforcement.** No ESLint/Prettier config anywhere (verified, §7). Style is currently consistent by author discipline alone. Fact.

Positives: `GET /health` endpoint with uptime/room counts (`server/src/index.ts`), structured JSON logger with levels and prod/dev formats (`server/src/logger.ts`), sensible multi-stage Dockerfile with a data-seed entrypoint, `docker-compose.yml`, `.env.example` files at root and app level. Setup (`npm install` && `npm run dev`) works as documented.

### 3.8 Documentation

Healthy: the README's claims were spot-checked and held up (614 songs verified against `data/songs.json`; feature list matches code; project-structure section matches reality), and PLAN/ROADMAP/DESIGN-BRIEF document intent. No findings worth space.

### 3.9 Strengths (preserve these)

1. **End-to-end type safety.** Shared workspace exports typed Socket.io event maps (`shared/src/events.ts`) consumed by both sides; `tsc --noEmit` strict passes across all workspaces.
2. **Zero SQL injection surface.** Every query in `server/src/database.ts` uses prepared statements with `?` placeholders; no string-built SQL anywhere (grep-verified).
3. **Correct, careful PKCE OAuth** (`app/src/services/spotify.ts:17-52`, `callback.html`) — RFC 7636 S256, verifier cleanup, listener removal after popup close.
4. **Hard-won browser/Spotify robustness:** multi-method audio unlock (`spotifyPlayer.ts:26-51`), device-registration polling with fallback (`spotifyPlayer.ts:176-217`), deliberate StrictMode removal with an explanatory comment (`app/src/main.tsx:5-12`), session restore with 12 h TTL (`app/src/services/socket.ts:41`).
5. **Operational hygiene unusual for a hobby project:** structured logging with token truncation, health endpoint, SQLite WAL persistence across restarts, 30 s disconnect grace with host reassignment.

---

## 4. Improvement Strategy

### Themes

**T-A: No safety net (explains D1, D2, T1).** Every change ships to `main` unverified. *Target state:* CI runs build + tests on every push; auto-merge (if kept) is gated on CI green. *Principle:* the cost of every other fix in this plan is a function of how safe it is to change code.

**T-B: Credentials handled below the bar (S1, S2, S3, S9).** Real users' passwords and Spotify tokens deserve standard practice even in a hobby app. *Target state:* bcrypt/argon2 with migration, tokens never at rest in plaintext. *Principle:* people reuse passwords; your DB leak is their email leak.

**T-C: Open trust boundary (S4, S5, S6, P1).** The server is correctly authoritative for game *logic*, but the perimeter — origin, rate, payload shape — is unenforced. *Target state:* CORS allowlist, per-socket throttle, length-capped validated payloads. *Principle:* validate at the boundary once, trust internally after.

**T-D: Risk concentration in god files (A1, A2, Q1).** The four biggest files take most churn with no tests. *Target state:* `Game.tsx` and `rooms.ts`/`game.ts` decomposed along phase/handler seams, duplication consolidated — *after* T-A provides cover. *Principle:* refactor behind tests, never before them.

### Explicit non-goals

- **Horizontal scaling / Redis / sticky sessions** — single-instance in-memory state (A3) is the right call for a party game; revisit only if concurrent rooms exceed one box.
- **Major framework bumps** (Express 5, Vite 8, uuid 14, Motion 12) — no current vulnerability requires them; churn-to-payoff is poor right now.
- **A full BFF for Spotify tokens** — the right *eventual* fix for S2, but encrypt-or-don't-persist (M1-T4) buys most of the risk reduction for a fraction of the effort.
- **High global test coverage / E2E suite** — aim tests at `GameEngine`, `fuzzy`, and account logic, not at JSX.

### Definition of done (measurable)

- CI fails the merge on type-check, lint, or test failure; auto-merge depends on it.
- Zero Critical and zero High security findings remain (S1–S5 resolved).
- `server/src/game.ts` core paths (placement, challenge resolution, tokens, turn advance) covered by unit tests; server workspace line coverage ≥ 70%.
- `npm audit` reports no high/critical advisories in production dependencies.
- No source file exceeds ~600 lines after M2 (current max 1,162).

---

## 5. Task Plan

### Milestone table

| ID | Status | Title | Effort | Risk | Depends on |
|---|---|---|---|---|---|
| M0-T1 | todo | CI workflow: build + type-check gate; chain auto-merge to it | S | Low | — |
| M0-T2 | todo | Add vitest to server workspace; tests for `fuzzy.ts` + `shuffle.ts` | S | Low | — |
| M0-T3 | todo | Unit tests for `GameEngine` core paths (fake io, fake timers) | L | Low | M0-T2 |
| M0-T4 | todo | ESLint + Prettier across workspaces, wired into CI | M | Low | M0-T1 |
| M1-T1 | todo | bcrypt password hashing with rehash-on-login migration; min length 8 | M | Med | M0-T1 |
| M1-T2 | todo | CORS allowlist via env var (Express + Socket.io) | S | Low | — |
| M1-T3 | todo | `npm audit fix` (resolves prod `ws` chain); verify build | S | Low | M0-T1 |
| M1-T4 | todo | Stop persisting Spotify tokens in plaintext (drop column or encrypt) | M | Med | M0-T3 |
| M1-T5 | todo | Socket payload validation: type/length guards on all event inputs | M | Low | M0-T3 |
| M1-T6 | todo | Rate limiting: login attempt limiter + per-socket event throttle | S | Low | — |
| M2-T1 | todo | Decompose `Game.tsx` into phase components + `useGameTimers`/`useSoundEffects` hooks | L | Med | M0-T1 |
| M2-T2 | todo | Extract challenge resolution from `resolveRound`; split `registerRoomHandlers` by domain | M | Med | M0-T3 |
| M2-T3 | todo | Consolidate duplicate `getToken`/`initPlayer` into one hook | S | Low | — |
| M2-T4 | todo | Fix orphaned disconnect timers (clear before `set`, game.ts:914/922) | S | Low | M0-T3 |
| M3-T1 | todo | Remove `hitster-clone.zip` from repo | S | Low | — |
| M3-T2 | todo | Code-split trivia data + vendor chunks (target <300 KB initial JS) | S | Low | — |
| M3-T3 | todo | Dockerfile: `ARG VITE_SPOTIFY_CLIENT_ID` instead of hardcoded value | S | Low | — |
| M3-T4 | todo | `crypto.randomInt` room codes; `timingSafeEqual` password compare | S | Low | M1-T1 |
| M3-T5 | todo | Within-major dependency bumps (tailwind, zustand, better-sqlite3, …) | S | Low | M0-T1 |

**Acceptance criteria per task** (checkable):
- **M0-T1:** A workflow runs `npm ci && npm run build` on every push/PR; `auto-merge.yml` either removed or made a dependent job that only runs on success; a deliberately broken push does not reach `main`.
- **M0-T2:** `npm test --workspace=server` exists and passes; ≥10 assertions over `fuzzyMatch` (typos, feat-stripping, unicode) and shuffle distribution.
- **M0-T3:** Tests cover: correct/incorrect placement in all 4 modes; challenge win→steal, lose→token loss; duplicate challenge position rejection; buy-card token math; turn advance skipping disconnected players; timers cleared on `resetGame`. Coverage on `game.ts` ≥ 70%.
- **M0-T4:** `npm run lint` exists at root and is a CI step; zero errors on baseline.
- **M1-T1:** New hashes are bcrypt (cost ≥ 10); existing SHA-256 users log in successfully once and are transparently rehashed; registration rejects <8 chars.
- **M1-T2:** With `ALLOWED_ORIGINS` set, a socket connection from another origin is refused; same-origin works.
- **M1-T3:** `npm audit --omit=dev` reports zero moderate+ advisories; build passes.
- **M1-T4:** `spotify_token` no longer readable in plaintext from `rooms` table (column dropped, or `SELECT` shows ciphertext); restored rooms still recover playback (or prompt the host to reconnect Spotify).
- **M1-T5:** `name-song` with a 1 MB title is rejected before reaching `fuzzy.ts`; all socket payloads pass through a guard that caps string length at 500.
- **M1-T6:** ≥10 failed logins per socket/minute are rejected; ≥20 game events per second per socket are dropped.
- **M2-T1:** `Game.tsx` < 400 lines; phase UIs render from dedicated components; no behavior change (manual playthrough of one full game per mode).
- **M2-T4:** Calling `handlePlayerDisconnect` twice for the same player leaves exactly one live timer (asserted with fake timers).
- **M3-T1:** `git ls-files | grep zip` returns nothing.
- **M3-T2:** Initial JS chunk < 300 KB; trivia loads as a separate chunk on first `WaitingState` render.

### Quick wins (high impact, S effort)
**M0-T1** (CI gate — the single highest-leverage change in this plan), **M1-T2** (CORS), **M1-T3** (audit fix), **M1-T6** (rate limits), **M3-T1** (delete zip).

### Implementation sketches — top 3

**M0-T1 — CI gate.** Add `.github/workflows/ci.yml`: checkout → `actions/setup-node@v4` (node 20, npm cache) → `npm ci` → `npm run build` (later `npm run lint`, `npm test`). Then either delete `auto-merge.yml` (recommended — merge via PR) or convert merging into a second job with `needs: build`. Gotcha: `better-sqlite3` compiles a native module — `npm ci` needs build tools, which ubuntu-latest has; cache `~/.npm` not `node_modules`.

**M1-T1 — bcrypt migration.** Add `bcrypt` to server deps. In `accounts.ts`: `hashPassword` → `bcrypt.hashSync(pw, 10)`; in `login`, branch on hash shape — if stored hash matches `/^[0-9a-f]{64}$/` (legacy SHA-256), compare via the old function and on success immediately `saveAccount` with a bcrypt hash; otherwise `bcrypt.compareSync`. Raise min length to 8 in `createAccount` (registration only — don't lock out existing users). Gotcha: bcrypt's 72-byte input cap (fine here); keep the sync API — calls are rare and the rest of the file is sync.

**M0-T3 — GameEngine tests.** `GameEngine` takes `(room, io)` — construct a real `Room` object and a fake `io` (`{ to: () => ({ emit: spy }) }`). Use vitest fake timers to drive turn/challenge/disconnect timeouts deterministically. Seed decks directly on the engine rather than via `songs.ts` (avoids Spotify resolution). Start with `resolveRound`'s decision table: active-correct/no-challenge, active-wrong/challenger-correct (steal), both-wrong, multi-challenger position priority. Gotcha: engine mutates `room` in place — assert on the room object, not on emitted payloads alone.

---

## 6. Open Questions

1. **Is the server publicly reachable today?** S1/S4/S5 severities assume yes (Docker + production env suggests so). If it's LAN-party-only, High findings drop a notch — Critical S1 stays, since the DB still holds reusable passwords.
2. **Are accounts worth keeping?** They're optional (guest fallback exists). Going guest-only + Spotify-for-host would delete the Critical finding entirely. Product call.
3. **Is auto-merge-to-main intentional as a solo-dev convenience?** If yes, gate it on CI (M0-T1) rather than removing it. If `main` auto-deploys somewhere, say so — it raises the stakes of D1.
4. **Spotify token persistence:** is "host must reconnect Spotify after a server restart" an acceptable UX? If yes, M1-T4 is trivial (drop the column); if no, it needs the encryption variant.
5. **Can `hitster-clone.zip` be deleted?** It looks like the pre-rewrite prototype, fully superseded.
6. **Any ambition beyond one server instance?** Determines whether A3 ever graduates from non-goal.

---

## 7. Evidence Appendix

Commands run from repo root (`/home/user/Tunes`), 2026-06-11:

| Command | Key output |
|---|---|
| `git status; git branch -a; git log --oneline` | Clean tree; branch `claude/confident-goldberg-7b0to6`; 88 commits, 2026-03-25 → 2026-04-30 |
| `wc -l` over all source files | 10,070 total; largest: `Game.tsx` 1,162 · `trivia.ts` 1,115 · `game.ts` 1,079 · `Lobby.tsx` 854 · `rooms.ts` 794 |
| `git log --format= --name-only \| sort \| uniq -c \| sort -rn` | Churn: `Game.tsx` 24, `rooms.ts` 14, `songs.ts` 13, `Lobby.tsx` 13, `game.ts` 12 |
| `find . -name '*.test.*' -o -name '*.spec.*'` (+ grep for `"test"` scripts) | **No test files; no test scripts in any package.json** |
| `ls .eslintrc* eslint.config.* .prettierrc*` | No lint/format config exists |
| `npm install` | Clean install, no errors |
| `npm run build` | All 3 workspaces build; `tsc --noEmit` passes; bundle: `index-CUF1nly6.js` **501.74 KB** (gzip 152.27) with Vite >500 KB chunk warning |
| `npm audit` | **14 vulnerabilities (2 critical, 2 high, 10 moderate).** Critical: `shell-quote` GHSA-w7jw-789q-3m8p via `concurrently` (dev-only). High: `vite` ≤6.4.1 GHSA-4w7w-66w2-5vf9 / GHSA-p9ff-h696-f583 (dev server only). Production-relevant: `ws` 8.0.0–8.20.0 GHSA-58qx-3vcg-4xpx via `engine.io`/`socket.io-adapter`. Fix available via `npm audit fix` |
| `npm outdated` | Majors held: express 4.22→5.2, vite 6.4→8.0, uuid 10→14, motion 11→12, lucide 0.460→1.17, TS 5.9→6.0; rest are patch/minor |
| `python3 -c "...len(json.load(open('data/songs.json')))"` | **614** songs — matches README |
| `unzip -l hitster-clone.zip` | Old prototype source (17 files, dated 2026-03-23) |
| `cat .github/workflows/auto-merge.yml` | Single workflow: on push to `claude/**` → merge into `main` → push; **no build/test steps** |
| Targeted reads/greps | `accounts.ts:22-24` (SHA-256), `accounts.ts:64-66` (3-char min), `accounts.ts:92` (`!==` compare), `index.ts:15,40` (CORS), `callback.html:69` (refresh token → localStorage), `database.ts:34,126-145` (plaintext token column), `Dockerfile:22` (hardcoded client ID), `rooms.ts:45-53` (`Math.random` codes), `rooms.ts:197-201` (name validation present), `rooms.ts:580-585` (unvalidated `guess`), `rooms.ts:623-632` (restart fallback), `game.ts:903-923` (timer overwrite), `game.ts:598` (`resolveRound` start) |

Two read-only Explore subagents performed full-file reviews of `server/src/*` + `shared/src/*` and `app/src/*` respectively; every finding they reported that appears above was independently re-verified against the source before inclusion.
