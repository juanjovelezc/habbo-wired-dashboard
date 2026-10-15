const $ = (sel) => document.querySelector(sel);

let globalProfile = {};       // { variables: { name: {value, ...} } }
let currentTarget = null;     // { targetKind, entityId }

const INT_RE = /^-?\d+$/;

function showToast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + kind;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, 3500);
}

const ERROR_MESSAGES = {
  'room.not_found': 'Sala no encontrada. Revisa ROOM_ID en .env',
  'wired.variables.entity_not_found': 'Ese usuario/mascota/bot no tiene perfil de variables en esta sala (no participa aun en ninguna variable)',
  'wired.variables.not_found': 'Variable no encontrada. Definela primero con el Wired en la sala',
  'wired.variables.key_missing': 'Falta la clave API',
  'wired.variables.key_invalid': 'Clave API invalida. Revisa READ_KEY / WRITE_KEY en .env',
  'wired.variables.api_disabled': 'La API de variables Wired esta deshabilitada en el hotel',
  'wired.variables.too_many_requests': 'Demasiadas peticiones. Espera unos segundos',
  'wired.variables.user_not_participating': 'El usuario no participa en esa variable',
  'wired.variables.invalid_target': 'Objetivo o variable no valida',
  'wired.variables.invalid_value': 'Valor invalido (debe ser un entero)',
  'wired.variables.operation_not_allowed': 'Operacion no permitida',
  'config_missing': 'Falta configurar ROOM_ID o las claves en .env',
};

function describeError(data, status) {
  const code = data && data.error;
  if (code && ERROR_MESSAGES[code]) return `${ERROR_MESSAGES[code]} (${code})`;
  if (code) return code;
  if (status === 404) return 'No encontrado (404)';
  if (data && typeof data === 'string') return data;
  return 'Error desconocido';
}

async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(describeError(data, res.status));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function loadConfig() {
  try {
    const cfg = await api('GET', '/api/config');
    const line = cfg.roomId
      ? `Sala ${cfg.roomId} · ${cfg.base}`
      : 'Sin sala configurada (revisa .env)';
    $('#configLine').textContent = line;
    const pill = $('#statusPill');
    if (!cfg.roomId || !cfg.hasReadKey || !cfg.hasWriteKey) {
      pill.textContent = 'Configuracion incompleta';
      pill.className = 'pill warn';
    } else {
      pill.textContent = 'Conectado';
      pill.className = 'pill ok';
    }
  } catch (e) {
    $('#configLine').textContent = 'No se pudo cargar la configuracion';
  }
}

function renderGlobal() {
  const body = $('#globalBody');
  const variables = globalProfile.variables || {};
  const names = Object.keys(variables);

  if (names.length === 0) {
    body.innerHTML = '<div class="empty">No hay variables globales. Definelas con el Wired dentro de la sala y luego pulsa "Cargar variables".</div>';
    return;
  }

  body.innerHTML = '';
  for (const name of names) {
    const v = variables[name] || {};
    const row = document.createElement('div');
    row.className = 'row';

    const nameEl = document.createElement('span');
    nameEl.className = 'name';
    nameEl.textContent = name;

    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.value = v.value ?? '';
    input.placeholder = 'numero entero';
    input.dataset.varName = name;

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = v.update_time ? 'Act. ' + new Date(v.update_time).toLocaleString() : '';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn';
    saveBtn.textContent = 'Guardar';
    saveBtn.onclick = () => saveGlobalOne(name, input.value, saveBtn);

    row.append(nameEl, input, meta, saveBtn);
    body.appendChild(row);
  }
}

async function saveGlobalOne(name, value, btn) {
  if (!INT_RE.test(value.trim())) {
    showToast('El valor debe ser un numero entero (ej. 5 o -3)', 'err');
    return;
  }
  btn.disabled = true;
  try {
    const data = await api('PATCH', '/api/global', { variables: { [name]: value.trim() } });
    globalProfile = data;
    renderGlobal();
    showToast(`Variable "${name}" actualizada`, 'ok');
  } catch (e) {
    showToast(e.message, 'err');
  } finally {
    btn.disabled = false;
  }
}

