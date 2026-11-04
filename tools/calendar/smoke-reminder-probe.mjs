import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import ICAL from 'ical.js';
import {makeProbeSettings} from '../../static/calendar-reminders/reminder-probe-model.mjs';
const origin='https://huideng-calendar-acceptance.pages.dev';
let stage='health',created,revision,requests=0;const checks=[];
const report={startedAt:new Date().toISOString(),environment:'acceptance',checks,phoneNotifications:'待真机验收'};
const options={redirect:'error',signal:AbortSignal.timeout(30000)};
async function api(method,path,body){
  requests++;
  const response=await fetch(origin+path,{...options,signal:AbortSignal.timeout(30000),method,
    headers:{Origin:origin,'Content-Type':'application/json',...(created?{Authorization:`Bearer ${created.manageToken}`}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
  assert.ok(response.ok,'验收 API 请求失败');return response.json();
}
const components=text=>new ICAL.Component(ICAL.parse(text)).getAllSubcomponents('vevent');
const item=(events,id)=>events.find(e=>e.getFirstPropertyValue('uid')===`reminder-probe-${id}@calendar.huidengvan.org`);
async function feed(extra={}){
  requests++;const r=await fetch(created.feedUrl,{...options,signal:AbortSignal.timeout(30000),...extra});
  assert.ok([200,304].includes(r.status),'验收日历取数失败');return r;
}
try{
  const health=await api('GET','/healthz');assert.equal(health.environment,'acceptance');assert.equal(health.version,health.gatewayVersion);
  if(process.env.CALENDAR_EXPECTED_VERSION)assert.equal(health.version,process.env.CALENDAR_EXPECTED_VERSION);
  report.version=health.version;report.dataVersion=health.dataVersion;
  stage='create';created=await api('POST','/api/subscriptions',{settings:makeProbeSettings('Asia/Shanghai')});revision=created.revision;
  assert.ok(new URL(created.feedUrl).origin===origin,'订阅地址必须为隔离 Pages');
  const read=await api('GET',`/api/subscriptions/${created.id}`);assert.deepEqual(read.settings,created.settings);
  const response=await feed(),text=await response.text(),events=components(text);
  assert.equal(events.length,6);assert.ok(!text.includes(created.manageToken),'凭证不能进入文件');
  for(const id of ['a','b','c','d','e','f'])assert.equal(item(events,id).getAllSubcomponents('valarm').length,{a:1,b:1,c:1,d:2,e:0,f:0}[id]);
  assert.equal(item(events,'a').getFirstSubcomponent('valarm').getFirstProperty('trigger').type,'date-time');
  assert.equal(item(events,'b').getFirstSubcomponent('valarm').getFirstProperty('trigger').type,'duration');
  assert.equal(item(events,'c').getFirstPropertyValue('dtstart').isDate,false);
  assert.equal(await (await feed({method:'HEAD'})).text(),'');
  assert.equal((await feed({headers:{'If-None-Match':response.headers.get('etag')}})).status,304);
  checks.push({case:'保存、读取、六项提醒、HEAD、304',result:'通过',alarms:5});
  async function patch(settings){const result=await api('PATCH',`/api/subscriptions/${created.id}`,{settings,revision});revision=result.revision;
    assert.ok(result.feedUrl===created.feedUrl,'修改不能换地址');return components(await (await feed()).text());}
  stage='reschedule';const settings=structuredClone(created.settings);
  settings.reminderProbe.startAt=new Date(Date.parse(settings.reminderProbe.startAt)+30*60000).toISOString();settings.reminderProbe.round++;
  let next=await patch(settings);const changed=item(next,'a');assert.equal(changed.getFirstPropertyValue('sequence'),1);
  assert.equal(changed.getFirstSubcomponent('valarm').getFirstPropertyValue('trigger').toJSDate().toISOString(),settings.reminderProbe.startAt);
  checks.push({case:'同地址改时间、UID稳定、版本递增',result:'通过'});
  stage='quiet';settings.reminderProbe.silent=['a'];next=await patch(settings);assert.equal(item(next,'a').getAllSubcomponents('valarm').length,0);
  stage='cancel';settings.reminderProbe.omit=['a'];next=await patch(settings);assert.equal(item(next,'a').getFirstPropertyValue('status'),'CANCELLED');
  checks.push({case:'仅显示与取消不含提醒',result:'通过'});
  stage='stop';await api('DELETE',`/api/subscriptions/${created.id}`);const stopped=await (await feed()).text();
  assert.ok(!stopped.includes('BEGIN:VALARM'));assert.equal(components(stopped).every(e=>e.getFirstPropertyValue('status')==='CANCELLED'),true);
  checks.push({case:'停用返回撤销且无提醒',result:'通过'});report.passed=true;
}catch{report.passed=false;report.failedStage=stage;process.exitCode=1;}
finally{
  if(created)try{await api('DELETE',`/api/subscriptions/${created.id}`);}catch{report.cleanup='待人工检查';process.exitCode=1;}
  report.requests=requests;report.finishedAt=new Date().toISOString();await fs.mkdir('artifacts',{recursive:true});
  await fs.writeFile('artifacts/reminder-probe-remote.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}
