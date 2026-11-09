import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import ICAL from 'ical.js';
import {defaults,selectCalendarOccurrences,dateInZone,addDays,rangeEnd,resolveAlarmInstants} from '../../static/calendar-reminders/core.mjs';
import {applyPreset} from '../../static/calendar-reminders/presets.mjs';
import {GATEWAY_FAILURE_STAGES} from '../../service/gateway/gateway.mjs';
const base=new URL(process.argv[2]);
const site=new URL(process.argv[3]);
if(base.origin!=='https://huideng-calendar-acceptance.pages.dev' || site.origin!==base.origin)throw new Error('远端写入测试仅允许独立 acceptance Pages 入口。');
const health=await (await fetch(new URL('/healthz',base))).json();
assert.equal(health.environment,'acceptance','拒绝对试用数据进行自动写入测试');
assert.equal(health.gatewayVersion,health.version,'验收必须经过同版本Pages网关');
if(process.env.CALENDAR_EXPECTED_VERSION)assert.equal(health.version,process.env.CALENDAR_EXPECTED_VERSION);
const data=JSON.parse(await fs.readFile('static/calendar-reminders/calendar-data.json','utf8'));
const parse=text=>new ICAL.Component(ICAL.parse(text)).getAllSubcomponents('vevent');
const startedAt=new Date().toISOString();
const timing=[],dailyMeasurements=[];let created;let scenario='create';let passed=false,failedScenario;
const dailyEntries=entries=>entries.filter(event=>String(event.getFirstPropertyValue('uid')).startsWith('daily-date-'));
const active=entries=>entries.filter(event=>event.getFirstPropertyValue('status')!=='CANCELLED');
function verifyDaily(entries){
 const daily=dailyEntries(active(entries));
 assert.ok(daily.length>=819 && daily.length<=823,'滚动窗口应每天恰有一条日期');
 assert.equal(new Set(daily.map(e=>e.getFirstPropertyValue('dtstart').toString())).size,daily.length);
 for(const event of daily){
  assert.equal(event.getAllSubcomponents('valarm').length,0);
  assert.equal(event.getFirstPropertyValue('transp'),'TRANSPARENT');
  assert.ok(event.getFirstPropertyValue('dtstart').isDate);
  // The title may carry the chosen everyday mark (◦ or 【每日】) before the date.
  assert.match(event.getFirstPropertyValue('summary'),/^(?:◦ |【每日】)?藏历/);
  assert.match(event.getFirstPropertyValue('description'),/藏历 PRO/);
  assert.ok(!event.getFirstPropertyValue('description').includes('原站标注'));
 }
 return daily;
}
async function call(method,pathname,body,extraHeaders={}){
 const started=performance.now(),startTime=new Date().toISOString();
 const response=await fetch(new URL(pathname,base),{method,headers:{Origin:site.origin,...(body?{'Content-Type':'application/json'}:{}),...(created?{Authorization:`Bearer ${created.manageToken}`}:{ }),...extraHeaders},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)}).catch(()=>{throw new Error(`${method} 验收请求未完成，请检查隔离服务与网络。`)});
 timing.push({scenario,operation:method,status:response.status,startedAt:startTime,finishedAt:new Date().toISOString(),wallMs:performance.now()-started});
 assert.ok(response.ok,`${method} 请求返回 ${response.status}`);
 return response.json();
}
async function feed(options={}){
 const started=performance.now(),startTime=new Date().toISOString();const response=await fetch(created.feedUrl,{...options,redirect:'error',signal:AbortSignal.timeout(30000)}).catch(()=>{throw new Error('日历验收请求未完成，请检查隔离服务与网络。')});
 const entry={scenario,operation:options.method||'feed',status:response.status,startedAt:startTime,finishedAt:new Date().toISOString(),wallMs:performance.now()-started};
 if(response.status>=400){
  // Keep failed requests as evidence too. Never retain raw error bodies or URLs.
  const message=await response.clone().json().then(value=>value.error).catch(()=>null);
  entry.failureKind=message==='暂时无法连接订阅服务，请稍后重试。'?'gateway_unavailable':
   message==='订阅服务暂时不可用，请稍后再试。'?'service_unavailable':
   message==='订阅正在更新，请稍后重试。'?'publication_conflict':'other';
  const gatewayStage=response.headers.get('X-Calendar-Gateway-Stage');
  if(entry.failureKind==='gateway_unavailable' && GATEWAY_FAILURE_STAGES.includes(gatewayStage))entry.gatewayStage=gatewayStage;
  console.error(JSON.stringify({scenario,status:response.status,failureKind:entry.failureKind,...(entry.gatewayStage?{gatewayStage:entry.gatewayStage}:{})}));
 }
 timing.push(entry);return response;
}
try{
 let settings=applyPreset(defaults(data.catalog,'Asia/Shanghai'),data.catalog,'guru');
 const initialSettings=structuredClone(settings);
 const createHeaders={'Idempotency-Key':randomBytes(32).toString('base64url')};
 created=await call('POST','/api/subscriptions',{settings:initialSettings},createHeaders);
 assert.equal(new URL(created.feedUrl).origin,base.origin);
 // A lost response, repeated click or reload must recover one existing subscription.
 for(const replay of await Promise.all(Array.from({length:3},()=>call('POST','/api/subscriptions',{settings:initialSettings},createHeaders)))){
  assert.ok(replay.id===created.id && replay.feedUrl===created.feedUrl && replay.manageToken===created.manageToken,'重复创建必须恢复同一订阅和凭证');
 }
 let managed=await call('GET',`/api/subscriptions/${created.id}`);
 for(const preset of ['guru','tsok','practice','dual']){
  scenario=preset;
  settings=applyPreset(settings,data.catalog,preset==='dual'?'practice':preset);
  if(preset==='dual')for(const value of Object.values(settings.events))if(value.mode!=='off'){value.mode='remind';value.reminders=[{daysBefore:0,time:'08:00'},{daysBefore:1,time:'20:00'}];}
  managed=await call('PATCH',`/api/subscriptions/${created.id}`,{settings,revision:managed.revision});
  assert.ok(managed.feedUrl===created.feedUrl,'修改设置不能改变订阅地址');
  if(preset==='tsok'){
   const recovered=await call('POST','/api/subscriptions',{settings:initialSettings},createHeaders);
   assert.ok(recovered.feedUrl===created.feedUrl && recovered.revision===managed.revision,'恢复创建不能倒退当前设置版本');
   assert.ok(JSON.stringify(recovered.settings)===JSON.stringify(managed.settings),'恢复创建必须返回当前设置，不覆盖已保存修改');
  }
  const first=await feed();assert.equal(first.status,200);
  assert.match(first.headers.get('content-type')||'',/^text\/calendar\b/i);
  assert.ok(first.headers.has('strict-transport-security'));
  const content=await first.text();assert.ok(!content.includes(created.manageToken));
  const entries=parse(content);assert.ok(entries.length>20);
  // Verify the real preset/save/Pages path, not just the presence of an ICS file.
  const today=dateInZone(new Date(),managed.settings.zone);
  const expected=new Map(selectCalendarOccurrences(data,managed.settings,{start:addDays(today,-90),end:rangeEnd(today,24)})
    .map(event=>[`${event.uid}@calendar.huidengvan.org`,resolveAlarmInstants(event,managed.settings.zone).length
      ? [...new Set(event.preference.reminders.map(r=>{const [h,m]=r.time.split(':').map(Number);return (h*60+m-r.daysBefore*1440)*60;}))].sort((a,b)=>a-b) : []]));
  for(const event of active(entries)){
    // All-day alarms are civil-day relative triggers (seconds from the day's start).
    const actual=event.getAllSubcomponents('valarm').map(alarm=>alarm.getFirstPropertyValue('trigger').toSeconds()).sort((a,b)=>a-b);
    assert.deepEqual(actual,expected.get(event.getFirstPropertyValue('uid')),'公开订阅文件的提醒必须与实际保存的设置逐项一致');
  }
  assert.equal(new Set(entries.map(e=>e.getFirstPropertyValue('uid'))).size,entries.length);
  const etag=first.headers.get('etag');assert.ok(etag);
  const head=await feed({method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  assert.equal((await feed({headers:{'If-None-Match':etag}})).status,304);
  const parallel=await Promise.all(Array.from({length:5},()=>feed()));
  for(const response of parallel){assert.equal(response.status,200);assert.equal(response.headers.get('etag'),etag);await response.arrayBuffer();}
  console.log(JSON.stringify({preset,events:entries.length,status:'passed'}));
 }
 scenario='modify-read-30';
 for(let i=0;i<30;i++){
  settings.events['guru-tsok'].reminders[0].time=i%2?'08:00':'09:00';
  managed=await call('PATCH',`/api/subscriptions/${created.id}`,{settings,revision:managed.revision});
  const response=await feed();assert.equal(response.status,200);await response.arrayBuffer();
 }
 // Daily dates use the same public feed. Test actual deployment, not only a
 // synthetic file; no personal address or credential is written to evidence.
 let dailyBaseline;
 for(const mode of ['daily-only','practice-daily','dual-daily']){
  scenario=mode;
  settings=mode==='daily-only'?defaults(data.catalog,'Asia/Shanghai'):applyPreset(settings,data.catalog,'practice');
  settings.includeDailyDates=true;
  if(mode==='dual-daily')for(const value of Object.values(settings.events))if(value.mode!=='off'){
   value.mode='remind';value.reminders=[{daysBefore:0,time:'08:00'},{daysBefore:1,time:'20:00'}];
  }
  managed=await call('PATCH',`/api/subscriptions/${created.id}`,{settings,revision:managed.revision});
  assert.equal(managed.feedUrl,created.feedUrl);
  const first=await feed();assert.equal(first.status,200);
  const content=await first.text(),entries=parse(content),daily=verifyDaily(entries);
  if(mode==='daily-only')assert.equal(active(entries).length,daily.length);
  dailyBaseline=new Map(daily.map(e=>[e.getFirstPropertyValue('uid'),Number(e.getFirstPropertyValue('sequence'))]));
  const etag=first.headers.get('etag');
  scenario=mode+'-snapshot';const cached=await feed();assert.equal(cached.status,200);assert.equal(cached.headers.get('etag'),etag);await cached.arrayBuffer();
  const head=await feed({method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  scenario=mode+'-304';assert.equal((await feed({headers:{'If-None-Match':etag}})).status,304);
  scenario=mode+'-concurrent';
  for(const response of await Promise.all(Array.from({length:5},()=>feed()))){assert.equal(response.status,200);assert.equal(response.headers.get('etag'),etag);await response.arrayBuffer();}
  dailyMeasurements.push({scenario:mode,dailyEvents:daily.length,activeEvents:active(entries).length,totalEvents:entries.length,icsBytes:Buffer.byteLength(content),status:'passed'});
 }
 scenario='daily-legacy-patch';
 const legacy=structuredClone(settings);delete legacy.includeDailyDates;
 managed=await call('PATCH',`/api/subscriptions/${created.id}`,{settings:legacy,revision:managed.revision});
 assert.equal(managed.settings.includeDailyDates,true);
 verifyDaily(parse(await (await feed()).text()));
 scenario='daily-disable';settings.includeDailyDates=false;
 managed=await call('PATCH',`/api/subscriptions/${created.id}`,{settings,revision:managed.revision});
 const cancelledDaily=dailyEntries(parse(await (await feed()).text()));
 assert.equal(cancelledDaily.length,dailyBaseline.size);
 for(const event of cancelledDaily){assert.equal(event.getFirstPropertyValue('status'),'CANCELLED');assert.equal(event.getAllSubcomponents('valarm').length,0);assert.ok(Number(event.getFirstPropertyValue('sequence'))>dailyBaseline.get(event.getFirstPropertyValue('uid')));}
 scenario='daily-reenable';settings.includeDailyDates=true;
 managed=await call('PATCH',`/api/subscriptions/${created.id}`,{settings,revision:managed.revision});
 const reopened=verifyDaily(parse(await (await feed()).text()));
 for(const event of reopened)assert.ok(Number(event.getFirstPropertyValue('sequence'))>dailyBaseline.get(event.getFirstPropertyValue('uid'))+1);
 assert.equal(managed.feedUrl,created.feedUrl);
 scenario='cancel-disable';
 settings.includeDailyDates=false;
 for(const value of Object.values(settings.events))value.mode='off';
 managed=await call('PATCH',`/api/subscriptions/${created.id}`,{settings,revision:managed.revision});
 const cancelled=parse(await (await feed()).text());
 assert.ok(cancelled.length>0);
 assert.ok(cancelled.every(e=>e.getFirstPropertyValue('status')==='CANCELLED' && e.getAllSubcomponents('valarm').length===0));
 await call('DELETE',`/api/subscriptions/${created.id}`);
 assert.ok(parse(await (await feed()).text()).every(e=>e.getFirstPropertyValue('status')==='CANCELLED'));
 console.log(JSON.stringify({status:'passed',requests:timing.length,version:health.version,note:'wallMs is network latency, not Worker CPU'}));
 passed=true;
}catch(error){failedScenario=scenario;throw error;}
finally{
 if(created)await call('DELETE',`/api/subscriptions/${created.id}`).catch(()=>console.error('验收订阅清理失败，请在隔离环境检查。'));
 await fs.mkdir('artifacts',{recursive:true});await fs.writeFile('artifacts/remote-smoke.json',JSON.stringify({version:health.version,dataVersion:health.dataVersion,passed,failedScenario,startedAt,finishedAt:new Date().toISOString(),timing,dailyMeasurements},null,2));
}
