require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const BASE = (process.env.HABBO_API_BASE || 'https://www.habbo.es/api/public').replace(/\/+$/, '');
const ROOM_ID = process.env.ROOM_ID || '';
const READ_KEY = process.env.READ_KEY || '';
const WRITE_KEY = process.env.WRITE_KEY || '';
const GROUP_ID = process.env.GROUP_ID || '';
const CLICK_VARIABLE = process.env.CLICK_VARIABLE || 'last_clicker';
const PORT = process.env.PORT || 3000;

let cachedGroupId = null;
let cachedGroupIdRoom = null;

async function resolveGroupId() {
  if (GROUP_ID) return GROUP_ID;
  if (cachedGroupId !== null && cachedGroupIdRoom === ROOM_ID) return cachedGroupId;
  const r = await fetch(`${BASE}/rooms/${ROOM_ID}`);
  if (!r.ok) return null;
  const data = await r.json().catch(() => null);
  cachedGroupId = (data && data.habboGroupId) || null;
  cachedGroupIdRoom = ROOM_ID;
  return cachedGroupId;
}

const USER_TARGET_KINDS = new Set(['users', 'pets', 'bots']);
const FURNI_TARGET_KINDS = new Set(['furni', 'furni-bc', 'wall-items', 'wall-items-bc']);
const VALID_TARGET_KINDS = new Set([...USER_TARGET_KINDS, ...FURNI_TARGET_KINDS]);

