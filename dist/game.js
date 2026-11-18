const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const context = canvas.getContext('2d');
const storageKey = 'gachinolja-island-v1';
const { characters, colors, colorNames, shells, catalog } = IslandModel;
function readDeviceIsland() {
  try {
    const saved = IslandModel.normalize(JSON.parse(localStorage.getItem(storageKey)));
    if (saved.fire) return saved;
  } catch { /* The island can still be played in this session. */ }
  return null;
}
let island = readDeviceIsland() ?? emptyIsland();
let step = 0;
let placing = false;
let fireDraft;
let scenery;
let audio;
let angle = 0;
let photoFrame;
const photoDialog = $('photo-dialog');
const photoPreview = $('photo-preview');
const photoContext = photoPreview.getContext('2d');
const enabledCamera = () => !$('island-info').hidden;

function randomGenerator(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function ellipse(ctx, x, y, rx, ry, color) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function outline(shape) {
  const path = new Path2D();
  if (shape === 1) {
    path.moveTo(-0.64, -0.63);
    path.bezierCurveTo(-1.33, -0.11, -0.93, 0.98, -0.12, 0.93);
    path.bezierCurveTo(0.76, 1.04, 1.16, 0.66, 0.94, -0.37);
    path.bezierCurveTo(0.73, -0.03, 0.44, -0.53, 0.12, -0.36);
    path.bezierCurveTo(-0.29, -0.24, -0.48, -0.15, -0.64, -0.63);
  } else if (shape === 2) {
    path.moveTo(-0.95, -0.04);
    path.bezierCurveTo(-0.91, -0.92, -0.54, -0.98, -0.12, -0.66);
    path.bezierCurveTo(0.21, -0.42, 0.56, -0.88, 0.85, -0.47);
    path.bezierCurveTo(1.37, 0.39, 0.44, 0.95, -0.14, 0.81);
    path.bezierCurveTo(-0.77, 0.95, -1.02, 0.44, -0.95, -0.04);
  } else {
    path.moveTo(-0.98, 0.07);
    path.bezierCurveTo(-0.99, -0.47, -0.48, -0.82, -0.07, -0.76);
    path.bezierCurveTo(0.38, -0.88, 0.94, -0.43, 0.98, 0.06);
    path.bezierCurveTo(1.14, 0.61, 0.51, 0.88, 0.07, 0.81);
    path.bezierCurveTo(-0.46, 0.91, -0.98, 0.62, -0.98, 0.07);
  }
  path.closePath();
  return path;
}

const coastlines = [0, 1, 2].map(outline);
const islandHit = document.createElement('canvas').getContext('2d');
function onIsland(shape, x, y, margin = 0.96) {
  return Math.abs(x) <= 1 && Math.abs(y) <= 1 && islandHit.isPointInPath(coastlines[shape], x / margin, y / margin);
}
const rims = coastlines.map((_, shape) => Array.from({ length: 48 }, (_, index) => {
  const theta = index * Math.PI / 24;
  const dx = Math.cos(theta);
  const dy = Math.sin(theta);
  let inside = 0;
  let outside = 1.3;
  for (let trial = 0; trial < 12; trial++) {
    const middle = (inside + outside) / 2;
    if (onIsland(shape, dx * middle, dy * middle, 1)) inside = middle;
    else outside = middle;
  }
  return [dx * inside, dy * inside];
}));

function shellAt(shape, id) {
  const [x, y] = shells[id];
  for (const scale of [1, 0.89, 0.77, 0.66]) {
    const point = [x * scale, y * scale + (1 - scale) * 0.32];
    if (onIsland(shape, ...point)) return point;
  }
  return [x * 0.55, 0.43];
}
const groundSpecks = coastlines.map((coast) => {
  const hit = document.createElement('canvas').getContext('2d');
  const random = randomGenerator(237);
  const specks = [];
  for (let index = 0; index < 110; index++) {
    const x = (random() - 0.5) * 1.84;
    const y = (random() - 0.5) * 1.66;
    const radius = 0.4 + random() * 1.4;
    if (hit.isPointInPath(coast, x / 0.955, y / 0.955)) {
      const color = hit.isPointInPath(coast, x / 0.72, y / 0.72) ? '#ccdb9180' : '#80667574';
      specks.push({ x, y, radius, color });
    }
  }
  return specks;
});

function landPath(ctx, shape, x, y, rx, ry, color, angle = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(rx, ry);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.fill(coastlines[shape]);
  ctx.restore();
}

function project(camera, x, y, z = 0) {
  const { cos, sin } = camera;
  return [camera.x + camera.rx * (x * cos - y * sin), camera.y + camera.ry * (x * sin + y * cos) - camera.rx * z * 0.82];
}

function unproject(camera, x, y) {
  return turnVector(camera, (x - camera.x) / camera.rx, (y - camera.y) / camera.ry);
}

function turnVector({ cos, sin }, x, y) {
  return [x * cos + y * sin, y * cos - x * sin];
}

function fade(ctx, startY, endY, stops) {
  const gradient = ctx.createLinearGradient(0, startY, 0, endY);
  for (const [location, color] of stops) gradient.addColorStop(location, color);
  return gradient;
}

function tree(ctx, x, y, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size, size);
  ellipse(ctx, 4, 0, 18, 5, '#202f43a0');
  ctx.fillStyle = '#675463';
  ctx.fillRect(-3, -20, 6, 21);
  const leaves = fade(ctx, -67, -16, [[0, '#82ad9c'], [0.46, '#3c776e'], [1, '#213748']]);
  ellipse(ctx, 0, -32, 21, 17, '#213f4b');
  ellipse(ctx, 5, -36, 19, 16, '#2c555c');
  ellipse(ctx, -6, -40, 17, 17, '#4c8076');
  ellipse(ctx, 0, -51, 17, 18, leaves);
  ellipse(ctx, -5, -59, 8, 4, '#a3c2a28a');
  ctx.restore();
}

