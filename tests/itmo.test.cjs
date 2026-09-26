const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {Store,WINDOW}=require('../server/store');
const {validateBuildings,loadConfig}=require('../server/config');
const topology=require('../config/buildings.itmo.json');
const b=topology.buildings[0],now=1800000000000;
const input=(p=b.places[0])=>({requestId:randomUUID(),buildingId:b.id,zoneId:p.id,place:p.name,category:'Нет холодной воды',description:'Нет воды'});
function store(t){const s=new Store(':memory:',topology);t.after(()=>s.close());return s;}
test('ITMO pilot contains only requested place categories and needs no unknown floor or block',()=>{
  validateBuildings(topology);
  assert.deepEqual(b.places.map(p=>p.name),['душ/туалет в блоке','прачечная, 1-й этаж','столовая','учебная комната','другое','не знаю']);
  assert.equal(b.units,undefined);assert.equal(b.zones,undefined);
  assert(b.places.every(p=>Object.keys(p).sort().join(',')==='id,name'));
  const c=loadConfig({NODE_ENV:'production',PUBLIC_URL:'https://fixture.example',MINI_APP_URL:'https://fixture.example/',MAX_WEBHOOK_URL:'https://fixture.example/webhook/max',BUILDINGS_FILE:'config/buildings.itmo.json',MAX_BOT_TOKEN:'fixture-only',MAX_ADMIN_IDS:'99',MAX_BOT_USERNAME:'fixture_bot',USER_HASH_SECRET:'h'.repeat(32),MAX_WEBHOOK_SECRET:'w'.repeat(32)});
  assert.equal(c.topology.grouping,'reported-place');
});
test('ITMO threshold matches place and category, never infers another place or physical block',t=>{
  const s=store(t);s.add('one',input(),now);s.add('two',input(),now+1);s.add('three',input(b.places[1]),now+2);
  assert.equal(s.snapshot('one',b.id,false,now+2).incidents.length,0);
  s.add('three',input(),now+3);const snap=s.snapshot('one',b.id,false,now+3);
  assert.equal(snap.incidents.length,1);assert.equal(snap.incidents[0].count,3);
  assert.equal(snap.incidents[0].zoneLabel,'душ/туалет в блоке');
  assert.equal(snap.incidents[0].title,'Похожие обращения / возможный общий инцидент');
  assert.throws(()=>s.add('four',{...input(),place:'столовая'},now));
  assert.throws(()=>s.add('four',{...input(),category:'unknown category'},now));
  assert.throws(()=>s.add('four',{...input(),floor:7},now));
});
test('ITMO repeats do not satisfy threshold, other and unknown remain distinct categories',t=>{
  const s=store(t);for(let i=0;i<3;i++)s.add('one',input(b.places[4]),now+i);
  s.add('two',input(b.places[5]),now+3);s.add('three',input(b.places[5]),now+4);
  const snap=s.snapshot('one',b.id,false,now+4);assert.equal(snap.incidents.length,0);
  assert.deepEqual(snap.pending.map(p=>p.uniqueCount).sort(),[1,2]);
});
test('ITMO time boundary: later wave does not join an old unresolved group',t=>{
  const s=store(t);s.add('one',input(),now);s.add('two',input(),now+1);s.add('three',input(),now+2);
  s.add('four',input(),now+WINDOW);assert.equal(s.snapshot('one',b.id,false,now+WINDOW).incidents[0].count,4);
  s.add('five',input(),now+WINDOW+1);s.add('six',input(),now+WINDOW+2);s.add('seven',input(),now+WINDOW+3);
  const snap=s.snapshot('five',b.id,false,now+WINDOW+3);
  assert.equal(snap.incidents.length,2);assert.deepEqual(snap.incidents.map(i=>i.count).sort(),[3,4]);
  assert.notEqual(snap.mine[0].incidentId,s.snapshot('one',b.id,false,now+WINDOW+3).mine[0].incidentId);
});
test('ITMO multiple unresolved time groups survive SQLite reopen',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dompulse-itmo-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'pilot.sqlite');let s=new Store(file,topology);
  for(const at of [now,now+WINDOW+1])for(const u of ['one','two','three'])s.add(u,input(),at);
  s.close();s=new Store(file,topology);t.after(()=>s.close());
  assert.equal(s.snapshot('one',b.id,false,now+WINDOW+1).incidents.length,2);
});
