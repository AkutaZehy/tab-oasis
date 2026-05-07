// Tab Oasis icon generator - pure Node.js, zero dependencies
// Generates 4 PNG icons (16, 32, 48, 96) with palm tree / oasis motif
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ─── Color Palette ───────────────────────────────────────────────
const BG    = [0xf0, 0xfd, 0xf4, 0x00]; // #f0fdf4 transparent bg
const TEAL  = [0x0d, 0x94, 0x88, 0xff]; // #0d9488 - canopy/fronds
const DARK  = [0x0f, 0x76, 0x6e, 0xff]; // #0f766e - trunk/deep
const LIGHT = [0x14, 0xb8, 0xa6, 0xff]; // #14b8a6 - highlights (48,96)
const WATER = [0x5e, 0xe7, 0xdf, 0xff]; // #5ee7df - water accent

// ─── PNG Builder ─────────────────────────────────────────────────
function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function createPNG(width, height, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = createChunk('IHDR', ihdrData);

  // Build scanlines with filter byte
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const offset = y * (1 + width * 4);
    raw[offset] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const px = pixels[y * width + x];
      const bo = offset + 1 + x * 4;
      raw[bo] = px[0]; raw[bo+1] = px[1]; raw[bo+2] = px[2]; raw[bo+3] = px[3];
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  const idat = createChunk('IDAT', compressed);
  const iend = createChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([signature, ihdr, idat, iend]);
}

// Helper: set pixel on a flat array
function setPx(pixels, w, x, y, color) {
  if (x >= 0 && x < w && y >= 0 && y < pixels.length / w) {
    pixels[y * w + x] = color;
  }
}

// Helper: fill all with bg
function makeCanvas(w, h) {
  const arr = new Array(w * h);
  for (let i = 0; i < w * h; i++) arr[i] = BG;
  return arr;
}

// ─── Pixel Art Designs ───────────────────────────────────────────

// 16x16 - Minimal palm silhouette (just canopy + curved trunk)
function design16() {
  const S = 16;
  const p = makeCanvas(S, S);
  // Teal canopy
  const canopy = [
    [6,1],[7,1],[8,1],[9,1],
    [5,2],[6,2],[7,2],[8,2],[9,2],[10,2],
    [5,3],[6,3],[7,3],[8,3],[9,3],[10,3],
    [4,4],[5,4],[6,4],[7,4],[8,4],[9,4],[10,4],[11,4],
    [4,5],[5,5],[7,5],[8,5],[10,5],[11,5],
    [5,6],[6,6],[8,6],[9,6],
    [6,7],[7,7],[8,7],
  ];
  for (const [x, y] of canopy) setPx(p, S, x, y, TEAL);
  // Dark trunk
  const trunk = [
    [8,8],[8,9],[8,10],[8,11],[8,12],[8,13],[7,14],[7,15],
  ];
  for (const [x, y] of trunk) setPx(p, S, x, y, DARK);
  return p;
}