function surface(ctx, camera, vertices, color) {
  ctx.beginPath();
  vertices.forEach(([x, y, z], index) => {
    const [sx, sy] = project(camera, x, y, z);
    if (index) ctx.lineTo(sx, sy);
    else ctx.moveTo(sx, sy);
  });
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function block(ctx, camera, x, y, z, w, d, h, tones) {
  const a = x - w / 2;
  const b = x + w / 2;
  const c = y - d / 2;
  const e = y + d / 2;
  const top = z + h;
  const point = (u, v, hi) => [u, v, hi ? top : z];
  const wall = (u, v, s, t, color) => surface(ctx, camera,
    [point(u, v, false), point(s, t, false), point(s, t, true), point(u, v, true)], color);
  if (camera.sin > 0) wall(b, c, b, e, tones[1]);
  else wall(a, e, a, c, tones[1]);
  if (camera.cos > 0) wall(b, e, a, e, tones[0]);
  else wall(a, c, b, c, tones[0]);
  surface(ctx, camera, [point(a, c, true), point(b, c, true), point(b, e, true), point(a, e, true)], tones[2]);
}

function avatar(ctx, x, y, size, type, color, wave = 0, angle = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size, size);
  const skin = ['#edba9d', '#efd6e4', '#c99778', '#aaadc6', '#e4a071', '#d4ae8c', '#f0e8dc', '#94c78f'][type];
  const shadow = ['#b97570', '#b78eaa', '#8d5e56', '#7a7eaa', '#ab5954', '#946f67', '#aaa6ba', '#558b77'][type];
  const rig = { x: 0, y: 0, rx: 32, ry: 15, sin: Math.sin(angle), cos: Math.cos(angle) };
  ellipse(ctx, 0, 2, 18, 5, '#121d3866');
  for (const side of [-1, 1]) {
    block(ctx, rig, side * .133, .025, 0, .20, .24, .13, ['#4d476c', '#352e52', '#9f96b2']);
    block(ctx, rig, side * .12, 0, .13, .14, .15, .15, ['#746e9d', '#49476d', '#a49ab9']);
  }
  block(ctx, rig, 0, 0, .23, .47, .30, .42, [color, '#585578', '#eee1da']);
  for (const side of [-1, 1]) {
    const handZ = side === 1 && wave ? .66 + Math.sin(wave * 9) * .10 : .31;
    const handX = side * .31;
    block(ctx, rig, handX, 0, handZ, .15, .19, .22, [color, '#696084', '#cfbdd8']);
    const [hx, hy] = project(rig, handX, .025, handZ);
    ellipse(ctx, hx, hy, 3.8, 4.2, shadow);
    ellipse(ctx, hx - 0.4, hy - 0.9, 3.1, 3.5, skin);
  }
  const headY = -30;
  const fur = ctx.createRadialGradient(-5, headY - 5, 1, 0, headY, 17);
  fur.addColorStop(0, skin);
  fur.addColorStop(.62, skin);
  fur.addColorStop(1, shadow);
  for (const side of [-1, 1]) {
    if (type === 1) {
      ellipse(ctx, side * 7.4, headY - 13, 4.4, 11, skin);
      ellipse(ctx, side * 7.4, headY - 13, 2, 7.5, '#df97af');
    } else if (type === 3 || type === 4 || type === 5) {
      ctx.beginPath();
      ctx.moveTo(side * 4, headY - 6);
      ctx.lineTo(side * 12.2, headY - 17);
      ctx.lineTo(side * 15.2, headY - 4);
      ctx.fillStyle = skin;
      ctx.fill();
      if (type === 5) ellipse(ctx, side * 8.3, headY - 15, 2, 7, '#73596a');
    } else if (type) {
      ellipse(ctx, side * 10, headY - 9, 5.6, 5.9, type === 6 ? '#3e3a54' : skin);
    }
  }
  if (type === 0) ellipse(ctx, 0, headY - 3, 14.5, 12.8, '#4b343f');
  ellipse(ctx, 0, headY, 13.6, 12.1, fur);
  if (!type) ellipse(ctx, -4, headY - 9.3, 10.3, 4.7, '#503748');
  if (type === 4) ellipse(ctx, 0, headY + 3, 9, 5.8, '#f6d9bd');
  for (const side of [-1, 1]) {
    if (type === 6) ellipse(ctx, side * 5.4, headY, 3.2, 3.9, '#4c425e');
    if (type === 7) ellipse(ctx, side * 6.9, headY - 7.9, 4.1, 4.5, skin);
    const eyeY = type === 7 ? headY - 7.9 : headY;
    ellipse(ctx, side * 5.4, eyeY, 1.5, 2.1, '#292337');
    ellipse(ctx, side * 8.6, headY + 3.3, 2.4, 1.25, '#ed9a9f86');
  }
  ellipse(ctx, 0, headY + 4, 1.7, 1, '#9c6476');
  ctx.restore();
}

