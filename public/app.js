const $ = (s) => document.querySelector(s);
const TAU = Math.PI * 2;
const TURNS = 8;
const COLORS = [
  ['#d4af37', '#1a1400'],
  ['#141414', '#f6e27a'],
  ['#7a0c12', '#f6e27a'],
  ['#0b4d33', '#f6e27a'],
];

const canvas = $('#wheel');
const ctx = canvas.getContext('2d');
let state = { participants: [], history: [], prize: '', rest: 0, spin: null };
let held = null;
let anim = null;
let rotation = 0;
let overlayTimer = null;
let token = sessionStorage.getItem('token');

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function draw() {
  const all = held || state.participants;
  const total = all.reduce((sum, p) => sum + p.cupos, 0);
  const c = canvas.width / 2;
  const R = c - 4;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(c, c);
  ctx.rotate(rotation - Math.PI / 2);
  let a = 0;
  all.forEach((p, i) => {
    if (!p.cupos) return;
    const w = (p.cupos / total) * TAU;
    const [fill, text] = COLORS[i % COLORS.length];
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, R, a, a + w);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = 'rgba(246, 226, 122, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    if (w > 0.045) {
      ctx.save();
      ctx.rotate(a + w / 2);
      ctx.fillStyle = text;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.max(13, Math.min(30, w * R * 0.4))}px system-ui, sans-serif`;
      ctx.fillText(`${p.name} (${p.cupos})`, R - 16, 0, R * 0.68);
      ctx.restore();
    }
    a += w;
  });
  ctx.restore();
  if (!total) {
    ctx.fillStyle = '#a39878';
    ctx.textAlign = 'center';
    ctx.font = '36px Georgia, serif';
    ctx.fillText(state.history.length ? 'Sin cupos disponibles' : 'Esperando participantes...', c, c * 0.5);
  }
}

function frame(now) {
  if (!anim) return;
  const t = Math.min(1, (now - anim.t0) / anim.duration);
  rotation = anim.start + (anim.end - anim.start) * (1 - Math.pow(1 - t, 4));
  draw();
  if (t < 1) return requestAnimationFrame(frame);
  anim = null;
  render();
}

function startSpin(s) {
  held = s.wheel;
  hideOverlay(false);
  anim = {
    id: s.id,
    t0: performance.now() - s.elapsed,
    duration: s.duration,
    start: TAU * (1 - s.from),
    end: TAU * (TURNS + 1 - s.fraction),
  };
  requestAnimationFrame(frame);
}

function render() {
  const active = state.participants.filter((p) => p.cupos > 0);
  const total = active.reduce((sum, p) => sum + p.cupos, 0);
  const spinning = Boolean(state.spin || anim);

  $('#prize').textContent = state.prize ? `Premio: ${state.prize}` : '';
  $('#summary').textContent = `${active.length} participantes · ${total} cupos en juego`;
  $('#viewers').textContent = state.viewers ? `${state.viewers} viendo ahora` : '';
  $('#spinBtn').disabled = spinning || !total;
  $('#spinBtn').textContent = spinning ? 'GIRANDO...' : 'GIRAR RULETA';

  const history = $('#history');
  history.replaceChildren();
  if (!state.history.length) history.append(el('li', 'empty', 'Aún no hay ganadores'));
  [...state.history].reverse().forEach((h) => {
    const li = el('li');
    const name = el('span');
    name.append(el('span', 'num', `#${h.n}`), h.name + (h.prize ? ` — ${h.prize}` : ''));
    li.append(name, el('span', 'meta', `cupo ${h.ticket}/${h.total}`));
    history.append(li);
  });

  const list = $('#participants');
  list.classList.toggle('editable', Boolean(token));
  list.replaceChildren();
  [...state.participants].sort((a, b) => b.cupos - a.cupos).forEach((p) => {
    const li = el('li', p.cupos ? '' : 'out');
    const pct = total ? ((p.cupos / total) * 100).toFixed(2) : '0.00';
    li.append(el('span', '', p.name), el('span', 'meta', `${p.cupos} cupos · ${pct}%`));
    li.addEventListener('click', () => {
      if (!token) return;
      $('#partName').value = p.name;
      $('#partCupos').value = p.cupos;
      $('#partCupos').focus();
    });
    list.append(li);
  });

  $('#admin').hidden = !token;
  $('#adminLink').hidden = Boolean(token);
  if (!anim) {
    if (!held) rotation = TAU * (1 - state.rest);
    draw();
  }
}

function showOverlay(entry) {
  $('#winnerName').textContent = entry.name;
  $('#winnerInfo').textContent = `${entry.prize ? entry.prize + ' · ' : ''}Giro #${entry.n} · cupo ${entry.ticket} de ${entry.total}`;
  $('#overlay').hidden = false;
  clearTimeout(overlayTimer);
  overlayTimer = setTimeout(hideOverlay, 9000);
}

function hideOverlay(release = true) {
  clearTimeout(overlayTimer);
  $('#overlay').hidden = true;
  if (release && !anim && !state.spin) {
    held = null;
    render();
  }
}

function connect() {
  const es = new EventSource('/events');
  const status = $('#status');
  es.onopen = () => {
    status.textContent = 'EN VIVO';
    status.className = 'badge on';
  };
  es.onerror = () => {
    status.textContent = 'RECONECTANDO';
    status.className = 'badge off';
  };
  es.addEventListener('state', (e) => {
    state = JSON.parse(e.data);
    if (state.spin && (!anim || anim.id !== state.spin.id)) startSpin(state.spin);
    render();
  });
  es.addEventListener('viewers', (e) => {
    state.viewers = JSON.parse(e.data);
    $('#viewers').textContent = `${state.viewers} viendo ahora`;
  });
  es.addEventListener('result', (e) => {
    if (anim) {
      rotation = anim.end;
      anim = null;
      draw();
    }
    showOverlay(JSON.parse(e.data));
  });
}

async function api(path, body = {}) {
  const res = await fetch(path, {
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
    return null;
  }
}

$('#overlay').addEventListener('click', () => hideOverlay());
$('#adminLink').addEventListener('click', () => $('#loginDialog').showModal());
$('#loginCancel').addEventListener('click', () => $('#loginDialog').close());
$('#logoutBtn').addEventListener('click', logout);
$('#spinBtn').addEventListener('click', () => adminAction('/api/spin'));

$('#resetBtn').addEventListener('click', () => {
  if (confirm('¿Reiniciar el sorteo? Se restaura la lista cargada y se borra el historial de ganadores.')) adminAction('/api/reset');
});

$('#listForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (state.participants.length && !confirm('¿Cargar esta lista? Reemplaza a los participantes actuales y borra el historial de ganadores.')) return;
  const result = await adminAction('/api/list', { text: $('#listText').value });
  if (!result) return;
  e.target.reset();
  alert(`Lista cargada: ${result.participants} participantes y ${result.cupos} cupos.`);
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

if (token) api('/api/check').catch(() => {});
render();
connect();
