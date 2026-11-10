const $ = (s) => document.querySelector(s);
const API_BASE = String(window.CLUB_SORTIS_API_URL || window.location.origin).replace(/\/$/, '');
const TAU = Math.PI * 2;
const TURNS = 8;
const WHEEL_R = 460;
const BULBS = 24;
const DEFAULT_DRAW_AT = '2026-11-10T20:00:00-04:00';
const COLORS = [
  ['#d4af37', '#1a1400'],
  ['#141414', '#f6e27a'],
  ['#7a0c12', '#f6e27a'],
  ['#0b4d33', '#f6e27a'],
  ['#f6e27a', '#1a1400'],
  ['#3a3a3a', '#ffffff'],
  ['#b3121d', '#ffffff'],
  ['#12805a', '#ffffff'],
  ['#8a6a14', '#ffffff'],
  ['#1b2a5c', '#f6e27a'],
  ['#4a1259', '#f6e27a'],
];

const canvas = $('#wheel');
const ctx = canvas.getContext('2d');
let state = { participants: [], slots: [], history: [], prize: '', rest: 0, attempts: 1, attempt: 0, spin: null, finished: false, drawAt: DEFAULT_DRAW_AT };
let held = null;
let highlight = null;
let anim = null;
let rotation = 0;
let cache = null;
let lastPointed = -1;
let lastTick = 0;
let idlePhase = 0;
let overlayTimer = null;
let audio = null;
let token = sessionStorage.getItem('token');
let serverOffset = 0;
let connected = false;

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

const colorOf = (name) => {
  const i = state.participants.findIndex((p) => p.name === name);
  return COLORS[Math.max(0, i) % COLORS.length];
};

function beep(freq, dur, type = 'square', vol = 0.04, when = 0) {
  if (!audio) return;
  const t = audio.currentTime + when;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + dur);
}

function tick(now) {
  if (now - lastTick < 55) return;
  lastTick = now;
  const pointer = $('#pointer');
  pointer.classList.remove('tick');
  void pointer.offsetWidth;
  pointer.classList.add('tick');
  beep(1100, 0.03);
}

function buildWheel(slots) {
  const img = document.createElement('canvas');
  img.width = img.height = WHEEL_R * 2;
  const g = img.getContext('2d');
  const colors = new Map(state.participants.map((p, i) => [p.name, COLORS[i % COLORS.length]]));
  const w = TAU / slots.length;
  g.translate(WHEEL_R, WHEEL_R);
  slots.forEach((name, i) => {
    const [fill, text] = colors.get(name) || COLORS[0];
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, WHEEL_R - 1, i * w, (i + 1) * w);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    g.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    g.lineWidth = 1;
    g.stroke();
    if (w > 0.04) {
      g.save();
      g.rotate((i + 0.5) * w);
      g.fillStyle = text;
      g.textAlign = 'right';
      g.textBaseline = 'middle';
      g.font = `bold ${Math.max(13, Math.min(30, w * WHEEL_R * 0.4))}px system-ui, sans-serif`;
      g.fillText(name, WHEEL_R - 16, 0, WHEEL_R * 0.66);
      g.restore();
    }
  });
  const shade = g.createRadialGradient(0, 0, WHEEL_R * 0.2, 0, 0, WHEEL_R);
  shade.addColorStop(0, 'rgba(0, 0, 0, 0.35)');
  shade.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
  shade.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
  g.fillStyle = shade;
  g.beginPath();
  g.arc(0, 0, WHEEL_R, 0, TAU);
  g.fill();
  return img;
}

function wheelImage(slots) {
  if (!cache || cache.slots !== slots || cache.parts !== state.participants) cache = { slots, parts: state.participants, img: buildWheel(slots) };
  return cache.img;
}

