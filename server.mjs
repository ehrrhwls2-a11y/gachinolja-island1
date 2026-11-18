import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { accountHandler, islandVisitorHandler } from './account.mjs';

const model = globalThis.IslandModel;

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '0.0.0.0';
const rooms = new Map();
const lanAddresses = Object.values(networkInterfaces()).flat().filter((address) => address.family === 'IPv4' && !address.internal);
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/game.js', ['game.js', 'text/javascript; charset=utf-8']],
  ['/sharing.js', ['sharing.js', 'text/javascript; charset=utf-8']],
  ['/multiplayer.js', ['multiplayer.js', 'text/javascript; charset=utf-8']],
  ['/account.js', ['account.js', 'text/javascript; charset=utf-8']],
  ['/island-model.js', ['island-model.js', 'text/javascript; charset=utf-8']],
  ['/island-life.js', ['island-life.js', 'text/javascript; charset=utf-8']],
]);

const key = (bytes = 16) => randomBytes(bytes).toString('hex');
const name = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 24) : fallback;
const active = (player, now = Date.now()) => player.stream || now - player.lastSeen < 15_000;

function respond(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

function snapshot(room) {
  return {
    island: room.island,
    visitCode: room.visitCode,
    players: [...room.players.values()].filter((player) => active(player)).map((player) => player.state),
  };
}

function broadcast(room) {
  const packet = `data: ${JSON.stringify(snapshot(room))}\n\n`;
  for (const player of room.players.values()) {
    if (player.stream && !player.stream.write(packet)) player.stream.destroy();
  }
}

function newPlayer(room, body, owner = false) {
  const token = key();
  const seat = [...room.players.values()].filter((player) => active(player)).length;
  const state = {
    id: key(8), name: name(body.name, '섬 친구'),
    character: model.index(body.character, model.characters.length), color: model.index(body.color, model.colors.length),
    x: 0.11 + (seat % 4) * 0.14, y: 0.43 + Math.floor(seat / 4) * 0.10, wave: 0,
  };
  room.players.set(token, { state, owner, stream: null, lastSeen: Date.now(), lastMove: 0 });
  broadcast(room);
  return { room: room.id, token, id: state.id, ...snapshot(room) };
}

async function jsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2048) throw new Error('body too large');
    chunks.push(chunk);
  }
  const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('invalid body');
  return result;
}

const accounts = accountHandler(respond, jsonBody);
const visitIsland = islandVisitorHandler(respond, jsonBody);
const certPath = process.env.ISLAND_TLS_CERT;
const keyPath = process.env.ISLAND_TLS_KEY;
if (!!certPath !== !!keyPath) throw new Error('Set both ISLAND_TLS_CERT and ISLAND_TLS_KEY for HTTPS.');
const tls = certPath ? { cert: await readFile(certPath), key: await readFile(keyPath) } : null;
const protocol = tls ? 'https' : 'http';
const server = tls ? createSecureServer(tls, handle) : createServer(handle);