function drawCliffs(ctx, camera, shape) {
  const rim = rims[shape];
  for (let i = 0; i < rim.length; i++) {
    const [x, y] = rim[i];
    const [u, v] = rim[(i + 1) % rim.length];
    if ((v - y) * camera.sin - (u - x) * camera.cos > 0) {
      const ink = ['#74738b', '#8f8090', '#8a7b91', '#a18b97'][Math.floor(i / 3) % 4];
      surface(ctx, camera, [[x, y, 0], [u, v, 0], [u * 1.015, v * 1.015, -.044], [x * 1.015, y * 1.015, -.044]], ink);
    }
  }
}

function drawBuilding(ctx, camera, x, y, key) {
  const item = catalog[key];
  const tent = item.slot === 'tent';
  const mint = key === 'mintTent';
  const blue = key === 'blueCottage';
  const w = tent ? .27 : .30;
  const d = tent ? .26 : .30;
  const h = tent ? .028 : .16;
  const roof = tent ? .21 : .26;
  const [sx, sy] = project(camera, x, y);
  ellipse(ctx, sx, sy + 4, camera.rx * .19, camera.ry * .11, '#27364c79');
  const base = tent
    ? (mint ? ['#547f79', '#45656d', '#9fd3ba'] : ['#8976a2', '#604d76', '#bea8ca'])
    : (blue ? ['#a28c7b', '#666f8c', '#ddd3ac'] : ['#ba906f', '#836381', '#e6be92']);
  block(ctx, camera, x, y, 0, w, d, h, base);
  const a = x - w / 2;
  const b = x + w / 2;
  const c = y - d / 2;
  const e = y + d / 2;
  const roofSide = camera.sin >= 0 ? b : a;
  const front = camera.cos >= 0 ? e : c;
  const frontShade = key === 'mintTent' ? '#608e87' : key === 'blueCottage' ? '#5575a4' : tent ? '#897bc9' : '#b58e81';
  surface(ctx, camera, [[a, front, h], [b, front, h], [x, front, roof]], frontShade);
  surface(ctx, camera, [[roofSide, c, h], [roofSide, e, h], [x, e, roof], [x, c, roof]], item.shade);
  const doorY = front + Math.sign(front - y) * .002;
  surface(ctx, camera, [[x - .044, doorY, .014], [x + .044, doorY, .014],
    [x + .035, doorY, tent ? .10 : .135], [x - .035, doorY, tent ? .10 : .135]], tent ? '#443c68' : '#ffe3a2');
}

function drawShell(ctx, x, y, size, time, id) {
  const glow = 0.37 + Math.sin(time * 2 + id) * 0.16;
  ellipse(ctx, x, y, 9 * size, 5 * size, `rgba(255,221,174,${glow})`);
  ellipse(ctx, x, y + size, 5 * size, 2 * size, '#865e78');
  ctx.beginPath();
  ctx.moveTo(x, y + size * 3);
  ctx.bezierCurveTo(x - size * 9, y - size * 1.5, x - size * 3, y - size * 7, x, y - size * 5);
  ctx.bezierCurveTo(x + size * 5, y - size * 7, x + size * 9, y - size * 1.5, x, y + size * 3);
  ctx.fillStyle = id % 2 ? '#f3b7b5' : '#ffe2b8';
  ctx.fill();
  for (const offset of [-2, 0, 2]) {
    ctx.beginPath();
    ctx.moveTo(x + size * offset * 1.7, y - 2.9 * size);
    ctx.lineTo(x, y + size * 2);
    ctx.strokeStyle = '#aa7484';
    ctx.lineWidth = size * .55;
    ctx.stroke();
  }
}

function fire(ctx, x, y, size, time, variant) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size, size);
  const glow = ctx.createRadialGradient(0, -2, 2, 0, -2, 70);
  const violet = variant === 'violetFire';
  glow.addColorStop(0, violet ? '#c19efb83' : '#ffbf7670');
  glow.addColorStop(1, violet ? '#bc8bff00' : '#ff995600');
  ellipse(ctx, 0, 0, 76, 47, glow);
  ellipse(ctx, 0, 4, 19, 7, '#5c494f');
  if (variant !== 'logFire') {
    for (let i = 0; i < 9; i++) {
      const phi = i * Math.PI * 2 / 9;
      ellipse(ctx, Math.cos(phi) * 19, Math.sin(phi) * 7 + 4, 4.7, 3.3, violet ? '#b6a1d2' : '#b1a0a6');
    }
  }
  ctx.strokeStyle = '#cc8f70';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-12, 0); ctx.lineTo(11, 5);
  ctx.moveTo(-11, 5); ctx.lineTo(12, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-10, -2);
  ctx.quadraticCurveTo(-16, -12, -4, -21);
  ctx.quadraticCurveTo(1, -15, 1 + Math.sin(time * 6) * 5, -36);
  ctx.quadraticCurveTo(18, -16, 10, -3);
  ctx.closePath();
  ctx.fillStyle = violet ? '#af83f2' : '#ff9966';
  ctx.fill();
  ellipse(ctx, 0, -9, 5, 10, violet ? '#f7dbff' : '#ffe5a3');
  const spark = violet ? '226,197,255' : '255,211,142';
  for (let index = 0; index < 4; index++) {
    const lift = (time * 17 + index * 12) % 47;
    ellipse(ctx, Math.sin(lift / 9 + index) * 12, -16 - lift, 1.25, 1.25, `rgba(${spark},${1 - lift / 47})`);
  }
  ctx.restore();
}

