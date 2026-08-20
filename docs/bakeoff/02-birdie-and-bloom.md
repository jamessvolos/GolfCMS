# Birdie & Bloom Studio — GolfCMS Bake-off Proposal

## Who we are

Birdie & Bloom is a product-design-first studio. We ship small games that people open every
morning without being nagged by a push notification. Our house rule: **the engine serves the
experience**. We prototype feel before physics, share cards before schemas, and we cut any
system that doesn't produce a smile, a screenshot, or a streak. GolfCMS today is a README with
two words in it. Good — a blank fairway is the best kind.

## Vision statement

**"One hole. One minute. One ridiculous story to tell."**

Every day, everyone on Earth gets the *same* procedurally generated golf hole with the *same*
absurd ball placement — perched on a windmill ledge, wedged behind a garden gnome, teed up on
a floating lily pad. You get a limited stroke budget. Your result is a tiny emoji map of your
shots that begs to be pasted into a group chat. Wordle proved the ritual; we bring it terrain,
trajectory, and slapstick. The generator's job is not "infinite content" — it is **daily
conversation fuel**: a fresh, fair, discussable challenge that resets the leaderboard of your
friend group every 24 hours.

## The core play loop (concrete, second by second)

1. **Open (0–3s).** No menu. The day's hole draws itself in: fairway unfurls, hazards bloom,
   the ball drops onto its random start with a bounce and a squash-and-stretch settle. Par and
   stroke budget fade in ("Par 3 · 5 strokes max"). Daily seed number shown: "Hole #214".
2. **Aim (3–15s).** Touch-drag anywhere — slingshot style, Angry-Birds-familiar. A dotted
   trajectory preview shows the first 40% of the arc (never the full path — mystery is the
   game). Power ring fills with a hue shift from mint to hot coral; a subtle haptic tick at
   25/50/75/100% power. Release cancels by dragging back to the ball.
3. **Flight (1–3s).** Ball physics with exaggerated, readable behavior: sand thuds and grips,
   ice slides with a shimmer, bumpers *boing* with screen-shake scaled to impact, water splash
   ends the stroke with a rueful "bloop" and a drop back to the last safe lie (+1 stroke).
4. **React (1s).** Every landing gets feedback: dust puff, grass confetti, a one-word toast
   ("Cozy.", "Brave.", "Oh no."). Near-miss lip-outs get a slow-mo 0.4s replay. Delight is
   not garnish here; it is the retention mechanic.
5. **Sink it.** Cup capture has generous magnetism at low speed. Flag pops, fireworks match
   your score tier (ace = full bloom, over par = a single sympathetic sparkler).
6. **Share (5s).** Result card auto-composes: emoji trace of your shots over a minimap
   glyph, score vs. par, streak count, one-tap copy. Then — and only then — we offer
   "Practice remix": three free-play variants of today's hole with different ball starts.

Session target: 60–120 seconds. Depth comes from mastery of reading terrain, not from grind.

## Technical architecture

**Stack: TypeScript + Svelte 5 + PixiJS (WebGL2/WebGPU renderer) + Rapier2D (WASM physics)
+ SvelteKit on Cloudflare Pages/Workers + Durable Objects + D1.** Justification:

- **PixiJS over Three.js/Unity-web:** we are 2.5D top-down with juicy sprite effects, not
  true 3D. Pixi gives 60fps particle bloom on a 2019 Android phone at ~120KB gzipped. Unity
  WebGL's 8MB+ payload murders the "open a link from a group chat" moment that our entire
  growth model depends on.
- **Rapier2D (Rust→WASM) over hand-rolled physics:** deterministic across devices when run in
  fixed-timestep mode — non-negotiable, because fairness of the shared daily hole *is* the
  product. Same seed + same inputs = same bounce on iPhone and ThinkPad alike.
- **Svelte 5 over React:** UI here is chrome around a canvas — scorecards, modals, settings.
  Svelte's compiled output keeps total JS under our 200KB interactive budget. Runes-based
  reactivity keeps game-state → UI bindings dumb and predictable.
- **Cloudflare edge over a fat backend:** the daily seed, leaderboards, and streaks are tiny
  data with global read patterns. Workers + D1 for scores, a Durable Object per daily hole
  for atomic leaderboard writes, KV for the published seed. No servers to babysit; global
  sub-50ms latency for the share-card endpoint.
- **Generation runs client-side from the seed.** We ship the generator, not the geometry.
  A 16-byte seed fully determines the hole, so payloads stay minuscule, replays are just
  input logs, and "practice remix" variants are free.
- **PWA from day one:** installable, offline practice mode, but always browser-first. No app
  store gatekeeping between a shared link and a first putt.

Anti-cheat is honest-tier: server re-simulates flagged runs (same WASM, same seed, submitted
input log) before a score enters the global board. Friend boards are trust-based; global
boards are verified. We refuse to make the 99% wait for the 1%.

## How random courses + random ball starts feed the daily ritual

The generator is a **director, not a dice roller**. Pipeline per daily seed:

1. **Seeded PRNG (xoshiro256++)** from `SHA-256(date + server-salt)` — published at 00:00
   UTC, salt revealed 24h later so third parties can verify we didn't cherry-pick.
2. **Grammar-based layout:** holes assemble from authored "biome phrases" (dune chicane,
   windmill gauntlet, ice bridge, gnome garden) with constraint-based placement — this is
   where hand-crafted personality survives procedural variety.
