// Local structural measurements, never Cloudflare CPU or billable D1 scans.
// Each scenario runs in a fresh process, database and PRO cache.
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {SQLiteD1} from '../../service/calendar/sqlite-d1.mjs';
import {createCalendarService} from '../../service/calendar/service.mjs';
import {defaults, validateSettings, selectOccurrences, exportICS} from '../../static/calendar-reminders/core.mjs';
import {applyPreset} from '../../static/calendar-reminders/presets.mjs';

const scenario=process.argv[2];
const scenarios=['daily-only','practice-daily','dual-daily'];
if(!scenario){
 const measurements=scenarios.map(name=>JSON.parse(execFileSync(process.execPath,[fileURLToPath(import.meta.url),name],{encoding:'utf8'})));
 await fs.mkdir('artifacts',{recursive:true});
 const report={generatedAt:new Date().toISOString(),version:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  environment:'local-node-sqlite',note:'本机耗时，不是云端 CPU。readRowsReturned 为查询返回行数，不是 D1 计费扫描行数；writeRowsChanged 为 SQLite 实际修改行数。每个场景独立进程、空库及日期缓存。',measurements};
 await fs.writeFile('artifacts/daily-local-benchmark.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}else{
 assert.ok(scenarios.includes(scenario));
 const data=JSON.parse(await fs.readFile('static/calendar-reminders/calendar-data.json','utf8'));
 const DB=new SQLiteD1(':memory:');
 const counts={readQueries:0,readRowsReturned:0,writeQueries:0};
 const originalPrepare=DB.prepare.bind(DB);
 const wrap=statement=>({
  bind(...values){return wrap(statement.bind(...values));},
  async first(...args){const row=await statement.first(...args);counts.readQueries++;counts.readRowsReturned+=row===null?0:1;return row;},
  async all(){const result=await statement.all();counts.readQueries++;counts.readRowsReturned+=result.results.length;return result;},
  execute(){counts.writeQueries++;return statement.execute();},
  async run(){return this.execute();}
 });
 DB.prepare=sql=>wrap(originalPrepare(sql));
 const totalChanges=()=>Number(DB.database.prepare('SELECT total_changes() AS n').get().n);
 const today='2026-11-02',origin='https://local-measurement.example';
 const service=createCalendarService({getData:()=>data,validateSettings,selectOccurrences,exportICS,now:()=>new Date(`${today}T04:00:00Z`)});
 const env={DB,PUBLIC_BASE_URL:origin,ALLOWED_ORIGINS:origin,RATE_LIMIT_SALT:'local-only-benchmark'};
 let settings=defaults(data.catalog,'Asia/Shanghai');
 if(scenario!=='daily-only')settings=applyPreset(settings,data.catalog,'practice');
 if(scenario==='dual-daily')for(const value of Object.values(settings.events))if(value.mode!=='off'){
  value.mode='remind';value.reminders=[{daysBefore:0,time:'08:00'},{daysBefore:1,time:'20:00'}];
 }
 settings.includeDailyDates=true;
 const samples=[];
 async function measured(operation,url,options={}){
  const before={...counts},changes=totalChanges(),started=performance.now();
  const response=await service.fetch(new Request(url,{...options}),env);
  const body=await response.text();
  samples.push({operation,status:response.status,wallMs:performance.now()-started,bytes:Buffer.byteLength(body),
   ...Object.fromEntries(Object.entries(counts).map(([key,value])=>[key,value-before[key]])),writeRowsChanged:totalChanges()-changes});
  return {response,body};
 }
 try{
  const result=await measured('create',`${origin}/api/subscriptions`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({settings})});
  assert.equal(result.response.status,201);const created=JSON.parse(result.body);
  const first=await measured('cold-feed',created.feedUrl);assert.equal(first.response.status,200);
  const dailyEvents=(first.body.match(/UID:daily-date-/g)||[]).length,totalEvents=(first.body.match(/BEGIN:VEVENT/g)||[]).length;
  assert.ok(dailyEvents>=819 && dailyEvents<=823);
  const etag=first.response.headers.get('etag');
  for(let i=0;i<5;i++){
   const hit=await measured('snapshot-feed',created.feedUrl);assert.equal(hit.response.headers.get('etag'),etag);
   const unmodified=await measured('304',created.feedUrl,{headers:{'If-None-Match':etag}});assert.equal(unmodified.response.status,304);
  }
  const head=await measured('HEAD',created.feedUrl,{method:'HEAD'});assert.equal(head.body,'');
  for(const sample of samples.filter(s=>['snapshot-feed','304','HEAD'].includes(s.operation)))assert.equal(sample.writeRowsChanged,0);
  const ledger=DB.database.prepare('SELECT count(*) AS n, sum(length(event_json)) AS bytes FROM calendar_entries').get();
  console.log(JSON.stringify({scenario,today,dailyEvents,totalEvents,icsBytes:Buffer.byteLength(first.body),ledgerRows:Number(ledger.n),ledgerJsonCharacters:Number(ledger.bytes),samples}));
 }finally{DB.close();}
}