// 32x32 - Refined palm tree with frond details
function design32() {
  const S = 32;
  const p = makeCanvas(S, S);
  // Canopy - larger, more detailed frond spread
  const canopy = [
    // Top cluster
    [15,3],[16,3],
    [13,4],[14,4],[15,4],[16,4],[17,4],[18,4],
    [11,5],[12,5],[13,5],[14,5],[15,5],[16,5],[17,5],[18,5],[19,5],[20,5],
    [10,6],[11,6],[12,6],[13,6],[14,6],[15,6],[16,6],[17,6],[18,6],[19,6],[20,6],[21,6],
    [9,7],[10,7],[11,7],[12,7],[13,7],[14,7],[15,7],[16,7],[17,7],[18,7],[19,7],[20,7],[21,7],[22,7],
    [8,8],[9,8],[10,8],[11,8],[12,8],[15,8],[16,8],[17,8],[18,8],[19,8],[20,8],[21,8],[22,8],[23,8],
    [9,9],[10,9],[11,9],[12,9],[13,9],[14,9],[15,9],[16,9],[17,9],[18,9],[19,9],[20,9],[21,9],[22,9],
    [10,10],[11,10],[12,10],[13,10],[14,10],[15,10],[16,10],[17,10],[18,10],[19,10],[20,10],[21,10],
    [11,11],[12,11],[13,11],[14,11],[15,11],[16,11],[17,11],[18,11],[19,11],[20,11],
    [13,12],[14,12],[15,12],[16,12],[17,12],[18,12],
    [14,13],[15,13],[16,13],[17,13],
    [15,14],[16,14],
  ];
  for (const [x, y] of canopy) setPx(p, S, x, y, TEAL);

  // Trunk
  const trunk = [
    [15,15],[16,15],[15,16],[16,16],[15,17],[16,17],
    [15,18],[16,18],[15,19],[16,19],[15,20],[16,20],
    [15,21],[16,21],[15,22],[16,22],[15,23],[16,23],
    [14,24],[15,24],[16,24],[14,25],[15,25],
    [14,26],[15,26],[14,27],[15,27],
    [14,28],[15,28],[14,29],[15,29],
    [14,30],[15,30],[14,31],[15,31],
  ];
  for (const [x, y] of trunk) setPx(p, S, x, y, DARK);
  return p;
}

