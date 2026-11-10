import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeFor} from '../../tools/calendar/smoke-scope.mjs';

test('interface-only releases run the light acceptance test',()=>{
 assert.equal(scopeFor(['static/calendar-reminders/app.mjs','static/calendar-reminders/style.css','static/calendar-reminders/mobile-tabs.mjs','tests/browser/calendar.spec.mjs','docs/notes.md']),'light');
 assert.equal(scopeFor([]),'light');
});
test('anything that can change feed content or storage runs the full test',()=>{
 for(const file of ['service/calendar/service.mjs','service/calendar/migrations/0004_x.sql','service/gateway/gateway.mjs',
  'static/calendar-reminders/core.mjs','static/calendar-reminders/presets.mjs','static/calendar-reminders/calendar-data.json',
  'static/calendar-reminders/feeds/practice.ics','data/fohui.json','tools/calendar/smoke-remote.mjs','tools/calendar/build.mjs','package-lock.json'])
  assert.equal(scopeFor(['static/calendar-reminders/app.mjs',file]),'full',file);
});
test('an unknown change set is tested in full',()=>{assert.equal(scopeFor(null),'full');});
