'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {loadConfig,ROOT} = require('./config');
const {HttpError,verifyInitData,constantEqual,userKey,Sessions} = require('./auth');
const {Store} = require('./store');
const {createBot} = require('../bot/handler');
const LOOPBACK = new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);
async function body(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new HttpError(415,'Нужен JSON.');
  let size = 0; const chunks=[];
  for await (const chunk of req) {size += chunk.length; if (size > 32768) throw new HttpError(413,'Запрос слишком большой.'); chunks.push(chunk);}
  try {const data=JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!data || typeof data!=='object' || Array.isArray(data)) throw new Error(); return data;}
  catch (_) {throw new HttpError(400,'Некорректный JSON.');}
}
function createApp(config, options = {}) {
  config.buildingAccess ||= new Map();
  if (config.development) for (const id of ['dev-1','dev-2','dev-3','dev-admin']) config.buildingAccess.set(id,config.topology.buildings.map(b=>b.id));
  const store = options.store || new Store(config.dbPath,config.topology,config.development?'development':'pilot');
  const sessions = new Sessions(config), bot = createBot(config, options.fetch);
  function buildingIdsFor(maxId) {
    const assigned = config.buildingAccess.get(maxId);
    if (assigned) return assigned;
    // The ITMO pilot has one configured house. Any MAX-verified user can use
    // that pilot; MAX identity is not presented as proof of residence.
    return config.topology.buildings.length === 1 ? [config.topology.buildings[0].id] : [];
  }
  const rates = new Map();
  function rate(req, action, identity, limit, windowMs=60000) {
    const now=Date.now(), key=action+':'+identity;
    let r=rates.get(key);
    if (!r) {
      if (rates.size>=10000) {
        for (const [k,v] of rates) if (v.until<=now) rates.delete(k);
        if (rates.size>=10000) throw new HttpError(429,'Слишком много запросов. Подождите минуту.');
      }
      r={until:now+windowMs,count:0};rates.set(key,r);
    }
    if (r.until<=now) {r.until=now+windowMs;r.count=0;}
    if (r.count>=limit) throw new HttpError(429,'Слишком много запросов. Подождите минуту.');
    r.count++;
  }
  function rateSession(req, session, action, limit, anonymousLimit=30) {
    rate(req,action,session?.userKey||req.socket.remoteAddress||'unknown',session?limit:anonymousLimit);
  }
  function requireBuilding(session, buildingId) {
    if (!config.topology.buildings.some(b=>b.id===buildingId)) throw new HttpError(400,'Дом не настроен.');
    if (!session.buildingIds?.includes(buildingId)) throw new HttpError(403,'Доступ к этому дому для вашего аккаунта не настроен.');
  }
  function requireSession(req, admin=false) {
    const s=sessions.get(req);
    if (!s) throw new HttpError(401,config.development?'Войдите тестовым участником.':'Сессия MAX не найдена или истекла. Откройте мини-приложение снова из бота.');
    if (admin && !s.admin) throw new HttpError(403,'Нужны права администратора.');
    return s;
  }
  function sessionView(s) {return {authenticated:!!s,admin:!!s?.admin,source:s?.source || null};}
  const json=(res,status,value) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  const server = http.createServer(async (req,res) => {
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://st.max.ru; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self' https://max.ru https://*.max.ru");
    if (!config.development) res.setHeader('Strict-Transport-Security','max-age=31536000');
    try {
      const url=new URL(req.url,'http://local');
      const devHost = ['localhost','127.0.0.1','[::1]'].includes(new URL('http://'+req.headers.host).hostname);
      const localDevRequest = LOOPBACK.has(req.socket.remoteAddress) && devHost;
      // Docker publishes this development listener on host loopback only (compose.yaml).
      // Keep the ordinary local-only check for every other development launch.
      const containerDevRequest = config.containerDevelopment && devHost;
      if (config.development && !(localDevRequest || containerDevRequest)) throw new HttpError(403,'Разработка доступна только локально.');
      if (url.pathname==='/health' && ['GET','HEAD'].includes(req.method)) {
        try {store.health();return json(res,200,{ok:true});}
        catch (_) {return json(res,503,{ok:false});}
      }
      if (url.pathname==='/webhook/max' && req.method==='POST') {
        rate(req,'webhook',req.socket.remoteAddress||'unknown',120);
        if (!config.webhookSecret || !constantEqual(req.headers['x-max-bot-api-secret'],config.webhookSecret)) throw new HttpError(403,'Webhook не авторизован.');
        try {await bot(await body(req));} catch (err) {if (err instanceof HttpError) throw err;throw new HttpError(502,'Не удалось обработать событие MAX.');}
        return json(res,200,{ok:true});
      }
      if (url.pathname.startsWith('/api/')) {
        const currentSession=sessions.get(req);
        if (url.pathname==='/api/config' && req.method==='GET') rateSession(req,currentSession,'config',120,120);
        else if (url.pathname==='/api/session' && req.method==='GET') rateSession(req,currentSession,'session-read',120,120);
        else if (url.pathname==='/api/session' && req.method==='POST') rateSession(req,null,'session-login',60,60);
        else if (url.pathname==='/api/session' && req.method==='DELETE') rateSession(req,currentSession,'session-end',60,60);
        else if (url.pathname==='/api/state' && req.method==='GET') rateSession(req,currentSession,'state-read',120);
        else if (url.pathname==='/api/reports' && req.method==='GET') rateSession(req,currentSession,'report-history',60);
        else if (url.pathname==='/api/reports' && req.method==='POST') rateSession(req,currentSession,'report-create',10);
        else if (url.pathname==='/api/incidents' && req.method==='GET') rateSession(req,currentSession,'incident-history',60);
        else if (/^\/api\/incidents\/[a-f0-9-]{36}\/status$/.test(url.pathname) && req.method==='PATCH') rateSession(req,currentSession,'incident-status',30);
        else rateSession(req,currentSession,'api-other',60,60);
        if (!['GET','HEAD'].includes(req.method)) {
          if (req.headers['x-dompulse-request']!=='1' || req.headers.origin!==config.origin) throw new HttpError(403,'Источник запроса не разрешён.');
        }
        if (url.pathname==='/api/config' && req.method==='GET') {
          const buildings=currentSession?config.topology.buildings.filter(b=>currentSession.buildingIds?.includes(b.id)):config.topology.buildings;
          return json(res,200,{development:config.development,synthetic:config.topology.synthetic,grouping:config.topology.grouping||'zone',note:config.topology.note,buildings,maxConfigured:!!(config.botToken && config.miniAppUrl.startsWith('https://')),maxAppUrl:config.botUsername?`https://max.ru/${config.botUsername}?startapp`:null});
        }
        if (url.pathname==='/api/session' && req.method==='GET') return json(res,200,sessionView(sessions.get(req)));
        if (url.pathname==='/api/session' && req.method==='POST') {
          const data=await body(req); let identity;
          if (data.initData) {
            const verified=verifyInitData(data.initData,config.botToken);
            identity={userKey:userKey('max:'+verified.id,config.hashSecret),admin:config.adminIds.has(verified.id),buildingIds:buildingIdsFor(verified.id),source:'max',expiresAt:verified.expiresAt};
          } else if (config.development && ['dev-1','dev-2','dev-3','dev-admin'].includes(data.devUser)) {
            identity={userKey:userKey(data.devUser,config.hashSecret),admin:data.devUser==='dev-admin',buildingIds:config.buildingAccess.get(data.devUser)||[],source:'development',expiresAt:Date.now()+3600000};
          } else throw new HttpError(401,'Нужны подписанные стартовые данные MAX.');
          sessions.remove(req);const token=sessions.create(identity);res.setHeader('Set-Cookie',sessions.cookie(token));return json(res,200,{...sessionView(identity),sessionToken:token});
        }
        if (url.pathname==='/api/session' && req.method==='DELETE') {sessions.remove(req);res.setHeader('Set-Cookie',sessions.cookie('').replace('Max-Age=3600','Max-Age=0'));return json(res,200,{authenticated:false});}
        if (url.pathname==='/api/state' && req.method==='GET') {
          const s=requireSession(req),buildingId=url.searchParams.get('buildingId');requireBuilding(s,buildingId);return json(res,200,store.currentState(buildingId));
        }
        if (url.pathname==='/api/incidents' && req.method==='GET') {
          const s=requireSession(req),buildingId=url.searchParams.get('buildingId');requireBuilding(s,buildingId);
          return json(res,200,store.incidentPage(buildingId,pageOptions(url),s.admin));
        }
        if (url.pathname==='/api/reports' && req.method==='GET') {
          const s=requireSession(req),buildingId=url.searchParams.get('buildingId');requireBuilding(s,buildingId);
          return json(res,200,store.reportPage(s.userKey,buildingId,pageOptions(url)));
        }
        if (url.pathname==='/api/reports' && req.method==='POST') {
          const s=requireSession(req),data=await body(req);requireBuilding(s,data.buildingId);const result=store.add(s.userKey,data);return json(res,result.repeated?200:201,result);
        }
        const match=url.pathname.match(/^\/api\/incidents\/([a-f0-9-]{36})\/status$/);
        if (match && req.method==='PATCH') {
          const s=requireSession(req,true),status=(await body(req)).status;
          const incidentBuilding=store.incidentBuilding(match[1]);if(!incidentBuilding)throw new HttpError(404,'Инцидент не найден.');requireBuilding(s,incidentBuilding);
          store.setStatus(match[1],status);return json(res,200,{ok:true});
        }
        throw new HttpError(404,'Метод не найден.');
      }
      if (!['GET','HEAD'].includes(req.method)) throw new HttpError(405,'Метод не поддерживается.');
      // Explicit allowlist: never serve source folders, .env, SQLite or the repository root.
      const files={'/':'index.html','/index.html':'index.html','/styles.css':'styles.css','/demo.css':'demo.css','/pilot.css':'pilot.css','/pilot.js':'pilot.js','/bridge.js':'bridge.js','/demo':'demo.html','/demo.html':'demo.html','/app.js':'app.js','/model.js':'model.js'};
      const filename=files[url.pathname];if (!filename) throw new HttpError(404,'Страница не найдена.');
      if (['demo.html','app.js','model.js'].includes(filename)) requireSession(req,true);
      const data=await fs.readFile(path.join(ROOT,filename));
      const ext=path.extname(filename), types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
      res.writeHead(200,{'Content-Type':types[ext]});res.end(req.method==='HEAD'?undefined:data);
    } catch (error) {
      if (!res.headersSent) json(res,error instanceof HttpError?error.status:500,{error:error instanceof HttpError?error.message:'Ошибка сервера. Попробуйте позже.'});
      else res.end();
      // Deliberately no request/body/error object logging: it may contain PII or tokens.
    }
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  server.on('close',()=>store.close());
  return {server,store,sessions};
}
function pageOptions(url) {
  const rawLimit=url.searchParams.get('limit');
  const limit=rawLimit===null?20:Number(rawLimit);
  if (!Number.isInteger(limit)||limit<1||limit>50) throw new HttpError(400,'Размер страницы должен быть от 1 до 50.');
  return {cursor:url.searchParams.get('cursor'),limit,status:url.searchParams.get('status')||'all'};
}
function start() {
  const config=loadConfig();const app=createApp(config);
  app.server.listen(config.port,config.host,()=>console.log(`ДомПульс: ${config.origin} · ${config.development?'development, тестовая база':'production, проверка MAX обязательна'}`));
  app.server.on('error',(error)=>{
    if (error.code==='EADDRINUSE') console.error(`Порт ${config.port} уже занят. Остановите предыдущий сервер в его терминале (Ctrl+C) и повторите запуск. Если меняете порт, обновите PORT и PUBLIC_URL в .env.`);
    else if (error.code==='EACCES') console.error(`Нет доступа к порту ${config.port}. Укажите свободный порт выше 1023 в PORT и PUBLIC_URL в .env.`);
    else console.error('Не удалось запустить сервер. Проверьте HOST, PORT и настройки сети.');
    app.server.close();process.exitCode=1;
  });
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>app.server.close());
  return app;
}
if (require.main===module) {try {start();} catch(error) {console.error(error.message);process.exitCode=1;}}
module.exports={createApp,start};