// 48x48 - Detailed palm with highlight layers and water base
function design48() {
  const S = 48;
  const p = makeCanvas(S, S);

  // Water base at bottom
  const waterBase = [
    [16,46],[17,46],[18,46],[19,46],[20,46],[21,46],[22,46],[23,46],[24,46],[25,46],[26,46],[27,46],[28,46],[29,46],[30,46],[31,46],
    [17,47],[18,47],[19,47],[20,47],[21,47],[22,47],[23,47],[24,47],[25,47],[26,47],[27,47],[28,47],[29,47],[30,47],
  ];
  for (const [x, y] of waterBase) setPx(p, S, x, y, WATER);

  // Canopy - teal
  const canopy = [
    [21,3],[22,3],[23,3],[24,3],[25,3],[26,3],
    [19,4],[20,4],[21,4],[22,4],[23,4],[24,4],[25,4],[26,4],[27,4],[28,4],
    [17,5],[18,5],[19,5],[20,5],[21,5],[22,5],[23,5],[24,5],[25,5],[26,5],[27,5],[28,5],[29,5],[30,5],
    [15,6],[16,6],[17,6],[18,6],[19,6],[20,6],[21,6],[22,6],[23,6],[24,6],[25,6],[26,6],[27,6],[28,6],[29,6],[30,6],[31,6],[32,6],
    [14,7],[15,7],[16,7],[17,7],[18,7],[19,7],[20,7],[21,7],[22,7],[23,7],[24,7],[25,7],[26,7],[27,7],[28,7],[29,7],[30,7],[31,7],[32,7],[33,7],
    [13,8],[14,8],[15,8],[16,8],[17,8],[18,8],[19,8],[22,8],[23,8],[24,8],[25,8],[26,8],[27,8],[28,8],[29,8],[30,8],[31,8],[32,8],[33,8],[34,8],
    [12,9],[13,9],[14,9],[15,9],[16,9],[17,9],[18,9],[22,9],[23,9],[24,9],[25,9],[26,9],[27,9],[28,9],[29,9],[30,9],[31,9],[32,9],[33,9],[34,9],[35,9],
    [12,10],[13,10],[14,10],[15,10],[16,10],[17,10],[22,10],[23,10],[24,10],[25,10],[26,10],[27,10],[28,10],[29,10],[30,10],[31,10],[32,10],[33,10],[34,10],[35,10],
    [13,11],[14,11],[15,11],[16,11],[17,11],[18,11],[19,11],[20,11],[21,11],[22,11],[23,11],[24,11],[25,11],[26,11],[27,11],[28,11],[29,11],[30,11],[31,11],[32,11],[33,11],[34,11],
    [14,12],[15,12],[16,12],[17,12],[18,12],[19,12],[20,12],[21,12],[22,12],[23,12],[24,12],[25,12],[26,12],[27,12],[28,12],[29,12],[30,12],[31,12],[32,12],[33,12],
    [15,13],[16,13],[17,13],[18,13],[19,13],[20,13],[21,13],[22,13],[23,13],[24,13],[25,13],[26,13],[27,13],[28,13],[29,13],[30,13],[31,13],[32,13],
    [16,14],[17,14],[18,14],[19,14],[20,14],[21,14],[22,14],[23,14],[24,14],[25,14],[26,14],[27,14],[28,14],[29,14],[30,14],[31,14],
    [18,15],[19,15],[20,15],[21,15],[22,15],[23,15],[24,15],[25,15],[26,15],[27,15],[28,15],[29,15],
    [19,16],[20,16],[21,16],[22,16],[23,16],[24,16],[25,16],[26,16],[27,16],[28,16],
    [20,17],[21,17],[22,17],[23,17],[24,17],[25,17],[26,17],[27,17],
    [21,18],[22,18],[23,18],[24,18],[25,18],[26,18],
    [22,19],[23,19],[24,19],[25,19],
  ];
  for (const [x, y] of canopy) setPx(p, S, x, y, TEAL);

  // Lighter highlights within canopy
  const hl = [
    [20,7],[21,7],[22,7],[23,7],[24,7],[25,7],[26,7],
    [19,8],[20,8],[21,8],[22,8],
    [18,9],[19,9],[20,9],[21,9],[22,9],
    [18,10],[19,10],[20,10],[21,10],[22,10],
    [19,11],[20,11],[21,11],[22,11],[23,11],
    [20,12],[21,12],[22,12],[23,12],
    [21,13],[22,13],[23,13],
    [21,14],[22,14],
  ];
  for (const [x, y] of hl) setPx(p, S, x, y, LIGHT);

  // Trunk
  const trunk = [
    [22,20],[23,20],[24,20],[22,21],[23,21],[24,21],
    [22,22],[23,22],[24,22],[22,23],[23,23],[24,23],
    [22,24],[23,24],[24,24],[22,25],[23,25],[24,25],
    [22,26],[23,26],[24,26],[22,27],[23,27],[24,27],
    [21,28],[22,28],[23,28],[24,28],[21,29],[22,29],[23,29],
    [21,30],[22,30],[23,30],[21,31],[22,31],[23,31],
    [21,32],[22,32],[23,32],[21,33],[22,33],[23,33],
    [20,34],[21,34],[22,34],[23,34],[20,35],[21,35],[22,35],
    [20,36],[21,36],[22,36],[20,37],[21,37],[22,37],
    [19,38],[20,38],[21,38],[22,38],[19,39],[20,39],[21,39],
    [19,40],[20,40],[21,40],[19,41],[20,41],[21,41],
    [19,42],[20,42],[21,42],[19,43],[20,43],[21,43],
    [18,44],[19,44],[20,44],[21,44],[18,45],[19,45],[20,45],
  ];
  for (const [x, y] of trunk) setPx(p, S, x, y, DARK);
  return p;
}

// Helper: fill horizontal range of pixels
function fillRow(pixels, w, y, x1, x2, color) {
  for (let x = Math.round(x1); x <= Math.round(x2); x++) {
    if (x >= 0 && x < w && y >= 0 && y < pixels.length / w) {
      pixels[y * w + x] = color;
    }
  }
}

