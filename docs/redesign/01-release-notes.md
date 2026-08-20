# Redesign — Release Notes (the two-year loop, four releases)

**R1 — Team Clubhouse** (`f5b4241`): `styles/system.css` design system
(tokens, type ramp, spacing, components); all six satellite pages on one
shell — same header, same nav (Play · Career · Workshop), same footer, one
voice. No JS touched; every ID preserved.

**R2–R3 — Team Fieldbook** (`7085795`): the game surface rebuilt. Status
strip with yards-to-pin as the hero number; ten peer buttons collapsed to a
4-group action bar (Round menu, My game, Share, primary action); the three
competing text lines merged into one caddie message; every string moved to
`src/ui/copy.js` in a single calm tour-caddie voice ("say the yardage, then
the choice, then nothing"); three-step first-run onboarding, under 15
seconds, shown once.

**R4 — Team Yardage** (this commit): independent QA. Onboarding fires once
and dismisses; hero yardage renders; voice consistent across aim, reveal,
coach, and share; zero console errors on every page, desktop and mobile
viewports; 126 engine tests untouched and green across the whole loop.
Study→charter→build→verify traceability: every R2 change maps to a numbered
finding in `00-user-study.md`.

Proof screenshots: `docs/proof/fieldbook-desktop.png`,
`fieldbook-mobile.png`, `clubhouse-cms.png`.
