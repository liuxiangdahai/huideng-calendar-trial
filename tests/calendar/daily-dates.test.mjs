import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import ICAL from 'ical.js';
import {ENGINE, tibetanDayDetails, dailyDateOccurrences, omittedTibetanDays} from '../../static/calendar-reminders/engine.mjs';
import {defaults, normalizeSettings, validateSettings, selectOccurrences, selectCalendarOccurrences,
  exportICS, resolveAlarmInstants, addDays} from '../../static/calendar-reminders/core.mjs';
import {applyPreset} from '../../static/calendar-reminders/presets.mjs';

const data = JSON.parse(readFileSync('static/calendar-reminders/calendar-data.json', 'utf8'));
const entries = text => new ICAL.Component(ICAL.parse(text)).getAllSubcomponents('vevent');

test('daily dates are opt-in; only explicit v2 booleans survive validation and browser recovery', () => {
  const blank = defaults(data.catalog, 'Asia/Shanghai');
  assert.equal(blank.includeDailyDates, false);
  const old = {...blank}; delete old.includeDailyDates;
  assert.equal(validateSettings(old, data.catalog).includeDailyDates, false);
  assert.equal(normalizeSettings(old, data.catalog).includeDailyDates, false);
  assert.equal(normalizeSettings({...old, version: 1, includeDailyDates: true}, data.catalog).includeDailyDates, false);
  for (const value of [null, 0, 1, '', 'true', 'false', [], {}]) {
    assert.throws(() => validateSettings({...old, includeDailyDates: value}, data.catalog), /每日藏历/);
    assert.equal(normalizeSettings({...old, includeDailyDates: value}, data.catalog).includeDailyDates, false);
  }
  const enabled = {...blank, includeDailyDates: true};
  assert.deepEqual(normalizeSettings(enabled, data.catalog), enabled);
  for (const id of ['guru', 'tsok', 'practice']) assert.equal(applyPreset(enabled, data.catalog, id).includeDailyDates, true);
});

test('real repeated days have different civil UIDs, explicit occurrence numbers and unchanged all-day dates', () => {
  const days = dailyDateOccurrences('2026-10-19', '2026-10-21');
  assert.deepEqual(days.map(day => [day.date, day.title]), [
    ['2026-10-19', '藏历九月初九（重日1）'],
    ['2026-10-20', '藏历九月初九（重日2）'],
    ['2026-10-21', '藏历九月初十']
  ]);
  assert.equal(new Set(days.map(day => day.uid)).size, 3);
  for (const day of days) {
    assert.equal(day.uid, `daily-date-${day.date}`);
    assert.deepEqual(dailyDateOccurrences(day.date, day.date), [day]);
  }
});

test('omitted day is described on the following real date, including month and year boundaries', () => {
  const cases = [
    {date: '2026-07-10', current: '五月廿六', missing: '五月廿五', year: 2026},
    {date: '2016-03-09', current: '二月初一', missing: '一月三十', year: 2016},
    {date: '2025-02-28', current: '一月初一', missing: '十二月三十', year: 2024}
  ];
  for (const {date, current, missing, year} of cases) {
    const detail = tibetanDayDetails(date);
    assert.equal(detail.display, current);
    assert.equal(detail.missingBefore.length, 1);
    assert.equal(detail.missingBefore[0].display, missing);
    assert.equal(detail.missingBefore[0].year, year);
    assert.match(detail.missingLabel, /缺日：.*已跳过/);
    assert.ok(dailyDateOccurrences(date, date)[0].description.includes(detail.missingLabel));
  }
  const days = dailyDateOccurrences('2026-07-09', '2026-07-10');
  assert.equal(days.length, 2);
  assert.ok(days.every(day => !day.title.includes('廿五')));
  assert.equal(tibetanDayDetails('2026-07-09').missingLabel, '');
});

test('leap months and the supported range endpoints remain explicit without invented neighbor dates', () => {
  const detail = tibetanDayDetails('2027-04-16');
  assert.equal(detail.monthLeap, true);
  assert.equal(dailyDateOccurrences('2027-04-16', '2027-04-16')[0].title, '藏历闰二月初十');
  for (const date of [ENGINE.supported.start, ENGINE.supported.end]) {
    assert.equal(dailyDateOccurrences(date, date).length, 1);
    assert.ok(tibetanDayDetails(date).fullLabel.startsWith('藏历'));
  }
  assert.deepEqual(tibetanDayDetails(ENGINE.supported.start).missingBefore, []);
  for (const date of ['1951-01-07', '2051-02-12', '2026-02-30']) assert.throws(() => dailyDateOccurrences(date, date), RangeError);
  assert.throws(() => dailyDateOccurrences('2026-10-21', '2026-10-20'), RangeError);
});

