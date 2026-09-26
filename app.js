(function () {
  'use strict';
  const M = window.DomPulse;
  const KEY = 'dompulse-demo-v1';
  const $ = id => document.getElementById(id);
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const building = M.BUILDINGS[0];
  let state = M.empty();
  let screen = 'home';
  let role = 'admin';
  let userId = M.USERS[0].id;
  let demoRunning = false;
  function warning(message) {
    $('storage-warning').textContent = message;
    $('storage-warning').hidden = !message;
  }
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (!M.validate(parsed)) throw new Error('Invalid saved data');
      state = parsed;
    }
  } catch (_) {
    warning('Не удалось прочитать локальные данные. Открыто пустое демо; проверьте сохранение или сбросьте демо.');
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); warning(''); return true; }
    catch (_) { warning('Сохранение недоступно. Изменения работают только до закрытия или перезагрузки страницы.'); return false; }
  }
  function toast(message) {
    $('toast').textContent = message;
    $('toast').classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => $('toast').classList.remove('show'), 3200);
  }
  const time = value => new Date(value).toLocaleString('ru-RU', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'});
  const userName = id => M.USERS.find(u => u.id === id)?.name || 'Демо-житель';
  const zone = r => `${M.BUILDINGS.find(b => b.id === r.buildingId)?.units.find(u => u.id === r.unitId)?.name} · этаж ${r.floor}`;
  const empty = (title, text) => `<div class="empty-state"><strong>${esc(title)}</strong>${esc(text)}</div>`;
  const statusChip = status => `<span class="chip ${status === 'Устранено' ? 'green' : 'blue'}"><span class="dot"></span>${esc(status)}</span>`;
  function incidentCard(i, admin = false) {
    const rows = state.reports.filter(r => r.incidentId === i.id);
    return `<article class="card incident" data-incident="${esc(i.id)}">
      <div class="card-heading"><span class="record-id">${esc(i.id)} · ТЕСТОВЫЙ ИНЦИДЕНТ</span>${statusChip(i.status)}</div>
      <h4>Возможная общая проблема с холодной водой</h4><p>${esc(zone(i))}</p>
      <p class="card-meta">Похожие обращения: ${rows.length} · разных жителей: ${M.uniqueResidents(rows)}</p>
      <p class="card-meta">Создан ${time(i.createdAt)}</p>
      <p class="explanation">${i.status === 'Устранено' ? 'Администратор отметил устранение в демо. Реальные работы не подтверждены.' : 'Возможная общая проблема. УК должна проверить её причину. Автоматически проблема не подтверждается.'}</p>
      ${admin ? `<label class="f-label" for="status-${esc(i.id)}">Статус инцидента</label><select id="status-${esc(i.id)}" class="field status-select" data-status="${esc(i.id)}" ${i.status === 'Устранено' ? 'disabled' : ''}>${M.STATUSES.map(s => `<option ${i.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select><div class="history">${i.history.map(h => `${time(h.at)} — ${esc(h.status)}`).join('<br>')}</div>` : `<p class="card-meta">${i.history.length > 1 ? 'Обновлено администратором · ' + time(i.updatedAt) : 'Ожидает проверки администратором'}</p>`}
    </article>`;
  }
  function pendingCards() {
    const groups = M.groups(state);
    return groups.length ? groups.map(rows => {
      const count = M.uniqueResidents(rows);
      return `<article class="card pending-card"><div class="card-heading"><b>${esc(zone(rows[0]))}</b><span class="pending-count">${count} из 3</span></div><p>${M.CATEGORY}</p><div class="progress-dots" aria-hidden="true">${[1, 2, 3].map(n => `<span class="${count >= n ? 'filled' : ''}"></span>`).join('')}</div><p class="card-meta">Похожие обращения: ${rows.length}, от разных жителей: ${count}, за последние 20 минут. Общий инцидент появится после третьего жителя.</p></article>`;
    }).join('') : empty('Нет необъединённых обращений за 20 минут', 'Сообщения из одной зоны появятся здесь до объединения в инцидент.');
  }
  function reportCard(r) {
    const incident = state.incidents.find(i => i.id === r.incidentId);
    const group = M.recentPending(state).filter(other => M.zoneKey(other) === M.zoneKey(r));
    const count = M.uniqueResidents(group);
    const expired = Date.now() - r.createdAt > M.WINDOW_MS;
    return `<article class="card report-card" data-report="${esc(r.id)}"><div class="card-heading"><span class="record-id">${esc(r.id)} · ТЕСТОВОЕ ОБРАЩЕНИЕ</span>${incident ? statusChip(incident.status) : '<span class="chip blue">Получено локально</span>'}</div><h4>${esc(r.category)}</h4><p>${esc(zone(r))} · ${esc(r.place)}</p><p class="card-meta">${esc(userName(r.userId))} · ${time(r.createdAt)}</p><p class="report-description">${esc(r.description)}</p><div class="report-state">${incident ? `В общем инциденте ${esc(incident.id)} · ${esc(incident.status)}` : expired ? '20 минут истекли. Обращение сохранено в истории и не участвует в новом объединении.' : `Похожие обращения: ${count} из 3 разных жителей за 20 минут. Повторные сообщения одного жителя не увеличивают порог.`}</div></article>`;
  }
  function render() {
    const active = state.incidents.filter(i => i.status !== 'Устранено').slice().reverse();
    const resolved = state.incidents.filter(i => i.status === 'Устранено').slice().reverse();
    $('active-count').textContent = active.length;
    $('home-incidents').innerHTML = active.map(i => incidentCard(i)).join('') || empty('Общих инцидентов пока нет', 'Это не означает, что проблем нет. Сообщите, если у вас отсутствует холодная вода.');
    $('home-resolved').innerHTML = resolved.map(i => incidentCard(i)).join('') || empty('Здесь будет история', 'Устранённые инциденты останутся доступны жителям.');
    $('home-pending').innerHTML = pendingCards();
    $('admin-pending').innerHTML = pendingCards();
    $('admin-incidents').innerHTML = [...active, ...resolved].map(i => incidentCard(i, true)).join('') || empty('Объединённых инцидентов пока нет', 'Добавьте тестовые обращения в одной зоне.');
    const reports = state.reports.slice().reverse();
    $('my-reports').innerHTML = reports.filter(r => r.userId === userId).map(reportCard).join('') || empty(`У ${userName(userId)} пока нет обращений`, 'Нажмите «Сообщить о проблеме» на главной или «＋ Заявка».');
    $('admin-reports').innerHTML = reports.map(reportCard).join('') || empty('Список обращений пуст', 'Здесь будут все тестовые обращения жителей.');
    $('admin-tab').hidden = role !== 'admin';
  }
  function show(name, focus = false) {
    if (name === 'admin' && role !== 'admin') name = 'home';
    screen = name;
    document.querySelector('.sheet').hidden = false;
    document.querySelectorAll('.chat, .chat-head').forEach(el => {el.inert = true;});
    document.querySelectorAll('.state').forEach(el => el.classList.toggle('active', el.id === 'state-' + screen));
    document.querySelectorAll('.tabbar [data-screen]').forEach(el => {
      el.classList.toggle('active', el.dataset.screen === screen);
      if (el.dataset.screen === screen) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    });
    render();
    document.querySelector('.states').scrollTop = 0;
    if (focus) {
      const heading = $('state-' + screen).querySelector('h3');
      heading.tabIndex = -1;
      heading.focus({preventScroll: true});
    }
  }
  function fillLocations() {
    const unit = building.units.find(u => u.id === $('unit').value);
    const oldFloor = Number($('floor').value);
    $('floor').innerHTML = unit.floors.map(f => `<option value="${f.number}">${f.number}</option>`).join('');
    if (unit.floors.some(f => f.number === oldFloor)) $('floor').value = oldFloor;
    fillPlaces();
  }
  function fillPlaces() {
    const floor = building.units.find(u => u.id === $('unit').value).floors.find(f => f.number === Number($('floor').value));
    $('place').innerHTML = floor.places.map(p => `<option>${esc(p)}</option>`).join('');
  }
  $('user-select').innerHTML = M.USERS.map(u => `<option value="${u.id}">${u.name} · тестовый житель</option>`).join('');
  $('unit').innerHTML = building.units.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
  fillLocations();
  const demoZones = building.units.flatMap(u => u.floors.map(f => ({buildingId: building.id, unitId: u.id, floor: f.number, place: f.places[0], category: M.CATEGORY})));
  $('demo-zone').innerHTML = demoZones.map((z, n) => `<option value="${n}">${esc(zone(z))}</option>`).join('');
  $('unit').addEventListener('change', fillLocations);
  $('floor').addEventListener('change', fillPlaces);
  $('role-select').addEventListener('change', () => {
    role = $('role-select').value;
    $('submission-result').hidden = true;
    show(role === 'admin' ? 'admin' : 'home', true);
  });
  $('user-select').addEventListener('change', () => {
    userId = $('user-select').value;
    $('submission-result').hidden = true;
    render();
  });
  document.addEventListener('click', e => {
    const nav = e.target.closest('[data-screen]');
    if (nav) show(nav.dataset.screen, true);
  });
  $('open-chat').addEventListener('click', () => {
    document.querySelector('.sheet').hidden = true;
    document.querySelectorAll('.chat, .chat-head').forEach(el => {el.inert = false;});
    document.querySelector('.mini-link').focus();
  });
  $('start-demo').addEventListener('click', () => {
    show('home');
    $('phone').scrollIntoView({behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center'});
    $('phone').focus({preventScroll: true});
  });
  $('report-form').addEventListener('submit', e => {
    e.preventDefault();
    try {
      const result = M.addReport(state, {buildingId: building.id, unitId: $('unit').value, floor: Number($('floor').value), place: $('place').value, category: M.CATEGORY, userId, description: $('description').value});
      const saved = save();
      $('form-error').classList.remove('show');
      $('description').removeAttribute('aria-invalid');
      $('description').value = '';
      const idx = demoZones.findIndex(z => M.zoneKey(z) === M.zoneKey(result.report));
      $('demo-zone').value = idx;
      $('submission-result').textContent = `Обращение ${result.report.id} ${saved ? 'сохранено в этом браузере' : 'добавлено только на время этой сессии'}. ${result.incident ? 'Присоединено к общему инциденту ' + result.incident.id + '.' : 'Проверяем похожие обращения от других демо-жителей.'} В УК не отправлено.`;
      $('submission-result').hidden = false;
      show('reports', true);
    } catch (error) {
      $('form-error').textContent = error.message;
      $('form-error').classList.add('show');
      $('description').setAttribute('aria-invalid', 'true');
      $('description').focus();
    }
  });
  $('admin-incidents').addEventListener('change', e => {
    if (role !== 'admin' || !e.target.dataset.status) return;
    const id = e.target.dataset.status;
    try {
      const status = e.target.value;
      M.setStatus(state, id, status);
      save(); render();
      toast(`${id}: ${status}. Статус обновлён у жителей в этом браузере.`);
    } catch (error) {toast(error.message); render();}
  });
  $('seed-demo').addEventListener('click', async () => {
    if (role !== 'admin' || demoRunning) return;
    demoRunning = true;
    const controls = ['seed-demo', 'demo-zone', 'role-select', 'user-select', 'reset-demo'];
    controls.forEach(id => {$(id).disabled = true;});
    const target = demoZones[Number($('demo-zone').value)];
    const key = M.zoneKey(target);
    $('reset-confirm').hidden = true;
    let trace = [];
    try {
      const active = state.incidents.find(i => M.zoneKey(i) === key && i.status !== 'Устранено');
      if (active) {
        $('demo-progress').textContent = `В этой зоне уже открыт ${active.id}. Второй активный инцидент не создаётся. Добавить сообщение можно через форму.`;
        return;
      }
      const present = new Set(M.recentPending(state).filter(r => M.zoneKey(r) === key).map(r => r.userId));
      if (present.size) trace.push(`${present.size}/3 — уже есть обращения`);
      for (const u of M.USERS.filter(u => !present.has(u.id))) {
        const result = M.addReport(state, {...target, userId: u.id, description: 'Тест: в общей зоне нет холодной воды.'});
        save(); present.add(u.id);
        trace.push(`${present.size}/3 — ${u.name}, ${result.report.id}`);
        if (result.incident) trace.push(`→ Общий инцидент ${result.incident.id}: Проверяется. Возможная общая проблема.`);
        $('demo-progress').textContent = trace.join(' · ');
        render();
        // Short visible stages demonstrate the threshold, with no simulated network request.
        await new Promise(resolve => setTimeout(resolve, 650));
      }
      toast('Три разных жителя → один общий инцидент');
    } finally {
      demoRunning = false;
      controls.forEach(id => {$(id).disabled = false;});
    }
  });
  $('reset-demo').addEventListener('click', () => {
    if (role !== 'admin' || demoRunning) return;
    $('reset-confirm').hidden = false;
    $('confirm-reset').focus();
  });
  $('cancel-reset').addEventListener('click', () => {$('reset-confirm').hidden = true; $('reset-demo').focus();});
  $('confirm-reset').addEventListener('click', () => {
    if (role !== 'admin' || demoRunning) return;
    state = M.empty(); save();
    $('reset-confirm').hidden = true;
    $('submission-result').hidden = true;
    $('description').value = '';
    $('form-error').classList.remove('show');
    $('demo-progress').textContent = '1 → 2 → 3 жителя → один инцидент';
    render(); toast('Тестовые данные ДомПульса сброшены');
    $('reset-demo').focus();
  });
  // Refresh age-sensitive pending groups without touching a form the user is typing.
  setInterval(() => {if (!document.hidden && screen !== 'create' && !demoRunning && !document.activeElement.matches('select, button')) render();}, 15000);
  $('role-select').value = 'admin';
  show('admin');
})();
