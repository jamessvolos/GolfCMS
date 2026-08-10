# Caddie UI/Copy Redesign — User Study & Team Charters

*Simulated study, 2026-08-07. Method: heuristic audit of every surface plus
five synthesized user sessions (personas drawn from the product's actual
audiences: a golf-obsessed data nerd, a casual phone player, a returning
Wordle-style daily player, a golf coach, and a first-time visitor).*

## Findings (ranked by severity)

1. **Button soup.** The HUD carries 10+ peer-level controls (Daily / New /
   Major / 18 holes / Share / Pro / HCP / Hit / Play on). First-time users
   cannot tell playing from configuring. All five personas hesitated here.
2. **Three competing voices.** The meta line is telegraphic ("Round 2026 ·
   hole 1/5"), the verdict line is chatty ("That aim burns real strokes."),
   the pattern line is clinical ("Pattern 77 × 109 yds"). Copy reads like
   three different authors because it was.
3. **Disjointed shell.** Seven satellite pages (arcade, editor, CMS, audit,
   A/B, stats, plus the game) each hand-rolled its own header, nav, and
   spacing. Footer link soup ("Career · Arcade · Editor · CMS · Audit ·
   Blind test") exposes internal tooling to players.
4. **No onboarding.** The first-run experience drops users on a hole with a
   paragraph of instruction text. Nobody read it. The core loop (drag → see
   odds → commit → reveal) is learnable in one guided shot.
5. **Identity split.** "Daily Links", "GolfCMS", and "Caddie" all appear.
   The product is Caddie; the rest is heritage.
6. **Hierarchy inversion.** The most important number mid-round (yards to
   pin) is buried mid-sentence; the least important (seed) is prominent.

## Team charters (three teams, two-year loop, four releases)

- **Team Clubhouse** (design systems): one token file, one shared shell —
  every page same header, nav, type ramp, spacing. Players see player
  pages; builder tools live behind a single "Workshop" link. → Release 1.
- **Team Fieldbook** (product UI + copy): the game surface. One voice — a
  calm, confident tour caddie: short, concrete, yardage-first. Controls
  grouped into Play (menu) / Settings (HCP, Pro) / one primary action.
  Score strip redesigned around yards-to-pin. → Release 2–3.
- **Team Yardage** (research + QA): before/after evidence, cross-viewport
  verification, release notes, regression watch. → Release 4.

## Decision record

Adopt all three charters. Copy principle: *"say the yardage, then the
choice, then nothing."* Success criteria: zero console errors on every
page, one shared stylesheet in use everywhere, first-run onboarding under
15 seconds, HUD ≤ 4 visible groups.
