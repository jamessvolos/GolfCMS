# Caddie — Playtest Findings (simulated cohort, round one)

*2026-08-10. Method: the five personas from [`00-user-study.md`](00-user-study.md)
(data nerd, casual phone player, returning daily player, golf coach,
first-time visitor) were scripted through the deployed-equivalent UI in real
Chromium — fresh profile per persona (localStorage cleared), desktop
1280×800 with a mouse and 390×844 with touch events, following
`playtest.html`'s five-task watch script literally: first touch → aiming →
committing → reveal comprehension → second hole. Ten sessions, ~90 logged
checkpoints, screenshots at every task. **This is a stand-in until real
humans play**: a script can measure what was on screen, where boxes collide,
and what a first-timer has been told — it cannot measure hesitation time or
capture verbatim quotes. Treat severities as evidence-backed predictions.*

Zero console errors in all ten sessions. Engine behavior (aim → commit →
reveal → putt → hole card) worked on every run, both viewports.

## Ranked friction list

### P0-1 — Nothing teaches the two core inputs; on desktop, committing is an invisible affordance — **FIXED**

**Evidence.** Cold open, desktop: the only visible controls are the Round
menu, "My game", and the settings cluster. `#hit` and `#commit` are both
hidden during the aim phase — there is *no on-screen way to hit the ball*;
clicking the canvas is the only commit path and nothing says so. The
instruction line read *"245 yds to the pin. Set the ellipse where the shot
should finish — that is where it really lands."* — what, never how. The
onboarding card 2 said *"Commit, then see what the caddie would have done."*
— the word "commit" with no verb attached to any control. Watch-script task
1 (does moving the pointer aim?) passes instantly on desktop, because
hover-follow is discovered by accident within one mouse movement; task 3
(commit) is where all five personas stall — the screen at that moment
contains no affordance for it. (Mobile is better: the first tap plants a
neutral aim and a large "Hit it ➜" button appears.)

**Fix (shipped, `src/ui/copy.js`).** The copy now names the gestures.
First-aim line: *"245 yds to the pin. Move to aim — the ellipse is
everywhere this shot can finish. Click the course (or tap Hit it) to play
it."* Onboarding card 1: *"Move the mouse — or drag a finger — and the
ellipse follows…"*; card 2: *"Click the course (or tap Hit it) when you
like the shape. The ball flies to one spot from your pattern — then the
caddie shows the line they would have picked."*; card 3 now says the
scoring rule in game terms (up to 1,000 pts/hole vs the caddie's best
line) instead of the undefined phrase "strokes-gained loss". Re-verified in
Chromium on both viewports.

### P0-2 — The reveal buries its own lesson under a wall of algebra; on phones it physically covered the reveal — **FIXED**

**Evidence.** Post-commit verdict, verbatim, before the fix: *"Costly —
that target gives strokes away. Caddie's line (green ring): the 229-yd
carry, E 2.27 vs your E 3.14 · SG −0.87 · +74 pts · ball 82 yds out."*
Three problems a first-timer hits at once: (1) "E" and "SG" are never
defined anywhere on the play surface; (2) the same numbers appear again on
the stamp chip ("SG −0.87 · +74 pts · E 3.14 vs caddie 2.27") — two dense
surfaces saying one thing; (3) on 390×844 this rendered as a ~9-line panel
(206 px tall) that covered the stamp's chip (a stray "E" peeking out from
behind the panel edge read as a rendering bug in the screenshot) and a band
of the heatmap itself. And the watch-script's task-4 question — *"what is
the green/red map telling you?"* — had no answer anywhere on screen; the
old line only ever named the green ring.

**Fix (shipped, `src/ui/copy.js` + `styles/cockpit.css`).** The verdict now
answers task 4 directly and stops: *"Costly — that target gives strokes
away. The map grades every aim — green smart, red costly. The ring: the
caddie's 229-yd line · +74 pts · ball 82 yds out."* The E-vs-E detail
lives only on the stamp chip; the putt verdict got the same trim. On
phones the chip is hidden entirely (`#stamp-chip { display: none }` under
the 760 px breakpoint) — it was pure duplication of the caddie line and
score strip and only ever half-fit. Re-verified: mobile reveal panel down
from 206 px to 187 px with full map explanation, chip occlusion gone, the
stamped word fully visible.

### P1-3 — The caddie line sat on top of the Round dock on ordinary laptop widths — **FIXED**