function drawSky(ctx, width, height, horizon, time, angle) {
  const random = randomGenerator(322);
  ctx.fillStyle = fade(ctx, 0, horizon, [[0, '#090e25'], [0.63, '#1c2445'], [1, '#4b4267']]);
  ctx.fillRect(0, 0, width, height);
  const moonX = width * (0.76 - Math.sin(angle) * 0.11);
  const moonY = horizon * 0.43;
  const moon = Math.min(width, height) * 0.036;
  const halo = ctx.createRadialGradient(moonX, moonY, 0, moonX, moonY, moon * 6);
  halo.addColorStop(0, '#edc8ac38');
  halo.addColorStop(0.24, '#bfb2d725');
  halo.addColorStop(1, '#a89aca00');
  ellipse(ctx, moonX, moonY, moon * 6, moon * 6, halo);
  for (let index = 0; index < 45; index++) {
    const x = ((random() + 2 - Math.sin(angle) * 0.12) % 1) * width;
    const y = random() * horizon * 0.92;
    const radius = random() * 0.9 + 0.35;
    const alpha = 0.24 + 0.46 * random() + Math.sin(time + index) * 0.10;
    ellipse(ctx, x, y, radius, radius, `rgba(255,238,206,${alpha})`);
    if (index % 13 === 0) {
      ellipse(ctx, x, y, 0.55, 3.4, '#fff0cb88');
      ellipse(ctx, x, y, 2.7, 0.45, '#fff0cb88');
    }
  }
  ctx.save();
  ctx.translate(moonX, moonY);
  ctx.scale(moon, moon);
  ctx.beginPath();
  ctx.moveTo(0.07, -1);
  ctx.bezierCurveTo(-1.22, -1.02, -1.34, 0.62, -0.34, 0.94);
  ctx.bezierCurveTo(0.22, 1.12, 0.83, 0.67, 0.91, 0.26);
  ctx.bezierCurveTo(0.05, 0.75, -0.55, -0.2, 0.07, -1);
  ctx.fillStyle = '#ffedca';
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = fade(ctx, horizon, height, [[0, '#514663'], [0.22, '#263c57'], [0.58, '#142d48'], [1, '#0b1b36']]);
  ctx.fillRect(0, horizon, width, height - horizon);
  for (let index = 0; index < 132; index++) {
    const depth = random() ** 1.46;
    const widthScale = 0.12 + depth * 0.82;
    const x = (index % 4 === 0 ? moonX + (random() - 0.5) * width * (0.06 + depth * 0.33) : random() * width);
    const y = horizon + depth * (height - horizon);
    const length = (random() * Math.min(width * 0.10, 74) + 3) * widthScale;
    const alpha = (index % 4 === 0 ? 0.25 : 0.12) * (0.67 + Math.sin(time * 0.75 + index) * 0.33);
    const tint = index % 4 === 0 ? '236,191,169' : '144,199,214';
    ellipse(ctx, x + Math.sin(time + index) * 5, y, length, (0.55 + random()) * widthScale, `rgba(${tint},${alpha})`);
  }
}

