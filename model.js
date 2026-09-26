/* Plain JavaScript: works from file:// and in Node's built-in test runner. */
(function (root) {
  'use strict';
  const WINDOW_MS = 20 * 60 * 1000;
  const CATEGORY = 'Нет холодной воды';
  const STATUSES = ['Проверяется', 'Мастер вызван', 'Устранено'];
  // Only the pilot address is real. This structure is deliberately synthetic.
  const BUILDINGS = [{
    id: 'vyazemsky-demo', name: 'Вяземский пер., 5/7',
    description: 'Общежитие ИТМО · пример пилота',
    units: ['А', 'Б'].map(id => ({id, name: 'Демо-корпус ' + id,
      floors: [1, 2, 3].map(number => ({number, places: ['Общая кухня', 'Общая душевая']}))}))
  }];
  const USERS = [
    {id: 'resident-1', name: 'Анна'}, {id: 'resident-2', name: 'Борис'}, {id: 'resident-3', name: 'Вера'}
  ];
  const empty = () => ({version: 1, nextReport: 1, nextIncident: 1, reports: [], incidents: []});
  const zoneKey = r => JSON.stringify([r.buildingId, r.unitId, r.floor, r.category]);
  const uniqueResidents = rows => new Set(rows.map(r => r.userId)).size;
  function validLocation(r) {
    const unit = BUILDINGS.find(b => b.id === r.buildingId)?.units.find(u => u.id === r.unitId);
    return !!unit?.floors.find(f => f.number === r.floor)?.places.includes(r.place);
  }
  function recentPending(state, now = Date.now()) {
    return state.reports.filter(r => !r.incidentId && r.createdAt <= now && now - r.createdAt <= WINDOW_MS);
  }
  function groups(state, now = Date.now()) {
    const result = new Map();
    recentPending(state, now).forEach(r => {
      const key = zoneKey(r);
      if (!result.has(key)) result.set(key, []);
      result.get(key).push(r);
    });
    return [...result.values()];
  }
  function addReport(state, input, now = Date.now()) {
    if (!USERS.some(u => u.id === input.userId) || input.category !== CATEGORY || !validLocation(input) ||
      typeof input.description !== 'string' || !input.description.trim() || input.description.trim().length > 300 || !Number.isFinite(now)) {
      throw new Error('Выберите место и добавьте описание от 1 до 300 символов.');
    }
    const report = {
      id: 'О-' + state.nextReport++, buildingId: input.buildingId, unitId: input.unitId,
      floor: input.floor, place: input.place, category: CATEGORY, userId: input.userId,
      description: input.description.trim(), createdAt: now, incidentId: null, test: true
    };
    state.reports.push(report);
    const key = zoneKey(report);
    let incident = state.incidents.find(i => zoneKey(i) === key && i.status !== 'Устранено');
    if (incident) {
      report.incidentId = incident.id;
    } else {
      const matching = recentPending(state, now).filter(r => zoneKey(r) === key);
      if (uniqueResidents(matching) >= 3) {
        incident = {id: 'И-' + state.nextIncident++, buildingId: report.buildingId,
          unitId: report.unitId, floor: report.floor, category: CATEGORY, createdAt: now,
          updatedAt: now, status: 'Проверяется', history: [{status: 'Проверяется', at: now}], test: true};
        state.incidents.push(incident);
        matching.forEach(r => {r.incidentId = incident.id;});
      }
    }
    return {report, incident};
  }
  function setStatus(state, id, status, now = Date.now()) {
    const incident = state.incidents.find(i => i.id === id);
    if (!incident || !STATUSES.includes(status)) throw new Error('Неизвестный инцидент или статус.');
    // A resolved incident stays in history. A new wave needs three fresh residents.
    if (incident.status === 'Устранено' && status !== 'Устранено') throw new Error('Инцидент уже устранён. Для новой проблемы создайте обращения.');
    if (incident.status !== status) {
      incident.status = status;
      incident.updatedAt = now;
      incident.history.push({status, at: now});
    }
    return incident;
  }
  function validate(state) {
    if (!state || state.version !== 1 || !Array.isArray(state.reports) || !Array.isArray(state.incidents) ||
      !Number.isSafeInteger(state.nextReport) || state.nextReport < 1 || !Number.isSafeInteger(state.nextIncident) || state.nextIncident < 1) return false;
    const validId = (id, prefix, next) => typeof id === 'string' && new RegExp('^' + prefix + '-[1-9][0-9]*$').test(id) && Number(id.slice(2)) < next;
    if (new Set(state.reports.map(r => r?.id)).size !== state.reports.length || new Set(state.incidents.map(i => i?.id)).size !== state.incidents.length) return false;
    if (!state.incidents.every(i => i && validId(i.id, 'И', state.nextIncident) && i.category === CATEGORY &&
      validLocation({...i, place: BUILDINGS.find(b => b.id === i.buildingId)?.units.find(u => u.id === i.unitId)?.floors.find(f => f.number === i.floor)?.places[0]}) &&
      STATUSES.includes(i.status) && Number.isFinite(i.createdAt) && Number.isFinite(i.updatedAt) &&
      Array.isArray(i.history) && i.history.length && i.history.every(h => h && STATUSES.includes(h.status) && Number.isFinite(h.at)))) return false;
    const activeKeys = state.incidents.filter(i => i.status !== 'Устранено').map(zoneKey);
    if (new Set(activeKeys).size !== activeKeys.length) return false;
    return state.reports.every(r => r && validId(r.id, 'О', state.nextReport) && validLocation(r) && r.category === CATEGORY &&
      USERS.some(u => u.id === r.userId) && typeof r.description === 'string' && r.description.trim().length > 0 && r.description.length <= 300 &&
      Number.isFinite(r.createdAt) && (r.incidentId === null || state.incidents.some(i => i.id === r.incidentId && zoneKey(i) === zoneKey(r))));
  }
  const api = {WINDOW_MS, CATEGORY, STATUSES, BUILDINGS, USERS, empty, zoneKey, uniqueResidents, validLocation, recentPending, groups, addReport, setStatus, validate};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DomPulse = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
