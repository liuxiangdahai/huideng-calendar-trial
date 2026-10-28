import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import ICAL from 'ical.js';
import {defaults} from '../../static/calendar-reminders/core.mjs';
import {applyPreset} from '../../static/calendar-reminders/presets.mjs';
const base=new URL(process.argv[2]);
const site=new URL(process.argv[3]);
if(base.protocol!=='https:' || site.protocol!=='https:' || !base.hostname.startsWith('huideng-calendar-acceptance.'))throw new Error('远端写入测试仅允许独立 acceptance 服务。');
const health=await (await fetch(new URL('/healthz',base))).json();
assert.equal(health.environment,'acceptance','拒绝对试用数据进行自动写入测试');
if(process.env.CALENDAR_EXPECTED_VERSION)assert.equal(health.version,process.env.CALENDAR_EXPECTED_VERSION);
const data=JSON.parse(await fs.readFile('static/calendar-reminders/calendar-data.json','utf8'));
const parse=text=>new ICAL.Component(ICAL.parse(text)).getAllSubcomponents('vevent');
const startedAt=new Date().toISOString();
const timing=[];let created;
async function call(method,pathname,body,extraHeaders={}){
 const started=performance.now();
 const response=await fetch(new URL(pathname,base),{method,headers:{Origin:site.origin,...(body?{'Content-Type':'application/json'}:{}),...(created?{Authorization:`Bearer ${created.manageToken}`}:{ }),...extraHeaders},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)}).catch(()=>{throw new Error(`${method} 验收请求未完成，请检查隔离服务与网络。`)});
 timing.push({operation:method,status:response.status,wallMs:performance.now()-started});
 assert.ok(response.ok,`${method} 请求返回 ${response.status}`);
 return response.json();
}
async function feed(options={}){
 const started=performance.now();const response=await fetch(created.feedUrl,{...options,signal:AbortSignal.timeout(30000)}).catch(()=>{throw new Error('日历验收请求未完成，请检查隔离服务与网络。')});
 timing.push({operation:options.method||'feed',status:response.status,wallMs:performance.now()-started});return response;
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
  const content=await first.text();assert.ok(!content.includes(created.manageToken));
  const entries=parse(content);assert.ok(entries.length>20);
  assert.equal(new Set(entries.map(e=>e.getFirstPropertyValue('uid'))).size,entries.length);
  const etag=first.headers.get('etag');assert.ok(etag);
  const head=await feed({method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  assert.equal((await feed({headers:{'If-None-Match':etag}})).status,304);
  const parallel=await Promise.all(Array.from({length:5},()=>feed()));
  for(const response of parallel){assert.equal(response.status,200);assert.equal(response.headers.get('etag'),etag);await response.arrayBuffer();}
  console.log(JSON.stringify({preset,events:entries.length,status:'passed'}));
 }
 for(let i=0;i<30;i++){
  settings.events['guru-tsok'].reminders[0].time=i%2?'08:00':'09:00';
  managed=await call('PATCH',`/api/subscriptions/${created.id}`,{settings,revision:managed.revision});
  const response=await feed();assert.equal(response.status,200);await response.arrayBuffer();
 }
 for(const value of Object.values(settings.events))value.mode='off';
 managed=await call('PATCH',`/api/subscriptions/${created.id}`,{settings,revision:managed.revision});
 const cancelled=parse(await (await feed()).text());
 assert.ok(cancelled.length>0);
 assert.ok(cancelled.every(e=>e.getFirstPropertyValue('status')==='CANCELLED' && e.getAllSubcomponents('valarm').length===0));
 await call('DELETE',`/api/subscriptions/${created.id}`);
 assert.ok(parse(await (await feed()).text()).every(e=>e.getFirstPropertyValue('status')==='CANCELLED'));
 console.log(JSON.stringify({status:'passed',requests:timing.length,version:health.version,note:'wallMs is network latency, not Worker CPU'}));
 await fs.mkdir('artifacts',{recursive:true});await fs.writeFile('artifacts/remote-smoke.json',JSON.stringify({version:health.version,dataVersion:health.dataVersion,startedAt,finishedAt:new Date().toISOString(),timing},null,2));
}finally{if(created)await call('DELETE',`/api/subscriptions/${created.id}`).catch(()=>console.error('验收订阅清理失败，请在隔离环境检查。'));}
