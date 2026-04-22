# Tunes — Visual Redesign Brief

> **Audience:** Claude Design (or any designer/design agent picking this up).
> **Objective:** Re-skin the entire Tunes app around the winning direction from the mockup gallery. Game logic, routing, socket events, and data structures stay as-is — this is a visual refresh.

---

## 1. Context

**Tunes** is a real-time multiplayer music party game. A host connects to Spotify and creates a 4-letter room code; 2–12 players join and race to build a chronological timeline of hit songs.

- **Platform:** Responsive web. Mobile-first (primary target is phones passed around a party), but plays on tablet and desktop too.
- **Session length:** 20–40 minutes. High-energy, social, played with the app visible to everyone at the table.
- **Tech stack (informational, not changing):** React 19, Vite, Tailwind CSS 4, Zustand, Motion (Framer Motion successor), TypeScript. Socket.io backend.
- **Sounds are already wired** (correct, wrong, challenge, stolen, tick, start). Don't redesign audio; just know it exists.

**Core loop per turn:**
1. Mystery song plays on host's device
2. Active player places a card on their timeline (45–60s timer)
3. Other players have 15s to spend a token and challenge
4. Reveal — right = keep, wrong + challenger = stolen, wrong alone = discarded
5. First to 10 cards wins (configurable 5–15)

**Modes:** Original · Pro (must name song) · Expert (must also guess year) · Co-op (shared timeline).

**Tokens:** Starting 2, max 5. Skip (1) · Challenge (1) · Buy card (3) · Name song correctly (+1).

Full game spec lives in `README.md`.

---

## 2. The Decision

**Direction:** Vinyl & Neon (Direction A from the mockup gallery).

**Reference files on branch `claude/redesign-game-ui-Tb4Dh`:**
- Gallery: `mockups/index.html`
- **Source of truth:** `mockups/vinyl-neon.html`
- Live preview: `https://raw.githack.com/gginesta/Tunes/claude/redesign-game-ui-Tb4Dh/mockups/vinyl-neon.html`

**Unanimous feedback from user-testing:**
- Catalina — "Most aesthetic. All the text is easiest to read, especially the years on the cards. The other ones are either too small or the font isn't the nicest."
- Axel — "Vinyl and neon."
- Thomas — "Looks readable and modern. I like the cassette look but not very readable."

**Guardrails from that feedback (non-negotiable):**
- **Readability comes first.** The winning mockup struck a balance of beautiful + legible. Don't push aesthetic at the expense of legibility — that's what sank Cassette.
- **Year typography on cards is a signature element.** Big, chunky, amber, unmistakably the year. Preserve and elevate.
- **Don't introduce decorative body text.** Only the display font (Bowlby One) is permitted for numbers/headlines. Body text must remain in Space Grotesk or similar clean sans.

---

## 3. Brand & Mood

- **Feel:** Night-club meets record shop meets rec-room mixtape. Analog warmth + neon glow.
- **Personality:** Playful but grown-up. Musical, not childish. Confident, not loud.
- **Metaphor:** The app is the DJ booth for a house party. Every screen should feel like it's playing music.
- **Emotional arc:**
  - Home → anticipation ("drop the needle")
  - Lobby → assembly ("line up the crew")
  - Game → focus + adrenaline ("read the groove, call the decade")
  - Results → celebration ("encore")

**Never look like:** a crypto dashboard, a SaaS settings page, Spotify itself, or a kids' game.

---

## 4. Design System

### 4.1 Color Tokens

All colors below are the canonical source. Implement as CSS variables under `:root` and expose to Tailwind via `@theme` in `app/src/index.css`.

#### Core brand — "Tri-color neon"

| Token | Hex | Usage |
|---|---|---|
| `--neon-pink` | `#ff2e9a` | **Primary action.** Main CTAs (Host, Place Card, Start), active states, the wordmark accent, hot highlights. |
| `--neon-cyan` | `#22e6ff` | **Secondary action / info.** Outlined buttons (Join), info chips, secondary glows, "Show mine" toggles. |
| `--neon-amber` | `#ffbe3d` | **Numbers & warnings.** Year on timeline cards, token count (★), turn timer, pending placement, trivia highlights. |
| `--neon-violet` | `#a855f7` | **Mode accent.** Pro mode pills, expert-mode cues, subtle tonal variation. |

#### Surface — "Deep plum"

| Token | Hex | Usage |
|---|---|---|
| `--bg-base` | `#0a0318` | App background (outermost). |
| `--bg-elev-1` | `#120528` | Panel background. |
| `--bg-elev-2` | `#1a0839` | Raised panel (lobby cards, modals). |
| `--bg-elev-3` | `#260d4f` | Phone-frame-like top chrome, headers. |

#### Text

