(async function () {
  'use strict';
  const launchContext=await window.DomPulseLaunch;
  if(launchContext?.error)document.body.classList.add('embedded');
  if(!document.body.classList.contains('embedded')&&!launchContext?.initData&&!launchContext?.error)return;
  const $=id=>document.getElementById(id);
  const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const time=v=>new Date(v).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
  let config,session={authenticated:false,admin:false,hasBuildingAccess:false},sessionToken='',data={incidents:[],pending:[]},screen='home',pendingRequest=null,busy=false,requestEpoch=0,stateLoaded=false,stateFailed=false;
  const pages={reports:{items:[],nextCursor:null,hasMore:false,loaded:false,failed:false},resolved:{items:[],nextCursor:null,hasMore:false,loaded:false,failed:false},admin:{items:[],nextCursor:null,hasMore:false,loaded:false,failed:false}};
  const pageRequests={reports:0,resolved:0,admin:0};
  const previewReports=[];
  let showLocalLogin=false;
  function error(message) {$('error').textContent=message;$('error').hidden=!message;}
  async function api(url,method='GET',payload) {
    let response;
    try {response=await fetch(url,{method,credentials:'same-origin',headers:{'X-DomPulse-Request':'1',...(sessionToken?{Authorization:'Bearer '+sessionToken}:{}),...(payload?{'Content-Type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(12000)});}
    catch (_) {throw new Error('Сервер недоступен. Проверьте сеть; текст формы сохранён на экране.');}
    let result;try {result=await response.json();} catch (_) {throw new Error('Сервис временно недоступен. Повторите позже или сообщите команде проекта.');}
    if (!response.ok) {const e=new Error(result.error||'Запрос не выполнен.');e.status=response.status;throw e;}
    return result;
  }
  function toast(message) {$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').classList.remove('show'),3000);}
  const building=()=>config.buildings.find(b=>b.id===$('building').value);
  const syncBuildingLabel=()=>{$('building-current').textContent=$('building').selectedOptions[0]?.textContent||'';};
  function showPreview(name,focus=false) {
    const panel=document.querySelector(`[data-preview-screen="${name}"]`);
    if(!panel)return;
    document.querySelectorAll('[data-preview-screen]').forEach(el=>{el.hidden=el!==panel;});
    document.querySelectorAll('[data-preview-tab]').forEach(el=>{
      const selected=el.dataset.previewTab===name;
      el.classList.toggle('selected',selected);el.setAttribute('aria-selected',String(selected));el.tabIndex=selected?0:-1;
    });
    if(focus){const heading=panel.querySelector('h3');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}}
  }
  function renderPreviewReports() {
    const list=$('preview-report-list');
    list.innerHTML=previewReports.length?previewReports.map(r=>`<article class="preview-report"><b>${esc(r.category)}</b><p>${esc(r.place)} · ${esc(r.description)}</p><p>Пример создан в этом браузере. Сервер его не получал.</p></article>`).join(''):'<div class="preview-empty">В этом примере вы ещё не отправляли обращений.</div>';
  }
  const empty=(title,body)=>`<div class="empty-state"><strong>${esc(title)}</strong>${esc(body)}</div>`;
  const loading=()=>'<div class="empty-state is-loading" role="status">Загружаем данные…</div>';
  const failed=()=>empty('Не удалось загрузить данные','Нажмите кнопку обновления вверху.');
  const stateBody=(items,emptyText)=>!stateLoaded?loading():stateFailed?failed():items||emptyText;
  const pageBody=(page,items,emptyText)=>!page.loaded?loading():page.failed?failed():items||emptyText;
  const countWord=n=>n%10===1&&n%100!==11?'обращение':n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?'обращения':'обращений';
  const problemIcon='<span class="card-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"><path d="M12 3C9.2 7.2 6 10.6 6 14.2a6 6 0 0 0 12 0C18 10.6 14.8 7.2 12 3Z" stroke="#2878F0"/><path d="m5 20 14-16" stroke="#E55761"/></svg></span>';
  const chip=status=>`<span class="chip ${status==='Устранено'?'green':'blue'}">${esc(status)}</span>`;
  const moreButton=(kind,page)=>page.hasMore?`<button class="more-button" type="button" data-more-page="${kind}">Показать ещё</button>`:'';
  const reportCard=r=>`<article class="card report-card"><div class="card-heading">${problemIcon}${r.incidentId?'<span class="chip amber">Возможный общий инцидент</span>':chip(r.status||'Отправлено')}</div><h4>${esc(r.category)}</h4><p class="card-place">${esc(r.zoneLabel)}${r.zoneLabel===r.place?'':' · '+esc(r.place)}</p><p class="card-meta">${time(r.createdAt)}</p>${r.incidentId?`<p class="report-state">Статус: ${esc(r.status||'Проверяется')}. Совпали категория, место и время.</p>`:r.expired?'<p class="report-state">За 20 минут общий инцидент не появился.</p>':`<p class="report-state">Похожих обращений: ${r.similarResidents} из 3 разных участников.</p>`}<p class="report-description">${esc(r.description)}</p></article>`;
  function incident(i,admin=false) {
    return `<article class="card incident"><div class="card-heading">${problemIcon}${chip(i.status)}</div><h4>${esc(i.title)}</h4><p class="card-place">${esc(i.zoneLabel)}</p><p class="card-meta">${i.uniqueCount} разных участников · ${i.count} ${countWord(i.count)}</p><p class="card-meta">С ${time(i.createdAt)}</p><p class="explanation">${i.status==='Устранено'?'Администратор отметил статус «Устранено».':'Совпали категория проблемы, выбранное место и время. Точное место и причина неизвестны.'}</p>${admin?`<label class="f-label" for="status-${i.id}">Статус</label><select class="field" id="status-${i.id}" data-status="${i.id}" ${i.status==='Устранено'?'disabled':''}>${['Проверяется','Мастер вызван','Устранено'].map(s=>`<option ${s===i.status?'selected':''}>${s}</option>`).join('')}</select><p class="card-meta">Статус отмечает администратор проекта.</p><p class="history">${i.history.map(h=>`${time(h.at)} — ${esc(h.status)}`).join('<br>')}</p>`:`<p class="card-meta">Статус отмечен администратором проекта · ${time(i.updatedAt)}</p>`}</article>`;
  }
  function render() {
    const active=data.incidents.filter(i=>i.status!=='Устранено');
    $('active-count').textContent=active.length;
    $('home-title').textContent=stateLoaded&&active.length?'Есть похожие обращения':'Что происходит в доме';
    $('home-incidents').innerHTML=stateBody(active.map(i=>incident(i)).join(''),empty('Возможных общих инцидентов нет','Если заметили проблему, отправьте обращение.'));
    $('home-resolved').innerHTML=pageBody(pages.resolved,pages.resolved.items.map(i=>incident(i)).join(''),empty('Пока ничего нет','Здесь появятся инциденты со статусом «Устранено».'))+moreButton('resolved',pages.resolved);
    $('home-pending').innerHTML=stateBody(data.pending.map(p=>`<article class="card pending-card"><div class="card-heading">${problemIcon}<span class="chip blue">Похожие обращения</span></div><h4>${esc(p.category)}</h4><p class="card-place">${esc(p.zoneLabel)}</p><p class="pending-count">${p.uniqueCount} из 3 разных участников</p><div class="progress-dots" aria-hidden="true">${[1,2,3].map(n=>`<span class="${p.uniqueCount>=n?'filled':''}"></span>`).join('')}</div><p class="card-meta">${p.count} ${countWord(p.count)} за последние 20 минут</p></article>`).join(''),empty('Пока нет похожих обращений','Сообщения за последние 20 минут появятся здесь.'));
    $('my-reports').innerHTML=pageBody(pages.reports,pages.reports.items.map(reportCard).join(''),empty('У вас пока нет обращений','Если заметили проблему, отправьте обращение.'))+moreButton('reports',pages.reports);
    $('admin-incidents').innerHTML=session.admin?pageBody(pages.admin,pages.admin.items.map(i=>incident(i,true)).join(''),empty('Общих сигналов пока нет','Здесь появятся возможные общие инциденты.'))+moreButton('admin',pages.admin):'';
  }
  function show(name) {
    if (!session.authenticated) return;
    if (name==='admin'&&!session.admin) return;
    screen=name;
    document.querySelectorAll('.state').forEach(el=>el.classList.toggle('active',el.id==='state-'+name));
    document.querySelectorAll('[data-screen]').forEach(el=>{if(el.classList.contains('tab')){el.classList.toggle('active',el.dataset.screen===name);if(el.dataset.screen===name)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');}});
    document.querySelector('.states').scrollTop=0;
    const h=$('state-'+name).querySelector('h3');h.tabIndex=-1;h.focus({preventScroll:true});
  }
  function authView() {
    if(session.source==='max')document.body.classList.add('embedded');
    const preview=!session.authenticated&&!document.body.classList.contains('embedded')&&!(config?.development&&showLocalLogin);
    $('app-loading').hidden=true;$('public-preview').hidden=!preview;$('login-panel').hidden=session.authenticated||preview;$('refresh').hidden=preview||!session.authenticated;
    $('preview-to-login').hidden=!preview||!config?.development;$('login-to-preview').hidden=preview||!config?.development;
    $('access-blocked').hidden=!(session.authenticated&&!session.hasBuildingAccess);
    $('app-content').hidden=!session.authenticated||!session.hasBuildingAccess;$('app-nav').hidden=!session.authenticated||!session.hasBuildingAccess;$('admin-tab').hidden=!session.admin;
    $('dev-login').hidden=!config?.development;
    for(const id of ['open-max-app','preview-open-max-app']){
      const link=$(id);link.hidden=!config?.maxAppUrl||session.authenticated||!!config?.development;
      if(config?.maxAppUrl)link.href=config.maxAppUrl;
    }
    $('mode-badge').textContent=preview?'Пример':config?.development?'Разработка':'Пилот';
    $('login-note').textContent=config?.development?'Войдите тестовым участником, чтобы проверить рабочую форму и статусы.':'Запустить приложение и отправить обращение можно из чата выданного бота MAX.';
  }
  async function refresh() {
    if (!session.authenticated||!session.hasBuildingAccess||busy) return;
    const current=++requestEpoch, id=$('building').value;
    try {
      const next=await api('/api/state?buildingId='+encodeURIComponent(id));
      if(current!==requestEpoch||id!==$('building').value||!session.authenticated)return;
      data=next;stateLoaded=true;stateFailed=false;error('');render();
    } catch(e) {if(current!==requestEpoch)return;stateLoaded=true;stateFailed=true;render();error(e.message);if(e.status===401){sessionToken='';session={authenticated:false,admin:false};authView();}}
  }
  function fillUnits() {
    const b=building(), byPlace=config.grouping==='reported-place';
    $('location-details').hidden=byPlace;
    for(const id of ['unit','floor','zone'])$(id).disabled=byPlace;
    if(byPlace){
      $('topology-note').textContent=b.description+' '+config.note;
      $('place').innerHTML='<option value="">Выберите место</option>'+b.places.map(p=>`<option>${esc(p.name)}</option>`).join('');
      return;
    }
    $('unit').innerHTML=b.units.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('');$('topology-note').textContent=config.synthetic?'Условная структура для разработки, не план здания.':b.description||'Настроенные командой общие зоны';fillFloors();}
  function fillFloors() {const floors=[...new Set(building().zones.filter(z=>z.unitId===$('unit').value).map(z=>z.floor))].sort((a,b)=>a-b);$('floor').innerHTML=floors.map(f=>`<option value="${f}">${f}</option>`).join('');fillZones();}
  function fillZones() {$('zone').innerHTML=building().zones.filter(z=>z.unitId===$('unit').value&&z.floor===Number($('floor').value)).map(z=>`<option value="${z.id}">${esc(z.name)}</option>`).join('');fillPlaces();}
  function fillPlaces() {$('place').innerHTML=building().zones.find(z=>z.id===$('zone').value).places.map(p=>`<option>${esc(p)}</option>`).join('');}
  function resetPages() {for(const kind of Object.keys(pages)){pageRequests[kind]++;pages[kind]={items:[],nextCursor:null,hasMore:false,loaded:false,failed:false};}}
  async function loadPage(kind,more=false) {
    if(!session.authenticated||!session.hasBuildingAccess)return;
    const page=pages[kind],cursor=more?page.nextCursor:null;if(more&&!cursor)return;
    const request=++pageRequests[kind],buildingId=$('building').value;
    const endpoint=kind==='reports'?'/api/reports':`/api/incidents?status=${kind==='resolved'?'resolved':'all'}`;
    const params=`${endpoint.includes('?')?'&':'?'}buildingId=${encodeURIComponent(buildingId)}&limit=20${cursor?'&cursor='+encodeURIComponent(cursor):''}`;
    try {
      const result=await api(endpoint+params);
      if(request!==pageRequests[kind]||buildingId!==$('building').value)return;
      pages[kind]={items:more?[...page.items,...result.items]:result.items,nextCursor:result.nextCursor,hasMore:result.hasMore,loaded:true,failed:false};render();
    } catch(e){if(request===pageRequests[kind]){error(e.message);pages[kind].loaded=true;pages[kind].failed=!more;render();}}
  }
  async function loadInitialPages() {await Promise.all([loadPage('reports'),loadPage('resolved'),session.admin?loadPage('admin'):Promise.resolve()]);}
  async function loadScopedConfig() {
    const scoped=await api('/api/config');config={...config,...scoped};session.hasBuildingAccess=scoped.buildings.length>0;
    $('building').innerHTML=scoped.buildings.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('');
    syncBuildingLabel();
    if(session.hasBuildingAccess)fillUnits();
  }
  function clearPrivateView() {requestEpoch++;resetPages();data={incidents:[],pending:[]};stateLoaded=false;stateFailed=false;render();$('description').value='';pendingRequest=null;$('submission-result').hidden=true;}
  async function login(payload) {
    const result=await api('/api/session','POST',payload);
    sessionToken=result.sessionToken || '';
    session={authenticated:result.authenticated,admin:result.admin,source:result.source,hasBuildingAccess:false};
    await loadScopedConfig();error('');clearPrivateView();authView();
    if(!session.hasBuildingAccess){error('Доступ к дому для вашего MAX ID пока не настроен. Обратитесь к команде пилота.');return;}
    show('home');await refresh();await loadInitialPages();
  }
  $('dev-signin').addEventListener('click',async()=>{if(busy)return;busy=true;$('dev-signin').disabled=true;try {await login({devUser:$('dev-user').value});}catch(e){error(e.message);}finally{busy=false;$('dev-signin').disabled=false;await refresh();}});
  $('preview-to-login').addEventListener('click',()=>{showLocalLogin=true;authView();});
  $('login-to-preview').addEventListener('click',()=>{showLocalLogin=false;authView();});
  for(const id of ['open-max-app','preview-open-max-app'])$(id).addEventListener('click',e=>{
    if(typeof window.WebApp?.openMaxLink==='function'){
      e.preventDefault();window.WebApp.openMaxLink(e.currentTarget.href);
    }
  });
  async function signOut(){if(busy)return;try {await api('/api/session','DELETE');sessionToken='';session={authenticated:false,admin:false,hasBuildingAccess:false};clearPrivateView();authView();}catch(e){error(e.message);}}
  $('signout').addEventListener('click',signOut);$('blocked-signout').addEventListener('click',signOut);
  $('building').addEventListener('change',()=>{syncBuildingLabel();pendingRequest=null;resetPages();data={incidents:[],pending:[]};stateLoaded=false;stateFailed=false;render();fillUnits();$('submission-result').hidden=true;refresh();loadInitialPages();});
  $('unit').addEventListener('change',fillFloors);$('floor').addEventListener('change',fillZones);$('zone').addEventListener('change',fillPlaces);
  document.addEventListener('click',e=>{const button=e.target.closest('[data-more-page]');if(button){button.disabled=true;loadPage(button.dataset.morePage,true);}});
  document.addEventListener('click',e=>{const nav=e.target.closest('[data-screen]');if(nav)show(nav.dataset.screen);});
  document.addEventListener('click',e=>{
    const nav=e.target.closest('[data-preview-go]');if(nav)showPreview(nav.dataset.previewGo,true);
    const tab=e.target.closest('[data-preview-tab]');if(tab){showPreview(tab.dataset.previewTab);tab.focus();}
  });
  document.querySelector('[role="tablist"]')?.addEventListener('keydown',e=>{
    if(!e.target.matches('[data-preview-tab]'))return;
    const tabs=[...document.querySelectorAll('[data-preview-tab]')],current=tabs.indexOf(e.target);let next=current;
    if(e.key==='ArrowRight')next=(current+1)%tabs.length;else if(e.key==='ArrowLeft')next=(current+tabs.length-1)%tabs.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=tabs.length-1;else return;
    e.preventDefault();tabs[next].focus();showPreview(tabs[next].dataset.previewTab);
  });
  $('preview-report-form').addEventListener('submit',e=>{
    e.preventDefault();const place=$('preview-place').value,description=$('preview-description').value.trim();
    if(!place||!description){$('preview-form-error').textContent='Выберите место и добавьте короткое описание.';$('preview-form-error').hidden=false;return;}
    previewReports.unshift({category:$('preview-category').value,place,description});$('preview-description').value='';$('preview-form-error').hidden=true;renderPreviewReports();showPreview('reports',true);
  });
  $('start-app').addEventListener('click',()=>{$('phone').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});$('phone').focus({preventScroll:true});});
  $('refresh').addEventListener('click',()=>{error('');refresh();if(session.authenticated&&session.hasBuildingAccess)loadInitialPages();});
  $('description').addEventListener('input',()=>{try{if(window.WebApp?.initData)window.WebApp.enableClosingConfirmation();}catch(_){}});
  $('report-form').addEventListener('submit',async e=>{
    e.preventDefault();if(busy)return;
    const input={buildingId:$('building').value,zoneId:config.grouping==='reported-place'?building().places.find(p=>p.name===$('place').value)?.id:$('zone').value,place:$('place').value,category:$('category').value,description:$('description').value.trim()};
    if(!input.description){$('form-error').textContent='Добавьте описание без личных данных.';$('form-error').classList.add('show');return;}
    const signature=JSON.stringify(input);
    if(!pendingRequest||pendingRequest.signature!==signature)pendingRequest={signature,id:crypto.randomUUID()};
    busy=true;$('submit-report').disabled=true;$('submit-report').textContent='Сохраняем…';
    try {
      const result=await api('/api/reports','POST',{...input,requestId:pendingRequest.id});
      pendingRequest=null;error('');$('description').value='';$('form-error').classList.remove('show');
      $('submission-result').textContent=`Обращение сохранено.${result.incidentId?' Оно связано с возможным общим инцидентом.':''}`;$('submission-result').hidden=false;
      try{if(window.WebApp?.initData)window.WebApp.disableClosingConfirmation();}catch(_){}
      show('reports');await loadPage('reports');
    } catch(e){error(e.message);$('form-error').textContent='Не удалось подтвердить отправку. Повторите с теми же данными: обращение не сохранится дважды.';$('form-error').classList.add('show');}
    finally{busy=false;$('submit-report').disabled=false;$('submit-report').textContent='Отправить обращение';await refresh();}
  });
  $('admin-incidents').addEventListener('change',async e=>{
    const id=e.target.dataset.status;if(!id||busy)return;busy=true;e.target.disabled=true;
    try{await api(`/api/incidents/${id}/status`,'PATCH',{status:e.target.value});error('');toast('Статус сохранён.');}catch(errorValue){error(errorValue.message);}finally{busy=false;await refresh();if(session.admin)await Promise.all([loadPage('admin'),loadPage('resolved')]);}
  });
  try {
    config=await api('/api/config');
    const previewPlaces=config.buildings?.[0]?.places||[];
    $('preview-place').innerHTML='<option value="">Выберите место</option>'+previewPlaces.map(p=>`<option>${esc(p.name)}</option>`).join('');
    $('preview-place').disabled=previewPlaces.length===0;
    $('building').innerHTML=config.buildings.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('');syncBuildingLabel();fillUnits();
    const launch=await window.DomPulseLaunch;
    session=await api('/api/session');
    if(launch.error)throw new Error(launch.error);
    if(launch.initData){try{await login({initData:launch.initData});}finally{history.replaceState(null,'',location.pathname+location.search);launch.initData='';}}
    else if(session.authenticated){await loadScopedConfig();clearPrivateView();authView();if(session.hasBuildingAccess){await refresh();await loadInitialPages();}}
    else {session.hasBuildingAccess=false;authView();}
  } catch(e){session={authenticated:false,admin:false};if(config){clearPrivateView();authView();}else{$('app-loading').hidden=true;$('login-panel').hidden=false;}error(e.message);$('login-note').textContent=e.message;}
  setInterval(()=>{if(!document.hidden&&screen!=='create'&&!document.activeElement.matches('select')&&!busy)refresh();},5000);
})();
