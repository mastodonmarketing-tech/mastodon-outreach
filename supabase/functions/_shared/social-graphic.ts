type Rgba = [number, number, number, number];

const WIDTH = 1200;
const HEIGHT = 675;

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hex(value: string, alpha = 255): Rgba {
  const clean = value.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
    alpha,
  ];
}

function pixel(buffer: Uint8Array, x: number, y: number, color: Rgba) {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
  const i = (y * WIDTH + x) * 4;
  const a = color[3] / 255;
  const ia = 1 - a;
  buffer[i] = Math.round(color[0] * a + buffer[i] * ia);
  buffer[i + 1] = Math.round(color[1] * a + buffer[i + 1] * ia);
  buffer[i + 2] = Math.round(color[2] * a + buffer[i + 2] * ia);
  buffer[i + 3] = 255;
}

function fill(buffer: Uint8Array, color: Rgba) {
  for (let i = 0; i < buffer.length; i += 4) {
    buffer[i] = color[0];
    buffer[i + 1] = color[1];
    buffer[i + 2] = color[2];
    buffer[i + 3] = color[3];
  }
}

function rect(buffer: Uint8Array, x: number, y: number, w: number, h: number, color: Rgba) {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(WIDTH, Math.round(x + w));
  const y1 = Math.min(HEIGHT, Math.round(y + h));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) pixel(buffer, px, py, color);
  }
}

function roundRect(buffer: Uint8Array, x: number, y: number, w: number, h: number, r: number, color: Rgba) {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(WIDTH, Math.round(x + w));
  const y1 = Math.min(HEIGHT, Math.round(y + h));
  const rr = r * r;
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const dx = px < x + r ? x + r - px : px > x + w - r ? px - (x + w - r) : 0;
      const dy = py < y + r ? y + r - py : py > y + h - r ? py - (y + h - r) : 0;
      if (dx * dx + dy * dy <= rr) pixel(buffer, px, py, color);
    }
  }
}

function strokeRoundRect(buffer: Uint8Array, x: number, y: number, w: number, h: number, r: number, t: number, color: Rgba) {
  roundRect(buffer, x, y, w, h, r, color);
  roundRect(buffer, x + t, y + t, w - 2 * t, h - 2 * t, Math.max(0, r - t), hex("ffffff", 255));
}

function circle(buffer: Uint8Array, cx: number, cy: number, radius: number, color: Rgba) {
  const x0 = Math.max(0, Math.floor(cx - radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const x1 = Math.min(WIDTH - 1, Math.ceil(cx + radius));
  const y1 = Math.min(HEIGHT - 1, Math.ceil(cy + radius));
  const rr = radius * radius;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= rr) pixel(buffer, x, y, color);
    }
  }
}

function line(buffer: Uint8Array, x1: number, y1: number, x2: number, y2: number, width: number, color: Rgba) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const steps = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / Math.max(1, width * 0.45)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    circle(buffer, x1 + dx * t, y1 + dy * t, width / 2, color);
  }
}

function triangle(buffer: Uint8Array, ax: number, ay: number, bx: number, by: number, cx: number, cy: number, color: Rgba) {
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const maxX = Math.min(WIDTH - 1, Math.ceil(Math.max(ax, bx, cx)));
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const maxY = Math.min(HEIGHT - 1, Math.ceil(Math.max(ay, by, cy)));
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const w1 = ((bx - x) * (cy - y) - (by - y) * (cx - x)) / area;
      const w2 = ((cx - x) * (ay - y) - (cy - y) * (ax - x)) / area;
      const w3 = 1 - w1 - w2;
      if (w1 >= 0 && w2 >= 0 && w3 >= 0) pixel(buffer, x, y, color);
    }
  }
}

function arrow(buffer: Uint8Array, x1: number, y1: number, x2: number, y2: number, color: Rgba) {
  line(buffer, x1, y1, x2, y2, 7, color);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = 22;
  triangle(
    buffer,
    x2,
    y2,
    x2 - Math.cos(angle - 0.55) * size,
    y2 - Math.sin(angle - 0.55) * size,
    x2 - Math.cos(angle + 0.55) * size,
    y2 - Math.sin(angle + 0.55) * size,
    color,
  );
}