function draw(ctx, width, height, time, showAvatar, showFire, view = island, players, angle = 0, photo = false, clock = Date.now()) {
  const horizon = height * (showAvatar ? 0.35 : 0.49);
  drawSky(ctx, width, height, horizon, time, angle);
  const x = width * 0.5;
  const y = height * (photo ? 0.55 : showAvatar ? 0.56 : 0.73);
  const rx = Math.min(width * (photo ? 0.4 : 0.385), height * 0.53);
  const ry = rx * 0.52;
  const size = Math.max(0.65, rx / 236);
  const camera = { x, y, rx, ry, cos: Math.cos(angle), sin: Math.sin(angle) };
  const shape = showAvatar ? view.shape : 0;
  const decor = showAvatar ? view.decor ?? IslandModel.defaults : IslandModel.defaults;
  const ground = (scale, offset, color) => landPath(ctx, shape, x, y + offset * size, rx * scale, ry * scale, color, angle);
  const wash = (1 + Math.sin(time * 1.4)) * 0.02;
  ground(1.2, 14, '#64c7c315');
  ground(1.12 + wash, 11, '#8aeddb38');
  ground(1.09 + wash, 10, '#1c5067');
  ground(1.065, 8, '#b5ebd161');
  drawCliffs(ctx, camera, shape);
  const sands = [
    ['#e0cab3', '#c9b29e', '#a99294'], ['#e3c5c7', '#c5a7bc', '#ac8ca7'], ['#dfd2b4', '#b5b7a1', '#8b9e99'],
  ][shape];
  ground(1, 0, fade(ctx, y - ry, y + ry, [[0, sands[0]], [0.54, sands[1]], [1, sands[2]]]));
  ground(0.77, -2, '#425c5b');
  const meadow = ctx.createRadialGradient(x - rx * 0.13, y - ry * 0.3, 0, x - rx * 0.13, y - ry * 0.3, rx * 0.86);
  meadow.addColorStop(0, '#a0a67b');
  meadow.addColorStop(0.54, '#78927b');
  meadow.addColorStop(1, '#537666');
  ground(0.74, -4, meadow);

  for (const speck of groundSpecks[shape]) {
    const [gx, gy] = project(camera, speck.x, speck.y);
    ellipse(ctx, gx, gy, speck.radius * size, speck.radius * size * 0.5, speck.color);
  }

  drawDock(ctx, camera, size, decor.bridge);
  const grove = shape === 1 ? [[-0.69, 0.15], [-0.55, -0.10], [0.66, 0.11], [0.55, 0.22]] : [[-0.58, -0.15], [-0.41, -0.36], [0.30, -0.37], [0.54, -0.23], [0.62, -0.04]];
  const objects = [];
  const add = (px, py, paint) => {
    const [sx, sy] = project(camera, px, py);
    objects.push({ sy, paint: () => paint(sx, sy) });
  };
  grove.forEach(([px, py], index) => add(px, py, (sx, sy) => tree(ctx, sx, sy, size * (0.74 + index % 3 * 0.19))));
  for (const key of [decor.house, decor.tent].filter(Boolean)) {
    const [px, py] = catalog[key].at;
    add(px, py, () => drawBuilding(ctx, camera, px, py, key));
  }
  if (decor.plant) {
    const placement = shape === 1 ? [-0.38, 0.36] : [-0.02, -0.32];
    add(...placement, (sx, sy) => drawGarden(ctx, sx, sy, size, time, decor.plant));
  }
  if (showAvatar) {
    const freshShells = IslandModel.shellsReturned(view, clock);
    shells.forEach((_, id) => {
      const [px, py] = shellAt(view.shape, id);
      if (freshShells || !view.collected.includes(id)) {
        add(px, py, (sx, sy) => drawShell(ctx, sx, sy, size, time, id));
      }
    });
  }
  [[-0.78, 0.31], [-0.13, 0.63], [0.39, 0.52], [0.79, 0.23]].forEach(([px, py], index) => {
    add(px, py, (sx, sy) => {
      const rock = size * (5 + index % 2 * 2);
      ellipse(ctx, sx, sy, rock, rock * 0.43, '#625b6b');
      ellipse(ctx, sx - rock * 0.15, sy - rock * 0.22, rock * 0.82, rock * 0.34, '#a49ba5');
      ellipse(ctx, sx + rock * 1.1, sy + rock * 0.2, rock * 0.36, rock * 0.24, '#918592');
    });
  });
  [[-0.67, 0.29], [-0.24, 0.41], [0.25, 0.51], [0.50, 0.33]].forEach(([px, py], index) => {
    add(px, py, (sx, sy) => flowers(ctx, sx, sy, size, index));
  });
  if (showFire) {
    add(showFire.x, showFire.y, (sx, sy) => fire(ctx, sx, sy, size, time, decor.firepit));
  }
  if (players) {
    for (const player of players) {
      add(player.x, player.y, (sx, sy) => {
        avatar(ctx, sx, sy, size, player.character, colors[player.color], player.wave ? time || 1 : 0, angle);
        if (photo) return;
        ctx.textAlign = 'center';
        ctx.font = `600 ${Math.max(9, size * 10)}px sans-serif`;
        ctx.strokeStyle = '#171b31';
        ctx.lineWidth = Math.max(2, size * 3);
        const label = player.wave > 0 ? `✦ ${player.name}` : player.name;
        ctx.strokeText(label, sx, sy - 48 * size, 84 * size);
        ctx.fillStyle = player.wave > 0 ? '#ffd69b' : '#fff5da';
        ctx.fillText(label, sx, sy - 48 * size, 84 * size);
      });
    }
  } else if (showAvatar) {
    const base = showFire || IslandModel.point(1);
    const px = onIsland(shape, base.x - 0.13, base.y + 0.055) ? base.x - 0.13 : 0.04;
    const py = onIsland(shape, base.x - 0.13, base.y + 0.055) ? base.y + 0.055 : 0.42;
    add(px, py, (sx, sy) => avatar(ctx, sx, sy, size, view.character, colors[view.color], 0, angle));
  }
  objects.sort((a, b) => a.sy - b.sy).forEach((object) => object.paint());
  return camera;
}

function drawGarden(ctx, x, y, size, time, key) {
  if (key === 'fireflyTree') {
    tree(ctx, x, y, size * 1.35);
    for (let i = 0; i < 7; i++) {
      const u = x + Math.sin(i * 2 + time * 0.54) * size * 24;
      const v = y - (28 + i * 7) * size;
      ellipse(ctx, u, v, 5 * size, 5 * size, '#eaf6a044');
      ellipse(ctx, u, v, 1.5 * size, 1.5 * size, '#f7ffd5');
    }
    return;
  }
  ellipse(ctx, x, y + 3, 26 * size, 6 * size, '#30464980');
  for (let i = 0; i < 7; i++) {
    const sx = x + (i - 3) * size * 7;
    const sy = y - (9 + i % 3 * 6) * size;
    ellipse(ctx, sx, sy + 5 * size, 8 * size, 8 * size, '#4d7c75');
    ellipse(ctx, sx, sy, 6.5 * size, 5.5 * size, ['#9a82c1', '#c8abec', '#a99bd8'][i % 3]);
    ellipse(ctx, sx - size * 2, sy - size, 2 * size, 1.5 * size, '#ded2ff');
  }
}

