import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import ICAL from 'ical.js';
import {changedDeviceZone} from '../../static/calendar-reminders/device-time.mjs';
import {reminderTestICS} from '../../static/calendar-reminders/reminder-test.mjs';

test('device date crosses midnight locally, independently of reminder timezone',()=>{
  const script=`import {deviceDate,nextLocalMidnight} from './static/calendar-reminders/device-time.mjs';
    const now=new Date('2026-12-31T16:30:00Z');
    console.log(JSON.stringify([deviceDate(now),nextLocalMidnight(now)]));`;
  const read=TZ=>JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env:{...process.env,TZ}}));
  assert.equal(read('Asia/Shanghai')[0],'2027-01-01');
  assert.equal(read('America/Vancouver')[0],'2026-12-31');
  assert.equal(read('Asia/Shanghai')[1],23.5*3600000+50);
});
test('travel asks before changing reminders, but intentional differences and unknown zones do not switch',()=>{
  assert.equal(changedDeviceZone('Asia/Shanghai','Europe/Paris','Asia/Shanghai'),true);
  assert.equal(changedDeviceZone('Europe/Paris','Europe/Paris','Asia/Shanghai'),false);
  assert.equal(changedDeviceZone('Asia/Shanghai','Europe/Paris','Europe/Paris'),false);
  assert.equal(changedDeviceZone('Asia/Shanghai','','Asia/Shanghai'),false);
  assert.equal(changedDeviceZone('','Europe/Paris','Asia/Shanghai'),false);
});
test('ten minute test keeps its actual instant across DST rollback',()=>{
  for(const iso of ['2026-11-01T08:55:45Z','2026-11-01T09:05:21Z','2026-12-31T23:55:00Z']) {
    const now=new Date(iso), {content,at}=reminderTestICS(now);
    assert.equal(at-now,600000);
    const event=new ICAL.Component(ICAL.parse(content)).getFirstSubcomponent('vevent');
    const trigger=event.getFirstSubcomponent('valarm').getFirstPropertyValue('trigger');
    assert.equal(trigger.toJSDate().getTime(),at.getTime());
    assert.equal(event.getFirstPropertyValue('dtstart').toJSDate().getTime(),at.getTime());
  }
});
