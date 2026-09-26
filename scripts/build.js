'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const sources=['app.js','model.js','pilot.js','bridge.js'];
for(const dir of ['server','bot','scripts']) for(const name of fs.readdirSync(path.join(root,dir))) if(name.endsWith('.js'))sources.push(`${dir}/${name}`);
for(const file of sources){const result=spawnSync(process.execPath,['--check',path.join(root,file)],{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);}
// Explicit allowlist: this directory is the ONLY content eligible for static Pages publication.
const publicFiles=['index.html','styles.css','demo.css','pilot.css','pilot.js','bridge.js'];
const out=path.join(root,'dist','public');
fs.mkdirSync(out,{recursive:true});
for(const file of fs.readdirSync(out)) if(!publicFiles.includes(file)) throw new Error('В dist/public есть посторонние файлы: сборка остановлена.');
for(const file of publicFiles)fs.copyFileSync(path.join(root,file),path.join(out,file));
console.log(`Проверено ${sources.length} JS-файлов. Статический preview: dist/public. Для рабочего пилота запускайте Node backend; сборка не включает .env, базу или демо.`);
