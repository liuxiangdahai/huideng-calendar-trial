import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ICAL from 'ical.js';
import {resolveTimeZone, deviceTimeZone, zoneInfo, listTimeZones} from '../../static/calendar-reminders/timezones.mjs';
import {defaults, normalizeSettings, validateSettings, selectOccurrences, exportICS, zonedInstant, dateInZone} from '../../static/calendar-reminders/core.mjs';

const data = JSON.parse(fs.readFileSync('static/calendar-reminders/calendar-data.json', 'utf8'));
const winter = new Date('2027-01-15T12:00:00Z');
const summer = new Date('2027-07-15T12:00:00Z');

test('global timezone catalogue retains Chinese cities and does not merge distinct places', () => {
  const zones = listTimeZones(winter);
  assert.ok(zones.length >= 400);
  assert.equal(new Set(zones.map(z => z.id)).size, zones.length);
  for (const zone of zones) {
    assert.match(zone.country, /[\u3400-\u9fff]/);
    assert.match(zone.city, /[\u3400-\u9fff]/);
    assert.match(zone.offset, /^UTC[+-]\d{2}:\d{2}$/);
    assert.ok(zone.search.includes(zone.id.toLowerCase()));
  }
  assert.match(zoneInfo('Europe/Bratislava').label, /斯洛伐克.*布拉迪斯拉发/);
  assert.match(zoneInfo('Europe/Prague').label, /捷克.*布拉格/);
  assert.match(zoneInfo('Africa/Asmara').label, /厄立特里亚/);
  assert.match(zoneInfo('Asia/Shanghai').search, /北京/);
  zones[0].label = '外部修改';
  assert.notEqual(listTimeZones(winter)[0].label, '外部修改');
});

test('legacy aliases are canonicalized and unsafe or unknown identifiers rejected', () => {
  assert.equal(resolveTimeZone('Asia/Katmandu'), 'Asia/Kathmandu');
  assert.equal(resolveTimeZone('Asia/Calcutta'), 'Asia/Kolkata');
  assert.equal(resolveTimeZone('Canada/Pacific'), 'America/Vancouver');
  assert.equal(resolveTimeZone('Europe/Kiev'), 'Europe/Kyiv');
  assert.equal(resolveTimeZone('asia/shanghai'), 'Asia/Shanghai');
  assert.equal(resolveTimeZone('Etc/UTC'), 'UTC');
  for (const input of ['', null, {}, 'Moon/Base', '+08:00', 'Asia/Shanghai\r\nBEGIN:VEVENT', '<script>']) {
    assert.equal(resolveTimeZone(input), '');
  }
});

test('offset labels use the requested instant and include non-hour offsets', () => {
  assert.equal(zoneInfo('Asia/Kathmandu', winter).offset, 'UTC+05:45');
  assert.equal(zoneInfo('Australia/Eucla', winter).offset, 'UTC+08:45');
  assert.equal(zoneInfo('America/St_Johns', winter).offset, 'UTC-03:30');
  assert.equal(zoneInfo('America/New_York', winter).offset, 'UTC-05:00');
  assert.equal(zoneInfo('America/New_York', summer).offset, 'UTC-04:00');
  assert.equal(listTimeZones(summer).find(z => z.id === 'America/New_York').offset, 'UTC-04:00');
  assert.equal(zoneInfo('Etc/GMT+2', winter).offset, 'UTC-02:00');
});