function draw(now = performance.now()) {
  const slots = held || state.slots || [];
  const total = slots.length;
  const c = canvas.width / 2;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(c, c);

  const rim = ctx.createRadialGradient(0, 0, WHEEL_R, 0, 0, c);
  rim.addColorStop(0, '#6b5010');
  rim.addColorStop(0.45, '#f6e27a');
  rim.addColorStop(1, '#8a6a14');
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.arc(0, 0, c - 2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath();
  ctx.arc(0, 0, WHEEL_R + 2, 0, TAU);
  ctx.fill();

  const phase = anim ? Math.floor(now / 110) : idlePhase;
  for (let i = 0; i < BULBS; i++) {
    const lit = (i + phase) % 2 === 0;
    const a = (i / BULBS) * TAU;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * (c - 20), Math.sin(a) * (c - 20), 8, 0, TAU);
    ctx.fillStyle = lit ? '#fffbe0' : '#5c4510';
    ctx.shadowColor = '#fff3b0';
    ctx.shadowBlur = lit ? 16 : 0;
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  let pointed = -1;
  if (total) {
    const w = TAU / total;
    pointed = Math.floor((((-rotation % TAU) + TAU) % TAU) / w) % total;
    ctx.rotate(rotation - Math.PI / 2);
    ctx.drawImage(wheelImage(slots), -WHEEL_R, -WHEEL_R);
    if (highlight !== null && !anim) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, WHEEL_R - 1, highlight * w, (highlight + 1) * w);
      ctx.closePath();
      ctx.fillStyle = `rgba(255, 255, 255, ${0.25 + 0.2 * Math.sin(now / 200)})`;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 4;
      ctx.stroke();
    }
  }
  ctx.restore();

  if (!total) {
    ctx.fillStyle = '#a39878';
    ctx.textAlign = 'center';
    ctx.font = '34px Georgia, serif';
    ctx.fillText(state.history.length ? 'Sin cupos disponibles' : 'Esperando participantes...', c, c * 0.55);
  }

  $('#current').textContent = (anim || held) && pointed >= 0 ? slots[pointed] : '';
  if (anim && pointed !== lastPointed) tick(now);
  lastPointed = pointed;
}

function frame(now) {
  if (!anim) return;
  const t = Math.min(1, Math.max(0, (now - anim.t0) / anim.duration));
  rotation = anim.start + (anim.end - anim.start) * (1 - Math.pow(1 - t, 4));
  draw(now);
  if (t < 1) return requestAnimationFrame(frame);
  anim = null;
  render();
}

function startSpin(s) {
  held = s.wheel;
  highlight = null;
  hideOverlay(false);
  anim = {
    id: s.id,
    t0: performance.now() - s.elapsed,
    duration: s.duration,
    start: TAU * (1 - s.from),
    end: TAU * ((s.turns || TURNS) + 1 - s.fraction),
  };
  requestAnimationFrame(frame);
}

function countUp(node, value) {
  const from = Number(node.textContent) || 0;
  if (from === value) return;
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / 500);
    node.textContent = Math.round(from + (value - from) * t);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderRound(total) {
  const round = $('#round');
  const isFinal = state.attempts > 1 && state.attempt + 1 >= state.attempts;
  round.classList.toggle('final', isFinal && total > 0);
  if (state.attempts === 1) round.textContent = 'Modo: a la primera, cada giro tiene ganador';
  else if (isFinal) round.textContent = `Intento ${state.attempt + 1} de ${state.attempts}: este giro define al ganador`;
  else round.textContent = `Intento ${state.attempt + 1} de ${state.attempts}: el premio sale en el intento ${state.attempts}`;
}

function renderHistory() {
  const history = $('#history');
  history.replaceChildren();
  if (!state.history.length) history.append(el('li', 'empty', 'Aún no hay resultados'));
  [...state.history].reverse().forEach((h) => {
    const li = el('li', h.win ? 'win' : 'miss');
    const name = el('span');
    name.append(el('span', 'num', h.win ? '♛' : `#${h.n}`), h.name + (h.win && h.prize ? ` — ${h.prize}` : ''));
    const meta = h.win ? (h.attempts > 1 ? `ganador · intento ${h.attempt}/${h.attempts}` : 'ganador') : `intento ${h.attempt}/${h.attempts} · no gana`;
    li.append(name, el('span', 'meta', meta));
    history.append(li);
  });
}

