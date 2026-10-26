import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ICAL from 'ical.js';
import {defaults, selectOccurrences, exportICS, zonedInstant, normalizeSettings,
  validateSettings, addDays, rangeEnd} from '../../static/calendar-reminders/core.mjs';
import {applyPreset} from '../../static/calendar-reminders/presets.mjs';
const data=JSON.parse(fs.readFileSync('static/calendar-reminders/calendar-data.json','utf8'));
const makeSettings=()=>applyPreset(defaults(data.catalog,'America/Vancouver'),data.catalog,'guru');
const window={start:'2026-10-20',end:'2028-10-19'};
const parsed=ics=>new ICAL.Component(ICAL.parse(ics));

test('new visitors begin empty and an explicit guru preset continues beyond the old snapshot',()=>{
  const empty=defaults(data.catalog,'America/Vancouver');
  assert.ok(Object.values(empty.events).every(pref=>pref.mode==='off'));
  assert.deepEqual(selectOccurrences(data,empty,window),[]);
  assert.deepEqual(normalizeSettings(empty,data.catalog),empty);
  const settings=applyPreset(empty,data.catalog,'guru');
  assert.equal(settings.version,2);
  assert.deepEqual(Object.entries(settings.events).filter(([,p])=>p.mode!=='off').map(([id])=>id).sort(),['guru-tsok']);
  const selected=selectOccurrences(data,settings,window);
  assert.ok(selected.some(e=>e.date>'2027-05-06'));
  assert.ok(selected.some(e=>e.date.startsWith('2028')));
});

test('v1 migration preserves old effective choices without selecting new observances',()=>{
  const old={version:1,zone:'Asia/Shanghai',start:'2026-01-01',months:3,groups:{
    tsok:{mode:'off',reminders:[{daysBefore:0,time:'09:00'}]},
    masters:{mode:'display',reminders:[{daysBefore:1,time:'20:00'}]},
    buddha:{mode:'off',reminders:[{daysBefore:0,time:'08:00'}]}
  },overrides:{'guru-tsok':{mode:'remind',reminders:[{daysBefore:1,time:'20:00'}]}}};
  const migrated=normalizeSettings(old,data.catalog);
  assert.equal(migrated.zone,'Asia/Shanghai');
  assert.deepEqual(migrated.events['guru-tsok'],old.overrides['guru-tsok']);
  assert.equal(migrated.events['dakini-tsok'].mode,'off');
  assert.equal(migrated.events['jigme-lingpa'].mode,'display');
  const known=['guru-tsok','dakini-tsok','jigme-lingpa','longchenpa','jigme-phuntsok','mipham','buddha-birth','saga-dawa','turning-wheel','lhabab'];
  assert.ok(data.catalog.events.filter(e=>!known.includes(e.id)).every(e=>migrated.events[e.id].mode==='off'));
  assert.ok(!Object.hasOwn(migrated,'start')&&!Object.hasOwn(migrated,'months'));
});

test('saved v2 selections keep both tsok days and their reminder times',()=>{
  const old=makeSettings();
  old.events['guru-tsok'].reminders=[{daysBefore:1,time:'20:00'},{daysBefore:0,time:'09:00'}];
  old.events['dakini-tsok']={mode:'remind',reminders:[{daysBefore:0,time:'10:30'}]};
  assert.deepEqual(normalizeSettings(old,data.catalog),old);
});

test('strict validation rejects malformed settings while browser recovery preserves modes',()=>{
  const invalid=makeSettings();invalid.events['guru-tsok'].reminders=[{daysBefore:0,time:'99:99'}];
  assert.throws(()=>validateSettings(invalid,data.catalog),/提醒时间/);
  const recovered=normalizeSettings(invalid,data.catalog);
  assert.equal(recovered.events['guru-tsok'].mode,'remind');
  assert.equal(recovered.events['guru-tsok'].reminders[0].time,'08:00');
  assert.throws(()=>validateSettings({...makeSettings(),zone:'Moon/Base'},data.catalog),/格式/);
  const unknown=makeSettings();unknown.events.injection={mode:'display',reminders:[]};
  assert.throws(()=>validateSettings(unknown,data.catalog),/目录/);
  const older=makeSettings();delete older.events['guru-tsok'];
  assert.equal(validateSettings(older,data.catalog).events['guru-tsok'].mode,'off');
});

test('individual preferences are independent and empty selection stays empty',()=>{
  const settings=makeSettings();settings.events['dakini-tsok'].mode='display';
  const selected=selectOccurrences(data,settings,window);
  assert.ok(selected.filter(e=>e.id==='guru-tsok').every(e=>e.preference.mode==='remind'));
  assert.ok(selected.filter(e=>e.id==='dakini-tsok').every(e=>e.preference.mode==='display'));
  for(const pref of Object.values(settings.events))pref.mode='off';
  assert.deepEqual(selectOccurrences(data,settings,window),[]);
  assert.equal(rangeEnd('2026-01-31',1),'2026-02-27');
});

