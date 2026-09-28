const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,createHmac}=require('node:crypto');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {Store,WINDOW}=require('../server/store');
const {verifyInitData,userKey}=require('../server/auth');
const {loadConfig,validateBuildings}=require('../server/config');
const {createApp}=require('../server/index');
const {createBot,welcome}=require('../bot/handler');
const topology=require('../config/buildings.example.json');
const demo=require('../model');
const now=1800000000000;
const input=(extra={})=>({requestId:randomUUID(),buildingId:'vyazemsky',zoneId:'a-floor-1',place:'Общая кухня',category:'Нет холодной воды',description:'Нет воды',...extra});
function store(t){const s=new Store(':memory:',topology);t.after(()=>s.close());return s;}
function wave(s,at=now){for(const u of ['one','two','three'])s.add(u,input(),at);}
function signed(id,token='fixture-token',date=Math.floor(Date.now()/1000),extra={}){
  const p=new URLSearchParams({user:JSON.stringify({id,first_name:'Fixture private name'}),auth_date:String(date),query_id:'test-query',...extra});
  const sorted=[...p.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>k+'='+v).join('\n');
  const secret=createHmac('sha256','WebAppData').update(token).digest();
  p.set('hash',createHmac('sha256',secret).update(sorted).digest('hex'));return p.toString();
}
test('SQLite threshold counts three distinct users; repeats remain one signal',t=>{
  const s=store(t);s.add('one',input(),now);s.add('one',input(),now);s.add('two',input(),now);
  let snap=s.snapshot('one','vyazemsky',false,now);assert.equal(snap.incidents.length,0);assert.equal(snap.pending[0].uniqueCount,2);
  s.add('three',input(),now);snap=s.snapshot('one','vyazemsky',false,now);
  assert.equal(snap.incidents.length,1);assert.equal(snap.incidents[0].count,4);assert.equal(snap.incidents[0].uniqueCount,3);assert.equal(snap.incidents[0].status,'Проверяется');
});
test('explicit zones, buildings and categories are separated; adjacent floors never merge',t=>{
  const s=store(t);s.add('one',input(),now);s.add('two',input({zoneId:'a-floor-2'}),now);s.add('three',input({zoneId:'b-floor-1'}),now);
  assert.equal(s.snapshot('one','vyazemsky',false,now).incidents.length,0);
  assert.throws(()=>s.add('four',input({buildingId:'unknown'}),now));assert.throws(()=>s.add('four',input({category:'other'}),now));
  assert.throws(()=>s.add('four',input({userId:'forged-user'}),now));
});
test('20-minute boundary excludes older and future reports',t=>{
  const s=store(t);s.add('old',input(),now-WINDOW-1);s.add('one',input(),now-WINDOW);s.add('two',input(),now);s.add('future',input(),now+1000);
  assert.equal(s.snapshot('one','vyazemsky',false,now).pending[0].uniqueCount,2);
  s.add('three',input(),now);const snap=s.snapshot('old','vyazemsky',false,now);assert.equal(snap.incidents.length,1);assert.equal(snap.incidents[0].count,3);assert.equal(snap.mine[0].incidentId,null);
});
test('active incident has no duplicate; after resolution a fresh wave is required',t=>{
  const s=store(t);wave(s);s.add('four',input(),now+WINDOW+1);let snap=s.snapshot('one','vyazemsky',true,now+WINDOW+1);
  assert.equal(snap.incidents.length,1);assert.equal(snap.incidents[0].count,4);const id=snap.incidents[0].id;
  s.setStatus(id,'Мастер вызван',now+1);s.setStatus(id,'Устранено',now+2);
  s.add('one',input(),now+3);s.add('two',input(),now+3);assert.equal(s.snapshot('one','vyazemsky',false,now+3).incidents.length,1);
  s.add('three',input(),now+3);snap=s.snapshot('one','vyazemsky',true,now+3);assert.equal(snap.incidents.length,2);
  assert.throws(()=>s.setStatus(id,'Проверяется'));assert.throws(()=>s.setStatus(id,'confirmed'));assert.equal(snap.incidents.find(i=>i.id===id).history.length,3);
});
test('request retry is idempotent and changes with the same key are rejected',t=>{
  const s=store(t),r=input();const a=s.add('one',r,now),b=s.add('one',r,now+1);assert.equal(a.id,b.id);assert.equal(b.repeated,true);
  assert.throws(()=>s.add('one',{...r,description:'changed'},now));assert.equal(s.snapshot('one','vyazemsky',false,now).mine.length,1);
});
test('snapshots expose only owner descriptions and aggregates, including to administrator',t=>{
  const s=store(t);s.add('private-user-key',input({description:'PRIVATE OTHER DESCRIPTION'}),now);s.add('one',input(),now);s.add('two',input(),now);
  const snap=s.snapshot('one','vyazemsky',true,now),wire=JSON.stringify(snap);
  assert.equal(snap.mine.length,1);assert.ok(!wire.includes('PRIVATE OTHER'));assert.ok(!wire.includes('private-user-key'));assert.ok(!wire.includes('user_key'));
});
test('store pages incident and owner-report history by stable created_at/id cursors',t=>{
  const s=store(t),ids=[];
  const addIncident=s.db.prepare('INSERT INTO incidents VALUES (?,?,?,?,?,?,?,?)');
  const addReport=s.db.prepare('INSERT INTO reports VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  for(let n=0;n<55;n++){
    const id=randomUUID();ids.push(id);
    const zone='page-zone-'+n;
    addIncident.run(id,'vyazemsky',zone,'Общая кухня','Нет холодной воды',n===0?'Устранено':'Проверяется',now,now);
    addReport.run(randomUUID(),'page-owner',randomUUID(),'vyazemsky',zone,'Общая кухня','Общая кухня','Нет холодной воды','page report '+n,now,id);
  }
  const readAll=(fetchPage)=>{let cursor=null,all=[];do{const page=fetchPage({cursor,limit:20});all.push(...page.items);cursor=page.nextCursor;if(cursor)assert.equal(page.hasMore,true);else assert.equal(page.hasMore,false);}while(cursor);return all;};
  const first=s.incidentPage('vyazemsky',{limit:20},true),newer=randomUUID();
  addIncident.run(newer,'vyazemsky','newer-page-zone','Общая кухня','Нет холодной воды','Проверяется',now+1,now+1);
  let cursor=first.nextCursor,incidents=[...first.items];
  while(cursor){const page=s.incidentPage('vyazemsky',{cursor,limit:20},true);incidents.push(...page.items);cursor=page.nextCursor;}
  assert.equal(s.incidentPage('vyazemsky',{limit:20},true).items[0].id,newer);
  const reports=readAll(o=>s.reportPage('page-owner','vyazemsky',o,now));
  assert.equal(incidents.length,55);assert.deepEqual(new Set(incidents.map(i=>i.id)),new Set(ids));assert.ok(!incidents.some(i=>i.id===newer));
  assert.equal(reports.length,55);assert.equal(new Set(reports.map(r=>r.id)).size,55);
  assert.equal(s.incidentPage('vyazemsky',{limit:20,status:'resolved'}).items.length,1);
  assert.equal(s.currentState('vyazemsky',now+1).incidents.length,55);
  assert.throws(()=>s.reportPage('page-owner','vyazemsky',{cursor:'invalid!'}),/курсор/i);
});
test('demo create/status/reset cannot alter pilot database',t=>{
  const s=store(t);wave(s);const before=JSON.stringify(s.snapshot('one','vyazemsky',true,now));let d=demo.empty();
  for(const u of demo.USERS)demo.addReport(d,{buildingId:demo.BUILDINGS[0].id,unitId:'А',floor:1,place:'Общая кухня',category:demo.CATEGORY,userId:u.id,description:'Demo'},now);
  demo.setStatus(d,d.incidents[0].id,'Устранено');d=demo.empty();assert.equal(d.reports.length,0);
  assert.equal(JSON.stringify(s.snapshot('one','vyazemsky',true,now)),before);
});
test('SQLite survives reopen and refuses cross-environment reuse',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dompulse-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'test.sqlite');let s=new Store(file,topology,'pilot');wave(s);s.close();s=new Store(file,topology,'pilot');assert.equal(s.snapshot('one','vyazemsky',false,now).incidents.length,1);s.close();
  assert.throws(()=>new Store(file,topology,'development'));
});
test('MAX HMAC authenticates ID only; decoding order and unknown signed fields preserved',()=>{
  const raw=signed(42,'fixture-token',Math.floor(now/1000),{start_param:'space + ampersand & unicode Ж',chat:'{"id":123}'});
  assert.deepEqual(verifyInitData(raw,'fixture-token',now),{id:'42',expiresAt:now+3600000});assert.ok(!JSON.stringify(verifyInitData(raw,'fixture-token',now)).includes('Fixture'));
  assert.notEqual(userKey('max:42','secret'),userKey('max:43','secret'));
});
test('MAX rejects forgery, wrong token, duplicates, missing fields, age and unsafe IDs',()=>{
  const raw=signed(42,'fixture-token',Math.floor(now/1000));
  const bad=[raw.replace('42','43'),raw+'&hash='+new URLSearchParams(raw).get('hash'),raw+'&auth_date=1','user=x',signed(42,'fixture-token',Math.floor(now/1000)-3601),signed(42,'fixture-token',Math.floor(now/1000)+31),signed('42','fixture-token',Math.floor(now/1000)),signed(9007199254740992,'fixture-token',Math.floor(now/1000))];
  for(const r of bad)assert.throws(()=>verifyInitData(r,'fixture-token',now));assert.throws(()=>verifyInitData(raw,'wrong',now));assert.throws(()=>verifyInitData(raw,'',now));
});
test('production defaults fail closed; development only explicit and loopback',()=>{
  assert.throws(()=>loadConfig({}));assert.throws(()=>loadConfig({NODE_ENV:'production',PUBLIC_URL:'https://example.org'}));
  assert.throws(()=>loadConfig({NODE_ENV:'development',HOST:'0.0.0.0'}));
  assert.equal(loadConfig({NODE_ENV:'development'}).development,true);assert.throws(()=>validateBuildings({synthetic:true,buildings:[]}));
});
async function httpApp(t,development=true,appTopology=topology){
  const config={development,origin:'http://localhost',topology:appTopology,botToken:'fixture-token',hashSecret:'fixture-only-long-hash-secret-not-real',adminIds:new Set(['99']),buildingAccess:development?new Map():new Map([['42',appTopology.buildings.map(b=>b.id)],['99',appTopology.buildings.map(b=>b.id)]]),botUsername:'fixture_bot',miniAppUrl:'https://example.org/',webhookSecret:'fixture-webhook-secret-0123456789'};
  const app=createApp(config,{store:new Store(':memory:',appTopology,development?'development':'pilot'),fetch:async()=>({ok:true})});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.server.address().port;config.origin=base;
  t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const request=async(url,{method='GET',data,cookie='',origin=base,extra={}}={})=>{
    const response=await fetch(base+url,{method,headers:{Origin:origin,'X-DomPulse-Request':'1',...(data?{'Content-Type':'application/json'}:{}),Cookie:cookie,...extra},body:data?JSON.stringify(data):undefined});
    const text=await response.text();let body;try{body=JSON.parse(text);}catch{body=text;}
    return {status:response.status,body,cookie:response.headers.get('set-cookie')?.split(';')[0]};
  };
  return {request,app,config};
}
test('HTTP: production rejects dev bypass and forged data; admin cannot be self-assigned',async t=>{
  const {request}=await httpApp(t,false);
  assert.equal((await request('/api/session',{method:'POST',data:{devUser:'dev-admin'}})).status,401);
  assert.equal((await request('/api/session',{method:'POST',data:{initData:signed(99,'wrong')}})).status,401);
  const resident=await request('/api/session',{method:'POST',data:{initData:signed(42),admin:true}});assert.equal(resident.status,200);assert.equal(resident.body.admin,false);
  assert.equal((await request('/demo',{cookie:resident.cookie})).status,403);
  assert.equal((await request('/api/incidents/'+randomUUID()+'/status',{method:'PATCH',data:{status:'Устранено'},cookie:resident.cookie})).status,403);
  const admin=await request('/api/session',{method:'POST',data:{initData:signed(99)}});assert.equal(admin.body.admin,true);assert.equal((await request('/demo',{cookie:admin.cookie})).status,200);
});
test('HTTP: every verified MAX user can use the single-building pilot',async t=>{
  const {request}=await httpApp(t,false);
  const config=await request('/api/config');
  assert.equal(config.body.maxAppUrl,'https://max.ru/fixture_bot?startapp');
  assert.equal((await request('/api/state?buildingId=vyazemsky')).status,401);
  const login=await request('/api/session',{method:'POST',data:{initData:signed(42)}});
  assert.equal(login.status,200);
  assert.match(login.body.sessionToken,/^[a-f0-9]{64}$/);
  const auth={Authorization:'Bearer '+login.body.sessionToken};
  const live=await request('/api/state?buildingId=vyazemsky',{extra:auth});assert.equal(live.status,200);assert.ok(!('mine' in live.body));
  assert.equal((await request('/api/reports',{method:'POST',data:input(),extra:auth})).status,201);
  assert.equal((await request('/api/reports?buildingId=vyazemsky&limit=20',{extra:auth})).body.items.length,1);
  const anotherUser=await request('/api/session',{method:'POST',data:{initData:signed(43)}});assert.equal(anotherUser.status,200);
  const anotherUserAuth={Authorization:'Bearer '+anotherUser.body.sessionToken};
  assert.equal((await request('/api/config',{extra:anotherUserAuth})).body.buildings.length,1);
  assert.equal((await request('/api/state?buildingId=vyazemsky',{extra:anotherUserAuth})).status,200);
  assert.equal((await request('/api/reports',{method:'POST',data:input(),extra:anotherUserAuth})).status,201);
  assert.equal((await request('/api/incidents?buildingId=vyazemsky',{extra:anotherUserAuth})).status,200);
  assert.equal((await request('/api/incidents/'+randomUUID()+'/status',{method:'PATCH',data:{status:'Устранено'},extra:anotherUserAuth})).status,403);
  assert.equal((await request('/api/session',{method:'DELETE',extra:auth})).status,200);
  assert.equal((await request('/api/state?buildingId=vyazemsky',{extra:auth})).status,401);
  assert.equal((await request('/api/state?buildingId=vyazemsky',{extra:{Authorization:'Bearer '+'0'.repeat(64)}})).status,401);
});
test('HTTP multi-building deployments still restrict users to assigned buildings',async t=>{
  const multi={...topology,buildings:[topology.buildings[0],{...topology.buildings[0],id:'other-house',name:'Другое общежитие'}]};
  const {request,app,config}=await httpApp(t,false,multi);
  config.buildingAccess=new Map([['42',['vyazemsky']],['99',['vyazemsky']]]);
  app.store.add('seed-resident-1',input());app.store.add('seed-resident-2',input());
  const id=app.store.add('seed-resident-3',input()).incidentId;
  const resident=await request('/api/session',{method:'POST',data:{initData:signed(42)}});
  assert.deepEqual((await request('/api/config',{cookie:resident.cookie})).body.buildings.map(b=>b.id),['vyazemsky']);
  assert.equal((await request('/api/state?buildingId=other-house',{cookie:resident.cookie})).status,403);
  const admin=await request('/api/session',{method:'POST',data:{initData:signed(99)}});
  assert.equal(admin.body.admin,true);
  assert.equal((await request('/api/state?buildingId=other-house',{cookie:admin.cookie})).status,403);
  assert.equal((await request('/api/state?buildingId=vyazemsky',{cookie:admin.cookie})).body.incidents[0].id,id);
  const unassigned=await request('/api/session',{method:'POST',data:{initData:signed(43)}});
  assert.deepEqual((await request('/api/config',{cookie:unassigned.cookie})).body.buildings,[]);
  assert.equal((await request('/api/state?buildingId=vyazemsky',{cookie:unassigned.cookie})).status,403);
  assert.equal((await request('/api/state?buildingId=other-house',{cookie:unassigned.cookie})).status,403);
});
test('HTTP: independent participants share an incident; privacy, status and demo access enforced',async t=>{
  const {request}=await httpApp(t);const cookies=[];
  for(let i=1;i<=3;i++){const login=await request('/api/session',{method:'POST',data:{devUser:'dev-'+i}});cookies.push(login.cookie);const r=await request('/api/reports',{method:'POST',data:input({description:'Private-'+i}),cookie:login.cookie});assert.equal(r.status,201);}
  let state=await request('/api/state?buildingId=vyazemsky',{cookie:cookies[0]});assert.equal(state.body.incidents.length,1);assert.ok(!('mine' in state.body));
  let own=await request('/api/reports?buildingId=vyazemsky',{cookie:cookies[0]});assert.equal(own.body.items.length,1);assert.equal(own.body.items[0].description,'Private-1');assert.ok(!JSON.stringify(own.body).includes('Private-2'));
  assert.ok(!('history' in (await request('/api/incidents?buildingId=vyazemsky',{cookie:cookies[0]})).body.items[0]));
  const admin=await request('/api/session',{method:'POST',data:{devUser:'dev-admin'}});const id=state.body.incidents[0].id;
  assert.equal((await request('/api/incidents/'+id+'/status',{method:'PATCH',data:{status:'Мастер вызван'},cookie:admin.cookie})).status,200);
  own=await request('/api/reports?buildingId=vyazemsky',{cookie:cookies[1]});assert.equal(own.body.items[0].status,'Мастер вызван');
  const adminHistory=await request('/api/incidents?buildingId=vyazemsky',{cookie:admin.cookie});assert.equal(adminHistory.body.items.find(i=>i.id===id).history.length,2);
  assert.equal((await request('/api/demo/reset',{method:'POST',data:{},cookie:admin.cookie})).status,404);
  assert.equal((await request('/app.js',{cookie:cookies[0]})).status,403);assert.equal((await request('/demo',{cookie:admin.cookie})).status,200);
});
test('HTTP: secrets/source unavailable; CSRF, unauthenticated writes and webhook forgery rejected',async t=>{
  const {request}=await httpApp(t);
  for(const url of ['/.env','/data/pilot.sqlite','/server/auth.js','/.git/config'])assert.equal((await request(url)).status,404);
  assert.equal((await request('/api/reports',{method:'POST',data:input()})).status,401);
  assert.equal((await request('/api/session',{method:'POST',data:{devUser:'dev-admin'},origin:'https://evil.example'})).status,403);
  assert.equal((await request('/api/session',{method:'POST',data:{devUser:'dev-admin'},extra:{'X-DomPulse-Request':''}})).status,403);
  assert.equal((await request('/webhook/max',{method:'POST',data:{update_type:'bot_started'}})).status,403);
  assert.equal((await request('/webhook/max',{method:'POST',data:{update_type:'other'},extra:{'X-Max-Bot-Api-Secret':'fixture-webhook-secret-0123456789'}})).status,200);
});
test('bot prepares official open_app button, handles start and suppresses retry duplicates',async()=>{
  const calls=[];const config={botToken:'fake-only',botUsername:'fixture_bot'};const handle=createBot(config,async(url,options)=>{calls.push({url,options});return {ok:true};});
  const update={update_type:'bot_started',timestamp:1,user:{user_id:42,name:'PRIVATE NAME'}};
  await handle(update);await handle(update);assert.equal(calls.length,1);assert.ok(calls[0].url.startsWith('https://platform-api2.max.ru/messages'));
  assert.equal(welcome(config).attachments[0].payload.buttons[0][0].type,'open_app');assert.ok(!calls[0].options.body.includes('PRIVATE NAME'));
  await handle({update_type:'message_created',timestamp:2,message:{sender:{user_id:42},body:{text:'/start',mid:'m1'}}});assert.equal(calls.length,2);
  await handle({update_type:'message_created',message:{sender:{user_id:42},body:{text:'ordinary message'}}});assert.equal(calls.length,2);
});
test('two configured buildings with the same zone ID never combine',t=>{
  const both=structuredClone(topology);both.buildings.push({...structuredClone(topology.buildings[0]),id:'second-house',name:'Второй тестовый дом'});
  const s=new Store(':memory:',both);t.after(()=>s.close());s.add('one',input(),now);s.add('two',input(),now);s.add('three',input({buildingId:'second-house'}),now);
  assert.equal(s.snapshot('one','vyazemsky',false,now).incidents.length,0);assert.equal(s.snapshot('three','second-house',false,now).pending[0].uniqueCount,1);
});
test('configuration rejects units without selectable zones',()=>{
  const bad=structuredClone(topology);bad.buildings[0].units.push({id:'empty-unit',name:'Empty'});assert.throws(()=>validateBuildings(bad));
});
test('HTTP: expiry and logout revoke access; unexpected client identity is rejected',async t=>{
  const {request,app}=await httpApp(t);const login=await request('/api/session',{method:'POST',data:{devUser:'dev-1'}});
  assert.equal((await request('/api/reports',{method:'POST',data:input({userId:'dev-3'}),cookie:login.cookie})).status,400);
  const token=login.cookie.split('=')[1];app.sessions.items.get(token).expiresAt=Date.now()-1;
  assert.equal((await request('/api/state?buildingId=vyazemsky',{cookie:login.cookie})).status,401);
  const again=await request('/api/session',{method:'POST',data:{devUser:'dev-admin'}});
  assert.equal((await request('/api/session',{method:'DELETE',cookie:again.cookie})).status,200);
  assert.equal((await request('/demo',{cookie:again.cookie})).status,401);
});
test('HTTP polling limits are per verified user, not shared peer address',async t=>{
  const {request,app}=await httpApp(t);
  const tokens=Array.from({length:21},(_,n)=>app.sessions.create({userKey:'poll-fixture-'+n,admin:false,buildingIds:['vyazemsky'],source:'test',expiresAt:Date.now()+3600000}));
  for(let i=0;i<tokens.length;i++)for(let n=0;n<12;n++){
    const result=await request('/api/state?buildingId=vyazemsky',{extra:{Authorization:'Bearer '+tokens[i],'X-Forwarded-For':`198.51.100.${i+1}`}});
    assert.equal(result.status,200,`user ${i}, poll ${n}`);
  }
  const solo=app.sessions.create({userKey:'poll-solo',admin:false,buildingIds:['vyazemsky'],source:'test',expiresAt:Date.now()+3600000});
  for(let n=0;n<120;n++)assert.equal((await request('/api/state?buildingId=vyazemsky',{extra:{Authorization:'Bearer '+solo}})).status,200);
  assert.equal((await request('/api/state?buildingId=vyazemsky',{extra:{Authorization:'Bearer '+solo}})).status,429);
});
test('HTTP login brute-force limit stays on peer address even if X-Forwarded-For changes',async t=>{
  const {request}=await httpApp(t);
  for(let n=0;n<60;n++){
    const result=await request('/api/session',{method:'POST',data:{devUser:'unknown'},extra:{'X-Forwarded-For':`198.51.100.${n+1}`}});
    assert.equal(result.status,401);
  }
  assert.equal((await request('/api/session',{method:'POST',data:{devUser:'unknown'},extra:{'X-Forwarded-For':'203.0.113.4'}})).status,429);
});
test('HTTP create-report quota is independent per verified user action',async t=>{
  const {request}=await httpApp(t),login=await request('/api/session',{method:'POST',data:{devUser:'dev-1'}}),report=input();
  assert.equal(login.status,200);
  for(let n=0;n<10;n++)assert.ok([200,201].includes((await request('/api/reports',{method:'POST',data:report,cookie:login.cookie})).status));
  assert.equal((await request('/api/reports',{method:'POST',data:report,cookie:login.cookie})).status,429);
});