function renderParticipants(total) {
  const list = $('#participants');
  const query = $('#search').value.trim().toUpperCase();
  const max = Math.max(1, ...state.participants.map((p) => p.cupos));
  const casillas = new Map();
  (state.slots || []).forEach((name) => casillas.set(name, (casillas.get(name) || 0) + 1));
  list.classList.toggle('editable', Boolean(token));
  list.replaceChildren();
  const shown = [...state.participants].sort((a, b) => b.cupos - a.cupos).filter((p) => p.name.includes(query));
  if (!shown.length) list.append(el('li', 'empty', state.participants.length ? 'Sin coincidencias' : 'Aún no hay participantes'));
  shown.forEach((p) => {
    const li = el('li', p.cupos ? '' : 'out');
    const own = casillas.get(p.name) || 0;
    const pct = total ? ((own / total) * 100).toFixed(2) : '0.00';
    const name = el('span');
    const dot = el('span', 'dot');
    dot.style.background = colorOf(p.name)[0];
    name.append(dot, p.name);
    const bar = el('span', 'bar');
    bar.style.width = `${(p.cupos / max) * 100}%`;
    li.append(name, el('span', 'meta', `${p.cupos} cupos · ${pct}%`), bar);
    li.addEventListener('click', () => {
      if (!token) return;
      $('#partName').value = p.name;
      $('#partCupos').value = p.cupos;
      $('#partCupos').focus();
    });
    list.append(li);
  });
}

function renderOrder() {
  const order = $('#order');
  const nums = state.nums || [];
  order.replaceChildren();
  if (!(state.slots || []).length) order.append(el('li', 'empty', 'Aún no hay casillas'));
  (state.slots || []).forEach((name, i) => {
    const li = el('li');
    const label = el('span');
    const dot = el('span', 'dot');
    dot.style.background = colorOf(name)[0];
    label.append(dot, `${nums[i]}. ${name}`);
    li.append(label);
    order.append(li);
  });
}

function renderFinalWinners() {
  const list = $('#finalWinners');
  const winners = state.history.filter((entry) => entry.win);
  list.replaceChildren();
  if (!winners.length) {
    list.append(el('p', 'final-empty', 'Aún no hay ganadores registrados.'));
    return;
  }
  winners.forEach((winner, index) => {
    const card = el('article', 'final-winner');
    card.append(
      el('span', 'final-place', `GANADOR ${index + 1}`),
      el('strong', 'final-name', winner.name),
      el('span', 'final-prize', winner.prize || 'Premio no especificado'),
    );
    list.append(card);
  });
}