test('alarm timezones handle DST without moving all-day dates',()=>{
  assert.equal(zonedInstant('2026-10-22','08:00','America/Vancouver').toISOString(),'2026-10-22T15:00:00.000Z');
  assert.equal(zonedInstant('2026-11-22','08:00','America/Vancouver').toISOString(),'2026-11-22T15:00:00.000Z');
  assert.equal(zonedInstant('2026-10-22','08:00','Asia/Shanghai').toISOString(),'2026-10-22T00:00:00.000Z');
  assert.equal(zonedInstant('2027-03-14','02:30','America/Los_Angeles').toISOString(),'2027-03-14T10:30:00.000Z');
  assert.equal(zonedInstant('2026-11-01','01:30','America/Los_Angeles').toISOString(),'2026-11-01T08:30:00.000Z');
});

test('independent iCalendar parser validates UTF-8, all-day dates and two alarm instants',()=>{
  const settings=makeSettings();settings.events['guru-tsok'].reminders=[{daysBefore:0,time:'08:00'},{daysBefore:1,time:'20:00'}];
  settings.events['dakini-tsok'].mode='display';
  const events=selectOccurrences(data,settings,{start:'2026-10-20',end:'2026-12-31'});
  const ics=exportICS(events,{zone:settings.zone,generatedAt:new Date('2026-10-20T00:00:00Z')});
  assert.ok(ics.endsWith('\r\n'));
  for(const line of ics.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75);
  const vevents=parsed(ics).getAllSubcomponents('vevent');
  assert.equal(vevents.length,events.length);
  for(let i=0;i<events.length;i++){
    const event=vevents[i],source=events[i];
    assert.equal(event.getFirstPropertyValue('dtstart').isDate,true);
    assert.equal(event.getFirstPropertyValue('dtstart').toString(),source.date);
    assert.equal(event.getFirstPropertyValue('dtend').toString(),addDays(source.date,1));
    assert.equal(event.getFirstPropertyValue('summary'),source.title);
    const alarms=event.getAllSubcomponents('valarm');
    assert.equal(alarms.length,source.preference.mode==='remind'?2:0);
    if(alarms.length)assert.equal(alarms[1].getFirstPropertyValue('trigger').toJSDate().toISOString(),
      zonedInstant(addDays(source.date,-1),'20:00',settings.zone).toISOString());
  }
  const special={...events[0],title:'测试,分号;反斜杠\\换行\n中文字'.repeat(12)};
  assert.equal(parsed(exportICS([special],{zone:settings.zone})).getFirstSubcomponent('vevent').getFirstPropertyValue('summary'),special.title);
});

test('subscription revisions preserve UID and timestamps and cancellation has no alarm',()=>{
  const settings=makeSettings(),event=selectOccurrences(data,settings,window)[0];
  event.sequence=3;event.createdAt='2026-10-20T00:00:00Z';event.lastModified='2026-10-21T00:00:00Z';
  const active=parsed(exportICS([event],{zone:settings.zone})).getFirstSubcomponent('vevent');
  const cancelled=parsed(exportICS([{...event,status:'CANCELLED',sequence:4}],{zone:settings.zone})).getFirstSubcomponent('vevent');
  assert.equal(active.getFirstPropertyValue('uid'),cancelled.getFirstPropertyValue('uid'));
  assert.equal(cancelled.getFirstPropertyValue('sequence'),4);
  assert.equal(cancelled.getFirstPropertyValue('status'),'CANCELLED');
  assert.equal(cancelled.getAllSubcomponents('valarm').length,0);
  assert.equal(active.getFirstPropertyValue('dtstamp').toJSDate().toISOString(),'2026-10-21T00:00:00.000Z');
  assert.equal(active.getFirstPropertyValue('created').toJSDate().toISOString(),'2026-10-20T00:00:00.000Z');
  event.preference.reminders=[{daysBefore:0,time:'08:00'},{daysBefore:0,time:'08:00'}];
  assert.equal(parsed(exportICS([event],{zone:settings.zone})).getFirstSubcomponent('vevent').getAllSubcomponents('valarm').length,1);
});

test('browser exports ignore supplied alarm instants while publication exports strictly validate their own ledger',()=>{
  const settings=makeSettings(),event=selectOccurrences(data,settings,window)[0];
  const baseline=parsed(exportICS([event],{zone:settings.zone})).getFirstSubcomponent('vevent');
  const supplied={...event,alarmInstants:['2030-01-01T00:00:00.000Z']};
  const direct=parsed(exportICS([supplied],{zone:settings.zone})).getFirstSubcomponent('vevent');
  assert.equal(direct.getFirstSubcomponent('valarm').getFirstPropertyValue('trigger').toString(),
    baseline.getFirstSubcomponent('valarm').getFirstPropertyValue('trigger').toString());
  const published=parsed(exportICS([supplied],{zone:settings.zone,usePublishedAlarmInstants:true})).getFirstSubcomponent('vevent');
  assert.equal(published.getFirstSubcomponent('valarm').getFirstPropertyValue('trigger').toString(),'2030-01-01T00:00:00Z');
  for(const alarmInstants of [undefined,[],['invalid'],['2030-02-30T00:00:00.000Z'],['2030-01-01T00:00:00Z'],
    ['2030-01-01T00:00:00.000Z\r\nACTION:AUDIO']]) {
    assert.throws(()=>exportICS([{...event,alarmInstants}],{zone:settings.zone,usePublishedAlarmInstants:true}),/已发布的提醒时间无效/);
  }
  const cancelled=parsed(exportICS([{...supplied,status:'CANCELLED'}],{zone:settings.zone,usePublishedAlarmInstants:true})).getFirstSubcomponent('vevent');
  assert.equal(cancelled.getAllSubcomponents('valarm').length,0);
});
