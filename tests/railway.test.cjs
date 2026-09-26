const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {createHmac,randomUUID}=require('node:crypto');
const {loadConfig}=require('../server/config');
const {createApp}=require('../server/index');
const {Store}=require('../server/store');

// Test fixture only. Never use this topology as an actual production configuration.
const topology={...require('../config/buildings.example.json'),synthetic:false};
const env={NODE_ENV:'production',PUBLIC_URL:'https://fixture.example',MINI_APP_URL:'https://fixture.example/',
  MAX_BOT_TOKEN:'fixture-only-not-a-real-token',MAX_BOT_USERNAME:'fixture_bot',MAX_ADMIN_IDS:'99',
  USER_HASH_SECRET:'fixture-only-hash-secret-0123456789',MAX_WEBHOOK_SECRET:'fixture-only-webhook-secret-0123456789',
  MAX_WEBHOOK_URL:'https://fixture.example/webhook/max',BUILDINGS_JSON:JSON.stringify(topology)};
const signed=()=>{
  const pairs=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id:42})});
  const key=createHmac('sha256','WebAppData').update(env.MAX_BOT_TOKEN).digest();
  pairs.set('hash',createHmac('sha256',key).update([...pairs].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n')).digest('hex'));
  return pairs.toString();
};
test('Railway config uses PORT, production 0.0.0.0 and absolute DATA_DIR',()=>{
  const c=loadConfig({...env,PORT:'8123',DATA_DIR:'/data'});
  assert.equal(c.port,8123);assert.equal(c.host,'0.0.0.0');assert.equal(c.dbPath,'/data/pilot.sqlite');
  assert.equal(loadConfig({NODE_ENV:'development'}).host,'127.0.0.1');
  for(const port of ['0','65536','bad'])assert.throws(()=>loadConfig({...env,PORT:port}));
});
test('production rejects missing, synthetic, empty, malformed and conflicting zone sources',()=>{
  assert.throws(()=>loadConfig({...env,BUILDINGS_JSON:''}),/согласованные зоны/);
  assert.throws(()=>loadConfig({...env,BUILDINGS_JSON:JSON.stringify({...topology,synthetic:true})}),/согласованные зоны/);
  assert.throws(()=>loadConfig({...env,BUILDINGS_JSON:JSON.stringify(require('../config/buildings.production.template.json'))}));
  assert.throws(()=>loadConfig({...env,BUILDINGS_JSON:'invalid-private-content'}),error=>!error.message.includes('invalid-private-content'));
  assert.throws(()=>loadConfig({...env,BUILDINGS_FILE:'config/buildings.example.json'}),/один источник/);
});
test('health is public, queries SQLite and returns sanitized 503 on failure',async t=>{
  const c=loadConfig(env),store=new Store(':memory:',c.topology);
  const app=createApp(c,{store});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const url=`http://127.0.0.1:${app.server.address().port}/health`;
  let response=await fetch(url,{headers:{Host:'healthcheck.railway.app'}});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
  response=await fetch(url,{method:'HEAD'});assert.equal(response.status,200);assert.equal(await response.text(),'');
  store.health=()=>{throw new Error('private error containing secrets');};
  response=await fetch(url);assert.equal(response.status,503);assert.deepEqual(await response.json(),{ok:false});
});
test('npm start in isolated production persists SQLite reports across restart', {timeout:20000},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dompulse-railway-'));
  // Explicit copy list excludes .env and local data. Child env contains only fixtures.
  for(const file of ['package.json','server','bot','config','index.html'])fs.cpSync(path.join(__dirname,'..',file),path.join(root,file),{recursive:true});
  const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const base=`http://127.0.0.1:${port}`,dataDir=path.join(root,'volume');
  let child,exit;
  const stop=async()=>{
    if(child && child.exitCode===null && child.signalCode===null)process.kill(-child.pid,'SIGTERM');
    if(exit)await exit;
    child=null;
  };
  t.after(async()=>{await stop();fs.rmSync(root,{recursive:true,force:true});});
  const start=async()=>{
    child=spawn('npm',['start'],{cwd:root,detached:true,env:{PATH:process.env.PATH,...env,PORT:String(port),DATA_DIR:dataDir},stdio:['ignore','pipe','pipe']});
    exit=once(child,'exit');child.stdout.resume();child.stderr.resume();
    for(let i=0;i<80;i++){
      if(child.exitCode!==null)throw new Error('Isolated npm start exited unexpectedly');
      try {if((await fetch(base+'/health')).status===200)return;}catch(_){}
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw new Error('Isolated npm start did not become healthy');
  };
  const request=(url,method='GET',data,cookie='')=>fetch(base+url,{method,headers:{Origin:env.PUBLIC_URL,'X-DomPulse-Request':'1','Content-Type':'application/json',Cookie:cookie},body:data?JSON.stringify(data):undefined});
  const login=async()=>{
    const response=await request('/api/session','POST',{initData:signed()});assert.equal(response.status,200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  await start();assert.equal((await fetch(base)).status,200);
  assert.equal((await request('/api/session','POST',{devUser:'dev-admin'})).status,401);
  let cookie=await login();
  const report={requestId:randomUUID(),buildingId:'vyazemsky',zoneId:'a-floor-1',place:'Общая кухня',category:'Нет холодной воды',description:'Isolated test report'};
  assert.equal((await request('/api/reports','POST',report,cookie)).status,201);
  assert.ok(fs.existsSync(path.join(dataDir,'pilot.sqlite')));
  await stop();await start();cookie=await login();
  const state=await (await request('/api/state?buildingId=vyazemsky','GET',undefined,cookie)).json();
  assert.equal(state.mine.length,1);assert.equal(state.mine[0].description,report.description);
  assert.equal((await fetch(base+'/.env')).status,404);
});
