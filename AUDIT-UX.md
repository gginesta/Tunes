# Tunes — UX Audit

> Date: 2026-06-12 · Branch: `claude/confident-goldberg-7b0to6` (post-improvement-plan)
> Method: full read of every screen component + **live testing** of the running app (Playwright,
> headless Chromium, 390×844 mobile viewport, two simultaneous browser contexts simulating host
> and guest). Screenshots in `audit-evidence/ux/`. Findings marked **(live)** were reproduced in
> the running app; the rest cite code. Facts vs `[judgment]` labelled as in AUDIT.md.

---

## 1. Executive Summary

**UX grade: B.** For a hobby party game this is genuinely polished: a coherent "Vinyl & Neon"
visual system, mode descriptions at the point of choice, token costs printed on the buttons
that spend them, invite deep-links that pre-fill the room code, session restore that survives
phone-locking, and disconnect banners with live countdowns. The flows tested live (host →
lobby → guest join → settings → start) worked smoothly end-to-end. The grade loses ground in
two places: **dead ends** — the app advertises "Host without Spotify" on the home screen and
only reveals *after* the host has configured everything and pressed START that preview mode
has zero playable songs, and the invite deep-link renders an enabled "Join Room" button that
silently does nothing when the name field is empty; and **error communication** — errors never
auto-dismiss, rejoin failures are indistinguishable from other errors, and mid-game Spotify
errors give the host no instruction on how to recover. All top issues are small fixes (S/M
effort); none require redesign.

---

## 2. What was tested live

| Flow | Result | Evidence |
|---|---|---|
| Home → name → Host a Room → host options | ✅ smooth | `01–03*.png` |
| Host without Spotify → Lobby (room JWAL) | ✅ smooth; clear preview-mode banner | `04-lobby-host.png` |
| Settings: modes, cards-to-win, song packs, regional packs | ✅ clear, well-labelled | `05–07*.png` |
| Guest join via 4-letter code (2nd browser context) | ✅ both lobbies update instantly | `08–11*.png` |
| START in preview mode | ❌ fails only at the last step — see UX-1 | `12-start-game-error.png` |
| Rules, Leaderboard (empty), My Stats (empty) | ✅ good empty states | `13–16*.png` |
| Invite deep-link `/join/JWAL` | ✅ code pre-filled + banner; ❌ dead tap — see UX-2 | `17`, `18-join-dead-tap.png` |
| In-game screens | not reachable without Spotify credentials — reviewed via code + the 379-line decomposed `Game.tsx` and `components/game/*` | — |

---

## 3. Findings

### High

**UX-1 — Preview mode is advertised up front but fails only at the very last step. (live)**
Home promises "Host without Spotify — 30s preview clips, no account needed"
(`app/src/components/Home.tsx:341-345`). The host then names themselves, creates a room,
configures mode/packs, gathers players — and only after pressing START GAME sees
*"No song previews available. Please use 'Host with Spotify' to play."*
(`server/src/rooms.ts:482-486`, screenshot `12-start-game-error.png`). Root cause: 0 of 614
songs in `data/songs.json` carry a `previewUrl` (verified), and nothing checks this before the
final step. Fix options: run `scripts/prebake-previews` to actually populate previews, and/or
have the server expose preview availability so Home can disable/hide the option with an honest
label. The worst version of this is at a party: five people in the lobby, host hits START,
nothing works. Fact.

**UX-2 — Invite deep-link leads to an enabled button that silently does nothing. (live)**
`/join/CODE` pre-fills the code beautifully (`17-invite-deeplink.png`) — but with the name
field empty, "Join Room" renders enabled (its `disabled` only checks code length,
`Home.tsx:466`) while `handleJoin` silently returns on empty name (`Home.tsx:124-126`).
Verified live: tap → nothing happens, no message (`18-join-dead-tap.png`). An invited guest's
*first* interaction with the app is a button that doesn't work. Fix: include
`!name.trim()` in the `disabled` condition and auto-focus the name field on deep-link entry.
Fact.

**UX-3 — Errors never expire and share one global slot.**
All server errors land in a single store field (`useSocket.ts:185-191` → `store.error`)
rendered in Lobby (`Lobby.tsx:256-263`, `825-829`) and Game; nothing ever auto-dismisses it,
and it survives context changes until some action happens to call `setError(null)`. A playlist
error from minutes ago still glows red while the user does something unrelated, implying the
*current* action failed. Fix: clear on a timer and on any successful subsequent event. Fact.

