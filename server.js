const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const SPIN_MS = 10000;
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_CLIENTS = 3000;
const MAX_LOGIN_FAILS = 5;
const LOGIN_WINDOW_MS = 60 * 1000;
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/logo.png': ['logo.png', 'image/png'],
};
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  ADMIN_PASSWORD = crypto.randomBytes(9).toString('base64url');
  console.log(`ADMIN_PASSWORD no definida. Contraseña temporal de admin: ${ADMIN_PASSWORD}`);
}

const copyList = (list) => list.map((p) => ({ ...p }));
const freshState = (base = []) => ({ participants: copyList(base), base, history: [], prize: '', rest: 0 });
const cleanName = (s) => String(s || '').replace(/^\s*\d+\s*[.)\-:]*\s*/, '').trim().replace(/\s+/g, ' ').toUpperCase();

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (Array.isArray(s.participants) && Array.isArray(s.history) && Array.isArray(s.base)) return s;
  } catch {}
  return freshState();
}

let state = loadState();
let spin = null;
const clients = new Set();
const tokens = new Map();
const loginFails = new Map();

function saveState() {
  fs.mkdir(DATA_DIR, { recursive: true }, () =>
    fs.writeFile(STATE_FILE, JSON.stringify(state), (err) => err && console.error('No se pudo guardar el estado:', err.message)));
}

const publicState = () => ({
  participants: state.participants,
  history: state.history,
  prize: state.prize,
  rest: state.rest,
  viewers: clients.size,
  spin: spin && { id: spin.id, elapsed: Date.now() - spin.startedAt, duration: SPIN_MS, from: spin.from, fraction: spin.fraction, wheel: spin.wheel },
});

const emit = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
const broadcast = (event, data) => clients.forEach((res) => emit(res, event, data));
const broadcastState = () => clients.forEach((res) => emit(res, 'state', publicState()));

