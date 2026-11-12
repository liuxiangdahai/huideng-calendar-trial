// Fixture-only end-to-end regression: source correction -> real build -> the
// real service and SQLite -> unchanged feed URL, monotonic versions and alarms.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import ICAL from 'ical.js';
import {readSourceState} from '../../tools/calendar/fohui-maintenance-core.mjs';
import {diffSource,mergeSource} from '../../tools/calendar/fohui-source.mjs';
import {createCalendarService} from '../../service/calendar/service.mjs';
import {SQLiteD1} from '../../service/calendar/sqlite-d1.mjs';
import {validateSettings,selectOccurrences,exportICS} from '../../static/calendar-reminders/core.mjs';

test('source correction, withdrawal and restoration update the same subscription and UID',async t=>{
  const temporaryRoot=await fs.realpath(tmpdir()),root=await fs.mkdtemp(path.join(temporaryRoot,'fohui-lifecycle-'));
  const db=new SQLiteD1(path.join(root,'test.sqlite'));
  t.after(async()=>{db.close();assert.equal(path.dirname(await fs.realpath(root)),temporaryRoot);assert.ok(path.basename(root).startsWith('fohui-lifecycle-'));await fs.rm(root,{recursive:true,force:true});});
  let state=await readSourceState(),data,version,current;
  const original=state.ledger.records.find(r=>r.sourceLabel==='春分');
  const target=new Date(Date.parse(original.date)-86400000).toISOString().slice(0,10);
  current=new Date(Date.parse(target)-7*86400000);
  await fs.mkdir(path.join(root,'data/calendar'),{recursive:true});
  const build=async()=>{
    for(const [file,value] of [['fohui-dates',state.existing],['catalog',state.catalog],['published-record-ids',state.ledger]])await fs.writeFile(path.join(root,`data/calendar/${file}.json`),JSON.stringify(value));
    execFileSync(process.execPath,[path.resolve('tools/calendar/build.mjs')],{cwd:root,stdio:'pipe'});
    const text=await fs.readFile(path.join(root,'static/calendar-reminders/calendar-data.json'),'utf8');
    data=JSON.parse(text);version=createHash('sha256').update(text).digest('hex');current=new Date(current.getTime()+60000);
  };
  const change=async(incoming,acceptRemovals=false)=>{
    const changes=diffSource({...state,incoming});
    const merged=mergeSource({...state,incoming,changes,snapshots:[],retrievedOn:'2026-11-10',acceptRemovals});
    state={...state,existing:merged.source,ledger:merged.ledger};await build();return changes;
  };
  await build();
  const base='https://calendar.example.org',origin='https://www.example.org';
  const service=createCalendarService({getData:()=>data,validateSettings,selectOccurrences,exportICS,now:()=>current,
    getRelease:()=>({version:'fixture-build',dataVersion:version,rendererVersion:'fixture-renderer',environment:'acceptance'})});
  const env={DB:db,PUBLIC_BASE_URL:base,ALLOWED_ORIGINS:origin,RATE_LIMIT_SALT:'fixture-only'};
  const fetch=(url,init={})=>service.fetch(new Request(new URL(url,base),init),env);
  const selected={version:2,zone:'Asia/Shanghai',includeDailyDates:false,events:{[original.eventId]:{mode:'remind',reminders:[{daysBefore:0,time:'08:00'}]}}};
  const create=await fetch('/api/subscriptions',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({settings:selected})});
  assert.equal(create.status,201);const subscription=await create.json();
  const entries=async()=>new ICAL.Component(ICAL.parse(await(await fetch(subscription.feedUrl)).text())).getAllSubcomponents('vevent');
  const entry=async()=> (await entries()).find(e=>e.getFirstPropertyValue('uid').includes(original.recordId));
  const first=await entry(),uid=first.getFirstPropertyValue('uid');
  assert.equal(first.getAllSubcomponents('valarm').length,1);
  let incoming=structuredClone(state.existing.days.filter(d=>d.date.slice(0,7)===original.date.slice(0,7)));
  incoming.find(d=>d.date===original.date).labels=incoming.find(d=>d.date===original.date).labels.filter(l=>l!=='春分');
  incoming.find(d=>d.date===target).labels.push('春分');
  const moves=await change(incoming);assert.equal(moves[0].recordId,original.recordId);
  const moved=await entry();assert.equal(moved.getFirstPropertyValue('uid'),uid);assert.equal(moved.getFirstPropertyValue('sequence'),1);
  assert.equal(moved.getFirstPropertyValue('dtstart').toString(),target);assert.equal(moved.getAllSubcomponents('valarm').length,1);
  incoming=structuredClone(incoming);incoming.find(d=>d.date===target).labels=incoming.find(d=>d.date===target).labels.filter(l=>l!=='春分');
  await change(incoming,true);
  assert.equal(await entry(),undefined,'a withdrawn source event must leave the feed, including its alarms');
  const tombstone=await db.prepare('SELECT sequence,cancelled_at FROM calendar_entries WHERE uid LIKE ?').bind(`%${original.recordId}%`).first();
  assert.equal(tombstone.sequence,2);assert.ok(tombstone.cancelled_at);
  incoming.find(d=>d.date===target).labels.push('春分');
  const restoredChanges=await change(incoming);assert.equal(restoredChanges[0].kind,'restored');
  const restored=await entry();assert.equal(restored.getFirstPropertyValue('uid'),uid);assert.equal(restored.getFirstPropertyValue('sequence'),3);assert.equal(restored.getFirstPropertyValue('status'),'CONFIRMED');assert.equal(restored.getAllSubcomponents('valarm').length,1);
  const last=await fetch(subscription.feedUrl);
  assert.equal((await fetch(subscription.feedUrl,{headers:{'If-None-Match':last.headers.get('etag')}})).status,304);
  const saved=await(await fetch(`/api/subscriptions/${subscription.id}`,{headers:{Origin:origin,Authorization:`Bearer ${subscription.manageToken}`}})).json();
  assert.deepEqual(saved.settings,subscription.settings);assert.equal(saved.feedUrl,subscription.feedUrl);assert.equal(saved.revision,1);
});