| Token | Value | Usage |
|---|---|---|
| `--text-primary` | `#ffffff` | Headings, body-prominent, numbers. |
| `--text-secondary` | `rgba(255,255,255,0.65)` | Body, descriptions. |
| `--text-tertiary` | `rgba(255,255,255,0.40)` | Metadata, captions, inactive labels. |
| `--text-quat` | `rgba(255,255,255,0.25)` | Placeholder, disabled. |

#### Semantic

| Token | Hex | Usage |
|---|---|---|
| `--success` | `#22c55e` (with `#4ade80` glow) | Correct placement, card kept, gain-token toast. |
| `--error` | `#ef4444` (with `#f87171` glow) | Wrong placement, stop-game, input error. |
| `--warning` | `#ffbe3d` (reuses `--neon-amber`) | Pending, warning banners, pre-timeout timer. |
| `--info` | `#22e6ff` (reuses `--neon-cyan`) | Info banners, neutral notices. |

> **Do not** introduce a fifth brand color. Tri-color + violet accent is intentional — more colors dilute the palette.

> **Reveal cards** use success/error as gradient pairs (`from-green-500 to-emerald-700` / `from-red-500 to-rose-700`), not neon pink/cyan. Semantic colors must stay distinct from brand colors so "correct" never looks like "primary action".

### 4.2 Typography

Three families. No fourth.

| Token | Family | Weights | Use |
|---|---|---|---|
| `--font-display` | **Bowlby One** | 400 (only) | Hero wordmark "TUNES", card years ('87, '91…), reveal-screen year, Results winner number. Numbers and one- or two-word headlines ONLY. Never body. |
| `--font-heading` | **Unbounded** | 500, 700, 900 | Section headings, screen titles, "Your Turn" callouts, modal titles. |
| `--font-body` | **Space Grotesk** | 400, 500, 600, 700 | Everything else: descriptions, buttons, inputs, chips, labels. |

#### Type scale (rem/px reference, mobile baseline)

| Role | Size | Line-height | Family | Weight | Notes |
|---|---|---|---|---|---|
| `display-xl` | 72px (4.5rem) | 1.0 | Display | 400 | Home wordmark |
| `display-l` | 56px | 1.0 | Display | 400 | Reveal year, winner score |
| `display-m` | 40px | 1.0 | Display | 400 | Timeline card year (visual bold presence) |
| `h1` | 32px | 1.1 | Heading | 700 | Screen titles |
| `h2` | 24px | 1.15 | Heading | 700 | Panel titles, winner name |
| `h3` | 18px | 1.2 | Heading | 600 | Subsections |
| `body-l` | 17px | 1.5 | Body | 500 | Primary body |
| `body` | 15px | 1.5 | Body | 400 | Default body |
| `body-s` | 13px | 1.45 | Body | 500 | Secondary descriptions, button labels |
| `label` | 11px | 1.2 | Body | 700 | All-caps labels with `letter-spacing: 0.2em` |
| `micro` | 10px | 1.2 | Body | 700 | All-caps micro labels; tabular-nums for counters |

**Numeric guidance:** anywhere a number needs to be counted quickly (score `4/10`, timer `0:38`, tokens `★2`), use `tabular-nums` and `font-variant-numeric: tabular-nums`. All card years use `font-display` (Bowlby One) for instant recognition.

### 4.3 Spacing

4px base. Expose as Tailwind spacing scale (already default). Commonly used:

| Token | px | Use |
|---|---|---|
| `space-1` | 4 | Tight gaps, chip internals |
| `space-2` | 8 | Button internals, chip gaps |
| `space-3` | 12 | Card internals |
| `space-4` | 16 | Panel padding (mobile) |
| `space-5` | 20 | Panel padding (comfortable) |
| `space-6` | 24 | Section gaps, card outer padding (desktop) |
| `space-8` | 32 | Major vertical rhythm |
| `space-10` | 40 | Hero spacing |

**Panel padding rule:** 20px inside panels on mobile, 24–28px on desktop.
**Screen padding rule:** 16–24px horizontal on mobile, `max-w-lg` (≤512px) centered on tablet+, with ample horizontal room to breathe on desktop.

### 4.4 Radii

| Token | px | Use |
|---|---|---|
| `radius-xs` | 6 | Chips |
| `radius-sm` | 10 | Inputs, small buttons |
| `radius-md` | 14 | Buttons, mini cards |
| `radius-lg` | 18 | Timeline cards, default buttons |
| `radius-xl` | 22 | Large buttons, playlist cards |
| `radius-2xl` | 28 | Panels, modals |
| `radius-3xl` | 36 | Phone-chrome framing, hero panels |
| `radius-full` | 9999 | Pills, circles, vinyl |

### 4.5 Elevation, Glow & Texture

No hard box-shadows — use glow layers instead.

