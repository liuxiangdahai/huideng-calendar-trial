import fs from 'node:fs';
import assert from 'node:assert/strict';
import ICAL from 'ical.js';
import {defaults} from '../../static/calendar-reminders/core.mjs';
import {applyPreset} from '../../static/calendar-reminders/presets.mjs';

const base = new URL(process.argv[2] || 'http://127.0.0.1:8787');
if (!['localhost','127.0.0.1','[::1]'].includes(base.hostname)) throw new Error('This check is restricted to a local service.');
const data = JSON.parse(fs.readFileSync('static/calendar-reminders/calendar-data.json','utf8'));
const settings = applyPreset(defaults(data.catalog,'Asia/Shanghai'),data.catalog,'tsok');
let subscription;
async function call(method, pathname, body) {
  const response = await fetch(new URL(pathname,base),{method,headers:{Origin:base.origin,
    ...(body ? {'Content-Type':'application/json'} : {}),
    ...(subscription ? {Authorization:`Bearer ${subscription.manageToken}`} : {})},
    body:body ? JSON.stringify(body) : undefined});
  const result = await response.json();
  assert.ok(response.ok,`${method} returned ${response.status}: ${result.error || ''}`);
  return result;
}
const events = text => new ICAL.Component(ICAL.parse(text)).getAllSubcomponents('vevent');
try {
  subscription = await call('POST','/api/subscriptions',{settings});
  const first = await fetch(subscription.feedUrl);
  assert.equal(first.status,200);
  const content = await first.text(), initial = events(content);
  assert.ok(initial.length>24);
  assert.ok(!content.includes(subscription.manageToken));
  const ids = new Set(initial.map(e=>e.getFirstPropertyValue('uid')));
  const unchanged = await fetch(subscription.feedUrl,{headers:{'If-None-Match':first.headers.get('ETag')}});
  assert.equal(unchanged.status,304);
  const managed = await call('GET',`/api/subscriptions/${subscription.id}`);
  assert.equal(managed.feedUrl,subscription.feedUrl);
  settings.events['guru-tsok'].mode='off';
  const updated = await call('PATCH',`/api/subscriptions/${subscription.id}`,{settings,revision:managed.revision});
  assert.equal(updated.feedUrl,subscription.feedUrl);
  const after = events(await (await fetch(subscription.feedUrl)).text());
  const cancelled = after.filter(e=>e.getFirstPropertyValue('status')==='CANCELLED');
  assert.ok(cancelled.length>0);
  assert.ok(cancelled.every(e=>ids.has(e.getFirstPropertyValue('uid')) && e.getAllSubcomponents('valarm').length===0));
  settings.zone='America/Vancouver';
  for (const preference of Object.values(settings.events)) {
    preference.mode='remind';
    preference.reminders=[{daysBefore:0,time:'01:30'},{daysBefore:1,time:'20:00'}];
  }
  await call('PATCH',`/api/subscriptions/${subscription.id}`,{settings,revision:updated.revision});
  const fullResponse=await fetch(subscription.feedUrl);
  assert.equal(fullResponse.status,200);
  const full=events(await fullResponse.text());
  assert.ok(full.length>initial.length*3);
  assert.equal(new Set(full.map(e=>e.getFirstPropertyValue('uid'))).size,full.length);
  assert.ok(full.every(e=>e.getFirstPropertyValue('status')==='CONFIRMED' && e.getAllSubcomponents('valarm').length===2));
  await call('DELETE',`/api/subscriptions/${subscription.id}`);
  const stopped = events(await (await fetch(subscription.feedUrl)).text());
  assert.ok(stopped.every(e=>e.getFirstPropertyValue('status')==='CANCELLED'));
  console.log(`本地联调通过：两个荟供日 ${initial.length} 条，全目录双提醒 ${full.length} 条；地址、缓存、修改与撤销已验证。`);
} finally {
  if (subscription) await call('DELETE',`/api/subscriptions/${subscription.id}`).catch(()=>{});
}
