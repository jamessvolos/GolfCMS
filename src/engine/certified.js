// PLACEHOLDER — replaced by scripts/certify-seeds.mjs --merge once the sweep
// finishes. An empty pool makes caddieHoleSeed a no-op, so the game is
// playable and every test passes while the table is being built.
export const CERTIFIED_PAR4 = new Uint32Array(0);
export const CERTIFIED_PAR5 = new Uint32Array(0);
export function certifiedPool(par) {
  if (par === 4) return CERTIFIED_PAR4;
  if (par === 5) return CERTIFIED_PAR5;
  return null;
}
