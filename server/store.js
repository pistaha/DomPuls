'use strict';
const {DatabaseSync} = require('node:sqlite');
const {randomUUID, createHash} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {HttpError} = require('./auth');
const WINDOW = 20 * 60 * 1000;
const CATEGORY = 'Нет холодной воды';
const TITLE = 'Возможная общая проблема с холодной водой';
const STATUSES = ['Проверяется', 'Мастер вызван', 'Устранено'];
class Store {
  constructor(filename, topology, namespace = 'pilot') {
    if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), {recursive: true, mode: 0o700});
    this.db = new DatabaseSync(filename);
    this.topology = topology;
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS incidents(
        id TEXT PRIMARY KEY, building_id TEXT NOT NULL, zone_id TEXT NOT NULL, zone_label TEXT NOT NULL,
        category TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('Проверяется','Мастер вызван','Устранено')),
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active ON incidents(building_id,zone_id,category) WHERE status != 'Устранено';
      CREATE TABLE IF NOT EXISTS reports(
        id TEXT PRIMARY KEY, user_key TEXT NOT NULL, request_key TEXT NOT NULL,
        building_id TEXT NOT NULL, zone_id TEXT NOT NULL, zone_label TEXT NOT NULL, place TEXT NOT NULL,
        category TEXT NOT NULL, description TEXT NOT NULL, created_at INTEGER NOT NULL,
        incident_id TEXT REFERENCES incidents(id), UNIQUE(user_key,request_key));
      CREATE INDEX IF NOT EXISTS report_zone_time ON reports(building_id,zone_id,category,created_at);
      CREATE INDEX IF NOT EXISTS report_owner ON reports(user_key);
      CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY, incident_id TEXT NOT NULL REFERENCES incidents(id), status TEXT NOT NULL, at INTEGER NOT NULL);
    `);
    const saved = this.db.prepare("SELECT value FROM meta WHERE key='namespace'").get();
    if (saved && saved.value !== namespace) {this.db.close(); throw new Error('Нельзя использовать одну базу для разработки и пилота.');}
    this.db.prepare("INSERT OR IGNORE INTO meta VALUES ('namespace',?)").run(namespace);
    // Never silently regroup existing reports after a topology edit.
    const fingerprint = createHash('sha256').update(JSON.stringify(topology)).digest('hex');
    const prior = this.db.prepare("SELECT value FROM meta WHERE key='topology'").get();
    if (prior && prior.value !== fingerprint && this.db.prepare('SELECT COUNT(*) n FROM reports').get().n) {
      this.db.close(); throw new Error('Зоны изменились при непустой базе. Нужна явная миграция или отдельный DATA_DIR; существующая база сохранена.');
    }
    this.db.prepare("INSERT OR REPLACE INTO meta VALUES ('topology',?)").run(fingerprint);
  }
  location(input) {
    const b = this.topology.buildings.find(b => b.id === input.buildingId);
    const z = b?.zones.find(z => z.id === input.zoneId);
    if (!z || !z.places.includes(input.place)) throw new HttpError(400, 'Выберите настроенную общую зону и место.');
    return `${b.units.find(u => u.id === z.unitId).name} · этаж ${z.floor} · ${z.name}`;
  }
  add(user, input, now = Date.now()) {
    const allowed = ['requestId','buildingId','zoneId','place','category','description'];
    if (!input || Object.keys(input).some(k => !allowed.includes(k)) || input.category !== CATEGORY ||
      typeof input.description !== 'string' || !input.description.trim() || input.description.trim().length > 300 ||
      typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.requestId)) throw new HttpError(400, 'Проверьте категорию, место и описание (1–300 символов).');
    const label = this.location(input), description = input.description.trim();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const duplicate = this.db.prepare('SELECT * FROM reports WHERE user_key=? AND request_key=?').get(user, input.requestId);
      if (duplicate) {
        if (duplicate.building_id !== input.buildingId || duplicate.zone_id !== input.zoneId || duplicate.place !== input.place || duplicate.category !== input.category || duplicate.description !== description) throw new HttpError(409, 'Этот запрос уже сохранён с другим содержимым. Обновите список обращений.');
        this.db.exec('COMMIT'); return {id: duplicate.id, incidentId: duplicate.incident_id, repeated: true};
      }
      if (this.db.prepare('SELECT COUNT(*) n FROM reports WHERE user_key=? AND created_at>=?').get(user, now - WINDOW).n >= 20) throw new HttpError(429, 'Слишком много обращений. Подождите 20 минут.');
      const id = randomUUID();
      const key = [input.buildingId, input.zoneId, CATEGORY];
      let incident = this.db.prepare("SELECT id FROM incidents WHERE building_id=? AND zone_id=? AND category=? AND status!='Устранено'").get(...key);
      this.db.prepare('INSERT INTO reports VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,user,input.requestId,input.buildingId,input.zoneId,label,input.place,CATEGORY,description,now,incident?.id || null);
      if (!incident) {
        const count = this.db.prepare('SELECT COUNT(DISTINCT user_key) n FROM reports WHERE building_id=? AND zone_id=? AND category=? AND incident_id IS NULL AND created_at BETWEEN ? AND ?').get(...key,now-WINDOW,now).n;
        if (count >= 3) {
          incident = {id: randomUUID()};
          this.db.prepare('INSERT INTO incidents VALUES (?,?,?,?,?,?,?,?)').run(incident.id,...key.slice(0,2),label,CATEGORY,'Проверяется',now,now);
          this.db.prepare('INSERT INTO history(incident_id,status,at) VALUES (?,?,?)').run(incident.id,'Проверяется',now);
          this.db.prepare('UPDATE reports SET incident_id=? WHERE building_id=? AND zone_id=? AND category=? AND incident_id IS NULL AND created_at BETWEEN ? AND ?').run(incident.id,...key,now-WINDOW,now);
        }
      }
      this.db.exec('COMMIT');
      return {id, incidentId: incident?.id || null, repeated: false};
    } catch (error) {this.db.exec('ROLLBACK'); throw error;}
  }
  setStatus(id, status, now = Date.now()) {
    if (!STATUSES.includes(status)) throw new HttpError(400, 'Неизвестный статус.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const i = this.db.prepare('SELECT * FROM incidents WHERE id=?').get(id);
      if (!i) throw new HttpError(404, 'Инцидент не найден.');
      if (i.status === 'Устранено' && status !== 'Устранено') throw new HttpError(409, 'Инцидент уже устранён. Для новой проблемы нужны новые обращения.');
      if (i.status !== status) {
        this.db.prepare('UPDATE incidents SET status=?,updated_at=? WHERE id=?').run(status,now,id);
        this.db.prepare('INSERT INTO history(incident_id,status,at) VALUES (?,?,?)').run(id,status,now);
      }
      this.db.exec('COMMIT');
    } catch (error) {this.db.exec('ROLLBACK'); throw error;}
  }
  snapshot(user, buildingId, admin = false, now = Date.now()) {
    if (!this.topology.buildings.some(b => b.id === buildingId)) throw new HttpError(400, 'Дом не настроен.');
    const incidents = this.db.prepare(`SELECT i.*,COUNT(r.id) count,COUNT(DISTINCT r.user_key) unique_count
      FROM incidents i LEFT JOIN reports r ON r.incident_id=i.id WHERE i.building_id=? GROUP BY i.id ORDER BY i.created_at DESC`).all(buildingId).map(i => ({
        id:i.id, buildingId:i.building_id, zoneId:i.zone_id, zoneLabel:i.zone_label, category:i.category, title:TITLE,
        status:i.status, createdAt:i.created_at, updatedAt:i.updated_at, count:i.count, uniqueCount:i.unique_count,
        ...(admin ? {history:this.db.prepare('SELECT status,at FROM history WHERE incident_id=? ORDER BY id').all(i.id)} : {})
      }));
    const pending = this.db.prepare(`SELECT zone_id,zone_label,category,COUNT(*) count,COUNT(DISTINCT user_key) unique_count
      FROM reports WHERE building_id=? AND incident_id IS NULL AND created_at BETWEEN ? AND ? GROUP BY zone_id,category`).all(buildingId,now-WINDOW,now).map(r => ({zoneId:r.zone_id,zoneLabel:r.zone_label,category:r.category,count:r.count,uniqueCount:r.unique_count}));
    // Deliberately no endpoint for neighbours' reports, user keys or raw MAX identifiers.
    const mine = this.db.prepare(`SELECT r.*,i.status FROM reports r LEFT JOIN incidents i ON i.id=r.incident_id
      WHERE r.user_key=? AND r.building_id=? ORDER BY r.created_at DESC`).all(user,buildingId).map(r => ({
        id:r.id,zoneId:r.zone_id,zoneLabel:r.zone_label,place:r.place,category:r.category,description:r.description,createdAt:r.created_at,
        incidentId:r.incident_id,status:r.status,expired:!r.incident_id && now-r.created_at>WINDOW,
        similarResidents:pending.find(p => p.zoneId===r.zone_id)?.uniqueCount || 0
      }));
    return {incidents,pending,mine};
  }
  health() {
    // Read the actual database; never return topology, user data or filesystem paths.
    this.db.prepare("SELECT value FROM meta WHERE key='namespace'").get();
  }
  close() {this.db.close();}
}
module.exports = {Store,WINDOW,CATEGORY,TITLE,STATUSES};