**Evidence.** At 1280×800 the centered caddie line's box was x 340–940
while the Round dock ran x 16–360: a real 20 px glass-on-glass overlap,
present in every desktop session (`max-width: min(600px, calc(100vw −
380px))` only reserved one dock's width). Any viewport under ~1330 px
collided.

**Fix (shipped, `styles/cockpit.css`).** The line now reserves the full
dock width on both sides (`calc(100vw − 760px)`), and a new 1150 px
breakpoint lifts it above the docks — the same lane it uses on phones —
instead of squeezing it to a sliver. Re-verified at 1280×800: zero HUD
overlaps while aiming and at reveal. A sibling nit — the giant yardage and
the ticker boxes crossing by 5 px at 390 px — was fixed the same way
(ticker max-width 56vw → 53vw; boxes now clear by 6 px).

### P1-4 — The score strip and the hole card disagree about your score — open (needs `src/ui/caddie.js`)

**Evidence.** Mid-hole the strip sums raw decision points: it read *"Shot
3 · 1818 pts"* — then the hole card said *"Hole 1: 606 / 1000"* and the
next tee showed 606 pts. Every persona watches their number collapse to a
third at the first hole-end, exactly when they're forming their mental
model of the scoring. The strip shows a sum; the hole banks the
per-decision *average*; nothing on screen says so. **Recommended fix:**
make the strip show `banked + this-hole average` (one line in `refresh()`),
or label it "this hole avg". Out of scope for this pass (copy/styles only).

### P1-5 — "E" means two different things — open (copy + `caddie.js`)

**Evidence.** The stamp chip says *"E 3.14 vs caddie 2.27"* (expected
strokes); the hole card says *"…245-yarder (E)"* (even par). Same letter,
same screen, different meanings, neither defined. Partially mitigated by
P0-2 (the verdict line no longer uses E at all; the chip no longer shows on
phones). **Recommended fix:** chip line 2 → "you'd avg 3.14 · caddie 2.27
strokes"; hole card → spell "even".

### P2-6 — Putt copy leads with clubhouse slang — open (copy)

**Evidence.** First putt line: *"On the dance floor — a 36-footer…"* The
casual and first-time personas have no reason to know "dance floor" =
green; it is the first sentence of a brand-new mode that also flips the
hero number from yards to feet. **Recommended fix:** *"On the green — a
36-footer. Aim your pace…"* (keep the slang for the Drained stamp, where
context carries it).

### P2-7 — The meta ticker is the densest, least readable text on screen — open (styles/`caddie.js`)

**Evidence.** On 390 px the ticker renders three lines of 9.5 px
letter-spaced uppercase: *"THORN MOOR NATIONAL · DAILY #4 · HOLE 1 OF 5 ·
PAR 3 · 245 YDS · STRAIGHT"* — six facts at glance-hostile size, including
two ("straight", the course name) that matter far less than par and hole
number. **Recommended fix:** drop the archetype word on small screens;
consider two tiers (course/label vs hole/par).

### P2-8 — The hole card's "decisions vs strokes" split is unexplained — open (copy)

**Evidence.** *"3 decisions · 3 strokes (1 putt) on the par-3, 245-yarder
(E)"* — fine for the data nerd and coach personas; the casual player has
not been told that penalties make strokes ≠ decisions. Low stakes; the
numbers are at least all real. **Recommended fix:** only surface
"decisions" when it differs from strokes.

## What worked (keep it)

- Desktop hover-aim is discovered in the first second — task 1 passes cold.
- Mobile first-touch is genuinely good: one tap plants a sensible neutral
  aim at ~70% of reach and summons a big thumb-sized "Hit it ➜".
- The dispersion dots + ellipse read as a pattern, not a cursor: the aim
  line *"195-yd carry, fairway wood · leaves 51 yds"* plus *"Lands inside
  72 × 46 yds · 17% green · 83% fairway"* is the study's "yardage first"
  principle working.
- Yards→feet flip on the green (hero number becomes "Ft to pin") landed.
- Coach's notes at round end give task 5 (behavior change on hole 2) a
  real hook — the two costliest targets are named with their SG bills.
- Zero console errors, ten sessions, both viewports.

## Verification

All three FIXED items were re-verified in headless Chromium after the
change (fresh profile, both viewports): onboarding and first-aim copy
render as written, desktop HUD has zero overlapping boxes at 1280×800,
mobile reveal shows the full stamped word with no chip fragment, and the
engine suite (`npm test`) stayed green — no engine or `caddie.js` file was
touched.
