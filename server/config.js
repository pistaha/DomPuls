'use strict';
const path = require('node:path');
const fs = require('node:fs');
const ROOT = path.resolve(__dirname, '..');
function validateBuildings(topology) {
  const fail = () => {throw new Error('Некорректный BUILDINGS_FILE: проверьте дома, уникальные ID, корпуса и общие зоны.');};
  if (!topology || typeof topology.synthetic !== 'boolean' || !Array.isArray(topology.buildings) || !topology.buildings.length) fail();
  const id = x => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(x);
  const name = x => typeof x === 'string' && x.trim().length > 0 && x.length <= 160;
  const unique = rows => new Set(rows.map(x => x.id)).size === rows.length;
  if (topology.grouping && !['reported-place','zone'].includes(topology.grouping)) fail();
  if (!unique(topology.buildings)) fail();
  for (const b of topology.buildings) {
    if (topology.grouping==='reported-place') {
      if (!id(b.id) || !name(b.name) || !Array.isArray(b.places) || !b.places.length || !unique(b.places) || b.places.some(p=>!id(p.id)||!name(p.name)) || new Set(b.places.map(p=>p.name)).size!==b.places.length) fail();
      continue;
    }
    if (!id(b.id) || !name(b.name) || !Array.isArray(b.units) || !b.units.length || !Array.isArray(b.zones) || !b.zones.length || !unique(b.units) || !unique(b.zones)) fail();
    if (b.units.some(u => !id(u.id) || !name(u.name) || !b.zones.some(z => z.unitId === u.id))) fail();
    for (const z of b.zones) if (!id(z.id) || !name(z.name) || !b.units.some(u => u.id === z.unitId) || !Number.isInteger(z.floor) || !Array.isArray(z.places) || !z.places.length || z.places.some(p => !name(p)) || new Set(z.places).size !== z.places.length) fail();
  }
  return topology;
}
function loadConfig(env = process.env) {
  const development = env.NODE_ENV === 'development';
  if (env.NODE_ENV && !['production', 'development', 'test'].includes(env.NODE_ENV)) throw new Error('NODE_ENV должен быть production или development.');
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Некорректный PORT.');
  const host = env.HOST || (development ? '127.0.0.1' : '0.0.0.0');
  if (development && !['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('Development разрешён только на loopback.');
  const publicUrl = new URL(env.PUBLIC_URL || `http://localhost:${port}`);
  if (!['http:', 'https:'].includes(publicUrl.protocol)) throw new Error('PUBLIC_URL должен использовать HTTP или HTTPS.');
  if (publicUrl.username || publicUrl.password || publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash) throw new Error('PUBLIC_URL должен содержать только origin.');
  if (development && !['localhost', '127.0.0.1', '[::1]'].includes(publicUrl.hostname)) throw new Error('Development URL должен быть локальным.');
  if (!development && publicUrl.protocol !== 'https:') throw new Error('Для production нужен PUBLIC_URL с HTTPS.');
  if (env.BUILDINGS_JSON && env.BUILDINGS_FILE) throw new Error('Задайте только один источник зон: BUILDINGS_JSON или BUILDINGS_FILE.');
  let topology;
  try {
    const source = env.BUILDINGS_JSON || fs.readFileSync(path.resolve(ROOT, env.BUILDINGS_FILE || 'config/buildings.example.json'), 'utf8');
    topology = validateBuildings(JSON.parse(source));
  } catch (_) {throw new Error('Некорректная конфигурация зон: проверьте BUILDINGS_JSON или BUILDINGS_FILE, дома, корпуса, этажи и общие места.');}
  const botToken = env.MAX_BOT_TOKEN || '';
  const hashSecret = env.USER_HASH_SECRET || (development ? 'development-only-not-a-production-secret' : '');
  const adminIds = new Set((env.MAX_ADMIN_IDS || '').split(',').map(x => x.trim()).filter(Boolean));
  if ([...adminIds].some(id => !/^[1-9]\d*$/.test(id))) throw new Error('MAX_ADMIN_IDS: нужны числовые ID через запятую.');
  if (!development && (!botToken || hashSecret.length < 32 || !adminIds.size)) throw new Error('Для production задайте MAX_BOT_TOKEN, USER_HASH_SECRET (32+ символа), MAX_ADMIN_IDS.');
  if (!development && topology.synthetic) throw new Error('Настройте согласованные зоны в BUILDINGS_JSON или BUILDINGS_FILE и отметьте synthetic: false.');
  const miniAppUrl = env.MINI_APP_URL || '';
  if (!development && miniAppUrl !== publicUrl.origin + '/') throw new Error('MINI_APP_URL должен быть PUBLIC_URL с завершающим /.');
  const webhookSecret = env.MAX_WEBHOOK_SECRET || '';
  const webhookUrl = env.MAX_WEBHOOK_URL || '';
  const botUsername = env.MAX_BOT_USERNAME || '';
  if (webhookSecret && !/^[A-Za-z0-9_-]{32,256}$/.test(webhookSecret)) throw new Error('MAX_WEBHOOK_SECRET: 32–256 символов A-Z, a-z, 0-9, _ или -.');
  if (botUsername && !/^[A-Za-z0-9_]+$/.test(botUsername)) throw new Error('MAX_BOT_USERNAME: укажите username без @.');
  if (webhookUrl && webhookUrl !== `${publicUrl.origin}/webhook/max`) throw new Error('MAX_WEBHOOK_URL должен быть PUBLIC_URL/webhook/max.');
  if (!development && (!webhookSecret || !webhookUrl || !botUsername)) throw new Error('Для production задайте MAX_WEBHOOK_SECRET, MAX_WEBHOOK_URL, MAX_BOT_USERNAME.');
  const dataDir = path.resolve(ROOT, env.DATA_DIR || 'data');
  return {development, port, host, origin: publicUrl.origin, topology, botToken, hashSecret, adminIds,
    miniAppUrl, webhookSecret, webhookUrl, botUsername,
    dbPath: path.join(dataDir, development ? 'development.sqlite' : 'pilot.sqlite')};
}
module.exports = {loadConfig, validateBuildings, ROOT};