| Token | Definition | Use |
|---|---|---|
| `elev-1` | `0 10px 30px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.06)` | Default raised panel |
| `elev-2` | `0 20px 50px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)` | Prominent cards |
| `glow-pink` | `0 0 40px rgba(255,46,154,0.55), 0 0 100px rgba(255,46,154,0.25)` | Primary CTA, active pills |
| `glow-cyan` | `0 0 40px rgba(34,230,255,0.55), 0 0 100px rgba(34,230,255,0.25)` | Secondary focus states |
| `glow-amber` | `0 0 30px rgba(255,190,61,0.45), 0 0 80px rgba(255,190,61,0.2)` | Selected drop-zone, timer warning |
| `text-glow-*` | `text-shadow: 0 0 24px rgba(<color>,0.75), 0 0 60px rgba(<color>,0.4)` | Wordmarks, hero numbers, status pings |

**Ambient background:**
Every full-screen view layers at least 2 radial-gradient "glow blobs" in corners/edges + a base `#0a0318`. Not loud — opacity 0.15–0.35 max. Example stack:

```css
background:
  radial-gradient(900px 600px at 10% 0%, rgba(168,85,247,0.25), transparent 60%),
  radial-gradient(800px 600px at 90% 100%, rgba(255,46,154,0.18), transparent 60%),
  radial-gradient(600px 500px at 50% 50%, rgba(34,230,255,0.10), transparent 65%),
  #0a0318;
```

**Scanlines overlay (optional, opt-in per screen):**
```css
.scanlines::after {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background-image: repeating-linear-gradient(0deg, rgba(255,255,255,0.02) 0 1px, transparent 1px 3px);
  mix-blend-mode: overlay; opacity: .6;
}
```
Apply sparingly — in-game view, not on input-heavy screens like Auth.

### 4.6 Iconography

Current stack uses **lucide-react** — keep it. Stroke weight 1.5–2, size follows text.

- **Primary sizes:** 14, 16, 18, 20, 24, 32.
- **Color rule:** inherit from text color. Accent icons get neon color only when pairing with a same-colored label.

**Custom iconography where lucide falls short:**
- Vinyl record (SVG, 3 sizes: hero 240px, card 120px, badge 24px)
- Tonearm (decorative, hero only)
- Tape-deck style PLAY/PAUSE for the in-game player button (optional polish)

### 4.7 Signature Visual Elements

These are the DNA of Vinyl & Neon. Every screen that has a hero element should use one.

#### Vinyl record
Concentric grooves (repeating-radial-gradient), glossy center label (radial-gradient pink or cyan), 14px center hole. **Always rotating** (14s linear loop) when music plays or the screen is focused. Spec in `mockups/vinyl-neon.html` — port verbatim as a reusable `<Vinyl size={…} label={…} variant="pink|cyan" />` component.

#### Sleeve card
Timeline card. 112×150 area on mobile, rendered as:
1. Colored gradient background (decade-driven, see § 6.x).
2. **Big amber year** (Bowlby One, 32px+) top-left.
3. Song title (Space Grotesk 11px bold, 2-line clamp) + artist (10px, 60% alpha) bottom-left.
4. **Pseudo-element on the right edge** — a 56px vinyl disc peeking out, grooves visible. This is what makes it a "sleeve", not a rectangle.
5. Soft bottom-up black gradient for legibility.

#### Tonearm
Decorative only — on Home/Lobby hero vinyl. Thin silver bar with a round cartridge, rotated -22deg. No animation (static).

#### Equalizer / VU
5-bar equalizer: 3px-wide bars, gradient pink→cyan, animated 0.9s alternate. Use:
- In the top bar next to "Jordan's Turn"
- Inside the name input right side (decorative)
- On the mystery vinyl top-left corner during playback
- In the Waiting state between turns

#### Ambient glow blob
Background-only, never foreground. Pair with tri-color palette for depth.

### 4.8 Decade Color System

Timeline/sleeve card backgrounds are decade-driven. Port this from existing code (`app/src/components/Game.tsx`), with saturation/contrast pushed up to sit on the new dark plum palette.

| Decade | Current gradient | Tweak |
|---|---|---|
| 1930s | `from-amber-900 to-yellow-900` | ok |
| 1940s | `from-amber-800 to-orange-900` | ok |
| 1950s | `from-rose-800 to-pink-900` | ok |
| 1960s | `from-purple-700 to-violet-900` | push saturation |
| 1970s | `from-orange-600 to-red-800` | ok (iconic "fire" decade) |
| 1980s | `from-pink-500 to-purple-700` | matches neon palette — hero decade |
| 1990s | `from-green-600 to-teal-800` | ok |
| 2000s | `from-blue-500 to-indigo-700` | ok |
| 2010s | `from-indigo-500 to-purple-700` | ok |
| 2020s | `from-emerald-500 to-cyan-700` | ok |

Each decade also drives a **secondary accent** used for the sleeve's vinyl edge, subtle texture overlays, and the reveal-screen glow. Spec a derivation rule (e.g. "50% lighter than primary gradient stop, reduced to 15% alpha").

### 4.9 Motion Principles