test('a boundary gap can describe both the previous month end and the following month start', () => {
  // Synthetic adjacent-day inputs exercise a future rule correction; the pinned
  // PRO dataset currently contains no two-consecutive-missing-day example.
  const previous = {year: 2024, yearName: '木龙', month: 12, monthLeap: false, day: 29};
  const next = {year: 2025, yearName: '木蛇', month: 1, monthLeap: false, day: 2};
  assert.deepEqual(omittedTibetanDays(previous, next).map(day => [day.year, day.display]),
    [[2024, '十二月三十'], [2025, '一月初一']]);
  const leap = {...next, month: 2, monthLeap: true};
  assert.deepEqual(omittedTibetanDays({...next, month: 2, day: 29}, leap).map(day => day.display),
    ['二月三十', '闰二月初一']);
  assert.deepEqual(omittedTibetanDays(next, {...next}), []);
});

test('calendar composition leaves the festival selector and its reminder counts unchanged', () => {
  const range = {start: '2026-10-01', end: '2026-10-31'};
  const settings = applyPreset(defaults(data.catalog, 'Asia/Shanghai'), data.catalog, 'practice');
  const festivalOnly = selectOccurrences(data, settings, range);
  settings.includeDailyDates = true;
  assert.deepEqual(selectOccurrences(data, settings, range), festivalOnly);
  const combined = selectCalendarOccurrences(data, settings, range);
  assert.equal(combined.length, festivalOnly.length + 31);
  assert.deepEqual(combined.filter(event => event.kind !== 'daily-date').map(event => event.uid).sort(), festivalOnly.map(event => event.uid).sort());
  assert.equal(combined.filter(event => event.preference.mode === 'remind').length, festivalOnly.filter(event => event.preference.mode === 'remind').length);
  assert.equal(new Set(combined.map(event => event.uid)).size, combined.length);
  const dailyOnly = {...defaults(data.catalog, 'Asia/Shanghai'), includeDailyDates: true};
  assert.equal(selectCalendarOccurrences(data, dailyOnly, range).length, 31);
});

test('daily ICS is transparent, all-day, PRO-attributed and has no alarm even if a caller changes its preference', () => {
  const events = dailyDateOccurrences('2026-07-09', '2026-07-10');
  const changed = {...events[1], preference: {mode: 'remind', reminders: [{daysBefore: 0, time: '08:00'}]}};
  assert.deepEqual(resolveAlarmInstants(changed, 'Asia/Shanghai'), []);
  const calendar = exportICS([events[0], changed], {zone: 'America/Vancouver', generatedAt: new Date('2026-07-01T00:00:00Z')});
  assert.doesNotMatch(calendar, /VALARM|佛慧法语|fohuifayu|原站标注/);
  const parsed = entries(calendar);
  for (let i = 0; i < parsed.length; i++) {
    assert.equal(parsed[i].getFirstPropertyValue('dtstart').isDate, true);
    assert.equal(parsed[i].getFirstPropertyValue('dtstart').toString(), events[i].date);
    assert.equal(parsed[i].getFirstPropertyValue('dtend').toString(), addDays(events[i].date, 1));
    assert.equal(parsed[i].getFirstPropertyValue('url'), ENGINE.url);
    assert.equal(parsed[i].getFirstPropertyValue('transp'), 'TRANSPARENT');
    assert.match(parsed[i].getFirstPropertyValue('description'), /日期换算：藏历 PRO/);
  }
  assert.match(parsed[1].getFirstPropertyValue('description'), /五月廿五.*已跳过/);
});

test('daily records are civil-date identical across reminder zones and process timezone DST boundaries', () => {
  const range = {start: '2026-10-31', end: '2026-11-02'};
  const selections = ['Asia/Shanghai', 'America/Vancouver', 'America/Los_Angeles'].map(zone =>
    selectCalendarOccurrences(data, {...defaults(data.catalog, zone), includeDailyDates: true}, range));
  assert.deepEqual(selections[0], selections[1]);
  assert.deepEqual(selections[1], selections[2]);
  const code = "import {dailyDateOccurrences} from './static/calendar-reminders/engine.mjs';" +
    "console.log(JSON.stringify([...dailyDateOccurrences('2026-10-31','2026-11-02'),...dailyDateOccurrences('2027-03-13','2027-03-15')]));";
  const outputs = ['Asia/Shanghai', 'America/Vancouver', 'America/Los_Angeles'].map(TZ =>
    execFileSync(process.execPath, ['--input-type=module', '-e', code], {encoding: 'utf8', env: {...process.env, TZ}}));
  assert.equal(outputs[0], outputs[1]);
  assert.equal(outputs[1], outputs[2]);
});
