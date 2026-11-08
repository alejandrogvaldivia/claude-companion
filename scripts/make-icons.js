// Genera el ícono de Clawd (pixel art, misma cuadrícula 12x8 del arte oficial) en PNG e ICO.
// uso: node tools/make-icons.js
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const GRID = [
  '..########..',
  '..#K####K#..',
  '############',
  '############',
  '..########..',
  '..########..',
  '..#.#..#.#..',
  '..#.#..#.#..',
];
const COLORS = { '#': [0xD9, 0x77, 0x57, 255], K: [0, 0, 0, 255] };

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xFF;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
function clawd(size) {
  const cell = Math.max(1, Math.floor(size / 12));
  const w = 12 * cell, h = 8 * cell;
  const ox = Math.floor((size - w) / 2), oy = Math.floor((size - h) / 2) + Math.floor(cell / 2);
  const buf = Buffer.alloc(size * size * 4);
  GRID.forEach((row, r) => [...row].forEach((ch, c) => {
    const col = COLORS[ch];
    if (!col) return;
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const px = ox + c * cell + x, py = oy + r * cell + y;
      if (px < 0 || py < 0 || px >= size || py >= size) continue;
      const i = (py * size + px) * 4;
      buf[i] = col[0]; buf[i + 1] = col[1]; buf[i + 2] = col[2]; buf[i + 3] = col[3];
    }
  }));
  return png(size, size, buf);
}

const out = path.join(__dirname, '..', 'assets');
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const pngs = sizes.map((s) => ({ s, data: clawd(s) }));
fs.writeFileSync(path.join(out, 'tray.png'), clawd(32));
fs.writeFileSync(path.join(out, 'icon-256.png'), clawd(256));
// ICO con las imágenes PNG adentro
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
const entries = []; let offset = 6 + 16 * pngs.length;
for (const { s, data } of pngs) {
  const e = Buffer.alloc(16);
  e[0] = s >= 256 ? 0 : s; e[1] = s >= 256 ? 0 : s; e[2] = 0; e[3] = 0;
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
  entries.push(e); offset += data.length;
}
fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]));
console.log('íconos listos:', sizes.join(', '));
