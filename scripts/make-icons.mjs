// Rasterize icon.svg's design into the PNG sizes the web actually demands —
// apple-touch-icon (180), and the manifest pair (192, 512 maskable) — with
// zero dependencies: we draw the same shapes (rounded square, target rings,
// flag) straight into a pixel buffer and hand-encode the PNG with node:zlib.
// Usage: node scripts/make-icons.mjs   → writes icons/icon-{180,192,512}.png
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const PALETTE = {
  bg: [0x10, 0x24, 0x1a], disc: [0x1a, 0x35, 0x27], rim: [0x6f, 0xd0, 0x8c],
  ring: [0xff, 0xd1, 0x66], bull: [0xe7, 0x4c, 0x3c], pole: [0xea, 0xf5, 0xec],
};

function crc32(buf) {
  let c, table = crc32.table ??= Array.from({ length: 256 }, (_, n) => {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePNG(px, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Draw the icon at `size`. `maskable` pads the art into the safe zone. */
function draw(size, { maskable = false } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const put = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  // the 96-unit design grid from icon.svg, scaled (and shrunk when maskable)
  const s = (maskable ? 0.78 : 1) * size / 96;
  const off = (size - 96 * s) / 2;
  const R = 20 * s; // corner radius of the plate
  const inPlate = (X, Y) => {
    // rounded-rect test in device pixels (the plate fills the whole 96 grid)
    const x0 = off, y0 = off, x1 = off + 96 * s, y1 = off + 96 * s;
    if (X < x0 || X > x1 || Y < y0 || Y > y1) return false;
    const cx = Math.max(x0 + R, Math.min(x1 - R, X));
    const cy = Math.max(y0 + R, Math.min(y1 - R, Y));
    return (X - cx) ** 2 + (Y - cy) ** 2 <= R * R;
  };
  const gx = (u) => off + u * s; // grid → device
  const cx = gx(48), cy = gx(52);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // maskable icons must paint the full square — the launcher does the mask
      if (maskable) put(x, y, PALETTE.bg);
      if (!inPlate(x, y)) continue;
      put(x, y, PALETTE.bg);
      const d = Math.hypot(x - cx, y - cy) / s; // distance in grid units
      if (d <= 32 && d >= 28) put(x, y, PALETTE.rim);
      else if (d < 28 && d > 19) put(x, y, PALETTE.disc);
      else if (d <= 19 && d >= 15) put(x, y, PALETTE.ring);
      else if (d < 15 && d > 6) put(x, y, PALETTE.disc);
      else if (d <= 6) put(x, y, PALETTE.bull);
      // flag pole and pennant, over everything above the disc
      const u = (x - off) / s, v = (y - off) / s;
      if (u >= 46 && u <= 50 && v >= 10 && v <= 32) put(x, y, PALETTE.pole);
      if (v >= 10 && v <= 24 && u > 50) {
        const t = (v - 10) / 14; // triangle: full width at v=17, apex at ends
        const w = 24 * (1 - Math.abs(t - 0.5) * 2);
        if (u - 50 <= w) put(x, y, PALETTE.bull);
      }
    }
  }
  return px;
}

mkdirSync('icons', { recursive: true });
for (const [size, opts] of [[180, {}], [192, {}], [512, { maskable: true }]]) {
  const png = encodePNG(draw(size, opts), size);
  writeFileSync(`icons/icon-${size}.png`, png);
  console.log(`icons/icon-${size}.png  ${png.length} bytes`);
}