async function loadGlobal() {
  const btn = $('#loadGlobalBtn');
  btn.disabled = true;
  try {
    globalProfile = await api('GET', '/api/global');
    renderGlobal();
  } catch (e) {
    showToast(e.message, 'err');
    $('#globalBody').innerHTML = '<div class="empty">No se pudo cargar.</div>';
  } finally {
    btn.disabled = false;
  }
}

function updateLookupLabel() {
  const kind = $('#targetKind').value;
  const label = $('#lookupLabel');
  const input = $('#lookupValue');
  if (kind === 'users') {
    label.textContent = 'Nombre de usuario o ID unico (hhus-...)';
    input.placeholder = 'ej. whatwasit o hhus-8a5eef6e9607f74a4e501865bc324fa0';
  } else if (kind === 'pets') {
    label.textContent = 'ID numerico de la mascota';
    input.placeholder = 'ej. 123';
  } else {
    label.textContent = 'ID numerico del bot';
    input.placeholder = 'ej. 456';
  }
}

function renderProfile(profile) {
  const info = $('#profileInfo');
  const body = $('#usersBody');

  const target = profile.user || profile.pet || profile.bot || {};
  const label = profile.user ? 'Usuario' : (profile.pet ? 'Mascota' : 'Bot');
  const parts = [];
  if (target.id !== undefined) parts.push('ID: ' + target.id);
  if (target.name) parts.push('Nombre: ' + target.name);
  if (target.unique_id) parts.push('Unique ID: ' + target.unique_id);
  info.textContent = `${label} — ${parts.join(' · ')}`;
  info.hidden = false;

  const variables = profile.variables || {};
  const names = Object.keys(variables);

  if (names.length === 0) {
    body.innerHTML = '<div class="empty">Este objetivo no tiene variables asignadas.</div>';
    return;
  }

  body.innerHTML = '';
  for (const name of names) {
    const v = variables[name] || {};
    const row = document.createElement('div');
    row.className = 'row';

    const nameEl = document.createElement('span');
    nameEl.className = 'name';
    nameEl.textContent = name;

    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.value = v.value ?? '';
    input.placeholder = 'numero entero';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn';
    saveBtn.textContent = 'Guardar';
    saveBtn.onclick = () => saveProfileOne(name, input.value, saveBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger';
    delBtn.textContent = 'Eliminar';
    delBtn.onclick = () => deleteProfileOne(name, delBtn);

    row.append(nameEl, input, saveBtn, delBtn);
    body.appendChild(row);
  }
}

async function saveProfileOne(name, value, btn) {
  if (!currentTarget) return;
  if (!INT_RE.test(value.trim())) {
    showToast('El valor debe ser un numero entero', 'err');
    return;
  }
  btn.disabled = true;
  try {
    const data = await api('PATCH', `/api/profile/${currentTarget.targetKind}/${currentTarget.entityId}`, {
      variables: { [name]: value.trim() },
    });
    renderProfile(data);
    showToast(`Variable "${name}" actualizada`, 'ok');
  } catch (e) {
    showToast(e.message, 'err');
  } finally {
    btn.disabled = false;
  }
}

async function deleteProfileOne(name, btn) {
  if (!currentTarget) return;
  if (!confirm(`Eliminar el valor de "${name}" para este objetivo?`)) return;
  btn.disabled = true;
  try {
    const data = await api('PATCH', `/api/profile/${currentTarget.targetKind}/${currentTarget.entityId}`, {
      variables: { [name]: null },
    });
    renderProfile(data);
    showToast(`Variable "${name}" eliminada`, 'ok');
  } catch (e) {
    showToast(e.message, 'err');
  } finally {
    btn.disabled = false;
  }
}

async function resolveUserProfile(value) {
  const isUniqueId = /^hh[a-z]*-/i.test(value);
  const attempts = isUniqueId
    ? [{ unique_id: value }, { name: value }]
    : [{ name: value }, { unique_id: value }];
  let lastErr;
  for (const q of attempts) {
    try {
      const qs = new URLSearchParams(q);
      return await api('GET', `/api/profile/user?${qs.toString()}`);
    } catch (e) {
      lastErr = e;
      if (e.status !== 404 && e.status !== 400) throw e;
    }
  }
  throw lastErr;
}

async function loadProfile() {
  const kind = $('#targetKind').value;
  const value = $('#lookupValue').value.trim();
  if (!value) {
    showToast('Escribe un nombre o ID', 'err');
    return;
  }
  const btn = $('#loadProfileBtn');
  btn.disabled = true;
  try {
    let data;
    if (kind === 'users') {
      data = await resolveUserProfile(value);
      currentTarget = { targetKind: 'users', entityId: data.user?.id ?? data.user?.unique_id };
    } else {
      data = await api('GET', `/api/profile/${kind}/${encodeURIComponent(value)}`);
      currentTarget = { targetKind: kind, entityId: value };
    }
    if (!currentTarget.entityId) {
      showToast('No se pudo resolver el ID del objetivo', 'err');
    }
    renderProfile(data);
  } catch (e) {
    currentTarget = null;
    showToast(e.message, 'err');
    $('#usersBody').innerHTML = '';
    $('#profileInfo').hidden = true;
  } finally {
    btn.disabled = false;
  }
}

let groupMembers = [];

async function loadGroupMembers() {
  const sel = $('#groupMember');
  sel.innerHTML = '<option value="">Cargando miembros...</option>';
  try {
    const data = await api('GET', '/api/group/members');
    groupMembers = data.members || [];
    sel.innerHTML = '<option value="">— Elegir miembro —</option>';
    groupMembers.forEach((m, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `${m.name}${m.online ? ' ● en linea' : ''}${m.isAdmin ? ' · admin' : ''}`;
      sel.appendChild(opt);
    });
  } catch (e) {
    sel.innerHTML = '<option value="">No se pudo cargar la lista</option>';
    showToast(e.message, 'err');
  }
}

$('#groupMember').addEventListener('change', async () => {
  const idx = $('#groupMember').value;
  if (idx === '') return;
  const m = groupMembers[Number(idx)];
  if (!m) return;
  $('#targetKind').value = 'users';
  updateLookupLabel();
  $('#lookupValue').value = m.uniqueId;
  await loadProfile();
});

function fmtName(u) {
  if (u && u.name) return u.name;
  if (u && u.id != null) return `#${u.id}`;
  return '?';
}

async function loadClicks() {
  const btn = $('#loadClicksBtn');
  btn.disabled = true;
  try {
    const data = await api('GET', '/api/clicks');
    $('#clicksVar').textContent = data.variable || 'last_clicker';
    renderClicks(data.events || []);
  } catch (e) {
    if (e.status === 404) {
      $('#clicksVar').textContent = '';
      $('#clicksBody').innerHTML = '<div class="empty">Aun no hay la variable "last_clicker". Configura el wired de clics en el juego y luego recarga.</div>';
    } else {
      showToast(e.message, 'err');
    }
  } finally {
    btn.disabled = false;
  }
}

function renderClicks(events) {
  const body = $('#clicksBody');
  if (!events.length) {
    body.innerHTML = '<div class="empty">Sin clics registrados todavia.</div>';
    return;
  }
  body.innerHTML = '';
  for (const e of events) {
    const row = document.createElement('div');
    row.className = 'row';

    const who = document.createElement('span');
    who.className = 'name';
    who.textContent = `${fmtName(e.clicker)}  clicó a  ${fmtName(e.clicked)}`;

    const time = document.createElement('span');
    time.className = 'meta';
    time.textContent = e.update_time ? new Date(e.update_time).toLocaleString() : '';

    row.append(who, time);
    body.appendChild(row);
  }
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tabpanel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    $('#tab-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'clicks') loadClicks();
  });
});

$('#targetKind').addEventListener('change', updateLookupLabel);
$('#reloadMembersBtn').addEventListener('click', loadGroupMembers);
$('#refreshBtn').addEventListener('click', () => {
  if ($('#tab-global').classList.contains('active')) loadGlobal();
});
$('#loadGlobalBtn').addEventListener('click', loadGlobal);
$('#loadClicksBtn').addEventListener('click', loadClicks);
$('#loadProfileBtn').addEventListener('click', loadProfile);
$('#lookupValue').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadProfile();
});

updateLookupLabel();
loadConfig();
loadGlobal();
loadGroupMembers();