function card(buffer: Uint8Array, x: number, y: number, w: number, h: number, accent: Rgba) {
  roundRect(buffer, x + 9, y + 11, w, h, 16, hex("241c2f", 24));
  roundRect(buffer, x, y, w, h, 16, hex("ffffff", 248));
  roundRect(buffer, x, y, w, 14, 16, accent);
  circle(buffer, x + 24, y + 38, 10, accent);
  rect(buffer, x + 48, y + 31, w * 0.45, 8, hex("d8dce7", 255));
  rect(buffer, x + 48, y + 51, w * 0.66, 7, hex("e7eaf1", 255));
  rect(buffer, x + 24, y + 79, w * 0.76, 8, hex("d8dce7", 255));
  rect(buffer, x + 24, y + 100, w * 0.55, 8, hex("e7eaf1", 255));
}

function check(buffer: Uint8Array, cx: number, cy: number, color: Rgba) {
  line(buffer, cx - 28, cy, cx - 8, cy + 20, 9, color);
  line(buffer, cx - 8, cy + 20, cx + 34, cy - 28, 9, color);
}

function cross(buffer: Uint8Array, cx: number, cy: number, color: Rgba) {
  line(buffer, cx - 26, cy - 26, cx + 26, cy + 26, 9, color);
  line(buffer, cx + 26, cy - 26, cx - 26, cy + 26, 9, color);
}

function palette(seed: number) {
  const sets = [
    { primary: hex("553d67"), secondary: hex("16a36a"), accent: hex("b794d0"), warn: hex("d24b55") },
    { primary: hex("263c67"), secondary: hex("1ca58a"), accent: hex("f2b84b"), warn: hex("d24b55") },
    { primary: hex("4b3f72"), secondary: hex("259f6c"), accent: hex("7aa5ff"), warn: hex("c9424a") },
  ];
  return sets[seed % sets.length];
}

function drawBackground(buffer: Uint8Array, colors: ReturnType<typeof palette>, seed: number) {
  fill(buffer, hex("fbfbfd"));
  triangle(buffer, 0, 0, 470 + (seed % 90), 0, 0, 390, hex("f1f4f8", 255));
  triangle(buffer, WIDTH, HEIGHT, WIDTH - 530, HEIGHT, WIDTH, 270, hex("f6f0fb", 255));
  roundRect(buffer, 84, 88, 1032, 499, 32, hex("ffffff", 225));
  rect(buffer, 110, 562, 980, 2, hex("e7eaf1", 255));
  circle(buffer, 1040, 140, 70, [colors.accent[0], colors.accent[1], colors.accent[2], 28]);
  circle(buffer, 164, 532, 56, [colors.secondary[0], colors.secondary[1], colors.secondary[2], 24]);
}

function drawAi(buffer: Uint8Array, colors: ReturnType<typeof palette>, seed: number) {
  card(buffer, 458, 222, 284, 188, colors.primary);
  circle(buffer, 600, 316, 42, [colors.accent[0], colors.accent[1], colors.accent[2], 70]);
  circle(buffer, 600, 316, 22, colors.primary);
  const nodes = [
    [266, 184], [318, 486], [892, 176], [928, 476], [212, 338], [1000, 330],
  ];
  for (const [x, y] of nodes) {
    arrow(buffer, 600, 316, x, y, [colors.primary[0], colors.primary[1], colors.primary[2], 150]);
    circle(buffer, x, y, 46, hex("ffffff", 245));
    circle(buffer, x, y, 28, [colors.secondary[0], colors.secondary[1], colors.secondary[2], 205]);
    circle(buffer, x - 8, y - 7, 8, hex("ffffff", 245));
    circle(buffer, x + 9, y + 9, 12, hex("ffffff", 245));
  }
  for (let i = 0; i < 7; i++) {
    const x = 382 + i * 72 + (seed % 13);
    const y = 504 + ((seed + i) % 3) * 13;
    line(buffer, x, y, x + 42, y - 24, 5, [colors.accent[0], colors.accent[1], colors.accent[2], 150]);
  }
}