- **Spring defaults** for enter/exit: `stiffness: 200, damping: 22`. Avoid bounce on micro-interactions.
- **Vinyl spin**: always `14s linear infinite` for hero records, `3s linear infinite` for mini-vinyls on sleeves.
- **Card placement**: scale 0.85→1, y -15→0, 300ms spring.
- **Reveal flip**: 3D rotateY 180→0, 400ms; pair with success/error color bloom.
- **Tick sound** (already wired) during final 5s of challenge timer — sync the numeric countdown to a scale 1→1.06→1 pulse.
- **Respect `prefers-reduced-motion`**: disable vinyl spin, equalizer bars, ambient scanlines, buzz-pulse. Fades and state transitions only.

---

## 5. Component Library

Name every component here as the handoff vocabulary. Designer delivers each as a spec + all states.

### 5.1 Buttons

| Variant | Look | Used for |
|---|---|---|
| `Button.Primary` | Filled neon-pink, black text (`#0a0318`), `glow-pink`, 14px radius, 14–16px vertical padding | Host, Start, Place Card, Play Again |
| `Button.Secondary` | Outline neon-cyan (1.5px), cyan text, soft cyan bg wash (`rgba(34,230,255,0.08)`), `glow-cyan` at 50% | Join, Leaderboard, Show Mine |
| `Button.Ghost` | `rgba(255,255,255,0.04)` bg, 1px `rgba(255,255,255,0.08)` border, secondary text | Back, Cancel, Skip, Buy |
| `Button.Danger` | `rgba(239,68,68,0.15)` bg, red-400 text, 1px red border | Stop Game, Leave |
| `Button.Icon` | 32–40px square ghost button w/ centered icon | Mute, History, Close modal |

**All buttons:** `active:scale-[0.97]`, 150ms transition, disabled = `opacity: 0.4` (no other change).

### 5.2 Inputs

- **Text / search input** — `bg-white/5`, 1px `border-white/10`, 2xl radius, 15–16px padding. Focus = neon-pink glow ring + pink border. Placeholder = `text-quat`.
- **Room-code input** — 4 boxes, `w-14 h-16`, 2px border, center-aligned display-font char. Filled box = pink bg tint + pink border.
- **Range slider** — track `rgba(255,255,255,0.08)`, thumb `--neon-pink` 22px with `glow-pink` at 50%.
- **Number input** (Expert year) — same as text, monospace-feel via `tabular-nums`.

### 5.3 Chips & Pills

- `Chip.Selectable` — `rgba(255,255,255,0.05)` bg, unselected text-secondary; selected = filled neon-pink bg, black text. Used for decades, genres, regions.
- `Chip.Mode` — colored pill per mode (original=cyan, pro=violet, expert=red, coop=green). Always small, letter-spaced, bordered.
- `Chip.Token` — amber pill, `★` icon, tabular count.
- `Pill.Timer` — shape-shifts with severity: cyan (default) → amber (≤10s) → red (≤5s), 2xl border, inline clock icon.

### 5.4 Panels

- `Panel` — `bg-elev-1`, 1px `rgba(255,255,255,0.08)` border, 2xl or 3xl radius, `elev-1` shadow. Interior padding 20–24px.
- `Panel.Raised` — `bg-elev-2`, `elev-2`. For modals, lobby settings blocks.
- `Panel.Hero` — For wordmark / winner blocks. No internal border, radial glow under.

### 5.5 Cards

- `Card.Sleeve` — see § 4.7.
- `Card.MysteryVinyl` — the rotating hero vinyl used center-stage during `playing` / `challenge`. Variants: pink label (default) and cyan label (co-op or alternate turn).
- `Card.Reveal` — filled success/error gradient; center displays the big year (display-l) + title/artist; mode-result checklist at bottom.
- `Card.Pending` — dashed amber border, `?` centered, "Placed here" micro-label.

### 5.6 Player Score Strip

Horizontal scroll row at the top of the game screen. Each pill:
- 54–64px wide
- Active turn: `rgba(255,46,154,0.15)` bg, 1px `rgba(255,46,154,0.30)` border, pink text
- Inactive: `rgba(255,255,255,0.05)` bg
- Content stack: player name (10px bold), cards/target (16px display), tokens (9px amber with ★)

Co-op replaces the strip with a single `Card.TeamScore` in the same position.

### 5.7 Timers

- `Timer.Challenge` — ring around the mystery vinyl (or below card). 15s countdown, stroke transitions cyan→amber at 10s→red at 5s.
- `Timer.Turn` — horizontal bar under the top chrome, same color logic.
- Numeric text uses tabular-nums and pulses on the last 5s.

### 5.8 Banners & Toasts

- `Banner.Error` — red-tint bg + red-left-accent, inline above the main content.
- `Banner.Warning` — amber, blinks slowly (already used for disconnect grace period).
- `Banner.Info` — cyan, static.
- `Toast.BuyCard` / `Toast.Stolen` — bottom-centered, soft-opaque bg, 2s auto-dismiss.

### 5.9 Modals & Sheets