function drawDock(ctx, camera, size, bridge) {
  const [x, y] = project(camera, 0.59, 0.47);
  const [edgeX, edgeY] = project(camera, bridge ? 1.035 : 0.98, 0.67);
  const length = Math.hypot(edgeX - x, edgeY - y);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.atan2(edgeY - y, edgeX - x));
  ctx.fillStyle = '#403a50';
  ctx.fillRect(0, -11 * size, length, 24 * size);
  for (let index = 0; index < 12; index++) {
    const grain = bridge === 'cedarBridge' ? ['#a47766', '#d3a57c', '#b58668'] :
      bridge === 'lanternBridge' ? ['#aa879d', '#d4ac9e', '#b98c9e'] : ['#9f7f77', '#c0a089', '#ae8b7a'];
    ctx.fillStyle = grain[index % 3];
    ctx.fillRect(index * length / 12, -10 * size, length * 0.077, 19 * size);
  }
  ctx.restore();
  ellipse(ctx, edgeX, edgeY, 5 * size, 3 * size, '#4c4053');
  ctx.fillStyle = '#5a444f';
  ctx.fillRect(edgeX - 2 * size, edgeY - 16 * size, 4 * size, 17 * size);
  ellipse(ctx, edgeX, edgeY - 16 * size, 4 * size, 5 * size, '#ffd19a');
  ellipse(ctx, edgeX, edgeY - 16 * size, 12 * size, 12 * size, '#ffa76a29');
  if (bridge) {
    for (const t of [.17, .48, .78]) {
      const tx = x + (edgeX - x) * t;
      const ty = y + (edgeY - y) * t - 8 * size;
      ctx.fillStyle = '#6b5261';
      ctx.fillRect(tx - 1.5 * size, ty - 7 * size, 3 * size, 12 * size);
      if (bridge === 'lanternBridge') ellipse(ctx, tx, ty - 8 * size, 3 * size, 3 * size, '#ffe0a0');
    }
  }
}

function flowers(ctx, x, y, size, index) {
  ellipse(ctx, x, y, 12 * size, 3 * size, '#2d514e71');
  for (let i = 0; i < 5; i++) {
    const sx = x + (i * 4 - 8) * size;
    const sy = y - (2 + (index + i * 3) % 7) * size;
    ellipse(ctx, sx, sy + 2 * size, 1.9 * size, 2.8 * size, '#376951');
    ellipse(ctx, sx, sy, 1.5 * size, 1.3 * size, i % 2 ? '#eed1ac' : '#d9a6bc');
  }
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
function render(time = 0) {
  const session = window.islandMultiplayer;
  const shared = session?.view(time);
  const visit = window.islandLife?.currentVisit();
  const animation = reducedMotion.matches ? 0 : time / 1000;
  const view = shared?.island ?? visit ?? island;
  const cameraAvailable = enabledCamera();
  if ($('orbit-controls').hidden === cameraAvailable) {
    $('orbit-controls').hidden = !cameraAvailable;
    document.body.classList.toggle('has-orbit', cameraAvailable);
  }
  if (photoDialog.open) {
    photoFrame = { animation, view: { ...view }, players: shared?.players, angle, clock: Date.now() };
    drawPhoto(photoContext, photoFrame);
  } else {
    const width = innerWidth;
    const height = innerHeight;
    const scale = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * scale) || canvas.height !== Math.round(height * scale)) {
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
    }
    context.setTransform(scale, 0, 0, scale, 0, 0);
    scenery = draw(context, width, height, animation, !!shared || !!visit || step > 0,
      placing ? fireDraft : view.fire || (!step && !visit ? IslandModel.point(1) : null),
      view, shared?.players, cameraAvailable ? angle : 0);
    if (placing) positionFireHandle();
  }
  requestAnimationFrame(render);
}

function positionFireHandle() {
  if (!scenery || !fireDraft) return;
  const [x, y] = project(scenery, fireDraft.x, fireDraft.y);
  $('fire-handle').style.left = `${x}px`;
  $('fire-handle').style.top = `${y}px`;
}

function persistIsland() {
  if (!window.islandAccount?.save(island)) {
    try { localStorage.setItem(storageKey, JSON.stringify(island)); }
    catch { /* Keep the current island in memory. */ }
  }
  window.islandMultiplayer?.updateIsland(island);
  window.islandLife?.sync();
}

function saveFire() {
  if (!placing || !fireDraft) return;
  island.fire = { ...fireDraft };
  persistIsland();
  showIsland(false);
  $('hint').textContent = '모닥불 위치를 저장했어요.';
  $('move').focus();
}

function emptyIsland() {
  return IslandModel.normalize();
}

function loadIsland(snapshot) {
  island = snapshot ? IslandModel.normalize(snapshot) : emptyIsland();
  step = snapshot ? 3 : 0;
  placing = false;
  if (step) {
    showIsland(false);
    window.islandMultiplayer?.updateIsland(island);
  } else {
    $('island-info').hidden = true;
    $('tools').hidden = true;
    $('land').hidden = true;
    $('fire-actions').hidden = true;
    $('setup').hidden = true;
    $('welcome').hidden = false;
  }
  window.islandLife?.sync();
}

function showIsland(pickSpot) {
  placing = pickSpot;
  fireDraft = placing ? { ...(island.fire || IslandModel.point(1)) } : null;
  $('welcome').hidden = true;
  $('setup').hidden = true;
  $('island-info').hidden = false;
  $('island-title').textContent = island.name || '나의 섬';
  $('hint').textContent = placing ? '땅 위에서 모닥불을 드래그한 뒤 저장해요.' : '';
  $('tools').hidden = placing || !island.fire;
  window.islandMultiplayer?.syncControls();
  $('land').hidden = !placing;
  $('fire-actions').hidden = !placing;
  $('move').setAttribute('aria-pressed', String(placing));
  $('move').textContent = placing ? '옮기기 취소' : '모닥불 옮기기';
  $('photo').disabled = placing;
  positionFireHandle();
  window.islandLife?.sync();
  if (placing) $('fire-handle').focus();
}