function drawCro(buffer: Uint8Array, colors: ReturnType<typeof palette>) {
  card(buffer, 138, 206, 270, 164, colors.primary);
  card(buffer, 138, 410, 270, 164, colors.warn);
  card(buffer, 792, 230, 280, 176, colors.secondary);
  arrow(buffer, 420, 288, 700, 288, colors.primary);
  arrow(buffer, 420, 492, 700, 396, colors.warn);
  arrow(buffer, 700, 288, 792, 286, colors.secondary);
  arrow(buffer, 700, 396, 792, 334, colors.secondary);
  circle(buffer, 612, 338, 54, hex("ffffff", 250));
  triangle(buffer, 574, 306, 650, 306, 622, 366, colors.accent);
  rect(buffer, 606, 364, 32, 50, colors.accent);
  circle(buffer, 966, 504, 58, [colors.secondary[0], colors.secondary[1], colors.secondary[2], 48]);
  check(buffer, 966, 504, colors.secondary);
  circle(buffer, 290, 520, 52, [colors.warn[0], colors.warn[1], colors.warn[2], 42]);
  cross(buffer, 290, 520, colors.warn);
}

function drawMarketing(buffer: Uint8Array, colors: ReturnType<typeof palette>, seed: number) {
  triangle(buffer, 478, 158, 760, 158, 646, 386, [colors.primary[0], colors.primary[1], colors.primary[2], 235]);
  triangle(buffer, 520, 216, 718, 216, 646, 386, [colors.accent[0], colors.accent[1], colors.accent[2], 225]);
  rect(buffer, 620, 386, 54, 100, colors.secondary);
  roundRect(buffer, 570, 486, 154, 52, 18, colors.secondary);
  const spots = [
    [228, 216], [286, 470], [930, 226], [986, 480], [184, 360], [1042, 350],
  ];
  for (let i = 0; i < spots.length; i++) {
    const [x, y] = spots[i];
    card(buffer, x - 82, y - 58, 164, 116, i % 2 ? colors.accent : colors.secondary);
    arrow(buffer, x + (x < 600 ? 90 : -90), y, 646, 326 + ((seed + i) % 3) * 22, [colors.primary[0], colors.primary[1], colors.primary[2], 145]);
  }
  circle(buffer, 646, 128, 40, [colors.secondary[0], colors.secondary[1], colors.secondary[2], 46]);
}

function chooseTheme(text: string, pillar: string) {
  const lower = `${pillar} ${text}`.toLowerCase();
  if (/landing|website|conversion|cro|lead|page|traffic/.test(lower)) return "CRO";
  if (/marketing|seo|google|content|ad|campaign|search|social/.test(lower)) return "MARKETING";
  return "AI";
}

export function buildSocialGraphicPng(post: string, topic: string, pillar: string) {
  const seed = hashString(`${topic}\n${pillar}\n${post}`);
  const colors = palette(seed);
  const buffer = new Uint8Array(WIDTH * HEIGHT * 4);
  drawBackground(buffer, colors, seed);
  const theme = chooseTheme(`${topic}\n${post}`, pillar);
  if (theme === "CRO") drawCro(buffer, colors);
  else if (theme === "MARKETING") drawMarketing(buffer, colors, seed);
  else drawAi(buffer, colors, seed);
  return encodePng(WIDTH, HEIGHT, buffer);
}

function crcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = crcTable();

function crc32(parts: Uint8Array[]) {
  let c = 0xffffffff;
  for (const part of parts) {
    for (const b of part) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(data: Uint8Array) {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32(value: number) {
  return new Uint8Array([
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ]);
}

function chunk(type: string, data: Uint8Array) {
  const typeBytes = new TextEncoder().encode(type);
  const crc = crc32([typeBytes, data]);
  return concat([u32(data.length), typeBytes, data, u32(crc)]);
}

function zlibStore(data: Uint8Array) {
  const parts: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  let offset = 0;
  while (offset < data.length) {
    const len = Math.min(65535, data.length - offset);
    const final = offset + len >= data.length ? 1 : 0;
    const header = new Uint8Array([
      final,
      len & 255,
      (len >>> 8) & 255,
      (~len) & 255,
      ((~len) >>> 8) & 255,
    ]);
    parts.push(header, data.slice(offset, offset + len));
    offset += len;
  }
  parts.push(u32(adler32(data)));
  return concat(parts);
}

function encodePng(width: number, height: number, rgba: Uint8Array) {
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rawOffset = y * (width * 4 + 1);
    raw[rawOffset] = 0;
    raw.set(rgba.slice(y * width * 4, (y + 1) * width * 4), rawOffset + 1);
  }
  const ihdr = new Uint8Array(13);
  ihdr.set(u32(width), 0);
  ihdr.set(u32(height), 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return concat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlibStore(raw)),
    chunk("IEND", new Uint8Array()),
  ]);
}

function concat(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