3. **Random ball start is the twist mechanic.** The cup placement defines the hole; the ball
   start defines the *story*. Monday you tee off from a bunker lip; Tuesday from atop a wall
   with a terrifying drop; Saturday's "Absurd Saturday" starts you on a moving platform.
   Difficulty curve across the week is tuned: gentle Monday, spicy Friday, chaotic Saturday,
   contemplative long-par Sunday.
4. **Solver-in-the-loop fairness gate:** a headless bot (simulated-annealing over shot
   sequences) must complete every candidate hole within budget, and the hole must admit at
   least two distinct viable routes (safe route vs. hero line). Fail → reroll deterministically
   (seed, attempt-counter). Players never see an unfair hole; the *possibility* of the hero
   line is what group chats argue about.
5. **Same hole for everyone** is the social contract. Random-per-player holes are a content
   treadmill; random-per-day holes are a shared campfire. Practice remixes (same course, new
   ball starts) give the "one more go" crowd infinite depth without splitting the campfire.

## Share & social mechanics

- **The emoji trace card:** `⛳ Hole #214 · 3/5 🟩🟨🟦⛳ · 🔥12` — shot-by-shot surface
  emoji (green/sand/water/bounce) that spoils nothing about the layout, exactly like Wordle's
  colored grid. One tap: copied. Native share sheet on mobile.
- **Rich link unfurl:** shared links render an OG image (Worker-generated SVG→PNG) showing a
  stylized, spoiler-safe silhouette of today's hole and the sharer's score — a visual dare.
- **Streaks & the Sunday Scorecard:** daily streak plus a weekly recap card (7 mini-maps,
  cumulative vs. par) designed for Sunday-night posting.
- **Friend leagues:** join by link, no accounts required (device identity + optional email
  claim). League standings reset weekly so newcomers are never permanently buried.
- **Ghost balls:** after finishing, watch friends' replays as translucent ghosts — pure
  input-log playback, ~1KB each, and the single biggest "how did you DO that" driver.
- **Accessibility as a share feature:** every card ships alt text ("Finished hole 214 in 3 of
  5, one bunker visit"). Color-blind-safe palettes, reduced-motion mode (all juice becomes
  fades), full keyboard aiming (arrows + hold-space power), switch-access friendly one-input
  mode. If a screen-reader user can't brag, the feature isn't done.

## Five-wave roadmap

**Wave 1 — The Feel (weeks 1–3).** Playable vertical slice: one authored hole, slingshot
input, Rapier physics tuned for comedy-plus-fairness, full juice pass (particles, haptics,
squash-and-stretch, sound). Deliverable: a URL that makes a stranger grin in under a minute.
Exit gate: 8 of 10 hallway testers replay unprompted.

**Wave 2 — The Generator (weeks 4–7).** Seeded xoshiro pipeline, four biome phrase sets,
constraint placement, random ball-start director with weekly difficulty curve, headless
solver + fairness gate, determinism test suite across 6 real devices. Deliverable: 30
consecutive generated holes rated "fair and fun" by external playtest panel.

**Wave 3 — The Ritual (weeks 8–10).** Daily seed service on Workers, countdown to next hole,
streaks, local stats, emoji trace share card, OG unfurl images, PWA install flow, reduced-
motion + keyboard + screen-reader pass. Deliverable: public soft launch; target D1→D7
retention ≥ 25% among invited cohort.

**Wave 4 — The Campfire (weeks 11–14).** Friend leagues via link, ghost-ball replays,
weekly Sunday Scorecard, verified global leaderboard with server re-simulation, practice
remix mode. Deliverable: ≥ 30% of daily players in at least one league.

**Wave 5 — The Seasons (weeks 15–18).** Monthly themed biomes (Spooky October pumpkins-as-
bumpers), "Absurd Saturday" modifier system, community seed voting for one wildcard hole per
month, creator mode MVP (share a seed + custom ball start as a challenge link), localization
for 5 languages. Deliverable: season one live, editorial calendar handed to client.

## Risks (and our honest mitigations)

- **Procedural blandness** — the classic roguelike trap: infinite variety, zero memorability.
  Mitigation: grammar phrases are hand-authored; the generator arranges personality, it does
  not invent it. Weekly human review of the upcoming seed queue; a kill-switch seed override.
- **Determinism drift** (WASM float behavior, throttled timers, 120Hz vs 60Hz displays)
  breaks the shared-hole contract. Mitigation: fixed-timestep simulation decoupled from
  render, Rapier's deterministic build, cross-device golden-replay tests in CI. This is our
  top engineering risk and it is staffed accordingly from Wave 1.
- **Difficulty whiplash** — one brutal Tuesday can end a streak habit. Mitigation: solver
  scores estimated difficulty; out-of-band days rerolled; "mulligan token" earned weekly so a
  bad day dents pride, not the streak.
- **Cheating poisons leaderboards.** Mitigation: re-simulation for global boards, trust-based
  friend boards, and a design stance that the primary scoreboard is your group chat — which
  polices itself better than we ever could.
- **Ritual fatigue** at week 6. Mitigation: weekly cadence texture (Absurd Saturday, Sunday
  long-par), Sunday Scorecard as a second-order ritual, seasonal biomes as scheduled novelty.
- **Scope creep toward "real golf sim."** Wind, club selection, 18-hole rounds — all seductive,
  all deferred. One hole a day is the product. We will say no on the client's behalf.

*— Birdie & Bloom Studio, August 2026. We'd rather ship a small joy daily than a big menu never.*