- `Modal.Confirm` — centered, 3xl radius, `Panel.Raised`, max-width 380. Two buttons: Ghost + Danger.
- `Sheet.Bottom` — full-height sheet for Song History on mobile. 3xl radius top only, drag-handle pill at top (decorative), close icon top-right.
- Both: backdrop `bg-black/70 backdrop-blur-sm`.

### 5.10 Avatar

Circular, gradient fill pink→cyan (or decade-driven for the turn player), first-letter monogram in black display font. Sizes: 24, 32, 40, 56.

### 5.11 Loading / Empty / Error states

- **Loader** — 3-dot pulsing row in neon pink (already used for "Waiting for host").
- **Spinner** — neon-cyan ring, matches auth "Connecting..." state.
- **Empty state** — muted icon (40% alpha), `h3` title, `body-s` description. See current `Leaderboard` empty for pattern; carry forward with new palette.

---

## 6. Screens

For each screen: **(a)** intent, **(b)** layout, **(c)** states to design. Existing implementations live in `app/src/components/` — use them as the functional spec (don't change IA, just re-skin).

### 6.1 Home (`Home.tsx`)

**Intent:** First impression. Must land the brand instantly and give a one-tap path to play.

**Layout (top → bottom):**
1. **Connection indicator** top-right (small, neon-cyan when online, red pulsing when offline).
2. **Vinyl hero** — rotating 240px vinyl with "TUNES" on the pink center label, tonearm decorating the right edge. Below it: subtitle line ("A Music Party Game" → `label` style).
3. **Headline** — `display-xl` wordmark area (if the vinyl already carries the wordmark, replace with an active headline like *"Drop the needle."* in Heading 32px, with `text-glow-pink` on the verb).
4. **Name input** — labeled "YOUR STAGE NAME" (micro label, cyan), input is full-width, equalizer decoration on right.
5. **Account strip** — signed-in state (with sign-out), signed-out state (inline "Have an account? Sign in"), or active login/register form (inline, collapsible).
6. **Primary action** — `Button.Primary` "HOST A ROOM".
7. **Secondary action** — `Button.Secondary` "JOIN WITH CODE".
8. **Tertiary footer row** — three ghost chips: Rules · Leaderboard · My Stats.
9. **Version label** — micro, `text-quat`, centered.

**States to design:**
- Signed out, name empty (disabled CTA styling)
- Signed out, name filled (CTAs enabled)
- Signed in (account strip collapsed, welcome micro-text)
- Auth form active (login variant + register variant, with loading state)
- Mode: picking Host → sub-flow:
  - Host with Spotify (primary) — shows Spotify-green nuance via glow/ring, NOT by reintroducing Spotify green as a brand color
  - Host without Spotify (Preview mode)
  - Back
- Mode: picking Join (room-code 4-box input + join button + back)
- Invite pre-filled (invite banner in cyan: "You've been invited to room ABCD!")
- Error banner
- Offline state (connection indicator + CTAs visibly disabled)

### 6.2 Lobby (`Lobby.tsx`)

**Intent:** Waiting room that feels like the band tuning up. Host configures game; players feel assembled.

**Layout (top → bottom, scroll-anchored):**
1. **Top chrome** — Leave (ghost icon, left), Room code block (centered), Copy invite link (small pill under code).
2. **Error banner** (when applicable).
3. **Player list** — `Panel`, header "PLAYERS · N/12". Each row: avatar (gradient monogram), name, "You"/"Offline" chip, crown (for host).
4. **Settings panel** (host only) — `Panel` with:
   - **Mode selector** 2×2 grid of mode cards (Original, Pro, Expert, Co-op). Active = pink fill.
   - **Cards to win** slider with live number in neon amber.
5. **Song source panel** (host only) — `Panel` with:
   - Pack type grid (Standard, Decades, Genre, Genre+Decade, Playlist).
   - Conditional chips: Decades (8 buttons), Genres (8), Regions (4 + "optional" note).
   - Playlist subflow: 8 curated "genre packs" as vibrant gradient cards (2 cols) + a "paste link" input with validation.
   - Preview mode variant (no Playlist option, amber info banner at top).
6. **Non-host waiting state** — loader + "Waiting for host to start..."
7. **Start button** (sticky or in-flow) — `Button.Primary`, display font, max-width 512px. Disabled copy: "Need at least 2 players".

**States to design:**
- Host, Spotify, pack: Standard / Decades / Genre / Genre+Decade / Playlist
- Host, preview mode
- Guest (read-only view of settings)
- Error (pack incomplete, no decades selected, etc.)
- Starting (button shows loader + "STARTING...")

### 6.3 Game (`Game.tsx`) — The most complex screen

**Intent:** Focused, readable, theatrical. The mystery record holds attention; everything else supports.

**Top chrome (fixed):**
- Row 1: `[equalizer] [Current turn player name + "Your Turn" if you]` on the left. `[Mode chip] [deck-left count] [History icon] [Mute icon] [Stop Game icon (host)]` on the right.
- Row 2: Horizontal scrolling **Score Strip** of player pills, active player highlighted pink.

**Below chrome, conditional:**
- Big "TAP TO PLAY MUSIC" primary button for the host if music hasn't started yet.
- **Turn timer bar** while phase=playing.
- Banners: Spotify error, disconnected player.

**Center stage:**
- Default: rotating `Card.MysteryVinyl` (220px), tonearm decoration, "NOW SPINNING · ???" label above.
- Phase=reveal: `Card.Reveal` replaces vinyl, with mode-result checklist, stolen-by notice.
- Phase=playing + host + music paused: vinyl shows a big pink PLAY button inside the label; label pulses "TAP TO PLAY".
- Below center: Timer pill (challenge), Song-named toast ("Maya named the song! +1 Token"), Challenge-result feedback.

**Actions area (context-sensitive, appears under the center stage):**
- Active player, playing: Song-name input stack (Title, Artist, optional Year) + Submit. Required banner on Pro/Expert.
- Non-active, challenge phase: "Pick a position then Challenge" prompt, Challenge & Looks-Good buttons.
- Reveal: Continue button.
- Song-name result (correct/wrong feedback with reason on wrong).

**Bottom dock:**
- Title row: "Jordan's Crate" (or "Your Timeline" / "Team Timeline"). Toggle button right: "Show Mine ⇄".
- **Timeline:** horizontal scroll of `Card.Sleeve` separated by drop zones (`DropZone` component). Drop zones change state:
  - Default: dashed cyan/white-15.
  - Selected (you): filled pink, pink glow.
  - Challenge selection: red variant.
  - Blocked (where active player placed): hidden.
  - Pending (after active player placed): `Card.Pending` with `?`.
- Bottom button row: `Skip · 1★` (ghost), `PLACE CARD` (primary, 2× flex), `Buy · 3★` (ghost).

**Non-active, playing phase:**
- Compact waiting state under timeline: `WaitingState` trivia + "I Know This!" buzz.

**Overlays:**
- Anchor-dealing ceremony when game starts (each player's starting card flips in with a 0.3s stagger).
- Stop-game confirmation (`Modal.Confirm`).
- Buzz flash alert (when active player is buzzed — yellow banner top, 2s).

**States to design — there are many:**
- Mode × phase × role combinations. See § 7. Deliver the baseline + each variant cleanly.

### 6.4 Results (`Results.tsx`)

**Intent:** Make winning feel like winning. Recap > analysis.

**Layout:**
1. **Confetti overlay** — already implemented; keep but retune colors to the new palette (pink/cyan/amber/violet + gold).
2. **Winner hero** — Trophy glow in amber, big "JORDAN WINS!" (display-l), subline "10 Cards Collected".
3. **Rankings** — list of players, top 3 with medal-styled rows (gold/silver/bronze gradients on card bg). Each row: badge + name + You chip + `display-m` card count + token count.
4. **Co-op variant** — single Team card with score vs. target + player contribution list.
5. **Awards grid** (conditional) — tinted gradient cards per award (Fastest Fingers, Sharpshooter, Hot Streak, Challenge King, Decade Expert, Card Collector, Name That Tune).
6. **Trivia score** — purple-tinted pill with "useless but fun" label.
7. **Actions** — Play Again (host-only primary) OR "Waiting for host…" ghost-disabled, Song History (ghost), Leave Game (ghost).

**States:**
- Solo winner, 2–12 players
- Co-op win, co-op loss (deck exhausted without hitting target)
- Host vs. guest

### 6.5 Rules (`Rules.tsx`)

**Intent:** Instructional, calm. Not a marketing page.

**Layout:**
- Back button + `h1` "How to Play"
- 4 panels: Objective · How to Play · Tokens · Game Modes
- Each panel has a neon icon in its header color (pink/cyan/amber/violet).
- Numbered list inside panels — number badge in neon pink.

### 6.6 Leaderboard (`Leaderboard.tsx`)

**Intent:** Social scoreboard. Signed-in user stands out.

**Layout:**
- Header with back + `h1` "Leaderboard" + trophy icon
- Empty state (large trophy, muted copy)
- Table — header row of `label` style, data rows with decade-rank tint: gold/silver/bronze for top 3.
- Current user row has pink-tinted bg + pink name color.
- Columns: `# · Player · Wins · Games · Win% · Streak`.

### 6.7 Player Profile (`PlayerProfile.tsx`)

**Intent:** Personal stat board, bragging rights, recent games.

**Layout:**
- Header with back + `h1` "My Stats"
- 2×3 stats grid — `Panel` tiles with icon, display number, micro label.
- "Recent Games" list — per game: date, mode, cards won, Win/Loss pill (pink/ghost).

### 6.8 Song History (`SongHistory.tsx`) — sheet

**Intent:** Scrollable receipts of every song this game.

**Layout:**
- Bottom sheet, 3xl top radius, backdrop blur.
- Header: title + close icon.
- List of rows — round number circle, song info (title, artist · year, played by, stolen-by line), Correct/Wrong pill.

### 6.9 Waiting State (`WaitingState.tsx`) — in-game component

**Intent:** Non-active players stay engaged while waiting.

**Layout (compact, 420px max-w):**
- Trivia card — category label in amber, question, 2×2 answer grid. Result feedback on press.
- Score (x/y) in corner.
- Buzz button — big yellow pulse "I Know This!". Transforms to "Buzzed!" on press.
- Buzzed players row — colored chips per buzz.

---

## 7. Game State Matrix

The game screen is the high-variant zone. The designer should explicitly deliver visual specs for **every cell** of:

**Phases:** `lobby` · `anchor_preview` · `playing` · `challenge` · `reveal` · `game_over`
**Modes:** `original` · `pro` · `expert` · `coop`
**Roles:** `active_player` · `other_player` · `host_special_chrome`

Not every combination is unique — most are small deltas. Minimum set of **visually distinct states to deliver:**

| # | State | Key visual change |
|---|---|---|
| 1 | Playing · Active · Original | Baseline game screen, optional name input |
| 2 | Playing · Active · Pro | Required-name banner, full name+artist inputs |
| 3 | Playing · Active · Expert | + exact-year input, red banner |
| 4 | Playing · Active · Co-op | Team timeline, no challenge copy |
| 5 | Playing · Other · any mode | No action buttons, WaitingState block |
| 6 | Challenge · Active · any | Vinyl rotates, "Waiting for challenges…" copy, timer pill |
| 7 | Challenge · Other · not-yet-decided | Challenge + Looks-Good buttons, drop zones in red variant |
| 8 | Challenge · Other · challenged | "Challenge submitted!" confirmation |
| 9 | Challenge · Other · declined | Muted "No challenge — waiting for timer…" |
| 10 | Reveal · correct | Green reveal card + Continue |
| 11 | Reveal · wrong + stolen | Red reveal card, "Stolen by…" badge, winner's color halo |
| 12 | Reveal · wrong + no challenger | Red reveal card, "Wrong placement" copy |
| 13 | Reveal · Co-op wrong | Red card, "−1 Token" team penalty |
| 14 | Anchor-preview overlay | Full-screen ceremony, flipping cards |
| 15 | Host · music not started | Big "TAP TO PLAY MUSIC" primary banner |
| 16 | Spotify error | Red banner under chrome |
| 17 | Disconnect grace | Amber blinking banner, "Waiting Xs…" |
| 18 | Buzz flash on active | Yellow "Someone knows this!" overlay |

**Note to designer:** For every state above, the *frame* stays constant — only the central composition and conditional overlays change. Don't redesign chrome 18 times.

---

## 8. Responsive Behavior

**Breakpoints (already Tailwind defaults, keep):**

| Breakpoint | Width | Layout |
|---|---|---|
| Mobile | 390–640px | Single-column, full-width cards capped at 448px (`max-w-md`), padding 16–24px. |
| Tablet | 640–1024px | Keep single-column but center content with `max-w-lg` (512px). Slight breathing room. |
| Desktop | 1024px+ | **Use the space.** Game screen: two-column — mystery + actions on left, timeline as a tall side column on right with vertical scroll. Lobby: player list + settings side by side (2 cols). Home: hero vinyl left / actions right. Results: rankings left / awards right. |

**Desktop game-screen target layout:**
- Header: full width (unchanged)
- Body: CSS grid, columns `1fr 320px` on ≥1200px. Left column = mystery + naming/actions. Right column = timeline (vertical list of sleeve cards) with drop zones between.
- Actions row stays fixed at bottom only on mobile; on desktop it can live inside the left column.

**Don't:** upscale mobile screens unchanged for desktop. Deliver desktop variants of Home, Lobby, Game, Results.

---

## 9. Accessibility

- **Contrast:** All text ≥ AA against `bg-base`. Small text (≤14px) ≥ AAA where possible — light-secondary text on neon-pink is too low; make hot-pink primary CTAs have **black** text, not white.
- **Focus visibility:** Every interactive element needs a visible focus state. Default: 2px pink ring + 2px offset of base color. Keyboard-only users should always know where they are.
- **Motion:** Honor `prefers-reduced-motion`. Disable spin, pulse, scanlines, buzz-pulse. Keep fade transitions.
- **Color-blindness:** Success/error pairs use green/red *but are accompanied by icons* (check/X) in every reveal card. Never rely on color alone for correctness.
- **Hit targets:** Mobile ≥ 44×44px for everything tappable.
- **Screen readers:** Retain current ARIA patterns in buttons and regions. New components must include `aria-label` on icon-only buttons.

---

## 10. Motion & Sound

### Motion catalog

| Element | Motion |
|---|---|
| Hero vinyl | 14s linear spin; stops when `prefers-reduced-motion` |
| Mini vinyl on sleeve | 3s linear spin (reverse on alternate cards) |
| Reveal flip | 400ms cubic-bezier(0.2, 0.8, 0.2, 1) rotateY |
| Card placement | 300ms spring `(stiffness:300, damping:25)` |
| Drop-zone selection | Instant color + glow, 150ms ease |
| Equalizer bars | 0.9s alternate, 5 bars, staggered delays |
| Buzz pulse | 2s ease-in-out, `buzz-pulse` keyframe |
| Anchor deal | 0.3s spring per card, 0.3s stagger |
| Confetti | 2–4s fall, 50 pieces |

### Sound (inherited, preserved)

Sound effects are already wired in `app/src/services/sounds.ts`. Design should **not** reduce them. Optional: small visual echoes when a sound plays (e.g. a soft ring pulse on the mystery vinyl when challenge sound fires).

---

## 11. Implementation Notes

**For the designer delivering this work, and the engineer consuming it:**

### Preserve
- All game logic (`server/src/game.ts`, `rooms.ts`, `songs.ts`)
- Socket events & shared types (`shared/src/*`)
- Zustand store shape (`app/src/store.ts`)
- Sound-effect system
- Routing (`App.tsx` screen switching — screens can be renamed but the switch remains)

### Replace
- All Tailwind classNames on markup
- `app/src/index.css` (theme block, fonts)
- Any hardcoded Spotify-green (`#1DB954`, `#1ed760`) — remove from the design language. If reintroducing Spotify branding on the "Host with Spotify" button, use the official Spotify green ONLY there as a recognizable brand cue, not as part of the Tunes palette.

### Font loading
Replace the current Google Fonts link in `app/src/index.css`:
```css
@import url('https://fonts.googleapis.com/css2?family=Bowlby+One&family=Unbounded:wght@500;700;900&family=Space+Grotesk:wght@400;500;600;700&display=swap');
```

### Tailwind theme
Redefine `@theme` block with the new tokens:
```css
@theme {
  --font-display: "Bowlby One", ui-sans-serif, system-ui;
  --font-heading: "Unbounded", ui-sans-serif, system-ui;
  --font-sans: "Space Grotesk", ui-sans-serif, system-ui;
  --color-neon-pink: #ff2e9a;
  --color-neon-cyan: #22e6ff;
  --color-neon-amber: #ffbe3d;
  --color-neon-violet: #a855f7;
  --color-bg-base: #0a0318;
  /* …etc. */
}
```

### Suggested component restructure (optional)
Create a `app/src/components/ui/` folder for the design system primitives (Button, Input, Panel, Vinyl, Sleeve, Equalizer) used across the app. Feature components (Game, Lobby…) compose these.

### Phasing — ship order
1. Design system tokens + fonts (1 day)
2. Home + Lobby (2 days)
3. Game screen — baseline + active-player phase matrix (3–4 days)
4. Game screen — challenge & reveal states (1 day)
5. Results + Song History sheet (1 day)
6. Rules + Leaderboard + Profile + Waiting (1 day)
7. Desktop layouts, polish, reduced-motion pass, a11y pass (2 days)

---

## 12. Deliverables

From design handoff, expect:

1. **Figma file** (preferred) with:
   - Token page (colors, type, spacing, radii, shadows, glows)
   - Component library (5.x) — each component with all states
   - Every screen from § 6 — mobile + desktop
   - Every game-state variant from § 7
2. **One exported frame per state** as PNG for reference screenshots.
3. **Written delta notes** (markdown) where a state differs subtly from its neighbor (helps engineer QA).
4. **Asset folder** — custom SVGs (vinyl grooves, tonearm, decade badges), bundled as inline React SVG components.

Or — if no Figma: a comprehensive set of HTML mockups mirroring `mockups/vinyl-neon.html` structure, covering every screen and state above.

---

## 13. Non-goals

- No change to game rules, timings, or scoring.
- No new features (leaderboards, chat, emotes, etc.).
- No new routes or screens.
- No change to database schema or socket events.
- No re-introduction of Spotify green as a Tunes brand color.
- No additional brand colors beyond pink/cyan/amber/violet + semantic green/red.

---

## 14. References

- **Winning mockup:** `mockups/vinyl-neon.html` (branch `claude/redesign-game-ui-Tb4Dh`)
- **Live preview:** `https://raw.githack.com/gginesta/Tunes/claude/redesign-game-ui-Tb4Dh/mockups/vinyl-neon.html`
- **Current codebase for functional behavior:** `app/src/components/` (Home, Lobby, Game, Results, Rules, Leaderboard, PlayerProfile, SongHistory, WaitingState)
- **Fonts:** Bowlby One, Unbounded, Space Grotesk (Google Fonts)
- **Icon library:** lucide-react (already in `package.json`)

---

*Brief compiled from user-testing feedback: Catalina (A) · Axel (A) · Thomas (A).*
