import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {defaults,normalizeSettings} from '../../static/calendar-reminders/core.mjs';
import {presetIds,applyPreset,matchingPreset} from '../../static/calendar-reminders/presets.mjs';
import {timeComparison} from '../../static/calendar-reminders/time-comparison.mjs';
import {zoneInfo,wallTimeInZone} from '../../static/calendar-reminders/timezones.mjs';
const catalog=JSON.parse(readFileSync('data/calendar/catalog.json','utf8'));
test('preset ranges retain all four eclipses but exclude every solar term and other commemoration',()=>{
  assert.deepEqual(presetIds(catalog,'guru'),['guru-tsok']);
  assert.equal(presetIds(catalog,'tsok').length,2);
  const selected=new Set(presetIds(catalog,'practice'));assert.equal(selected.size,54);
  for(const event of catalog.events){if(event.tags?.includes('eclipse'))assert.ok(selected.has(event.id));if(event.tags?.includes('solar-term')||event.group==='other')assert.ok(!selected.has(event.id));}
  const expanded=structuredClone(catalog);expanded.events.push({id:'new-solar-term',group:'nature',tags:['solar-term']});assert.equal(presetIds(expanded,'practice').length,54);
});
test('presets preserve existing reminders and zone, replace scope, and never expand saved selections',()=>{
  const old=applyPreset(defaults(catalog,'America/New_York'),catalog,'guru');old.events['guru-tsok'].reminders=[{daysBefore:1,time:'21:30'},{daysBefore:0,time:'06:15'}];old.events['dakini-tsok'].mode='display';
  old.events['jigme-lingpa']={mode:'remind',reminders:[{daysBefore:1,time:'19:30'}]};
  const next=applyPreset(old,catalog,'practice');assert.equal(next.zone,old.zone);assert.deepEqual(next.events['guru-tsok'],old.events['guru-tsok']);assert.deepEqual(next.events['dakini-tsok'],{mode:'remind',reminders:[{daysBefore:0,time:'08:00'}]});assert.equal(matchingPreset(next,catalog),'practice');
  assert.equal(Object.values(next.events).filter(pref=>pref.mode==='remind').length,2);
  assert.equal(Object.values(next.events).filter(pref=>pref.mode==='display').length,52);
  assert.deepEqual(next.events['jigme-lingpa'],{mode:'display',reminders:old.events['jigme-lingpa'].reminders});
  assert.equal(old.events['jigme-lingpa'].mode,'remind');
  const customized=structuredClone(next);customized.events['jigme-lingpa'].mode='remind';assert.equal(matchingPreset(customized,catalog),'');
  assert.equal(old.events['dakini-tsok'].mode,'display');assert.equal(matchingPreset(applyPreset(next,catalog,'guru'),catalog),'guru');
  const expanded=structuredClone(catalog);expanded.events.push({id:'future-item',group:'buddha'});assert.equal(normalizeSettings(next,expanded).events['future-item'].mode,'off');
});
const compare=(iso,device,reminder)=>{const now=new Date(iso);return timeComparison(now,device,reminder,{deviceWall:wallTimeInZone(now,device)});};
test('clock comparison merges same zone and shows dates across the date line and non-hour offsets',()=>{
  const same=compare('2026-10-22T00:00:00Z','Asia/Shanghai','Asia/Shanghai');assert.equal(same.device.time,'08:00');assert.ok(same.merged);assert.equal(same.device.label,'北京时间');
  const before=compare('2026-10-22T00:00:00Z','Asia/Shanghai','America/New_York');assert.equal(before.reminder.date,'2026-10-21');assert.equal(before.reminder.dayLabel,'前一天');assert.equal(before.reminder.time,'20:00');
  const after=compare('2026-10-22T00:00:00Z','America/New_York','Asia/Kathmandu');assert.equal(after.reminder.dayLabel,'后一天');assert.equal(after.reminder.time,'05:45');
  assert.equal(compare('2026-10-22T00:00:00Z','Asia/Singapore','Asia/Shanghai').merged,false);
});
test('clock comparison uses instant-specific daylight time and never invents an unknown device zone',()=>{
  assert.equal(compare('2026-07-01T12:00:00Z','Asia/Shanghai','America/New_York').reminder.time,'08:00');
  assert.equal(compare('2026-12-01T12:00:00Z','Asia/Shanghai','America/New_York').reminder.time,'07:00');
  const unknown=timeComparison(new Date('2026-10-22T00:00:00Z'),'','',{deviceWall:'2026-10-22T13:00:00'});assert.equal(unknown.device.time,'13:00');assert.equal(unknown.device.label,'设备当地');assert.equal(unknown.reminder,null);
  assert.match(zoneInfo('Asia/Shanghai').search,/上海/);assert.match(zoneInfo('Asia/Shanghai').search,/北京/);assert.equal(zoneInfo('Asia/Singapore').label,'新加坡时间');
});