**UX-4 — Mid-game Spotify errors give the host no recovery instruction.**
`Game.tsx` shows the raw `spotifyError` string in a banner. Messages like a device-not-found
state don't tell a non-technical host the actual remedy ("open Spotify on this phone, then tap
play"). Given the host's device *is* the party's speakers, this is the single most stressful
failure in the product. Map known error classes to actionable copy. Fact (raw passthrough);
`[judgment]` on severity.

### Medium

**UX-5 — START failure window is silent.**
`handleStart` disables the button and shows "STARTING…", which is good — but if the server
never responds, a blind 10-second timeout (`Lobby.tsx:140-142`) just re-enables the button
with no message. The host sees STARTING… revert to START GAME and learns nothing. Add a
"Server not responding — try again" error when the timeout fires without a phase change. Fact.

**UX-6 — Backgrounded players miss the challenge window with no explanation.**
The app requests notification permission and notifies on "It's your turn!"
(`useSocket.ts:78`, `97-99`) — but not when a challenge window opens. A player who locks
their phone during someone else's placement returns to find the round revealed and their
challenge chance gone, with no cue that it happened. Notify (or show a returning-player toast)
for challenge windows too. Fact.

**UX-7 — Challenge placement doesn't say whose timeline you're touching.**
During a challenge you pick a position on the *active player's* timeline, but the instruction
("Pick where YOU think it belongs, then challenge", `components/game/ChallengeBar.tsx`)
never says so. First-timers who've spent the whole game looking at their own timeline can
mis-place their challenge. One added phrase fixes it. `[judgment]` on frequency; the ambiguity
is fact.

**UX-8 — 14px inputs trigger iOS Safari auto-zoom mid-game.**
The song-naming inputs use `text-sm` = 14px (`components/game/NamingForm.tsx:71, 84, 93`), as
does the playlist URL input (`Lobby.tsx:558`); the viewport meta (`app/index.html:5`) does not
constrain zoom, so iOS zooms the page when these fields focus — disorienting in the middle of
a timed turn. Use 16px on inputs. Fact (recent commit history shows iOS quirks are already a
known battleground here).

**UX-9 — A failed rejoin looks like a generic error.**
Sessions restore via localStorage with a 12 h TTL (`services/socket.ts:31-64`) — a genuinely
great mechanism — but when restore fails (room cleaned up, TTL expired) the user just gets the
server's generic "Room not found or player unknown" with no framing ("Your game session
expired — join a new room"). Fact.

**UX-10 — Late joiners receive no briefing.** `[judgment]`
Late joining is supported (deal-in, turn-order insertion — `server/src/game.ts:164-206`), but
the joiner lands in WaitingState trivia with no summary of mode, target score, or standings.
A one-shot "You're in! Original mode, first to 10 cards, Maria leads with 4" toast would
orient them.

**UX-11 — Timeline horizontal scrollability is invisible.** `[judgment]`
The timeline hides its scrollbar (`index.css` `hide-scrollbar`) and nothing signals there are
cards past the right edge. Auto-scroll on selection (`components/game/TimelineStrip.tsx:46-54`)
mitigates this once a player interacts, but first-time discovery relies on accident. An edge
fade-out gradient or a one-time swipe hint would fix discovery.

### Low

