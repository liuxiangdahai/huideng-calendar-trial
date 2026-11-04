import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {eventDateHint} from '../../static/calendar-reminders/event-presentation.mjs';
const data=JSON.parse(fs.readFileSync('static/calendar-reminders/calendar-data.json','utf8'));
const hint=(id,today)=>eventDateHint(data.catalog.events.find(e=>e.id===id),data,today);

test('法会使用每次来源日期：结束日不从上一年外推',()=>{
  assert.equal(hint('longevity-assembly-end','2026-03-28'),'2026年3月28日 · 藏历二月初十');
  assert.equal(hint('longevity-assembly-end','2026-03-29'),'2027年3月18日 · 藏历二月十一');
  assert.equal(hint('longevity-assembly-end','2027-03-19'),'下次日期待确认');
  assert.equal(hint('vajrasattva-assembly-start','2026-11-04'),'下次日期待确认');
  assert.equal(hint('vidyadhara-assembly-start','2026-11-04'),'2027年2月7日 · 藏历一月初一');
});
test('修行月已确认的固定规则保留，日期提示不修改安排',()=>{
  const before=JSON.stringify(data);
  assert.equal(hint('miracles-month','2027-05-07'),'藏历一月初一');
  assert.equal(hint('guru-tsok','2027-05-07'),data.catalog.events.find(e=>e.id==='guru-tsok').ruleLabel);
  assert.equal(JSON.stringify(data),before);
});