// 96x96 - Full detailed palm tree, explicit pixel art (no float gaps)
function design96() {
  const S = 96;
  const p = makeCanvas(S, S);

  // ── Canopy (teal #0d9488) ──
  // Top spire
  fillRow(p, S, 5, 47, 48, TEAL);
  fillRow(p, S, 6, 46, 49, TEAL);
  fillRow(p, S, 7, 45, 50, TEAL);
  fillRow(p, S, 8, 44, 51, TEAL);
  fillRow(p, S, 9, 42, 53, TEAL);
  fillRow(p, S, 10, 40, 55, TEAL);
  fillRow(p, S, 11, 38, 57, TEAL);
  fillRow(p, S, 12, 36, 59, TEAL);
  fillRow(p, S, 13, 34, 61, TEAL);
  fillRow(p, S, 14, 33, 62, TEAL);
  // Left frond 1
  fillRow(p, S, 12, 28, 35, TEAL);
  fillRow(p, S, 13, 26, 33, TEAL);
  fillRow(p, S, 14, 24, 32, TEAL);
  fillRow(p, S, 15, 22, 31, TEAL);
  fillRow(p, S, 16, 21, 30, TEAL);
  fillRow(p, S, 17, 20, 29, TEAL);
  fillRow(p, S, 18, 19, 28, TEAL);
  fillRow(p, S, 19, 18, 28, TEAL);
  fillRow(p, S, 20, 17, 27, TEAL);
  fillRow(p, S, 21, 17, 27, TEAL);
  fillRow(p, S, 22, 17, 27, TEAL);
  // Right frond 1
  fillRow(p, S, 12, 60, 67, TEAL);
  fillRow(p, S, 13, 62, 69, TEAL);
  fillRow(p, S, 14, 63, 71, TEAL);
  fillRow(p, S, 15, 64, 73, TEAL);
  fillRow(p, S, 16, 65, 74, TEAL);
  fillRow(p, S, 17, 66, 75, TEAL);
  fillRow(p, S, 18, 67, 76, TEAL);
  fillRow(p, S, 19, 67, 77, TEAL);
  fillRow(p, S, 20, 68, 78, TEAL);
  fillRow(p, S, 21, 68, 78, TEAL);
  fillRow(p, S, 22, 68, 78, TEAL);
  // Mid canopy body
  fillRow(p, S, 15, 33, 62, TEAL);
  fillRow(p, S, 16, 33, 62, TEAL);
  fillRow(p, S, 17, 32, 63, TEAL);
  fillRow(p, S, 18, 31, 63, TEAL); // gap for frond separation
  fillRow(p, S, 19, 30, 64, TEAL);
  fillRow(p, S, 20, 29, 65, TEAL);
  fillRow(p, S, 21, 29, 65, TEAL);
  fillRow(p, S, 22, 30, 65, TEAL);
  fillRow(p, S, 23, 32, 64, TEAL);
  fillRow(p, S, 24, 34, 62, TEAL);
  // Lower canopy
  fillRow(p, S, 25, 35, 61, TEAL);
  fillRow(p, S, 26, 37, 59, TEAL);
  fillRow(p, S, 27, 39, 57, TEAL);
  fillRow(p, S, 28, 41, 55, TEAL);
  fillRow(p, S, 29, 43, 53, TEAL);
  fillRow(p, S, 30, 44, 52, TEAL);
  fillRow(p, S, 31, 45, 51, TEAL);
  fillRow(p, S, 32, 45, 51, TEAL);
  fillRow(p, S, 33, 46, 50, TEAL);
  fillRow(p, S, 34, 47, 49, TEAL);

  // Fix canopy gaps around frond splits (fill the body)
  for (let y = 15; y <= 24; y++) {
    fillRow(p, S, y, 35, 60, TEAL); // solid fill between fronds
  }
  // Remove gap at row 18-20 center (connect left/right fronds to body)
  fillRow(p, S, 18, 30, 64, TEAL);
  fillRow(p, S, 19, 30, 64, TEAL);

  // ── Highlight layer (lighter teal #14b8a6) ──
  fillRow(p, S, 9, 45, 46, LIGHT);
  fillRow(p, S, 10, 43, 44, LIGHT);
  fillRow(p, S, 11, 42, 44, LIGHT);
  fillRow(p, S, 12, 41, 43, LIGHT);
  fillRow(p, S, 13, 40, 43, LIGHT);
  fillRow(p, S, 14, 40, 42, LIGHT);
  fillRow(p, S, 15, 41, 43, LIGHT);
  fillRow(p, S, 16, 41, 43, LIGHT);
  fillRow(p, S, 17, 42, 44, LIGHT);
  fillRow(p, S, 18, 43, 45, LIGHT);
  fillRow(p, S, 19, 43, 45, LIGHT);
  fillRow(p, S, 20, 44, 46, LIGHT);
  fillRow(p, S, 21, 44, 46, LIGHT);
  fillRow(p, S, 22, 45, 47, LIGHT);
  fillRow(p, S, 23, 45, 47, LIGHT);
  // Left frond highlights
  fillRow(p, S, 14, 29, 30, LIGHT);
  fillRow(p, S, 15, 27, 29, LIGHT);
  fillRow(p, S, 16, 26, 28, LIGHT);
  fillRow(p, S, 17, 24, 26, LIGHT);
  fillRow(p, S, 18, 23, 25, LIGHT);
  fillRow(p, S, 19, 22, 24, LIGHT);
  fillRow(p, S, 20, 22, 23, LIGHT);
  // Right frond highlights
  fillRow(p, S, 14, 65, 66, LIGHT);
  fillRow(p, S, 15, 66, 68, LIGHT);
  fillRow(p, S, 16, 67, 69, LIGHT);
  fillRow(p, S, 17, 69, 71, LIGHT);
  fillRow(p, S, 18, 70, 72, LIGHT);
  fillRow(p, S, 19, 71, 73, LIGHT);
  fillRow(p, S, 20, 72, 73, LIGHT);

  // ── Trunk (dark teal #0f766e) ──
  // Upper trunk - straight and slightly thicker
  for (let y = 35; y <= 53; y++) {
    fillRow(p, S, y, 44, 51, DARK);
  }
  // Mid trunk - begins curving slightly
  for (let y = 54; y <= 65; y++) {
    fillRow(p, S, y, 45, 51, DARK);
  }
  for (let y = 66; y <= 72; y++) {
    fillRow(p, S, y, 45, 50, DARK);
  }
  // Lower trunk - curves left
  for (let y = 73; y <= 80; y++) {
    fillRow(p, S, y, 44, 49, DARK);
  }
  for (let y = 81; y <= 86; y++) {
    fillRow(p, S, y, 44, 48, DARK);
  }

  // Trunk highlight/ridge (left edge highlight)
  for (let y = 40; y <= 80; y++) {
    setPx(p, S, 45, y, [0x15, 0x85, 0x7c, 0xff]); // slightly lighter
  }

  // ── Water base (light teal #5ee7df) ──
  // Stylized water droplet / pool at base
  fillRow(p, S, 86, 42, 50, WATER);
  fillRow(p, S, 87, 36, 56, WATER);
  fillRow(p, S, 88, 33, 55, WATER);
  fillRow(p, S, 89, 33, 54, WATER);
  fillRow(p, S, 90, 34, 54, WATER);
  fillRow(p, S, 91, 33, 54, WATER);
  fillRow(p, S, 92, 34, 53, WATER);
  fillRow(p, S, 93, 35, 52, WATER);
  fillRow(p, S, 94, 37, 50, WATER);
  fillRow(p, S, 95, 40, 48, WATER);

  return p;
}

// ─── Generate All Icons ──────────────────────────────────────────
const outDir = path.join(__dirname);
const sizes = [
  { name: 'icon-16.png', w: 16, h: 16, design: design16 },
  { name: 'icon-32.png', w: 32, h: 32, design: design32 },
  { name: 'icon-48.png', w: 48, h: 48, design: design48 },
  { name: 'icon-96.png', w: 96, h: 96, design: design96 },
];

for (const { name, w, h, design } of sizes) {
  const pixels = design();
  const png = createPNG(w, h, pixels);
  const filePath = path.join(outDir, name);
  fs.writeFileSync(filePath, png);
  const sizeKb = (png.length / 1024).toFixed(2);
  console.log(`✓ ${name}  ${w}x${h}  ${sizeKb} KB`);
}

console.log('\nAll icons generated successfully!');
