import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {monthCells, shiftMonth, navigateDate, previewAvailability, deviceReminderTimes} from '../../static/calendar-reminders/calendar-view.mjs';
import {eventPresentation, eventIcon} from '../../static/calendar-reminders/event-presentation.mjs';
import {defaults, selectOccurrences} from '../../static/calendar-reminders/core.mjs';

const data = JSON.parse(readFileSync('static/calendar-reminders/calendar-data.json', 'utf8'));
const settings = defaults(data.catalog, 'Asia/Shanghai');
// Date-edge fixtures deliberately cover both tsok days, independently of onboarding defaults.
settings.events['guru-tsok'].mode = 'remind';
settings.events['dakini-tsok'].mode = 'remind';
const occurrences = (start, end) => selectOccurrences(data, settings, {start, end});

test('month grid always has six real Monday-first weeks, including cross-year and leap February', () => {
  const december = monthCells('2026-12');
  assert.equal(december.length, 42);
  assert.equal(december[0].date, '2026-11-30');
  assert.equal(december.at(-1).date, '2027-01-10');
  assert.equal(december.filter(day => day.inMonth).length, 31);
  assert.equal(new Set(december.map(day => day.date)).size, 42);
  const february = monthCells('2028-02');
  assert.equal(february.filter(day => day.inMonth).length, 29);
  assert.ok(february.some(day => day.date === '2028-02-29'));
  assert.throws(() => monthCells('2028-13'), RangeError);
});

test('calendar marks both real repeated days and only the actual first-day event', () => {
  const cells = monthCells('2026-02', {events: occurrences('2026-02-01', '2026-02-28')});
  const first = cells.find(cell => cell.date === '2026-02-11');
  const second = cells.find(cell => cell.date === '2026-02-12');
  assert.equal(first.repeatNumber, 1);
  assert.equal(second.repeatNumber, 2);
  assert.equal(first.tibetan.day, 25);
  assert.equal(second.tibetan.day, 25);
  assert.match(first.tibetan.fullLabel, /重日第一次/);
  assert.match(second.tibetan.fullLabel, /重日第二次/);
  assert.match(second.tibetanShort, /重/);
  assert.equal(first.count, 1);
  assert.equal(second.count, 0);
});

test('missing days create no fictional cells; leap-month occurrences retain a visible leap marker', () => {
  const july = monthCells('2026-07', {events: occurrences('2026-07-01', '2026-07-31')});
  assert.equal(july.find(cell => cell.date === '2026-07-09').tibetan.day, 24);
  assert.equal(july.find(cell => cell.date === '2026-07-09').count, 1);
  assert.equal(july.find(cell => cell.date === '2026-07-10').tibetan.day, 26);
  assert.ok(!july.some(cell => cell.tibetan.month === 5 && cell.tibetan.day === 25));
  const april = monthCells('2027-04', {events: occurrences('2027-04-01', '2027-04-30')});
  const leap = april.find(cell => cell.date === '2027-04-16');
  assert.equal(leap.count, 1);
  assert.equal(leap.tibetan.monthLeap, true);
  assert.match(leap.tibetanShort, /^闰/);
  assert.match(leap.tibetan.fullLabel, /闰二月初十/);
});

test('month grid counts selected original records and preserves the caller device date', () => {
  const events = [
    {id: 'one', date: '2026-11-01', title: '原名一', preference: {mode: 'display'}},
    {id: 'two', date: '2026-11-01', title: '原名二', preference: {mode: 'remind'}},
    {id: 'off', date: '2026-11-01', title: '不显示', preference: {mode: 'off'}}
  ];
  const cell = monthCells('2026-11', {events, today: '2026-11-01', selected: '2026-11-01', start: '2026-11-01', end: '2026-11-30'})
    .find(day => day.date === '2026-11-01');
  assert.equal(cell.count, 2);
  assert.equal(cell.today, true);
  assert.equal(cell.selected, true);
  assert.deepEqual(cell.events.map(event => event.title), ['原名一', '原名二']);
  const clipped = monthCells('2026-11', {start: '2026-11-05', end: '2026-11-27'});
  assert.equal(clipped.find(day => day.date === '2026-11-04').disabled, true);
  assert.equal(clipped.find(day => day.date === '2026-11-05').disabled, false);
});

test('keyboard date navigation handles week edges, clamped month ends, leap years and bounds', () => {
  assert.equal(navigateDate('2026-12-31', 'ArrowRight'), '2027-01-01');
  assert.equal(navigateDate('2026-11-01', 'Home'), '2026-10-26');
  assert.equal(navigateDate('2026-11-01', 'End'), '2026-11-01');
  assert.equal(navigateDate('2026-10-26', 'End'), '2026-11-01');
  assert.equal(navigateDate('2026-03-31', 'PageUp'), '2026-02-28');
  assert.equal(shiftMonth('2028-01-31', 1), '2028-02-29');
  assert.equal(navigateDate('2026-10-22', 'ArrowUp', {start: '2026-10-20', end: '2026-11-30'}), '2026-10-20');
  assert.equal(navigateDate('2026-11-30', 'ArrowRight', {start: '2026-10-20', end: '2026-11-30'}), '2026-11-30');
  assert.equal(navigateDate('2026-11-01', 'Enter'), null);
});

