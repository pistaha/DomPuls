(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const screens = ['home', 'create', 'reports', 'admin'];
  let reports = [];

  function show(name) {
    if (!screens.includes(name)) return;
    for (const screen of screens) $('state-' + screen).classList.toggle('active', screen === name);
    for (const button of document.querySelectorAll('.tabbar [data-go]')) {
      const selected = button.dataset.go === name;
      button.classList.toggle('active', selected);
      if (selected) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    $('showcase-scroll').scrollTop = 0;
  }

  function reportCard(report) {
    const article = document.createElement('article');
    article.className = 'card report-card';
    const heading = document.createElement('div');
    heading.className = 'card-heading';
    const icon = document.createElement('span');
    icon.className = 'card-symbol';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '◉';
    const status = document.createElement('span');
    status.className = 'chip blue';
    status.textContent = 'Отправлено';
    heading.append(icon, status);
    const title = document.createElement('h3');
    title.textContent = report.category;
    const place = document.createElement('p');
    place.className = 'card-place';
    place.textContent = report.place;
    const date = document.createElement('p');
    date.className = 'card-meta';
    date.textContent = report.time;
    const info = document.createElement('p');
    info.className = 'report-state';
    info.textContent = 'Обращение добавлено. Если появятся похожие сообщения, вы увидите их в разделе «Дом».';
    const description = document.createElement('p');
    description.className = 'report-description';
    description.textContent = report.description;
    article.append(heading, title, place, date, info, description);
    return article;
  }

  function renderReports() {
    const list = $('report-list');
    if (!reports.length) return;
    list.replaceChildren(...reports.map(reportCard));
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-go]');
    if (button) show(button.dataset.go);
  });

  $('report-form').addEventListener('submit', event => {
    event.preventDefault();
    const description = $('description').value.trim();
    const place = $('place').value;
    if (!place || !description) {
      $('report-form').reportValidity();
      return;
    }
    reports.unshift({
      category: $('category').value,
      place,
      description,
      time: new Intl.DateTimeFormat('ru-RU', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}).format(new Date())
    });
    renderReports();
    $('description').value = '';
    $('place').value = '';
    $('submission-result').hidden = false;
    show('reports');
  });

  $('incident-status').addEventListener('change', event => {
    const status = event.target.value;
    for (const id of ['home-status', 'admin-status-chip']) {
      const chip = $(id);
      chip.textContent = status;
      chip.classList.toggle('green', status === 'Устранено');
      chip.classList.toggle('blue', status !== 'Устранено');
    }
    const incident = $('home-incident');
    const resolved = $('resolved-list');
    if (status === 'Устранено') {
      resolved.replaceChildren(incident);
      $('active-count').textContent = '0';
      incident.querySelector('.explanation').textContent = 'Администратор отметил проблему как устранённую.';
    } else {
      $('pending-heading').before(incident);
      resolved.innerHTML = '<div class="empty-state"><strong>Пока ничего нет</strong>Здесь появятся проблемы, которые отметят как устранённые.</div>';
      $('active-count').textContent = '1';
      incident.querySelector('.explanation').textContent = status === 'Мастер вызван' ? 'Администратор отметил, что мастер вызван. Причина проблемы ещё проверяется.' : 'Несколько жителей сообщили об одной проблеме. Причину ещё нужно проверить.';
    }
  });
})();
