# From two words to a caddie: how GolfCMS became Caddie

The repository started as two words stuck together — *golf* and *CMS* — and
an empty directory. What it is now is a course-management trainer called
Caddie: you stand on a generated hole, you pick a target, your real
dispersion pattern decides where the ball goes, and a solver tells you, in
strokes, what your decision was worth. This is the story of how one became
the other, with the receipts inline. Some of it was built the ordinary way,
one commit at a time. Some of it was simulated — five "firms" that were
really five agent runs, two "years" that fit in an afternoon — and the
honest thing is to say so as we go.

## The bake-off

The first real decision was refusing to make the first real decision alone.
Five design/dev firms — independently prompted agents, each with its own
philosophy — wrote full proposals for how to turn a bare repo into a
dynamic golf puzzle app. Fairway Labs wanted engine-first rigor and solver
certificates. Birdie & Bloom wanted a daily ritual and emoji share cards.
Mulligan Systems argued the CMS *was* the product. TopoGolf Collective
cared only about generation quality — "the lie is the puzzle statement; the
course is just the board." Scratch & Par Digital promised a working game
with zero dependencies and no build step. Every proposal is preserved
verbatim in `docs/bakeoff/` (commits `0605ab5`, `eeefb7a`), and the
scorecard in `JUDGING.md` (`079c968`) picked Scratch & Par at 42/50 — the
only plan guaranteed to ship — on the condition that it absorb the field's
best ideas: TopoGolf's interesting-lie sampler, Fairway's rule that no
puzzle publishes without a machine-verified winning line, Mulligan's
`(seed, difficulty)` content tuples, Birdie & Bloom's daily.

The firms were imaginary. The tiebreaks they forced were not.

## Ten waves

Development ran in waves, one commit each, tested before shipping. The
first five (`c47c82b` → `75fe500`) built the engine — seeded RNG with named
substreams, a 40×24 course model, an archetype generator with a corridor
guarantee — then a Dijkstra solver whose winning line doubles as a
replayable certificate, a playable canvas client, the CMS with
tamper-rejecting `GLF-XXXX-XXXX-D` share codes, and stats with streaks. The
suite grew 21 → 46 tests, including a 1,000-seed generator sweep with
flood-fill reachability. The whole game plus CMS came in around 1,900 lines
of dependency-free JavaScript, exactly as the winning bid promised.

Waves 6–10 (`0cb2e9d` → `6ba0575`) added ice and slope physics, winter and
alpine biomes, 9-hole rounds, ghost replays packed six hex characters per
stroke into URLs, a links biome with real wind, and a weekly gauntlet — 74
tests, with golden fixtures proving that already-shared seeds never changed
behavior. A greedy aim-at-the-flag bot took 5 strokes on a hole the solver
certified at par 2. The puzzles had depth. Then came the ship-it batch: PR
#1 merged, GitHub Pages deployment, a blind A/B page pitting six
hand-authored holes against six generated ones, a leaderboard server that
re-simulates every submitted ghost so a forged score is structurally
impossible, a terrain editor, and fully synthesized Web Audio.

## The pivot

And then the client looked at all of it and said the arcade game had lost
the plot. The interesting decision in golf was never the swing — it's the
target. The real product was "GeoGuessr meets a shot-pattern app": drop the
player on a hole, let them aim, and grade the *choice*.

That pivot produced the two files that are the actual heart of Caddie.
`src/engine/dispersion.js` models shot patterns as distance-scaled ellipses
— long-axis depth error bigger than lateral, widened by rough, sand, and
trees. `src/engine/strategy.js` is the caddie's brain: value iteration over
every cell of the course with that dispersion model, producing an
expected-strokes field, an optimal-aim search, and per-decision
strokes-gained scoring. It is tested to lay up short of water it can't
safely clear. The old execution game wasn't deleted; it moved intact to
`arcade.html`. Everything under the pivot survived — the generator, the
terrain, the deploy pipeline, the daily.

Yardage became the language. A tile grid became 245 yds to the pin, a
195-yd carry with a fairway wood, a pattern that "lands inside 72 × 46 yds
· 17% green · 83% fairway." Handicaps made the dispersion honest: a scratch
pattern and an 18-handicap pattern get different ellipses, so the caddie
re-solves the whole hole for *your* game — including a custom profile with
a directional miss bias, which the caddie provably aims into.

## Two years in one sitting

Next the client asked for two simulated years of roadmap — eight quarters,
one commit each, all deployed. Wind that drifts the pattern center downwind
scaled by carry (`99145eb`). A career log of every aiming decision and a
stats dashboard with leak analysis (`37b6a13`). A weekly Major, same five
holes for everyone, and an 18-hole Championship (`4c5d51c`). Pro mode,
which hides the odds and dots and turns the trainer into an exam, plus the
personal dispersion editor (`eeaa8fa`). Coach's notes that name your two
costliest targets, seed-derived course names like Gorse Downs National, and
a PWA that works offline after one visit (`7ae84c6`). The suite hit 126
tests, with wind- and bias-compensation among the behavioral guarantees.
"Two years" is a label, not a duration — but each quarter really is one
commit, and each one really did deploy.

## The cockpit, and learning to putt

The design had accreted, so a redesign loop ran the way the firms had: a
user study (`docs/redesign/00-user-study.md`, five synthesized personas,
six ranked findings — button soup, three competing copy voices, no
onboarding), then three teams across four releases. One design system
(`f5b4241`), every string in the game moved into `src/ui/copy.js` in a
single calm tour-caddie voice — "say the yardage, then the choice, then
nothing" (`7085795`) — and finally the broadcast-cockpit skin: the course
full-bleed, yards-to-pin as a giant top-left numeral, a stamped verdict
slammed down where the ball finishes, a risk vignette that tints the screen
as your aim flirts with water.

Putting closed the last dishonesty. For a long time reaching the green
ended the hole with a flat 2.5-stroke estimate; now the ball goes in the
hole or it doesn't. Every putt is a real decision through the same
aim-commit-reveal loop — pace is the miss, the long axis of the ellipse
lies along your line, and a 36-footer might be "playing 16 feet of pace
past the cup — 25% to drop." The card shows real strokes and real putts.

## Where it stands

The suite is at 139 tests, all passing, still `node --test`, still zero
dependencies. This week the loop turned once more: a playtest kit shipped
(`playtest.html` — an invite, a five-task watch script, a feedback form
that files straight to GitHub), and because no humans had sat down yet, the
five study personas were scripted through the real UI in Chromium — fresh
profiles, desktop and a 390×844 touch viewport, ninety logged checkpoints.
That simulated cohort caught real things, all logged in
`docs/redesign/02-playtest-findings.md`:
nothing taught desktop players that clicking the course hits
the ball; the reveal buried its own lesson under strokes-gained algebra and,
on phones, physically covered it; the caddie's text panel sat on the Round
menu at laptop widths. The top findings are already fixed — in copy and
CSS, with the engine untouched — and re-verified in the browser.

A scripted persona can tell you what was on screen. It cannot tell you
what a person felt, misread, or said out loud. That part has to be you.

The trainer is live at **https://jamessvolos.github.io/GolfCMS/** — today's
Daily is five holes, no account, nothing to install. If you can spare
fifteen minutes, open the playtest kit at `playtest.html`, hand the game to
someone who has never seen it, and watch, don't coach. The caddie always
sees the better line. We'd like to know if you do too.