async function handle(request, response) {
  let url;
  try { url = new URL(request.url, 'http://localhost'); }
  catch { return respond(response, 400, { error: 'path' }); }
  if (url.pathname === '/api/account' || url.pathname.startsWith('/api/account/')) {
    return accounts(request, response, url.pathname);
  }
  const visit = /^\/api\/islands\/([a-f0-9]{30})(\/guestbook)?$/.exec(url.pathname);
  if (visit) return visitIsland(request, response, visit[1], !!visit[2]);
  if (request.method === 'GET' && assets.has(url.pathname)) {
    const [file, type] = assets.get(url.pathname);
    try {
      const body = await readFile(new URL(`./dist/${file}`, import.meta.url));
      response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      response.end(body);
    } catch { respond(response, 500, { error: 'asset' }); }
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/status') {
    const lanOrigin = host === '0.0.0.0' && lanAddresses.length ? `${protocol}://${lanAddresses[0].address}:${port}` : null;
    return respond(response, 200, { multiplayer: true, lanOrigin, kakaoJsKey: process.env.ISLAND_KAKAO_JS_KEY || null });
  }
  const match = /^\/api\/rooms(?:\/([0-9a-f]{20})\/(join|events|move|leave))?$/.exec(url.pathname);
  if (!match) return respond(response, 404, { error: 'missing' });
  const [, id, action] = match;
  const room = rooms.get(id);
  if (id && !room) return respond(response, 404, { error: 'room' });

  if (request.method === 'GET' && action === 'events') {
    const player = room.players.get(url.searchParams.get('token'));
    if (!player) return respond(response, 403, { error: 'player' });
    player.stream?.end();
    player.stream = response;
    player.lastSeen = Date.now();
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    });
    response.on('close', () => {
      if (player.stream !== response) return;
      player.stream = null;
      player.lastSeen = Date.now();
      broadcast(room);
    });
    broadcast(room);
    return;
  }

  if (request.method !== 'POST') return respond(response, 405, { error: 'method' });
  if (action === 'events') return respond(response, 405, { error: 'method' });
  if (!request.headers['content-type']?.startsWith('application/json')) return respond(response, 415, { error: 'type' });
  let body;
  try { body = await jsonBody(request); }
  catch { return respond(response, 400, { error: 'body' }); }

  if (!id) {
    if (rooms.size >= 200) return respond(response, 503, { error: 'capacity' });
    const island = model.normalize(body.island);
    const entry = {
      id: key(10), emptySince: null, players: new Map(),
      island: { ...island, name: name(island.name, '나의 섬'), fire: island.fire || model.point(1) },
      visitCode: /^[a-f0-9]{30}$/.test(body.visitCode) ? body.visitCode : null,
    };
    rooms.set(entry.id, entry);
    return respond(response, 201, newPlayer(entry, body, true));
  }
  if (action === 'join') {
    if ([...room.players.values()].filter((player) => active(player)).length >= 8) {
      return respond(response, 409, { error: 'full' });
    }
    room.emptySince = null;
    return respond(response, 201, newPlayer(room, body));
  }

  const token = request.headers.authorization?.replace(/^Bearer /, '');
  const player = room.players.get(token);
  if (!player) return respond(response, 403, { error: 'player' });
  if (action === 'leave') {
    room.players.delete(token);
    const stream = player.stream;
    player.stream = null;
    stream?.end();
    broadcast(room);
    return respond(response, 200, {});
  }
  const now = Date.now();
  if (now - player.lastMove < 35) return respond(response, 429, { error: 'rate' });
  player.lastSeen = player.lastMove = now;
  if (Number.isFinite(body.x) && Number.isFinite(body.y)) {
    player.state.x = Math.min(0.93, Math.max(-0.93, body.x));
    player.state.y = Math.min(0.78, Math.max(-0.66, body.y));
  }
  if (body.wave === true) player.state.wave = now;
  if (player.owner) {
    const amended = body.island && model.normalize(body.island);
    if (amended?.fire) {
      room.island = { ...amended, name: name(amended.name, '나의 섬') };
      Object.assign(player.state, { character: amended.character, color: amended.color });
    }
    else if (model.point(body.fire)) room.island.fire = model.point(body.fire);
  }
  broadcast(room);
  return respond(response, 200, {});
}

setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    let changed = false;
    for (const [token, player] of room.players) {
      if (!active(player, now)) { room.players.delete(token); changed = true; }
      else if (player.stream && !player.stream.write(': ping\n\n')) player.stream.destroy();
    }
    if (changed) broadcast(room);
    if (room.players.size) room.emptySince = null;
    else {
      room.emptySince ??= now;
      if (now - room.emptySince > 15 * 60_000) rooms.delete(id);
    }
  }
}, 5000).unref();

server.listen(port, host, () => {
  console.log(`Local: ${protocol}://localhost:${port}`);
  if (host !== '0.0.0.0') return;
  for (const address of lanAddresses) console.log(`Wi-Fi/LAN: ${protocol}://${address.address}:${port}`);
});