**UX-12 — Guests waiting in the lobby have no escape hint.** "Waiting for host to start…"
(`10-lobby-guest.png`) pulses forever with no guidance if the host wandered off. Fact; Low for
a couch context where the host is in the room.
**UX-13 — Disabled buttons at `opacity: 0.4`** (`index.css`) are subtle on a dark screen at
party brightness; a tap on disabled PLACE CARD reads as "app is broken". `[judgment]`
**UX-14 — Reduced-motion coverage is partial.** A `prefers-reduced-motion` block exists in
`index.css` (good — many hobby apps have none), but motion/react-driven animations (confetti
pieces in `Results.tsx:14-45`, spring transitions) don't consult it. `[judgment]` on impact.
**UX-15 — Icon-only state buttons lack `aria-pressed`** (mute toggle, play/pause in
`GameTopBar.tsx`/`VinylDeck.tsx` — labels exist, state doesn't). Fact; Low.

### Findings checked and rejected

- "Token costs not visible at the moment of decision" — **false**: buttons read
  `Skip · 1★` / `Buy · 3★` and disable when unaffordable (`Game.tsx:340-364`). Counted as a
  strength.
- "START button remains clickable while starting" — **false**: `disabled={starting || …}`
  (`Lobby.tsx:833-840`). The real (smaller) issue is UX-5.

---

## 4. Strengths (preserve these)

1. **Session restore that matches real party behavior** — phones lock, Safari kills tabs;
   localStorage session + auto-rejoin (`services/socket.ts:21-64`, `useSocket.ts:14-22`)
   makes that a non-event. This is the most valuable UX decision in the app.
2. **Invite deep-links done right (modulo UX-2)** — `/join/CODE` pre-fills the code and shows
   "You've been invited to room JWAL!" (`17-invite-deeplink.png`).
3. **Decisions explained at the point of choice** — mode cards carry one-line descriptions,
   the lobby shows a "Preview mode: 30-second clips…" context banner, costs are printed on
   the spending buttons (`04-lobby-host.png`, `Game.tsx:340-364`).
4. **Disconnects are communicated, not mysterious** — banner with the player's name and a
   live grace-period countdown, plus turn-paused state (`components/game/DisconnectBanners.tsx`).
5. **Redundant turn-time signalling** — gradient stripe + numeric countdown pill with color
   ramp (`Game.tsx:220-274`), so the deadline is never a surprise.
6. **Action feedback is immediate** — "Challenge submitted!" confirmation, buy-card toast,
   buzz overlay for the active player (`ChallengeBar.tsx:71-73`, `BuzzAlert.tsx`).
7. **Every empty state is designed** — leaderboard, stats, history all have friendly copy
   (`15-leaderboard-empty.png`, `16-profile-empty.png`), including the new stage-name note.
8. **Consistent, characterful design system** — the Vinyl & Neon language holds across all
   screens at mobile viewport (all screenshots), with `aria-label`s on icon buttons and a
   `prefers-reduced-motion` block present.

---

## 5. Recommended fixes (prioritized)

| ID | Status | Fix | Effort | Addresses |
|---|---|---|---|---|
| UXF-1 | todo | Gate "Host without Spotify" on actual preview availability (server flag) — or prebake previews via `scripts/prebake-previews` so the mode works | S–M | UX-1 |
| UXF-2 | todo | Disable Join Room without a name + autofocus name on deep-link | S | UX-2 |
| UXF-3 | todo | Error lifecycle: auto-dismiss after ~6 s, clear on next successful event; distinct copy for expired-session rejoin | S | UX-3, UX-9 |
| UXF-4 | todo | Map Spotify error classes to actionable host instructions; add "Server not responding" on START timeout | S | UX-4, UX-5 |
| UXF-5 | todo | Notify/toast for challenge-window on backgrounded devices; clarify challenge copy ("…on **{name}'s** timeline") | S | UX-6, UX-7 |
| UXF-6 | todo | 16px input font sizes (NamingForm, playlist URL) | S | UX-8 |
| UXF-7 | todo | Late-joiner briefing toast; timeline edge-fade scroll affordance | M | UX-10, UX-11 |
| UXF-8 | todo | Polish: aria-pressed on toggles, stronger disabled affordance, reduced-motion for confetti | S | UX-13–15 |

**Done means:** an invited guest with an empty name field cannot tap a dead button; a host
can never reach a configured lobby whose START is guaranteed to fail; no error message
outlives its relevance; every Spotify failure tells the host what to do next.

---

## 6. Evidence Appendix

- Live run: `npm run dev` (server :3000, Vite :5173); Playwright 1.56.1 headless Chromium,
  viewport 390×844 (`isMobile`, `hasTouch`), three contexts (host, guest, fresh visitor).
  Driver: `/tmp/uxdrive/drive.js` (session-scoped, not committed).
- Screenshots (committed): `audit-evidence/ux/01–18*.png` — home, host flow, lobby (host +
  guest, 1 and 2 players), settings panels, join flow, start-game error, rules, empty
  leaderboard/profile, invite deep-link, dead-tap repro.
- Preview-availability check: `python3` count of `previewUrl` in `data/songs.json` → 0/614.
- Code citations verified against working tree at commit `b939c5d`.
- One UI code-review subagent (read-only) swept all screen components; its findings were
  spot-checked before inclusion — two were rejected as factually wrong (§3, "checked and
  rejected").
