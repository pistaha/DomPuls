const {test} = require('node:test');
const assert = require('node:assert/strict');
const M = require('../model.js');
const now = 1_800_000_000_000;
const input = (userId, extra = {}) => ({buildingId: M.BUILDINGS[0].id, unitId: 'А', floor: 1, place: 'Общая кухня', category: M.CATEGORY, userId, description: 'Нет воды', ...extra});
const add = (s, user, at = now, extra = {}) => M.addReport(s, input(user, extra), at);
function wave(s, at = now) {M.USERS.forEach(u => add(s, u.id, at));}
test('three different residents create one checking incident and attach all matching reports', () => {
  const s = M.empty(); add(s, 'resident-1'); add(s, 'resident-2');
  assert.equal(s.incidents.length, 0); assert.equal(M.uniqueResidents(M.groups(s, now)[0]), 2);
  add(s, 'resident-3'); assert.equal(s.incidents.length, 1);
  assert.equal(s.incidents[0].status, 'Проверяется'); assert.ok(s.reports.every(r => r.incidentId === s.incidents[0].id));
  assert.equal(M.groups(s, now).length, 0);
});
test('repeat messages from one person do not reach threshold', () => {
  const s = M.empty(); for (let i = 0; i < 5; i++) add(s, 'resident-1');
  add(s, 'resident-2'); assert.equal(s.incidents.length, 0);
  add(s, 'resident-3'); assert.equal(s.incidents.length, 1); assert.equal(M.uniqueResidents(s.reports), 3);
});
test('20-minute inclusive boundary and expired reports', () => {
  const s = M.empty(); add(s, 'resident-1', now - M.WINDOW_MS - 1); add(s, 'resident-2'); add(s, 'resident-3');
  assert.equal(s.incidents.length, 0);
  add(s, 'resident-1'); assert.equal(s.incidents.length, 1); assert.equal(s.reports[0].incidentId, null);
  const boundary = M.empty(); add(boundary, 'resident-1', now - M.WINDOW_MS); add(boundary, 'resident-2'); add(boundary, 'resident-3');
  assert.equal(boundary.incidents.length, 1);
});
test('future timestamps do not count', () => {
  const s = M.empty(); add(s, 'resident-1', now + 1); add(s, 'resident-2'); add(s, 'resident-3'); assert.equal(s.incidents.length, 0);
});
test('different units and floors are separate zones; rooms within one floor combine', () => {
  const s = M.empty(); add(s, 'resident-1'); add(s, 'resident-2', now, {unitId: 'Б'}); add(s, 'resident-3', now, {floor: 2});
  assert.equal(s.incidents.length, 0); assert.equal(M.groups(s, now).length, 3);
  add(s, 'resident-2', now, {place: 'Общая душевая'}); add(s, 'resident-3', now, {place: 'Общая кухня'});
  assert.equal(s.incidents.length, 1);
});
test('category and building belong to grouping key; invalid inputs are rejected', () => {
  assert.notEqual(M.zoneKey(input('resident-1')), M.zoneKey(input('resident-1', {buildingId: 'other'})));
  assert.notEqual(M.zoneKey(input('resident-1')), M.zoneKey(input('resident-1', {category: 'other'})));
  for (const extra of [{category: 'other'}, {buildingId: 'other'}, {floor: 99}, {place: 'other'}, {userId: 'other'}, {description: '  '}, {description: 'x'.repeat(301)}]) {
    const s = M.empty(); assert.throws(() => M.addReport(s, input('resident-1', extra), now)); assert.equal(s.reports.length, 0);
  }
});
test('active incident receives later reports with no duplicate even beyond window', () => {
  const s = M.empty(); wave(s); add(s, 'resident-1', now + M.WINDOW_MS + 1);
  assert.equal(s.incidents.length, 1); assert.equal(s.reports[3].incidentId, s.incidents[0].id);
});
test('administrator status is shared by linked reports; resolution requires a fresh wave', () => {
  const s = M.empty(); wave(s); const id = s.incidents[0].id;
  M.setStatus(s, id, 'Мастер вызван', now + 1); assert.equal(s.incidents[0].status, 'Мастер вызван');
  M.setStatus(s, id, 'Устранено', now + 2); add(s, 'resident-1', now + 3); add(s, 'resident-2', now + 3);
  assert.equal(s.incidents.length, 1); add(s, 'resident-3', now + 3); assert.equal(s.incidents.length, 2);
  assert.notEqual(s.reports[3].incidentId, id); assert.equal(s.incidents[0].history.length, 3);
  assert.throws(() => M.setStatus(s, id, 'Проверяется')); assert.throws(() => M.setStatus(s, 'bad', 'Устранено'));
});
test('saved data round-trips with relationships and statuses; corrupt data rejected', () => {
  const s = M.empty(); wave(s); M.setStatus(s, s.incidents[0].id, 'Мастер вызван');
  assert.ok(M.validate(JSON.parse(JSON.stringify(s)))); assert.ok(M.validate(M.empty()));
  for (const bad of [null, {}, {version: 1}, {...s, reports: [null]}, {...s, incidents: [null]}, {...s, nextReport: 1}, {...s, reports: [s.reports[0], s.reports[0]]}]) assert.equal(M.validate(bad), false);
  s.reports[0].incidentId = 'missing'; assert.equal(M.validate(s), false);
});
