import test from 'node:test';
import assert from 'node:assert/strict';
import ICAL from 'ical.js';
import data from '../../static/calendar-reminders/calendar-data.json' with {type:'json'};
import {SQLiteD1} from '../../service/calendar/sqlite-d1.mjs';
import {createCalendarService} from '../../service/calendar/service.mjs';
import {reminderProbeAdapters} from '../../service/calendar/reminder-probe.mjs';
import {makeProbeSettings, probeExpiry, probeSchedule} from '../../static/calendar-reminders/reminder-probe-model.mjs';
import {exportICS,resolveAlarmInstants} from '../../static/calendar-reminders/core.mjs';

const ORIGIN='https://huideng-calendar-acceptance.pages.dev';
const entries=text=>new ICAL.Component(ICAL.parse(text)).getAllSubcomponents('vevent');
const byID=(list,id)=>list.find(e=>e.getFirstPropertyValue('uid')===`reminder-probe-${id}@calendar.huidengvan.org`);
function fixture(t,enabled=true) {
  let time=new Date('2026-11-03T06:00:00Z');
  const DB=new SQLiteD1(':memory:');t.after(()=>DB.close());
  const adapters=reminderProbeAdapters({enabled,now:()=>time});
  const service=createCalendarService({getData:()=>data,...adapters,now:()=>time});
  const env={DB,PUBLIC_BASE_URL:ORIGIN,ALLOWED_ORIGINS:ORIGIN,RATE_LIMIT_SALT:'probe-tests'};
  const fetch=(path,options={})=>service.fetch(new Request(new URL(path,ORIGIN),options),env);
  const api=(path,method,body,token,key)=>fetch(path,{method,headers:{Origin:ORIGIN,'Content-Type':'application/json',
    ...(token?{Authorization:`Bearer ${token}`} :{}),...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {DB,adapters,fetch,api,settings:()=>makeProbeSettings('Asia/Shanghai',time),setTime:value=>{time=new Date(value);},
    create:async(settings=makeProbeSettings('Asia/Shanghai',time))=>{
      const r=await api('/api/subscriptions','POST',{settings});assert.equal(r.status,201,await r.clone().text());return r.json();
    }};
}
test('probe uses real saved settings and ledger; A baseline, B relative, C timed, D double, E/F silent',async t=>{
  const f=fixture(t),created=await f.create();
  const saved=await (await f.api(`/api/subscriptions/${created.id}`,'GET',null,created.manageToken)).json();
  assert.deepEqual(saved.settings,created.settings);
  const r=await f.fetch(created.feedUrl),text=await r.text(),list=entries(text);
  assert.equal(list.length,6);assert.doesNotMatch(text,/\r\r|manageToken|Bearer/);
  for (const id of ['a','b','d','e','f']) assert.equal(byID(list,id).getFirstPropertyValue('dtstart').isDate,true);
  assert.equal(byID(list,'c').getFirstPropertyValue('dtstart').isDate,false);
  assert.equal(byID(list,'a').getFirstSubcomponent('valarm').getFirstPropertyValue('trigger').toString(),'2026-11-03T06:30:00Z');
  assert.equal(byID(list,'b').getFirstSubcomponent('valarm').getFirstPropertyValue('trigger').toSeconds(),(14*60+33)*60);
  assert.equal(byID(list,'c').getFirstSubcomponent('valarm').getFirstPropertyValue('trigger').toSeconds(),0);
  assert.equal(byID(list,'c').getFirstPropertyValue('dtstart').toString(),'2026-11-03T06:36:00Z');
  assert.equal(byID(list,'d').getAllSubcomponents('valarm').length,2);
  for(const id of ['e','f'])assert.equal(byID(list,id).getAllSubcomponents('valarm').length,0);
  const occurrences=f.adapters.selectOccurrences(data,created.settings,{}),a=occurrences.find(e=>e.id==='probe-a');
  const baseline=entries(exportICS([a],{zone:created.settings.zone}))[0];
  assert.deepEqual(byID(list,'a').getFirstSubcomponent('valarm').toJSON(),baseline.getFirstSubcomponent('valarm').toJSON());
  const writes=(await f.DB.prepare('SELECT render_version FROM subscriptions').first()).render_version;
  assert.equal((await f.fetch(created.feedUrl,{headers:{'If-None-Match':r.headers.get('etag')}})).status,304);
  assert.equal(await (await f.fetch(created.feedUrl,{method:'HEAD'})).text(),'');
  assert.equal((await f.DB.prepare('SELECT render_version FROM subscriptions').first()).render_version,writes);
});
test('same probe address and UID survive reschedule, cancellation and stop; versions advance and no silent alarm leaks',async t=>{
  const f=fixture(t),c=await f.create();let settings=c.settings,revision=1;
  const initial=entries(await (await f.fetch(c.feedUrl)).text());
  const patch=async()=>{const r=await f.api(`/api/subscriptions/${c.id}`,'PATCH',{settings,revision},c.manageToken);assert.equal(r.status,200,await r.clone().text());const saved=await r.json();revision=saved.revision;assert.equal(saved.feedUrl,c.feedUrl);return entries(await (await f.fetch(c.feedUrl)).text());};
  f.setTime('2026-11-03T06:01:00Z');settings.reminderProbe.startAt='2026-11-03T07:00:00.000Z';
  const moved=await patch();
  assert.equal(byID(moved,'a').getFirstPropertyValue('sequence'),byID(initial,'a').getFirstPropertyValue('sequence')+1);
  assert.equal(byID(moved,'a').getFirstSubcomponent('valarm').getFirstPropertyValue('trigger').toString(),'2026-11-03T07:00:00Z');
  settings.reminderProbe.silent=['a'];let list=await patch();assert.equal(byID(list,'a').getAllSubcomponents('valarm').length,0);
  settings.reminderProbe.omit=['a'];list=await patch();assert.equal(byID(list,'a').getFirstPropertyValue('status'),'CANCELLED');
  settings.reminderProbe.omit=[];settings.reminderProbe.silent=[];list=await patch();assert.equal(byID(list,'a').getFirstPropertyValue('sequence'),4);
  assert.equal((await f.api(`/api/subscriptions/${c.id}`,'DELETE',null,c.manageToken)).status,200);
  const stopped=await (await f.fetch(c.feedUrl)).text();assert.doesNotMatch(stopped,/BEGIN:VALARM/);
  assert.equal(entries(stopped).every(e=>e.getFirstPropertyValue('status')==='CANCELLED'),true);
});
test('probe expires at 72 hours even with a fresh snapshot; expiry produces cancellation once',async t=>{
  const f=fixture(t),c=await f.create();await f.fetch(c.feedUrl);
  const expiry=probeExpiry(c.settings.reminderProbe);
  f.setTime(new Date(Date.parse(expiry)-60000));await f.fetch(c.feedUrl);
  assert.equal((await f.DB.prepare('SELECT expires_at FROM feed_snapshots').first()).expires_at,expiry);
  f.setTime(expiry);const text=await (await f.fetch(c.feedUrl)).text();
  assert.doesNotMatch(text,/BEGIN:VALARM/);assert.equal(entries(text).every(e=>e.getFirstPropertyValue('status')==='CANCELLED'),true);
  const writes=(await f.DB.prepare('SELECT render_version FROM subscriptions').first()).render_version;
  await f.fetch(c.feedUrl);assert.equal((await f.DB.prepare('SELECT render_version FROM subscriptions').first()).render_version,writes);
});
test('trial rejects probe settings before writes; forged types, mixed dates and mutation of anchor are rejected',async t=>{
  const trial=fixture(t,false);
  assert.equal((await trial.api('/api/subscriptions','POST',{settings:trial.settings()})).status,400);
  assert.equal((await trial.DB.prepare('SELECT COUNT(*) AS n FROM subscriptions').first()).n,0);
  const f=fixture(t),c=await f.create();
  for(const change of [s=>s.includeDailyDates=true,s=>s.reminderProbe.anchor='2026-11-03T06:01:00.000Z',
    s=>s.reminderProbe.startAt='2026-12-03T06:00:00.000Z',s=>s.reminderProbe.omit=['unknown'],s=>delete s.reminderProbe]) {
    const settings=structuredClone(c.settings);change(settings);
    assert.equal((await f.api(`/api/subscriptions/${c.id}`,'PATCH',{revision:1,settings},c.manageToken)).status,400);
  }
});
test('probe creation response replay does not duplicate subscriptions or reset time',async t=>{
  const f=fixture(t),settings=f.settings(),key=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const a=await (await f.api('/api/subscriptions','POST',{settings},null,key)).json();
  f.setTime('2026-11-03T06:10:00Z');
  const b=await (await f.api('/api/subscriptions','POST',{settings},null,key)).json();
  assert.equal(a.feedUrl,b.feedUrl);assert.equal(a.manageToken,b.manageToken);
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM subscriptions').first()).n,1);
});
test('probe absolute alarms retain instants across midnight, year end and Vancouver DST boundary',()=>{
  for(const zone of ['Asia/Shanghai','America/Vancouver','Asia/Kathmandu'])for(const anchor of ['2026-12-31T15:25:00Z','2027-03-14T09:25:00Z','2027-11-07T08:25:00Z']) {
    const now=new Date(anchor),settings=makeProbeSettings(zone,now);
    const adapters=reminderProbeAdapters({enabled:true,now:()=>now});
    const selected=adapters.selectOccurrences(data,settings,{}),schedule=probeSchedule(settings);
    for(const id of ['a','d'])assert.deepEqual(resolveAlarmInstants(selected.find(e=>e.id===`probe-${id}`),zone),schedule.find(e=>e.id===id).instants);
  }
});
