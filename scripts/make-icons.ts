/**
 * Draws the PWA icons (no image tools needed): a deep-red tile with a white
 * check mark inside scanner brackets. Run with `npm run icons`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const RED = [0xac, 0x20, 0x25];
const NAVY = [0x09, 0x14, 0x1d];
const WHITE = [0xff, 0xff, 0xff];

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size: number, pixel: (x: number, y: number) => number[]): Buffer {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x + 0.5, y + 0.5);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r!;
      raw[o + 1] = g!;
      raw[o + 2] = b!;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Coordinates in a 0..1 unit square; `pad` shrinks the art for maskable icons. */
function icon(size: number, pad: number, background: number[]) {
  return png(size, (x, y) => {
    const u = (x / size - pad) / (1 - 2 * pad);
    const v = (y / size - pad) / (1 - 2 * pad);
    const stroke = 0.055;
    // check mark
    const check = Math.min(segDist(u, v, 0.3, 0.52, 0.45, 0.67), segDist(u, v, 0.45, 0.67, 0.72, 0.36));
    if (check < stroke) return WHITE;
    // scanner brackets
    const b = 0.16;
    const lo = 0.17;
    const hi = 0.83;
    const t = 0.035;
    const corners = [
      segDist(u, v, lo, lo, lo + b, lo), segDist(u, v, lo, lo, lo, lo + b),
      segDist(u, v, hi, lo, hi - b, lo), segDist(u, v, hi, lo, hi, lo + b),
      segDist(u, v, lo, hi, lo + b, hi), segDist(u, v, lo, hi, lo, hi - b),
      segDist(u, v, hi, hi, hi - b, hi), segDist(u, v, hi, hi, hi, hi - b),
    ];
    if (Math.min(...corners) < t) return WHITE;
    return background;
  });
}

const dir = resolve(process.cwd(), 'public/icons');
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, 'icon-192.png'), icon(192, 0, RED));
writeFileSync(resolve(dir, 'icon-512.png'), icon(512, 0, RED));
writeFileSync(resolve(dir, 'maskable-512.png'), icon(512, 0.12, RED));
writeFileSync(resolve(dir, 'apple-touch-icon.png'), icon(180, 0.06, RED));
writeFileSync(resolve(dir, 'badge-96.png'), icon(96, 0, NAVY));
console.log('Icons written to public/icons');
