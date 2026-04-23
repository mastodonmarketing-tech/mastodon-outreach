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

function magnifier(buffer: Uint8Array, cx: number, cy: number, color: Rgba) {
  circle(buffer, cx, cy, 36, [color[0], color[1], color[2], 48]);
  circle(buffer, cx, cy, 24, hex("ffffff", 245));
  line(buffer, cx + 23, cy + 23, cx + 62, cy + 62, 10, color);
}

function pin(buffer: Uint8Array, cx: number, cy: number, color: Rgba) {
  circle(buffer, cx, cy - 16, 34, color);
  triangle(buffer, cx - 22, cy + 2, cx + 22, cy + 2, cx, cy + 48, color);
  circle(buffer, cx, cy - 16, 12, hex("ffffff", 245));
}

function palette(seed: number) {
  const sets = [
    { primary: hex("553d67"), secondary: hex("16a36a"), accent: hex("b794d0"), warn: hex("d24b55") },
    { primary: hex("263c67"), secondary: hex("1ca58a"), accent: hex("f2b84b"), warn: hex("d24b55") },
    { primary: hex("4b3f72"), secondary: hex("259f6c"), accent: hex("7aa5ff"), warn: hex("c9424a") },
    { primary: hex("31516f"), secondary: hex("d36d3d"), accent: hex("71b7a7"), warn: hex("bc3d56") },
    { primary: hex("5a456b"), secondary: hex("2a9d8f"), accent: hex("e9c46a"), warn: hex("e76f51") },
  ];
  return sets[seed % sets.length];
}

function drawBackground(buffer: Uint8Array, colors: ReturnType<typeof palette>, seed: number) {
  fill(buffer, hex("fbfbfd"));
  const variant = seed % 4;
  if (variant === 0) {
    triangle(buffer, 0, 0, 470 + (seed % 90), 0, 0, 390, hex("f1f4f8", 255));
    triangle(buffer, WIDTH, HEIGHT, WIDTH - 530, HEIGHT, WIDTH, 270, hex("f6f0fb", 255));
  } else if (variant === 1) {
    triangle(buffer, WIDTH, 0, WIDTH - 430, 0, WIDTH, 392, hex("f1f4f8", 255));
    circle(buffer, 148, 166, 112, hex("f6f0fb", 255));
    circle(buffer, 1054, 535, 76, [colors.secondary[0], colors.secondary[1], colors.secondary[2], 18]);
  } else if (variant === 2) {
    rect(buffer, 0, 0, WIDTH, 92, hex("f1f4f8", 255));
    rect(buffer, 0, HEIGHT - 96, WIDTH, 96, hex("f6f0fb", 255));
    triangle(buffer, 230, 0, 640, 0, 394, HEIGHT, hex("f8fafc", 255));
  } else {
    circle(buffer, 210, 120, 130, hex("f1f4f8", 255));
    circle(buffer, 956, 178, 118, hex("f6f0fb", 255));
    triangle(buffer, 0, HEIGHT, 520, HEIGHT, 0, 214, hex("f8fafc", 255));
  }
  roundRect(buffer, 84, 88, 1032, 499, 32, hex("ffffff", 225));
  rect(buffer, 110, 562, 980, 2, hex("e7eaf1", 255));
  circle(buffer, 1040, 140, 70, [colors.accent[0], colors.accent[1], colors.accent[2], 28]);
  circle(buffer, 164, 532, 56, [colors.secondary[0], colors.secondary[1], colors.secondary[2], 24]);
}

function miniCardStack(buffer: Uint8Array, x: number, y: number, w: number, h: number, accent: Rgba, count = 3) {
  for (let i = count - 1; i >= 0; i--) {
    card(buffer, x + i * 22, y - i * 18, w, h, i === 0 ? accent : hex("cfd6e4", 255));
  }
}

function sparkline(buffer: Uint8Array, x: number, y: number, color: Rgba, up = true) {
  const points = up
    ? [[x, y + 58], [x + 72, y + 32], [x + 132, y + 44], [x + 210, y - 8], [x + 286, y + 8]]
    : [[x, y], [x + 72, y + 46], [x + 132, y + 30], [x + 210, y + 70], [x + 286, y + 52]];
  for (let i = 0; i < points.length - 1; i++) {
    line(buffer, points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], 8, color);
  }
}

