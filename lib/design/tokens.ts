/**
 * "The strategist's folio" — single source of truth for the design system.
 * The folio (paper, hairlines, engraved headers) frames the instrument (the
 * dark map viewport); it never sits on top of it. Every color, radius, type
 * stack, and motion number in the UI comes from here.
 */

export const color = {
  ink: '#16130E',
  paper: '#F1EBDD',
  paperEdge: '#E4DCC9',
  fairway: '#2F5233',
  flag: '#B5342A',
  brass: '#9C7A2E',
  /**
   * Brass for TEXT on paper surfaces: #9C7A2E only hits 3.4:1 on paper, so
   * captions/eyebrows use this darker step (5.5:1 on paper, 4.8:1 on
   * paperEdge). Keep bright brass for the dark viewport and decoration.
   */
  brassText: '#755A1F',
  viewport: '#101511',
  hairline: '#C9C0AC',
  /** Isoline ink drawn over imagery. */
  contourInk: 'rgba(241,235,221,0.92)',
  /** Fill for expected-strokes regions ≥ 0.50 above optimal. */
  washDanger: 'rgba(181,53,43,0.14)',
  /** Muted body copy on paper (ink at ~78%). */
  inkSoft: '#453F33',
} as const;

/** Vector ground-plan tones inside the viewport (drawn over/instead of imagery). */
export const ground = {
  fairway: '#2F5233',
  green: '#477149',
  bunker: '#8D7C52',
  water: '#23404E',
  recovery: '#1D2C1B',
  ob: '#2A1814',
  rough: '#101511',
  outline: 'rgba(241,235,221,0.16)',
} as const;

export const radius = {
  folio: '4px',
  /** No radii inside the map viewport. */
  viewport: '0px',
} as const;

/** Separation is hairlines and paper-edge color — never shadows. */
export const shadow = 'none';

/** Fixed CSS filter toning satellite imagery toward the palette. Cap here. */
export const imageryFilter = 'saturate(0.85) sepia(0.12) brightness(0.96)';

/** Same tone, dimmed 10% for the reveal's lock beat. */
export const imageryFilterDim = 'saturate(0.85) sepia(0.12) brightness(0.86)';

export const type = {
  /** Folio headers, page titles, band stamps ONLY. Never body or data. */
  display: "'Libre Caslon Display', 'Iowan Old Style', Georgia, serif",
  ui: "'Archivo', system-ui, sans-serif",
  /** Map labels: small caps, letter-spaced 0.08em. */
  label: "'Archivo Narrow', 'Archivo', system-ui, sans-serif",
  /** Every numeral, tabular. No exceptions. */
  mono: "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace",
} as const;

/** Reveal choreography beats (ms since lock). Total must stay ≤ 900. */
export const reveal = {
  lockStart: 0,
  lockEnd: 150,
  drawEnd: 650,
  stampEnd: 900,
  /** Imagery dim during the reveal (multiplied into the tone filter). */
  dimBrightness: 0.86,
} as const;

/** All motion outside the reveal stays at or under this. */
export const motionMaxMs = 700;

export const bandStamp = {
  rotateDeg: -4,
  colors: {
    perfect: color.fairway,
    good: color.brass,
    okay: color.ink,
    miss: color.flag,
  },
  labels: {
    perfect: 'PERFECT',
    good: 'GOOD',
    okay: 'OKAY',
    miss: 'MISS',
  },
} as const;

/** Focus ring: 2px flag-red outline, offset 2px (WCAG-visible everywhere). */
export const focusRing = `2px solid ${color.flag}`;

/** Isoline levels above optimal, matching the scoring bands + context. */
export const contourLevels = [0.03, 0.1, 0.25, 0.5, 1.0] as const;

/** Emit the tokens as CSS custom properties for the app shell. */
export function cssVars(): string {
  const entries: [string, string][] = [
    ['--sg-ink', color.ink],
    ['--sg-paper', color.paper],
    ['--sg-paper-edge', color.paperEdge],
    ['--sg-fairway', color.fairway],
    ['--sg-flag', color.flag],
    ['--sg-brass', color.brass],
    ['--sg-brass-text', color.brassText],
    ['--sg-viewport', color.viewport],
    ['--sg-hairline', color.hairline],
    ['--sg-contour-ink', color.contourInk],
    ['--sg-wash-danger', color.washDanger],
    ['--sg-ink-soft', color.inkSoft],
    ['--sg-radius-folio', radius.folio],
    ['--sg-font-display', type.display],
    ['--sg-font-ui', type.ui],
    ['--sg-font-label', type.label],
    ['--sg-font-mono', type.mono],
    ['--sg-imagery-filter', imageryFilter],
    ['--sg-imagery-filter-dim', imageryFilterDim],
  ];
  return `:root{${entries.map(([k, v]) => `${k}:${v}`).join(';')}}`;
}