function updatePresentation() {
  const drawAt = Date.parse(state.drawAt || DEFAULT_DRAW_AT);
  const now = Date.now() + serverOffset;
  const publicWaiting = now < drawAt && !token && !state.finished;
  const publicFinished = Boolean(state.finished) && !token;
  $('#countdownView').hidden = !publicWaiting;
  $('#finalView').hidden = !publicFinished;
  $('#liveView').hidden = publicWaiting || publicFinished;

  if (publicWaiting) {
    const totalSeconds = Math.floor(Math.max(0, drawAt - now) / 1000);
    $('#countDays').textContent = String(Math.floor(totalSeconds / 86400)).padStart(2, '0');
    $('#countHours').textContent = String(Math.floor((totalSeconds % 86400) / 3600)).padStart(2, '0');
    $('#countMinutes').textContent = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
    $('#countSeconds').textContent = String(totalSeconds % 60).padStart(2, '0');
    const formatted = new Intl.DateTimeFormat('es-BO', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/La_Paz' }).format(new Date(drawAt));
    $('#eventDate').textContent = `${formatted} · hora de Bolivia`;
  }

  if (publicFinished) renderFinalWinners();
  if (connected) {
    const status = $('#status');
    status.textContent = publicWaiting ? 'PRÓXIMAMENTE' : publicFinished ? 'FINALIZADO' : 'EN VIVO';
    status.className = `badge ${publicWaiting || publicFinished ? 'off' : 'on'}`;
  }
}

function render() {
  const active = state.participants.filter((p) => p.cupos > 0);
  const total = (state.slots || []).length;
  const spinning = Boolean(state.spin || anim);

  $('#prize').textContent = state.prize ? `Premio: ${state.prize}` : '';
  $('#viewers').textContent = state.viewers ? `${state.viewers} viendo ahora` : '';
  countUp($('#statPeople'), active.length);
  countUp($('#statCupos'), active.reduce((sum, p) => sum + p.cupos, 0));
  countUp($('#statSpins'), state.history.length);
  countUp($('#statWinners'), state.history.filter((h) => h.win).length);
  renderRound(total);
  renderHistory();
  renderParticipants(total);
  renderOrder();
  renderFinalWinners();
  updatePresentation();

  $('#shuffleBtn').disabled = spinning || total < 2;
  $('#spinBtn').disabled = spinning || !total || state.finished;
  $('#testModeNote').hidden = Date.now() + serverOffset >= Date.parse(state.drawAt || DEFAULT_DRAW_AT);
  $('#finishBtn').disabled = spinning || state.finished || !state.history.some((entry) => entry.win);
  $('#finishBtn').textContent = state.finished ? 'Sorteo finalizado' : 'Finalizar sorteo';
  $('#spinBtn').textContent = spinning ? 'GIRANDO...' : state.attempts > 1 ? `GIRAR · INTENTO ${state.attempt + 1}/${state.attempts}` : 'GIRAR RULETA';
  if (document.activeElement !== $('#attemptsSel')) $('#attemptsSel').value = state.attempts;
  if (document.activeElement !== $('#prizeInput')) $('#prizeInput').value = state.prize || '';
  $('#attemptsSel').disabled = spinning;
  $('#admin').hidden = !token;
  $('#adminLink').hidden = Boolean(token);
  if (!anim) {
    if (!held) rotation = TAU * (1 - state.rest);
    draw();
  }
}

function confetti() {
  const cv = $('#confetti');
  const g = cv.getContext('2d');
  cv.width = innerWidth;
  cv.height = innerHeight;
  cv.hidden = false;
  const colors = ['#f6e27a', '#d4af37', '#ffffff', '#b3121d'];
  const parts = Array.from({ length: 200 }, () => ({
    x: Math.random() * cv.width,
    y: -20 - Math.random() * cv.height * 0.6,
    vx: (Math.random() - 0.5) * 3,
    vy: 2 + Math.random() * 4,
    size: 5 + Math.random() * 8,
    rot: Math.random() * TAU,
    vr: (Math.random() - 0.5) * 0.3,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  const step = (now) => {
    g.clearRect(0, 0, cv.width, cv.height);
    parts.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.fillStyle = p.color;
      g.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      g.restore();
    });
    if (now - t0 < 5500) requestAnimationFrame(step);
    else cv.hidden = true;
  };
  requestAnimationFrame(step);
}

function showOverlay(entry) {
  const where = `Cupo n.º ${entry.num} · giro #${entry.n}`;
  $('#card').classList.toggle('miss', !entry.win);
  $('#cardIcon').textContent = entry.win ? '♛' : '✕';
  $('#winnerName').textContent = entry.name;
  if (entry.win) {
    $('#cardLabel').textContent = 'GANADOR';
    $('#winnerInfo').textContent = `${entry.prize ? entry.prize + ' · ' : ''}${where}`;
    confetti();
    [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.35, 'triangle', 0.08, i * 0.14));
  } else {
    $('#cardLabel').textContent = `INTENTO ${entry.attempt} DE ${entry.attempts}`;
    $('#winnerInfo').textContent = `No gana todavía: el premio sale en el intento ${entry.attempts} · ${where}`;
    beep(220, 0.4, 'sawtooth', 0.05);
  }
  $('#overlay').hidden = false;
  clearTimeout(overlayTimer);
  overlayTimer = setTimeout(hideOverlay, entry.win ? 10000 : 6000);
}

function hideOverlay(release = true) {
  clearTimeout(overlayTimer);
  $('#overlay').hidden = true;
  if (release && !anim && !state.spin) {
    held = null;
    highlight = null;
    render();
  }
}

function connect() {
  const es = new EventSource(`${API_BASE}/events`);
  const status = $('#status');
  es.onopen = () => {
    connected = true;
    updatePresentation();
  };
  es.onerror = () => {
    connected = false;
    status.textContent = 'RECONECTANDO';
    status.className = 'badge off';
  };
  es.addEventListener('state', (e) => {
    state = JSON.parse(e.data);
    if (state.serverNow) serverOffset = Date.parse(state.serverNow) - Date.now();
    if (state.spin && (!anim || anim.id !== state.spin.id)) startSpin(state.spin);
    render();
  });
  es.addEventListener('viewers', (e) => {
    state.viewers = JSON.parse(e.data);
    $('#viewers').textContent = `${state.viewers} viendo ahora`;
  });
  es.addEventListener('result', (e) => {
    const entry = JSON.parse(e.data);
    if (anim) {
      rotation = anim.end;
      anim = null;
    }
    if (held) highlight = entry.ticket - 1;
    draw();
    showOverlay(entry);
  });
}

async function api(path, body = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') logout();
  if (!res.ok) throw new Error(data.error || 'Error');
  return data;
}

function logout() {
  token = null;
  sessionStorage.removeItem('token');
  render();
}

async function adminAction(path, body) {
  $('#adminMsg').textContent = '';
  try {
    return await api(path, body);
  } catch (err) {
    $('#adminMsg').textContent = err.message;
    await showActionModal({ title: 'Atención', message: err.message, confirmText: 'Entendido' });
    return null;
  }
}

let actionResolve = null;

function showActionModal({ title, message, confirmText = 'Aceptar', cancelText = '', danger = false }) {
  const dialog = $('#actionDialog');
  $('#actionTitle').textContent = title;
  $('#actionMessage').textContent = message;
  $('#actionConfirm').textContent = confirmText;
  $('#actionConfirm').className = danger ? 'danger' : 'gold';
  $('#actionCancel').textContent = cancelText || 'Cancelar';
  $('#actionCancel').hidden = !cancelText;
  dialog.showModal();
  return new Promise((resolve) => { actionResolve = resolve; });
}

function closeActionModal(result) {
  $('#actionDialog').close();
  const resolve = actionResolve;
  actionResolve = null;
  if (resolve) resolve(result);
}

function previewList() {
  const names = $('#listText').value.split('\n').map((l) => l.replace(/^\s*\d+\s*[.)\-:]*\s*/, '').trim().replace(/\s+/g, ' ').toUpperCase()).filter(Boolean);
  $('#listPreview').textContent = names.length ? `Se detectan ${new Set(names).size} participantes y ${names.length} cupos.` : '';
}