function json(res, code, body) {
  res.writeHead(code, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 500000) {
        reject(new Error('Cuerpo demasiado grande'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

function isAdmin(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const expires = tokens.get(token);
  if (!expires) return false;
  if (expires < Date.now()) {
    tokens.delete(token);
    return false;
  }
  return true;
}

function login(req, res, body) {
  const ip = clientIp(req);
  const now = Date.now();
  const fails = (loginFails.get(ip) || []).filter((t) => now - t < LOGIN_WINDOW_MS);
  if (fails.length >= MAX_LOGIN_FAILS) return json(res, 429, { error: 'Demasiados intentos. Espera 60 segundos.' });
  if (!crypto.timingSafeEqual(sha(body.password), sha(ADMIN_PASSWORD))) {
    fails.push(now);
    loginFails.set(ip, fails);
    return json(res, 401, { error: 'Contraseña incorrecta' });
  }
  loginFails.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  tokens.set(token, now + TOKEN_TTL_MS);
  json(res, 200, { token });
}

function startSpin(res) {
  if (spin) return json(res, 409, { error: 'La ruleta ya está girando' });
  const wheel = state.participants.filter((p) => p.cupos > 0).map((p) => ({ ...p }));
  const total = wheel.reduce((sum, p) => sum + p.cupos, 0);
  if (!total) return json(res, 400, { error: 'No quedan cupos para sortear' });
  const ticket = crypto.randomInt(total);
  let acc = 0;
  const winner = wheel.find((p) => (acc += p.cupos) > ticket);
  const fraction = (ticket + 0.1 + 0.8 * (crypto.randomInt(1000) / 1000)) / total;
  spin = { id: crypto.randomUUID(), startedAt: Date.now(), from: state.rest, fraction, wheel };
  broadcastState();
  setTimeout(() => {
    const entry = { n: state.history.length + 1, name: winner.name, ticket: ticket + 1, total, prize: state.prize, at: new Date().toISOString() };
    const p = state.participants.find((x) => x.name === winner.name);
    if (p) p.cupos = Math.max(0, p.cupos - 1);
    state.history.push(entry);
    state.rest = fraction;
    spin = null;
    saveState();
    broadcast('result', entry);
    broadcastState();
  }, SPIN_MS + 700);
  json(res, 200, { ok: true });
}

function loadList(res, body) {
  const counts = new Map();
  for (const line of String(body.text || '').split(/\r?\n/)) {
    const name = cleanName(line);
    if (!name) continue;
    if (name.length > 60) return json(res, 400, { error: `Nombre demasiado largo: ${name.slice(0, 30)}...` });
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  if (!counts.size) return json(res, 400, { error: 'La lista está vacía' });
  if (counts.size > 500) return json(res, 400, { error: 'Demasiados participantes (máximo 500)' });
  state = freshState([...counts].map(([name, cupos]) => ({ name, cupos })));
  saveState();
  broadcastState();
  json(res, 200, { ok: true, participants: counts.size, cupos: state.base.reduce((sum, p) => sum + p.cupos, 0) });
}

function setParticipant(res, body) {
  const name = cleanName(body.name);
  const cupos = Number(body.cupos);
  if (!name || name.length > 60) return json(res, 400, { error: 'Nombre inválido' });
  if (!Number.isInteger(cupos) || cupos < 0 || cupos > 10000) return json(res, 400, { error: 'Cupos inválidos' });
  if (!state.participants.some((p) => p.name === name) && state.participants.length >= 500) return json(res, 400, { error: 'Demasiados participantes' });
  for (const list of [state.participants, state.base]) {
    const existing = list.find((p) => p.name === name);
    if (existing) existing.cupos = cupos;
    else if (cupos > 0) list.push({ name, cupos });
  }
  state.base = state.base.filter((p) => p.cupos > 0);
  state.participants = state.participants.filter((p) => p.cupos > 0 || state.history.some((h) => h.name === p.name));
  saveState();
  broadcastState();
  json(res, 200, { ok: true });
}

async function handleApi(req, res, url) {
  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    return json(res, 400, { error: err.message });
  }
  if (url === '/api/login') return login(req, res, body);
  if (!isAdmin(req)) return json(res, 401, { error: 'No autorizado' });
  if (url === '/api/check') return json(res, 200, { ok: true });
  if (url === '/api/spin') return startSpin(res);
  if (spin) return json(res, 409, { error: 'Espera a que termine el giro' });
  if (url === '/api/list') return loadList(res, body);
  if (url === '/api/participant') return setParticipant(res, body);
  if (url === '/api/prize') {
    state.prize = String(body.prize || '').trim().slice(0, 80);
  } else if (url === '/api/reset') {
    state = freshState(state.base);
  } else {
    return json(res, 404, { error: 'No encontrado' });
  }
  saveState();
  broadcastState();
  json(res, 200, { ok: true });
}

function handleEvents(req, res) {
  if (clients.size >= MAX_CLIENTS) return json(res, 503, { error: 'Servidor lleno' });
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  clients.add(res);
  emit(res, 'state', publicState());
  broadcast('viewers', clients.size);
  req.on('close', () => {
    clients.delete(res);
    broadcast('viewers', clients.size);
  });
}

http
  .createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (req.method === 'POST' && url.startsWith('/api/')) return handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Método no permitido' });
    if (url === '/events') return handleEvents(req, res);
    if (url === '/healthz') return json(res, 200, { ok: true });
    const file = STATIC[url];
    if (!file) return json(res, 404, { error: 'No encontrado' });
    fs.readFile(path.join(PUBLIC_DIR, file[0]), (err, data) => {
      if (err) return json(res, 500, { error: 'Error interno' });
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': file[1], 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  })
  .listen(PORT, () => console.log(`Club Sortis en http://localhost:${PORT}`));

setInterval(() => clients.forEach((res) => res.write(': ping\n\n')), 25000);
