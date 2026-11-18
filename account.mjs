import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import './dist/island-model.js';

const model = globalThis.IslandModel;

const deriveKey = promisify(scrypt);
const sessionName = 'island_session';
const sessionSeconds = 30 * 24 * 60 * 60;
const attemptWindow = 15 * 60_000;
const attempts = new Map();
const guestbookAttempts = new Map();
const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const publicHost = process.env.ISLAND_PUBLIC_ORIGIN ? new URL(process.env.ISLAND_PUBLIC_ORIGIN).host : null;
const folder = process.env.ISLAND_DATA_DIR || fileURLToPath(new URL('./.island-data/', import.meta.url));
let database;

function db() {
  if (database) return database;
  mkdirSync(folder, { recursive: true });
  const connection = new DatabaseSync(join(folder, 'islands.sqlite'));
  connection.exec(`
    PRAGMA busy_timeout = 3000;
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY,
      login TEXT NOT NULL UNIQUE,
      nickname TEXT NOT NULL,
      salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      island TEXT,
      revision INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS island_links (
      account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      code TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS guestbook (
      id INTEGER PRIMARY KEY,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      visitor TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS guestbook_by_island ON guestbook(account_id, id DESC);
  `);
  database = connection;
  return database;
}

function transport(request) {
  const authority = request.headers.host;
  if (!authority) return { allowed: false };
  const localSocket = loopback.has(request.socket.remoteAddress);
  const secure = !!request.socket.encrypted || !!(publicHost && localSocket && authority === publicHost &&
    request.headers['x-forwarded-proto'] === 'https');
  const origin = `${secure ? 'https' : 'http'}://${authority}`;
  const allowed = secure || (localSocket && allowedHosts.has(new URL(origin).hostname));
  return { allowed, secure, origin };
}

function sessionCookie(token, secure, maxAge = sessionSeconds) {
  return `${sessionName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function sessionHash(request) {
  const token = request.headers.cookie?.match(/(?:^|;\s*)island_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  return token && createHash('sha256').update(token).digest('hex');
}

function currentUser(request) {
  const hash = sessionHash(request);
  if (!hash) return null;
  return db().prepare(`
    SELECT accounts.* FROM sessions JOIN accounts ON sessions.account_id = accounts.id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(hash, Date.now()) || null;
}

function accountView(user) {
  let visitCode = null;
  if (user) {
    const connection = db();
    let link = connection.prepare('SELECT code FROM island_links WHERE account_id = ?').get(user.id);
    if (!link) {
      connection.prepare('INSERT OR IGNORE INTO island_links VALUES (?, ?)').run(user.id, randomBytes(15).toString('hex'));
      link = connection.prepare('SELECT code FROM island_links WHERE account_id = ?').get(user.id);
    }
    visitCode = link.code;
  }
  return {
    enabled: true,
    user: user ? { name: user.nickname } : null,
    island: user?.island ? model.normalize(JSON.parse(user.island)) : null,
    revision: user?.revision ?? 0,
    visitCode,
  };
}

function startSession(request, response, user, secure) {
  const previous = sessionHash(request);
  const token = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  const connection = db();
  const now = Date.now();
  if (previous) connection.prepare('DELETE FROM sessions WHERE token_hash = ?').run(previous);
  connection.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  connection.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(hash, user.id, now + sessionSeconds * 1000);
  response.setHeader('Set-Cookie', sessionCookie(token, secure));
}

function validIsland(value) {
  if (!value || typeof value !== 'object') return null;
  const data = model.normalize(value);
  return data.fire ? data : null;
}

function limited(address) {
  const now = Date.now();
  for (const [key, entry] of attempts) if (now >= entry.until) attempts.delete(key);
  const entry = attempts.get(address) || { total: 0, until: now + attemptWindow };
  if (entry.total >= 16 || (!attempts.has(address) && attempts.size >= 10000)) return true;
  entry.total++;
  attempts.set(address, entry);
  return false;
}