$('#overlay').addEventListener('click', () => hideOverlay());
$('#adminLink').addEventListener('click', () => $('#loginDialog').showModal());
$('#loginCancel').addEventListener('click', () => $('#loginDialog').close());
$('#logoutBtn').addEventListener('click', logout);
$('#actionCancel').addEventListener('click', () => closeActionModal(false));
$('#actionConfirm').addEventListener('click', () => closeActionModal(true));
$('#actionDialog').addEventListener('cancel', (e) => {
  e.preventDefault();
  closeActionModal(false);
});
$('#spinBtn').addEventListener('click', async () => {
  const prize = $('#prizeInput').value.trim();
  if (!prize) {
    await showActionModal({ title: 'Premio obligatorio', message: 'Ingresa el nombre del premio antes de girar la ruleta.', confirmText: 'Ingresar premio' });
    $('#prizeInput').focus();
    return;
  }
  if (prize !== state.prize && !(await adminAction('/api/prize', { prize }))) return;
  await adminAction('/api/spin');
});
$('#shuffleBtn').addEventListener('click', () => adminAction('/api/shuffle'));
$('#search').addEventListener('input', () => renderParticipants((state.slots || []).length));
$('#listText').addEventListener('input', previewList);

$('#soundBtn').addEventListener('click', (e) => {
  if (audio) {
    audio.close();
    audio = null;
  } else {
    audio = new (window.AudioContext || window.webkitAudioContext)();
    beep(880, 0.08);
  }
  e.currentTarget.textContent = audio ? 'Sonido: sí' : 'Sonido: no';
  e.currentTarget.setAttribute('aria-pressed', String(Boolean(audio)));
});