async function habbo(method, subpath, { write = false, body, query } = {}) {
  const url = new URL(`${BASE}${subpath}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== null && v !== undefined && v !== '') url.searchParams.set(k, v);
    }
  }
  const key = write ? WRITE_KEY : READ_KEY;
  const headers = {};
  headers['X-Wired-' + (write ? 'Write' : 'Read') + '-Key'] = key;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { status: res.status, data };
}

function requireConfig(req, res, next) {
  if (!ROOM_ID) {
    return res.status(400).json({ error: 'config_missing', message: 'ROOM_ID no esta configurado en .env' });
  }
  if (!READ_KEY && !WRITE_KEY) {
    return res.status(400).json({ error: 'config_missing', message: 'Faltan READ_KEY/WRITE_KEY en .env' });
  }
  next();
}

app.get('/api/config', (req, res) => {
  res.json({
    base: BASE,
    roomId: ROOM_ID,
    hasReadKey: Boolean(READ_KEY),
    hasWriteKey: Boolean(WRITE_KEY),
  });
});

app.use('/api', requireConfig);

app.get('/api/variables', async (req, res) => {
  const r = await habbo('GET', `/rooms/${ROOM_ID}/variables`);
  res.status(r.status).json(r.data);
});

app.get('/api/global', async (req, res) => {
  const r = await habbo('GET', `/rooms/${ROOM_ID}/variables_profile/global`);
  res.status(r.status).json(r.data);
});

app.patch('/api/global', async (req, res) => {
  const r = await habbo('PATCH', `/rooms/${ROOM_ID}/variables_profile/global`, { write: true, body: req.body });
  res.status(r.status).json(r.data);
});

app.get('/api/global/:variableName', async (req, res) => {
  const name = encodeURIComponent(req.params.variableName);
  const r = await habbo('GET', `/rooms/${ROOM_ID}/variables/global/${name}`);
  res.status(r.status).json(r.data);
});

app.patch('/api/global/:variableName', async (req, res) => {
  const name = encodeURIComponent(req.params.variableName);
  const r = await habbo('PATCH', `/rooms/${ROOM_ID}/variables/global/${name}`, { write: true, body: req.body });
  res.status(r.status).json(r.data);
});

app.get('/api/profile/user', async (req, res) => {
  const query = {};
  if (req.query.name) query.name = req.query.name;
  if (req.query.unique_id) query.unique_id = req.query.unique_id;
  const r = await habbo('GET', `/rooms/${ROOM_ID}/variables_profile/user/users`, { query });
  res.status(r.status).json(r.data);
});

app.get('/api/profile/:targetKind/:entityId', async (req, res) => {
  const { targetKind, entityId } = req.params;
  if (!VALID_TARGET_KINDS.has(targetKind)) {
    return res.status(400).json({ error: 'wired.variables.invalid_target' });
  }
  const r = await habbo('GET', `/rooms/${ROOM_ID}/variables_profile/user/${targetKind}/${encodeURIComponent(entityId)}`);
  res.status(r.status).json(r.data);
});

app.patch('/api/profile/:targetKind/:entityId', async (req, res) => {
  const { targetKind, entityId } = req.params;
  if (!USER_TARGET_KINDS.has(targetKind)) {
    return res.status(400).json({ error: 'wired.variables.invalid_target' });
  }
  const r = await habbo('PATCH', `/rooms/${ROOM_ID}/variables_profile/user/${targetKind}/${encodeURIComponent(entityId)}`, { write: true, body: req.body });
  res.status(r.status).json(r.data);
});

app.delete('/api/profile/:targetKind/:entityId', async (req, res) => {
  const { targetKind, entityId } = req.params;
  if (!USER_TARGET_KINDS.has(targetKind)) {
    return res.status(400).json({ error: 'wired.variables.invalid_target' });
  }
  const r = await habbo('DELETE', `/rooms/${ROOM_ID}/variables_profile/user/${targetKind}/${encodeURIComponent(entityId)}`, { write: true });
  res.status(r.status).json(r.data);
});

app.get('/api/group/members', async (req, res) => {
  const groupId = await resolveGroupId();
  if (!groupId) {
    return res.status(404).json({ error: 'group_not_found', message: 'La sala no tiene un grupo asociado' });
  }
  const r = await fetch(`${BASE}/groups/${encodeURIComponent(groupId)}/members`);
  const data = await r.json().catch(() => null);
  if (!r.ok) return res.status(r.status).json(data);
  const members = (Array.isArray(data) ? data : []).map((m) => ({
    name: m.name,
    uniqueId: m.uniqueId,
    online: Boolean(m.online),
    isAdmin: Boolean(m.isAdmin),
  }));
  res.json({ groupId, members });
});

app.get('/api/clicks', async (req, res) => {
  const list = await habbo('GET', `/rooms/${ROOM_ID}/variables/user/${encodeURIComponent(CLICK_VARIABLE)}/users`, {
    query: { order_by: 'update_time', order_dir: 'desc', size: 100 },
  });
  if (list.status !== 200) return res.status(list.status).json(list.data);

  const raw = list.data || {};
  const items = Array.isArray(raw.items) ? raw.items : (Array.isArray(raw.results) ? raw.results : []);
  const events = [];
  for (const item of items) {
    const holder = item.user || {};
    const variable = item.variable || {};
    const clickedId = holder.id ?? holder.unique_id ?? null;
    const clickerId = variable.value ?? null;
    if (clickedId == null) continue;
    events.push({
      clicked: { id: clickedId, name: holder.name || null, unique_id: holder.unique_id || null },
      clickerId,
      update_time: variable.update_time ?? null,
    });
  }

  const ids = [...new Set(events.map((e) => e.clickerId).filter((v) => v != null))];
  const nameMap = {};
  await Promise.all(ids.map(async (id) => {
    const r = await habbo('GET', `/rooms/${ROOM_ID}/variables_profile/user/users/${encodeURIComponent(id)}`);
    if (r.status === 200 && r.data && r.data.user) {
      nameMap[id] = r.data.user.name || null;
    }
  }));

  res.json({
    variable: CLICK_VARIABLE,
    events: events.map((e) => ({
      clicked: e.clicked,
      clicker: { id: e.clickerId, name: nameMap[e.clickerId] ?? null },
      update_time: e.update_time,
    })),
  });
});

app.listen(PORT, () => {
  console.log(`Habbo Wired Dashboard: http://localhost:${PORT}`);
  if (!ROOM_ID) console.log('AVISO: ROOM_ID no configurado en .env');
  if (!READ_KEY) console.log('AVISO: READ_KEY no configurado en .env');
  if (!WRITE_KEY) console.log('AVISO: WRITE_KEY no configurado en .env');
});