export function accountHandler(respond, jsonBody) {
  return async (request, response, path) => {
    try {
      const access = transport(request);
      if (path === '/api/account' && request.method === 'GET') {
        return respond(response, 200, access.allowed ? accountView(currentUser(request)) : { enabled: false });
      }
      if (!access.allowed) return respond(response, 403, { error: 'secure' });
      if (request.headers.origin && request.headers.origin !== access.origin) {
        return respond(response, 403, { error: 'origin' });
      }
      if (path === '/api/account/logout' && request.method === 'POST') {
        const hash = sessionHash(request);
        if (hash) db().prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
        response.setHeader('Set-Cookie', sessionCookie('', access.secure, 0));
        return respond(response, 200, accountView(null));
      }
      if (!request.headers['content-type']?.startsWith('application/json')) return respond(response, 415, { error: 'type' });
      let body;
      try { body = await jsonBody(request); }
      catch { return respond(response, 400, { error: 'body' }); }

      if (path === '/api/account/island' && request.method === 'PUT') {
        const user = currentUser(request);
        if (!user) return respond(response, 401, { error: 'session' });
        const data = validIsland(body.island);
        if (!data || !Number.isSafeInteger(body.revision)) return respond(response, 400, { error: 'island' });
        const result = db().prepare(`
          UPDATE accounts SET island = ?, revision = revision + 1 WHERE id = ? AND revision = ?
        `).run(JSON.stringify(data), user.id, body.revision);
        const updated = db().prepare('SELECT * FROM accounts WHERE id = ?').get(user.id);
        return respond(response, result.changes ? 200 : 409, accountView(updated));
      }

      const signup = path === '/api/account/signup' && request.method === 'POST';
      const login = path === '/api/account/login' && request.method === 'POST';
      if (!signup && !login) return respond(response, 404, { error: 'missing' });
      if (limited(request.socket.remoteAddress)) return respond(response, 429, { error: 'rate' });
      const nickname = typeof body.name === 'string' ? body.name.trim().normalize('NFC') : '';
      const username = nickname.toLowerCase();
      const password = body.password;
      if (!/^[\p{L}\p{N}_-]{3,24}$/u.test(nickname) || typeof password !== 'string' || password.length < 10 || password.length > 128) {
        return respond(response, 400, { error: 'credentials' });
      }
      const connection = db();
      let user = connection.prepare('SELECT * FROM accounts WHERE login = ?').get(username);
      if (signup) {
        const data = validIsland(body.island);
        if (body.island != null && !data) return respond(response, 400, { error: 'island' });
        const salt = randomBytes(16).toString('hex');
        const hash = (await deriveKey(password, salt, 64)).toString('hex');
        const result = connection.prepare(`
          INSERT INTO accounts (login, nickname, salt, password_hash, island, revision)
          VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(login) DO NOTHING
        `).run(username, nickname, salt, hash, data ? JSON.stringify(data) : null, data ? 1 : 0);
        if (!result.changes) return respond(response, 409, { error: 'used' });
        user = connection.prepare('SELECT * FROM accounts WHERE id = ?').get(result.lastInsertRowid);
      } else {
        const key = await deriveKey(password, user?.salt ?? '00000000000000000000000000000000', 64);
        const expected = user ? Buffer.from(user.password_hash, 'hex') : Buffer.alloc(64);
        if (!timingSafeEqual(key, expected) || !user) return respond(response, 401, { error: 'invalid' });
      }
      startSession(request, response, user, access.secure);
      return respond(response, signup ? 201 : 200, accountView(user));
    } catch (error) {
      console.error('Account request failed:', error.code || error.name);
      return respond(response, 500, { error: 'server' });
    }
  };
}

export function islandVisitorHandler(respond, jsonBody) {
  return async (request, response, code, book) => {
    try {
      const connection = db();
      const entry = connection.prepare(`
        SELECT accounts.id, accounts.island FROM island_links JOIN accounts ON accounts.id = island_links.account_id
        WHERE code = ? AND island IS NOT NULL
      `).get(code);
      if (!entry) return respond(response, 404, { error: 'island' });
      const notes = () => connection.prepare(`
        SELECT visitor, message, created_at AS createdAt FROM guestbook WHERE account_id = ?
        ORDER BY id DESC LIMIT 50
      `).all(entry.id);
      if (request.method === 'GET') {
        return respond(response, 200, book ? { notes: notes() } : { island: model.normalize(JSON.parse(entry.island)) });
      }
      if (request.method !== 'POST' || !book) return respond(response, 405, { error: 'method' });
      const origin = transport(request).origin;
      if (request.headers.origin && request.headers.origin !== origin) return respond(response, 403, { error: 'origin' });
      if (!request.headers['content-type']?.startsWith('application/json')) return respond(response, 415, { error: 'type' });
      const now = Date.now();
      const limiter = `${code}/${request.socket.remoteAddress}`;
      for (const [key, until] of guestbookAttempts) if (until <= now) guestbookAttempts.delete(key);
      if (guestbookAttempts.has(limiter) || guestbookAttempts.size >= 10000) return respond(response, 429, { error: 'rate' });
      let body;
      try { body = await jsonBody(request); }
      catch { return respond(response, 400, { error: 'body' }); }
      const visitor = typeof body.name === 'string' ? body.name.trim() : '';
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      if (!visitor || visitor.length > 24 || !message || message.length > 200) return respond(response, 400, { error: 'note' });
      if (guestbookAttempts.has(limiter)) return respond(response, 429, { error: 'rate' });
      guestbookAttempts.set(limiter, now + 3500);
      connection.prepare('INSERT INTO guestbook (account_id, visitor, message, created_at) VALUES (?, ?, ?, ?)')
        .run(entry.id, visitor, message, now);
      return respond(response, 201, { notes: notes() });
    } catch (error) {
      console.error('Island visit failed:', error.code || error.name);
      return respond(response, 500, { error: 'server' });
    }
  };
}