function choices(label, labels, key, drawPreview, selection = island, onChange) {
  const group = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = label;
  const list = document.createElement('div');
  list.className = 'choices';
  labels.forEach((name, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice';
    button.setAttribute('aria-pressed', String(selection[key] === index));
    if (drawPreview) {
      const thumbnail = document.createElement('canvas');
      thumbnail.width = 84;
      thumbnail.height = 60;
      thumbnail.setAttribute('aria-hidden', 'true');
      drawPreview(thumbnail.getContext('2d'), index);
      button.append(thumbnail);
    }
    button.append(name);
    button.addEventListener('click', () => {
      selection[key] = index;
      for (const item of list.children) item.setAttribute('aria-pressed', String(item === button));
      onChange?.();
    });
    list.append(button);
  });
  group.append(legend, list);
  return group;
}

function lookOptions(element, selection) {
  let characterChoices;
  const refresh = () => {
    for (const [type, preview] of [...characterChoices.querySelectorAll('canvas')].entries()) {
      const ctx = preview.getContext('2d');
      ctx.clearRect(0, 0, 84, 60);
      avatar(ctx, 42, 54, 1, type, colors[selection.color], 0, 0.28);
    }
  };
  characterChoices = choices('캐릭터', characters, 'character',
    (ctx, type) => avatar(ctx, 42, 54, 1, type, colors[selection.color], 0, 0.28), selection);
  characterChoices.classList.add('character-choices');
  element.replaceChildren(characterChoices, choices('옷 색', colorNames, 'color', null, selection, refresh));
}

function showSetup() {
  $('welcome').hidden = step !== 0;
  $('setup').hidden = step === 0;
  if (!step) { $('start').focus(); return; }
  $('steps').textContent = `섬 만들기 · ${step}/3`;
  $('setup-title').textContent = step === 1 ? '어떤 모습으로 갈까요?' : '섬 이름을 지어봐요';
  $('setup-title').tabIndex = -1;
  const element = $('options');
  element.replaceChildren();
  if (step === 1) {
    lookOptions(element, island);
  } else {
    const label = document.createElement('label');
    label.className = 'name-label';
    label.htmlFor = 'island-name';
    label.textContent = '섬 이름';
    const input = document.createElement('input');
    input.id = 'island-name';
    input.maxLength = 24;
    input.placeholder = '나의 섬';
    input.value = island.name;
    input.addEventListener('input', () => { island.name = input.value; });
    element.append(label, input);
  }
  $('setup-title').focus();
}

function drawPhoto(ctx, frame) {
  draw(ctx, 540, 960, frame.animation, true, frame.view.fire, frame.view, frame.players, frame.angle, true, frame.clock);
  const vignette = ctx.createRadialGradient(270, 490, 188, 270, 490, 555);
  vignette.addColorStop(0, '#07092000');
  vignette.addColorStop(1, '#07092060');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, 540, 960);
}

function savePhoto() {
  if (!photoFrame) return;
  const status = $('photo-status');
  const capture = $('capture');
  capture.disabled = true;
  status.textContent = '사진을 저장하는 중이에요.';
  const photo = document.createElement('canvas');
  photo.width = 1080;
  photo.height = 1920;
  const ctx = photo.getContext('2d');
  ctx.scale(2, 2);
  drawPhoto(ctx, photoFrame);
  photo.toBlob((blob) => {
    capture.disabled = false;
    if (!blob) {
      status.textContent = '사진을 저장하지 못했어요. 다시 눌러 주세요.';
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `gachinolja-island-${Date.now()}.png`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    status.textContent = '사진을 다운로드했어요.';
  }, 'image/png');
}

function rotateCamera(amount) {
  angle = (angle + amount) % (Math.PI * 2);
}

function addOrbitGesture(surface, enabled, tap) {
  let pointer;
  surface.addEventListener('pointerdown', (event) => {
    if (pointer || !event.isPrimary || event.button !== 0 || !enabled()) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, dragged: false };
    surface.setPointerCapture(event.pointerId);
  });
  surface.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointer?.id) return;
    if (!pointer.dragged && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) < 7) return;
    pointer.dragged = true;
    surface.classList.add('dragging');
    rotateCamera((event.clientX - pointer.lastX) * Math.PI * 2 / Math.max(400, surface.clientWidth));
    pointer.lastX = event.clientX;
  });
  const release = (event) => {
    if (event.pointerId !== pointer?.id) return;
    if (event.type === 'pointerup' && !pointer.dragged && enabled()) tap?.(event);
    pointer = undefined;
    surface.classList.remove('dragging');
  };
  surface.addEventListener('pointerup', release);
  surface.addEventListener('pointercancel', release);
  surface.addEventListener('lostpointercapture', release);
}