test('verified IANA 2026e corrections prevent stale runtime DST rules from changing future alarms', () => {
  for (const [id, offset] of [
    ['America/Vancouver', 'UTC-07:00'], ['America/Edmonton', 'UTC-06:00'],
    ['America/Inuvik', 'UTC-06:00'], ['America/Winnipeg', 'UTC-05:00'],
    ['Africa/Casablanca', 'UTC+00:00'], ['Africa/El_Aaiun', 'UTC+00:00']
  ]) assert.equal(zoneInfo(id, winter).offset, offset);
  assert.equal(zoneInfo('America/Vancouver', new Date('2026-01-15T12:00:00Z')).offset, 'UTC-08:00');
  assert.equal(zoneInfo('Canada/Pacific', winter).offset, 'UTC-07:00');
  assert.equal(zoneInfo('Africa/Casablanca', new Date('2026-09-20T00:59:59Z')).offset, 'UTC+01:00');
  assert.equal(zoneInfo('Africa/Casablanca', new Date('2026-09-20T01:00:00Z')).offset, 'UTC+00:00');
  assert.equal(dateInZone(new Date('2026-11-22T07:30:00Z'), 'America/Vancouver'), '2026-11-22');
  assert.equal(zonedInstant('2026-11-22', '08:00', 'America/Vancouver').toISOString(), '2026-11-22T15:00:00.000Z');
  assert.equal(zonedInstant('2027-03-14', '02:30', 'America/Vancouver').toISOString(), '2027-03-14T09:30:00.000Z');
  assert.equal(zonedInstant('2026-09-20', '01:30', 'Africa/Casablanca').toISOString(), '2026-09-20T00:30:00.000Z');
  assert.equal(zonedInstant('2026-09-20', '02:00', 'Africa/Casablanca').toISOString(), '2026-09-20T02:00:00.000Z');
});

test('new preferences use device zone, valid saved global zones and reminder overrides survive migration', () => {
  assert.equal(defaults(data.catalog).zone, deviceTimeZone());
  const saved = defaults(data.catalog, 'Asia/Katmandu');
  saved.events['guru-tsok'] = {mode: 'remind', reminders: [{daysBefore: 1, time: '20:45'}, {daysBefore: 0, time: '07:15'}]};
  saved.events['dakini-tsok'].mode = 'display';
  const migrated = normalizeSettings(saved, data.catalog);
  assert.equal(migrated.zone, 'Asia/Kathmandu');
  assert.deepEqual(migrated.events, saved.events);
  const changedZone = validateSettings({...migrated, zone: 'Australia/Eucla'}, data.catalog);
  assert.deepEqual(changedZone.events, saved.events);
  assert.equal(changedZone.zone, 'Australia/Eucla');
});

test('unrecognized zones require explicit selection while preview still works', t => {
  assert.equal(defaults(data.catalog, 'Moon/Base').zone, '');
  const draft = normalizeSettings({...defaults(data.catalog, 'UTC'), zone: 'Moon/Base'}, data.catalog);
  draft.events['guru-tsok'].mode = 'remind';
  assert.equal(draft.zone, '');
  assert.throws(() => validateSettings(draft, data.catalog), /格式/);
  assert.throws(() => exportICS([], {zone: draft.zone}), /时区/);
  assert.ok(selectOccurrences(data, draft, {start: '2027-01-01', end: '2027-01-31'}).length > 0);
  assert.ok(selectOccurrences(data, draft).length > 0);
  t.mock.method(Intl, 'DateTimeFormat', function () { throw new Error('unavailable'); });
  assert.equal(deviceTimeZone(), '');
  assert.equal(defaults(data.catalog).zone, '');
});

test('all-day civil dates are invariant when reminder zone changes', () => {
  const window = {start: '2027-01-01', end: '2027-02-28'};
  const a = defaults(data.catalog, 'Asia/Kathmandu'), b = defaults(data.catalog, 'Pacific/Honolulu');
  a.events['guru-tsok'].mode = 'remind'; b.events['guru-tsok'].mode = 'remind';
  const events = selectOccurrences(data, a, window);
  assert.deepEqual(events.map(e => [e.uid, e.date]), selectOccurrences(data, b, window).map(e => [e.uid, e.date]));
  const parse = (settings) => new ICAL.Component(ICAL.parse(exportICS(events, {zone: settings.zone}))).getAllSubcomponents('vevent');
  const first = parse(a), second = parse(b);
  assert.deepEqual(first.map(e => e.getFirstPropertyValue('dtstart').toString()), second.map(e => e.getFirstPropertyValue('dtstart').toString()));
  assert.notEqual(first[0].getFirstSubcomponent('valarm').getFirstPropertyValue('trigger').toString(),
    second[0].getFirstSubcomponent('valarm').getFirstPropertyValue('trigger').toString());
  assert.equal(zonedInstant('2027-01-15', '08:00', 'Asia/Kathmandu').toISOString(), '2027-01-15T02:15:00.000Z');
});