$('#attemptsSel').addEventListener('change', async (e) => {
  await adminAction('/api/attempts', { attempts: Number(e.target.value) });
  e.target.blur();
  render();
});

$('#resetBtn').addEventListener('click', async () => {
  const accepted = await showActionModal({ title: 'Reiniciar sorteo', message: 'Se restaurará la lista cargada y se borrará todo el historial de resultados.', confirmText: 'Reiniciar', cancelText: 'Cancelar', danger: true });
  if (accepted) await adminAction('/api/reset');
});

$('#clearBtn').addEventListener('click', async () => {
  const accepted = await showActionModal({ title: 'Nuevo sorteo', message: 'Se borrarán todos los participantes, cupos, resultados y el premio actual. Esta acción no se puede deshacer.', confirmText: 'Borrar todo', cancelText: 'Cancelar', danger: true });
  if (!accepted) return;
  if (await adminAction('/api/clear')) {
    $('#listForm').reset();
    $('#partForm').reset();
    $('#prizeInput').value = '';
    previewList();
    $('#adminMsg').textContent = 'Sorteo limpiado. Ya puedes cargar una nueva lista.';
  }
});

$('#finishBtn').addEventListener('click', async () => {
  const winners = state.history.filter((entry) => entry.win).length;
  const accepted = await showActionModal({ title: 'Finalizar sorteo', message: `Se mostrarán públicamente ${winners} ganador${winners === 1 ? '' : 'es'} junto con sus premios.`, confirmText: 'Finalizar', cancelText: 'Cancelar' });
  if (!accepted) return;
  await adminAction('/api/finish');
});

$('#listForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (state.participants.length) {
    const accepted = await showActionModal({ title: 'Reemplazar participantes', message: 'La nueva lista reemplazará a todos los participantes actuales y borrará el historial de resultados.', confirmText: 'Cargar lista', cancelText: 'Cancelar' });
    if (!accepted) return;
  }
  const result = await adminAction('/api/list', { text: $('#listText').value });
  if (!result) return;
  e.target.reset();
  previewList();
  $('#adminMsg').textContent = '';
  await showActionModal({ title: 'Lista cargada', message: `${result.participants} participantes y ${result.cupos} cupos están listos para el sorteo.`, confirmText: 'Aceptar' });
});

$('#prizeForm').addEventListener('submit', (e) => {
  e.preventDefault();
  adminAction('/api/prize', { prize: $('#prizeInput').value });
});

$('#partForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (await adminAction('/api/participant', { name: $('#partName').value, cupos: Number($('#partCupos').value) })) e.target.reset();
});

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginMsg').textContent = '';
  try {
    token = (await api('/api/login', { password: $('#password').value })).token;
    sessionStorage.setItem('token', token);
    $('#password').value = '';
    $('#loginDialog').close();
    render();
  } catch (err) {
    token = null;
    $('#loginMsg').textContent = err.message;
  }
});

setInterval(() => {
  if (anim) return;
  idlePhase += 1;
  draw();
}, 600);

if (token) api('/api/check').catch(() => {});
render();
connect();
setInterval(updatePresentation, 1000);