test('empty state distinguishes no selection from unconfirmed source-only schedules', () => {
  const none = structuredClone(settings);
  for (const preference of Object.values(none.events)) preference.mode = 'off';
  assert.deepEqual(previewAvailability(data, none, {start: '2028-01-01', end: '2028-01-31'}),
    {selectedCount: 0, unconfirmedCount: 0, unconfirmedTitles: [], hasUnconfirmed: false});
  assert.equal(previewAvailability(data, settings, {start: '2028-01-01', end: '2028-01-31'}).hasUnconfirmed, false);
  const ceremony = data.catalog.events.find(event => event.group === 'practice' && !event.rule);
  none.events[ceremony.id].mode = 'display';
  const confirmed = previewAvailability(data, none, {start: '2026-10-01', end: '2026-10-31'});
  assert.equal(confirmed.selectedCount, 1);
  assert.equal(confirmed.hasUnconfirmed, false);
  const future = previewAvailability(data, none, {start: '2028-01-01', end: '2028-01-31'});
  assert.equal(future.hasUnconfirmed, true);
  assert.deepEqual(future.unconfirmedTitles, [ceremony.title]);
});

test('shared event presentation preserves source titles and distinguishes eclipses from solar terms', () => {
  const event = {id: 'custom-eclipse', group: 'nature', title: '日全食（北京时间23:34开始-次日凌晨03:57结束）', tags: ['eclipse']};
  const before = structuredClone(event);
  assert.deepEqual(eventPresentation(event, data.catalog), {
    groupId: 'nature', label: '日月食', icon: 'eclipse', colorClass: 'event-category-eclipse'
  });
  assert.deepEqual(event, before);
  assert.match(eventIcon(event, data.catalog), /^<svg.*aria-hidden="true"/);
  assert.equal(eventPresentation({eventId: 'guru-tsok'}, data.catalog).icon, 'ritual-bell');
  assert.equal(eventPresentation({eventId: 'dakini-tsok'}, data.catalog).icon, 'vajra');
  for (const [group, expectedIcon] of [['tsok', 'bell-vajra'], ['masters', 'throne'], ['practice', 'pecha'], ['festivals', 'festival'], ['nature', 'sun-moon']]) {
    // Existing catalog metadata retains old generic icons; every screen must use
    // the shared current design mapping instead of silently overriding it.
    assert.equal(eventPresentation({group}, data.catalog).icon, expectedIcon);
  }
  assert.equal(eventPresentation({group: 'nature', title: '冬至', tags: ['solar-term']}, data.catalog).colorClass, 'event-category-nature');
  assert.equal(eventPresentation({title: '月全食', group: 'nature'}, data.catalog).label, '日月食');
  assert.equal(eventPresentation({group: 'unknown'}).colorClass, 'event-category-other');
});

test('device reminder preview uses each future alarm date including DST and advance days', () => {
  const event = {date: '2026-01-10', preference: {mode: 'remind', reminders: [{daysBefore: 0, time: '08:00'}]}};
  const winter = deviceReminderTimes(event, 'Asia/Shanghai', 'America/New_York')[0];
  assert.equal(winter.date, '2026-01-09');
  assert.equal(winter.time, '19:00');
  event.date = '2026-07-10';
  event.preference.reminders.push({daysBefore: 1, time: '08:00'});
  const summer = deviceReminderTimes(event, 'Asia/Shanghai', 'America/New_York');
  assert.deepEqual(summer.map(({date, time}) => ({date, time})), [
    {date: '2026-07-09', time: '20:00'}, {date: '2026-07-08', time: '20:00'}
  ]);
  const halfHour = deviceReminderTimes(event, 'Asia/Shanghai', 'Asia/Kolkata')[0];
  assert.equal(halfHour.date, '2026-07-10');
  assert.equal(halfHour.time, '05:30');
  assert.equal(event.date, '2026-07-10');
});

test('same, unknown, invalid and display-only reminder zones do not show a misleading conversion', () => {
  const event = {date: '2026-07-10', preference: {mode: 'remind', reminders: [{daysBefore: 0, time: '08:00'}]}};
  assert.deepEqual(deviceReminderTimes(event, 'Asia/Shanghai', 'PRC'), []);
  assert.deepEqual(deviceReminderTimes(event, 'Asia/Shanghai', ''), []);
  assert.deepEqual(deviceReminderTimes(event, '', 'America/New_York'), []);
  assert.deepEqual(deviceReminderTimes(event, 'Asia/Shanghai', 'No/Such_Zone'), []);
  event.preference.mode = 'display';
  assert.deepEqual(deviceReminderTimes(event, 'Asia/Shanghai', 'America/New_York'), []);
});