async function toggleSound() {
  const button = $('sound');
  button.disabled = true;
  try {
    if (!audio) {
      audio = new AudioContext();
      const noise = audio.createBuffer(1, audio.sampleRate * 8, audio.sampleRate);
      const samples = noise.getChannelData(0);
      for (let index = 0; index < samples.length; index++) {
        const tide = 0.12 + 0.23 * (0.5 - 0.5 * Math.cos(index / samples.length * Math.PI * 4)) ** 2;
        samples[index] = (Math.random() * 2 - 1) * tide;
      }
      const source = audio.createBufferSource();
      const filter = audio.createBiquadFilter();
      const volume = audio.createGain();
      source.buffer = noise;
      source.loop = true;
      filter.type = 'lowpass';
      filter.frequency.value = 710;
      volume.gain.value = 0.52;
      source.connect(filter).connect(volume).connect(audio.destination);
      source.start();
      await audio.resume();
    } else if (audio.state === 'running') await audio.suspend();
    else await audio.resume();
    const playing = audio.state === 'running';
    button.setAttribute('aria-pressed', String(playing));
    button.textContent = playing ? '파도 소리 끄기' : '파도 소리 켜기';
  } catch {
    button.textContent = '파도 소리 다시 켜기';
  } finally {
    button.disabled = false;
  }
}

function previewFire(screenX, screenY) {
  if (!placing || !scenery) return;
  const [x, y] = unproject(scenery, screenX, screenY);
  if (!onIsland(island.shape, x, y)) return;
  fireDraft = { x, y };
  positionFireHandle();
}

let firePointer;
const fireHandle = $('fire-handle');
function startFireDrag(event) {
  if (!placing || !event.isPrimary || event.button !== 0) return;
  firePointer = event.pointerId;
  event.currentTarget.setPointerCapture(firePointer);
  if (event.currentTarget === canvas) previewFire(event.clientX, event.clientY);
}
fireHandle.addEventListener('pointerdown', startFireDrag);
canvas.addEventListener('pointerdown', startFireDrag);
window.addEventListener('pointermove', (event) => {
  if (event.pointerId === firePointer) previewFire(event.clientX, event.clientY);
});
window.addEventListener('pointerup', (event) => {
  if (event.pointerId !== firePointer) return;
  previewFire(event.clientX, event.clientY);
  firePointer = undefined;
});
window.addEventListener('pointercancel', (event) => { if (event.pointerId === firePointer) firePointer = undefined; });
fireHandle.addEventListener('keydown', (event) => {
  const direction = { ArrowLeft: [-14, 0], ArrowRight: [14, 0], ArrowUp: [0, -14], ArrowDown: [0, 14] }[event.key];
  if (!direction || !placing || !scenery) return;
  event.preventDefault();
  const [x, y] = project(scenery, fireDraft.x, fireDraft.y);
  previewFire(x + direction[0], y + direction[1]);
});
$('save-fire').addEventListener('click', saveFire);
$('cancel-fire').addEventListener('click', () => {
  if (island.fire) showIsland(false);
  else {
    placing = false;
    fireDraft = null;
    step = 2;
    for (const id of ['island-info', 'land', 'fire-actions']) $(id).hidden = true;
    showSetup();
  }
});
$('start').addEventListener('click', () => { step = 1; showSetup(); });
$('back').addEventListener('click', () => { step--; showSetup(); });
$('setup').addEventListener('submit', (event) => {
  event.preventDefault();
  step++;
  if (step === 3) { island.name = island.name.trim(); showIsland(true); }
  else showSetup();
});
$('move').addEventListener('click', () => showIsland(!placing));
$('photo').addEventListener('click', () => {
  if (placing || photoDialog.open) return;
  photoFrame = undefined;
  $('photo-status').textContent = '드래그해서 구도를 잡아봐요.';
  photoDialog.showModal();
  $('capture').focus();
});
$('capture').addEventListener('click', savePhoto);
for (const [left, right] of [['orbit-left', 'orbit-right'], ['photo-left', 'photo-right']]) {
  $(left).addEventListener('click', () => rotateCamera(-Math.PI / 8));
  $(right).addEventListener('click', () => rotateCamera(Math.PI / 8));
}
addOrbitGesture(canvas, () => enabledCamera() && !placing, (event) => {
  if (!window.islandLife?.pickAt(event.clientX, event.clientY)) window.islandMultiplayer?.walkTo(event.clientX, event.clientY);
});
addOrbitGesture(photoPreview, () => photoDialog.open);
window.addEventListener('keydown', (event) => {
  if (!enabledCamera() || event.ctrlKey || event.metaKey || event.altKey || (document.querySelector('dialog[open]') && !photoDialog.open)) return;
  const key = event.key.toLowerCase();
  const left = key === 'q' || (photoDialog.open && key === 'arrowleft');
  const right = key === 'e' || (photoDialog.open && key === 'arrowright');
  if (!left && !right) return;
  event.preventDefault();
  rotateCamera((left ? -1 : 1) * Math.PI / 12);
});
$('sound').addEventListener('click', toggleSound);
if (island.fire !== null) { step = 3; showIsland(false); }
const letter = $('intro-letter');
const letterKey = 'gachinolja-intro-seen';
$('read-letter').addEventListener('click', () => letter.showModal());
letter.addEventListener('close', () => {
  try { localStorage.setItem(letterKey, '1'); } catch { /* The letter remains available on the home screen. */ }
});
let letterSeen;
try { letterSeen = localStorage.getItem(letterKey); } catch { /* The letter can still be read. */ }
if (!letterSeen) letter.showModal();
window.afterIslandLetter = (ready) => {
  if (letter.open) letter.addEventListener('close', ready, { once: true });
  else ready();
};
requestAnimationFrame(render);