function drawAiHub(buffer: Uint8Array, colors: ReturnType<typeof palette>, seed: number) {
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

function drawAiReview(buffer: Uint8Array, colors: ReturnType<typeof palette>) {
  miniCardStack(buffer, 150, 190, 235, 154, colors.primary, 3);
  card(buffer, 478, 244, 244, 164, colors.accent);
  card(buffer, 842, 196, 226, 154, colors.secondary);
  arrow(buffer, 392, 268, 470, 292, colors.primary);
  arrow(buffer, 728, 306, 832, 272, colors.secondary);
  circle(buffer, 600, 468, 56, [colors.primary[0], colors.primary[1], colors.primary[2], 44]);
  circle(buffer, 600, 446, 22, colors.primary);
  circle(buffer, 570, 494, 18, colors.secondary);
  circle(buffer, 632, 494, 18, colors.secondary);
  line(buffer, 570, 494, 600, 446, 6, [colors.primary[0], colors.primary[1], colors.primary[2], 170]);
  line(buffer, 632, 494, 600, 446, 6, [colors.primary[0], colors.primary[1], colors.primary[2], 170]);
  check(buffer, 958, 458, colors.secondary);
  circle(buffer, 958, 458, 76, [colors.secondary[0], colors.secondary[1], colors.secondary[2], 36]);
}

function drawAiLanes(buffer: Uint8Array, colors: ReturnType<typeof palette>) {
  const lanes = [
    { y: 176, color: colors.primary },
    { y: 318, color: colors.secondary },
    { y: 460, color: colors.accent },
  ];
  for (const lane of lanes) {
    card(buffer, 138, lane.y - 58, 174, 116, lane.color);
    card(buffer, 454, lane.y - 58, 174, 116, lane.color);
    card(buffer, 770, lane.y - 58, 174, 116, lane.color);
    arrow(buffer, 318, lane.y, 446, lane.y, lane.color);
    arrow(buffer, 634, lane.y, 762, lane.y, lane.color);
  }
  circle(buffer, 1010, 318, 62, [colors.primary[0], colors.primary[1], colors.primary[2], 52]);
  check(buffer, 1010, 318, colors.secondary);
  line(buffer, 944, 176, 1010, 318, 5, [colors.primary[0], colors.primary[1], colors.primary[2], 140]);
  line(buffer, 944, 318, 1010, 318, 5, [colors.primary[0], colors.primary[1], colors.primary[2], 140]);
  line(buffer, 944, 460, 1010, 318, 5, [colors.primary[0], colors.primary[1], colors.primary[2], 140]);
}

function drawAiImpactDashboard(buffer: Uint8Array, colors: ReturnType<typeof palette>, seed: number) {
  roundRect(buffer, 150, 152, 348, 330, 26, hex("ffffff", 248));
  roundRect(buffer, 150, 152, 348, 64, 26, colors.primary);
  for (let i = 0; i < 4; i++) {
    const x = 194 + i * 66;
    rect(buffer, x, 426 - i * 52, 38, 78 + i * 52, i % 2 ? colors.secondary : colors.accent);
  }
  sparkline(buffer, 552, 422, colors.secondary, true);
  circle(buffer, 850, 284, 110, [colors.secondary[0], colors.secondary[1], colors.secondary[2], 36]);
  circle(buffer, 850, 284, 64, colors.secondary);
  check(buffer, 850, 284, hex("ffffff", 245));
  card(buffer, 760, 440, 244, 118, colors.accent);
  arrow(buffer, 500, 326, 730, 292, colors.primary);
  for (let i = 0; i < 5; i++) {
    line(buffer, 562 + i * 48, 220 + ((seed + i) % 4) * 18, 642 + i * 46, 196 + i * 12, 5, [colors.primary[0], colors.primary[1], colors.primary[2], 110]);
  }
}

function drawAiImpactSteps(buffer: Uint8Array, colors: ReturnType<typeof palette>, seed: number) {
  for (let i = 0; i < 5; i++) {
    const x = 182 + i * 130;
    const h = 84 + i * 48;
    roundRect(buffer, x, 504 - h, 92, h, 18, i % 2 ? colors.secondary : colors.primary);
    circle(buffer, x + 46, 464 - h, 30, hex("ffffff", 245));
    rect(buffer, x + 25, 504 - h + 38, 42, 8, hex("ffffff", 210));
  }
  sparkline(buffer, 246, 240, colors.accent, true);
  card(buffer, 840, 180, 202, 142, colors.secondary);
  card(buffer, 840, 388, 202, 142, colors.accent);
  arrow(buffer, 764, 300, 832, 248, colors.secondary);
  arrow(buffer, 764, 388, 832, 454, colors.accent);
  for (let i = 0; i < 4; i++) {
    circle(buffer, 350 + i * 94 + (seed % 9), 146 + (i % 2) * 28, 12, colors.warn);
  }
}

function drawAiImpactScorecards(buffer: Uint8Array, colors: ReturnType<typeof palette>, seed: number) {
  for (let i = 0; i < 4; i++) {
    const x = 154 + (i % 2) * 258;
    const y = 172 + Math.floor(i / 2) * 182;
    card(buffer, x, y, 208, 128, i % 2 ? colors.secondary : colors.primary);
    circle(buffer, x + 154, y + 90, 26, i % 2 ? colors.accent : colors.secondary);
  }
  roundRect(buffer, 730, 156, 294, 392, 30, hex("ffffff", 248));
  for (let i = 0; i < 6; i++) {
    const y = 206 + i * 48;
    rect(buffer, 778, y, 96 + ((seed + i) % 5) * 28, 14, i % 2 ? hex("d8dce7", 255) : colors.secondary);
  }
  circle(buffer, 878, 470, 54, [colors.secondary[0], colors.secondary[1], colors.secondary[2], 44]);
  check(buffer, 878, 470, colors.secondary);
}

function drawAiImpact(buffer: Uint8Array, colors: ReturnType<typeof palette>, seed: number) {
  const variant = (seed + (seed >>> 3)) % 3;
  if (variant === 0) drawAiImpactDashboard(buffer, colors, seed);
  else if (variant === 1) drawAiImpactSteps(buffer, colors, seed);
  else drawAiImpactScorecards(buffer, colors, seed);
}

function drawAiTeam(buffer: Uint8Array, colors: ReturnType<typeof palette>) {
  const people = [
    [250, 230, colors.primary], [430, 430, colors.secondary], [610, 230, colors.accent], [790, 430, colors.primary], [970, 230, colors.secondary],
  ] as const;
  for (const [x, y, color] of people) {
    circle(buffer, x, y, 48, [color[0], color[1], color[2], 48]);
    circle(buffer, x, y - 18, 22, color);
    roundRect(buffer, x - 46, y + 14, 92, 58, 22, color);
  }
  for (let i = 0; i < people.length - 1; i++) {
    line(buffer, people[i][0] + 58, people[i][1], people[i + 1][0] - 58, people[i + 1][1], 6, [colors.primary[0], colors.primary[1], colors.primary[2], 110]);
  }
  roundRect(buffer, 450, 288, 300, 100, 28, hex("ffffff", 245));
  circle(buffer, 600, 338, 38, colors.primary);
  circle(buffer, 582, 330, 9, hex("ffffff", 245));
  circle(buffer, 618, 330, 9, hex("ffffff", 245));
  line(buffer, 578, 356, 622, 356, 6, hex("ffffff", 245));
}

function drawAiToolkit(buffer: Uint8Array, colors: ReturnType<typeof palette>, seed: number) {
  const icons = [colors.primary, colors.secondary, colors.accent, colors.warn, colors.secondary, colors.primary];
  for (let i = 0; i < 6; i++) {
    const x = 198 + (i % 3) * 310;
    const y = 172 + Math.floor(i / 3) * 214;
    roundRect(buffer, x, y, 190, 132, 22, hex("ffffff", 248));
    circle(buffer, x + 62, y + 64, 30, icons[i]);
    rect(buffer, x + 108, y + 44, 48 + ((seed + i) % 4) * 14, 10, hex("d8dce7", 255));
    rect(buffer, x + 108, y + 72, 58 + ((seed + i) % 3) * 20, 8, hex("e7eaf1", 255));
  }
  arrow(buffer, 392, 238, 494, 238, colors.primary);
  arrow(buffer, 702, 238, 804, 238, colors.secondary);
  arrow(buffer, 392, 452, 494, 452, colors.accent);
  arrow(buffer, 702, 452, 804, 452, colors.warn);
}

function drawAiAdoption(buffer: Uint8Array, colors: ReturnType<typeof palette>, seed: number) {
  const groups = [
    [202, 232, colors.primary], [202, 444, colors.secondary], [998, 232, colors.accent], [998, 444, colors.primary],
  ] as const;
  for (const [x, y, color] of groups) {
    roundRect(buffer, x - 78, y - 66, 156, 132, 22, hex("ffffff", 248));
    for (let i = 0; i < 3; i++) {
      const bx = x - 46 + i * 34;
      rect(buffer, bx, y + 30 - i * 18, 24, 34 + i * 18, color);
    }
    circle(buffer, x, y - 34, 18, color);
  }
  circle(buffer, 600, 338, 92, [colors.primary[0], colors.primary[1], colors.primary[2], 42]);
  circle(buffer, 600, 338, 54, colors.primary);
  circle(buffer, 578, 326, 10, hex("ffffff", 245));
  circle(buffer, 622, 326, 10, hex("ffffff", 245));
  line(buffer, 574, 356, 626, 356, 7, hex("ffffff", 245));
  for (const [x, y, color] of groups) {
    arrow(buffer, x + (x < 600 ? 92 : -92), y, 600 + (x < 600 ? -72 : 72), 338 + (y < 338 ? -34 : 34), color);
  }
  for (let i = 0; i < 5; i++) {
    circle(buffer, 440 + i * 78, 514 + ((seed + i) % 2) * 24, 16, i % 2 ? colors.secondary : colors.accent);
  }
}

function drawAi(buffer: Uint8Array, colors: ReturnType<typeof palette>, seed: number, topic: string, post: string) {
  const topicLower = topic.toLowerCase();
  const fullLower = `${topic}\n${post}`.toLowerCase();
  if (/tool|software|platform|stack|pick|chat|email/.test(topicLower)) {
    drawAiToolkit(buffer, colors, seed);
    return;
  }
  if (/employee|agentic|agent/.test(topicLower)) {
    drawAiTeam(buffer, colors);
    return;
  }
  if (/mid-market|business moment|adoption|today.?s market|strategies for success|ready for every business/.test(topicLower)) {
    drawAiAdoption(buffer, colors, seed);
    return;
  }
  if (/roi|growth|results|scale|scaling|payoff|revenue|profit/.test(topicLower)) {
    drawAiImpact(buffer, colors, seed);
    return;
  }
  if (/operation|workflow|process|admin|handoff/.test(topicLower)) {
    drawAiLanes(buffer, colors);
    return;
  }
  if (/tool|software|platform|stack|pick|chat|email/.test(fullLower)) {
    drawAiToolkit(buffer, colors, seed);
    return;
  }
  if (/employee|agentic|agent|sales|service|team|support/.test(fullLower)) {
    drawAiTeam(buffer, colors);
    return;
  }
  if (/roi|payoff|revenue|profit/.test(fullLower)) {
    drawAiImpact(buffer, colors, seed);
    return;
  }
  const variant = (seed + (seed >>> 5)) % 3;
  if (variant === 0) drawAiHub(buffer, colors, seed);
  else if (variant === 1) drawAiReview(buffer, colors);
  else drawAiLanes(buffer, colors);
}

function drawCroFlow(buffer: Uint8Array, colors: ReturnType<typeof palette>) {
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

function drawCroScoreboard(buffer: Uint8Array, colors: ReturnType<typeof palette>, seed: number) {
  card(buffer, 142, 212, 260, 170, colors.primary);
  card(buffer, 470, 170, 260, 170, colors.accent);
  card(buffer, 798, 212, 260, 170, colors.secondary);
  sparkline(buffer, 170, 490, colors.warn, false);
  sparkline(buffer, 642, 494, colors.secondary, true);
  circle(buffer, 600, 372, 52, hex("ffffff", 250));
  triangle(buffer, 566, 340, 636, 340, 600, 396, colors.accent);
  rect(buffer, 584, 396, 32, 64, colors.accent);
  for (let i = 0; i < 5; i++) {
    const x = 438 + i * 82 + (seed % 8);
    rect(buffer, x, 494 - i * 24, 42, 68 + i * 24, i % 2 ? colors.secondary : colors.primary);
  }
}

function drawCroWireframe(buffer: Uint8Array, colors: ReturnType<typeof palette>) {
  strokeRoundRect(buffer, 172, 140, 360, 382, 24, 5, colors.primary);
  roundRect(buffer, 212, 184, 280, 74, 16, [colors.primary[0], colors.primary[1], colors.primary[2], 42]);
  rect(buffer, 218, 304, 224, 12, hex("d8dce7", 255));
  rect(buffer, 218, 340, 264, 12, hex("e7eaf1", 255));
  rect(buffer, 218, 382, 180, 12, hex("d8dce7", 255));
  roundRect(buffer, 218, 438, 136, 46, 14, colors.warn);
  arrow(buffer, 540, 330, 714, 330, colors.primary);
  roundRect(buffer, 720, 184, 300, 296, 28, [colors.secondary[0], colors.secondary[1], colors.secondary[2], 42]);
  circle(buffer, 870, 282, 58, colors.secondary);
  check(buffer, 870, 282, hex("ffffff", 255));
  roundRect(buffer, 796, 390, 150, 52, 16, colors.secondary);
}

function drawCroTesting(buffer: Uint8Array, colors: ReturnType<typeof palette>, seed: number) {
  card(buffer, 138, 178, 230, 156, colors.primary);
  card(buffer, 138, 386, 230, 156, colors.accent);
  roundRect(buffer, 466, 148, 268, 420, 26, hex("ffffff", 248));
  for (let i = 0; i < 5; i++) {
    const y = 196 + i * 66;
    circle(buffer, 512, y, 18, i % 2 ? colors.secondary : colors.warn);
    rect(buffer, 548, y - 8, 128 + ((seed + i) % 3) * 24, 12, hex("d8dce7", 255));
  }
  sparkline(buffer, 796, 452, colors.secondary, true);
  circle(buffer, 936, 252, 64, [colors.secondary[0], colors.secondary[1], colors.secondary[2], 48]);
  check(buffer, 936, 252, colors.secondary);
  arrow(buffer, 380, 256, 456, 256, colors.primary);
  arrow(buffer, 380, 464, 456, 464, colors.accent);
}

function drawCro(buffer: Uint8Array, colors: ReturnType<typeof palette>, seed: number, text: string) {
  const lower = text.toLowerCase();
  if (/test|testing|framework|roadmap|phase|strategy/.test(lower)) {
    drawCroTesting(buffer, colors, seed);
    return;
  }
  if (/landing|builder|page|homepage/.test(lower)) {
    drawCroWireframe(buffer, colors);
    return;
  }
  if (/stat|rate|boost|metric|data/.test(lower)) {
    drawCroScoreboard(buffer, colors, seed);
    return;
  }
  const variant = (seed + (seed >>> 5)) % 3;
  if (variant === 0) drawCroFlow(buffer, colors);
  else if (variant === 1) drawCroScoreboard(buffer, colors, seed);
  else drawCroWireframe(buffer, colors);
}

function drawMarketingFunnel(buffer: Uint8Array, colors: ReturnType<typeof palette>, seed: number) {
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

function drawMarketingOrbit(buffer: Uint8Array, colors: ReturnType<typeof palette>, seed: number) {
  circle(buffer, 600, 322, 86, [colors.primary[0], colors.primary[1], colors.primary[2], 48]);
  circle(buffer, 600, 322, 48, colors.primary);
  const orbit = [
    [300, 170], [514, 132], [814, 178], [910, 376], [680, 514], [366, 466], [220, 318],
  ];
  for (let i = 0; i < orbit.length; i++) {
    const [x, y] = orbit[i];
    circle(buffer, x, y, 54, hex("ffffff", 245));
    circle(buffer, x, y, 32, i % 2 ? colors.secondary : colors.accent);
    line(buffer, 600, 322, x, y, 5, [colors.primary[0], colors.primary[1], colors.primary[2], 120]);
    if (i % 3 === 0) check(buffer, x, y, hex("ffffff", 245));
    else if (i % 3 === 1) {
      rect(buffer, x - 16, y - 16, 32, 32, hex("ffffff", 245));
      circle(buffer, x, y, 10, i % 2 ? colors.secondary : colors.accent);
    } else {
      triangle(buffer, x - 18, y + 18, x + 20, y + 18, x + 1, y - 20, hex("ffffff", 245));
    }
  }
  for (let i = 0; i < 5; i++) {
    const y = 548 - i * 18;
    line(buffer, 474 + i * 20, y, 724 + (seed % 20), y - 10, 4, [colors.secondary[0], colors.secondary[1], colors.secondary[2], 110]);
  }
}

function drawMarketingCalendar(buffer: Uint8Array, colors: ReturnType<typeof palette>) {
  card(buffer, 150, 172, 246, 176, colors.primary);
  card(buffer, 150, 386, 246, 176, colors.accent);
  roundRect(buffer, 500, 150, 246, 390, 22, hex("ffffff", 245));
  roundRect(buffer, 500, 150, 246, 46, 22, colors.primary);
  for (let y = 224; y < 498; y += 62) {
    for (let x = 528; x < 714; x += 62) {
      roundRect(buffer, x, y, 38, 38, 10, ((x + y) % 3) ? hex("e7eaf1", 255) : colors.secondary);
    }
  }
  card(buffer, 838, 230, 220, 150, colors.secondary);
  card(buffer, 838, 418, 220, 132, colors.warn);
  arrow(buffer, 406, 258, 492, 276, colors.primary);
  arrow(buffer, 406, 470, 492, 422, colors.accent);
  arrow(buffer, 750, 322, 830, 304, colors.secondary);
  arrow(buffer, 750, 438, 830, 476, colors.warn);
}

function drawMarketingSearch(buffer: Uint8Array, colors: ReturnType<typeof palette>) {
  roundRect(buffer, 174, 138, 654, 92, 36, hex("ffffff", 248));
  magnifier(buffer, 230, 184, colors.primary);
  for (let i = 0; i < 5; i++) {
    const y = 282 + i * 58;
    roundRect(buffer, 218, y, 430 - i * 28, 32, 12, i === 0 ? colors.secondary : hex("e7eaf1", 255));
  }
  sparkline(buffer, 718, 506, colors.secondary, true);
  card(buffer, 842, 216, 198, 146, colors.accent);
  card(buffer, 842, 404, 198, 132, colors.primary);
}

function drawMarketingMap(buffer: Uint8Array, colors: ReturnType<typeof palette>) {
  roundRect(buffer, 148, 132, 448, 420, 28, hex("ffffff", 248));
  line(buffer, 184, 236, 552, 178, 8, hex("e7eaf1", 255));
  line(buffer, 196, 408, 562, 342, 8, hex("e7eaf1", 255));
  line(buffer, 332, 142, 290, 542, 8, hex("e7eaf1", 255));
  pin(buffer, 286, 274, colors.primary);
  pin(buffer, 446, 394, colors.secondary);
  pin(buffer, 514, 214, colors.accent);
  card(buffer, 698, 166, 316, 142, colors.secondary);
  card(buffer, 698, 360, 316, 142, colors.primary);
  arrow(buffer, 606, 304, 688, 236, colors.secondary);
  arrow(buffer, 606, 384, 688, 430, colors.primary);
}

function drawMarketing(buffer: Uint8Array, colors: ReturnType<typeof palette>, seed: number, text: string) {
  const lower = text.toLowerCase();
  if (/local|map|near me|location|spam/.test(lower)) {
    drawMarketingMap(buffer, colors);
    return;
  }
  if (/google|seo|search|overview|visibility|rank|rules/.test(lower)) {
    drawMarketingSearch(buffer, colors);
    return;
  }
  if (/calendar|content|social|schedule/.test(lower)) {
    drawMarketingCalendar(buffer, colors);
    return;
  }
  const variant = (seed + (seed >>> 5)) % 3;
  if (variant === 0) drawMarketingFunnel(buffer, colors, seed);
  else if (variant === 1) drawMarketingOrbit(buffer, colors, seed);
  else drawMarketingCalendar(buffer, colors);
}

function chooseTheme(text: string, pillar: string) {
  const pillarKey = pillar.toLowerCase();
  if (pillarKey.includes("ai")) return "AI";
  if (pillarKey.includes("cro") || pillarKey.includes("website") || pillarKey.includes("conversion")) return "CRO";
  if (pillarKey.includes("marketing") || pillarKey.includes("seo") || pillarKey.includes("ads")) return "MARKETING";
  const lower = text.toLowerCase();
  if (/landing|website|conversion|cro|lead|page|traffic/.test(lower)) return "CRO";
  if (/marketing|seo|google|content|ad|campaign|search|social/.test(lower)) return "MARKETING";
  return "AI";
}

export function buildSocialGraphicPng(post: string, topic: string, pillar: string) {
  const seed = hashString(`${topic}\n${pillar}\n${post}`);
  const colors = palette(seed);
  const buffer = new Uint8Array(WIDTH * HEIGHT * 4);
  drawBackground(buffer, colors, seed);
  const text = `${topic}\n${post}`;
  const theme = chooseTheme(text, pillar);
  if (theme === "CRO") drawCro(buffer, colors, seed, text);
  else if (theme === "MARKETING") drawMarketing(buffer, colors, seed, text);
  else drawAi(buffer, colors, seed, topic, post);
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
