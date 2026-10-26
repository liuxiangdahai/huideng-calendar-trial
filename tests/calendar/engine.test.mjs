import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {ENGINE, getTibetanDate, generateOccurrences} from '../../static/calendar-reminders/engine.mjs';

const source = JSON.parse(fs.readFileSync('data/calendar/fohui-dates.json', 'utf8'));
const data = JSON.parse(fs.readFileSync('static/calendar-reminders/calendar-data.json', 'utf8'));
const rulesOnly = {catalog: data.catalog};
const events = (start, end, input = data) => generateOccurrences(input, {start, end});

test('pinned PRO calendar agrees with every one of the 491 source dates, including repeated and leap months', () => {
  assert.equal(ENGINE.commit, 'c29e60f8292473c038a1da7d5a4061a3c97026fa');
  assert.equal(source.days.length, 491);
  for (const day of source.days) assert.equal(getTibetanDate(day.date).display, day.tibetan, day.date);
  assert.equal(getTibetanDate('2026-02-18').year, 2026);
  assert.equal(getTibetanDate('2026-01-01').year, 2025);
  assert.equal(getTibetanDate('2026-08-27').dayLeap, true);
  assert.equal(getTibetanDate('2027-04-16').monthLeap, true);
});

test('all 62 original labels map once to seven categories and exact published titles survive', () => {
  assert.equal(data.schemaVersion, 2);
  assert.deepEqual(data.catalog.groups.map(g => g.id), ['tsok', 'buddha', 'masters', 'practice', 'festivals', 'nature', 'other']);
  assert.ok(data.catalog.groups.every(g => g.defaultMode === (g.id === 'tsok' ? 'remind' : 'off')));
  const labels = new Set(source.days.flatMap(d => d.labels));
  const mapped = data.catalog.events.flatMap(e => e.sourceLabels);
  assert.equal(labels.size, 62);
  assert.deepEqual(new Set(mapped), labels);
  assert.equal(mapped.length, labels.size);
  const actual = events(source.start, source.end);
  assert.equal(actual.length, source.days.reduce((n, d) => n + d.labels.length, 0));
  for (const day of source.days) {
    assert.deepEqual(actual.filter(o => o.date === day.date).map(o => o.title).sort(), [...day.labels].sort());
  }
  for (const event of data.catalog.events.filter(e => e.sourceLabel.endsWith('加持日'))) assert.equal(event.group, 'buddha');
  assert.equal(data.catalog.events.find(e => e.id === 'jigme-lingpa').title, '持明无畏洲（吉美林巴）尊者圆寂纪念日');
});

test('the explicit source schedule overrides PRO extraInfo and missing-day nominal dates', () => {
  const actual = events('2026-07-01', '2026-12-31');
  assert.equal(actual.find(o => o.eventId === 'dakini-tsok' && o.date.startsWith('2026-07')).date, '2026-07-09');
  assert.equal(actual.find(o => o.eventId === 'lhabab').date, '2026-11-01');
  assert.equal(actual.find(o => o.eventId === 'jigme-phuntsok').date, '2026-12-23');
  assert.ok(!actual.some(o => o.eventId === 'lhabab' && o.date === '2026-10-30'));
  const solar = actual.filter(o => o.eventId === 'total-solar-eclipse');
  assert.equal(solar.length, 1);
  assert.equal(solar[0].date, '2026-08-12');
  assert.equal(solar[0].title, '日全食（北京时间23:34开始-次日凌晨03:57结束）');
});

test('monthly rules move missing days backwards, keep first repeated day, and include leap months', () => {
  const actual = events('2026-01-01', '2027-05-06', rulesOnly);
  for (const [id, date] of [['dakini-tsok', '2026-07-09'], ['kshitigarbha', '2026-11-29'],
    ['amitabha', '2026-12-23'], ['medicine-buddha', '2027-03-15']]) {
    assert.ok(actual.some(o => o.eventId === id && o.date === date), id + ' ' + date);
  }
  assert.ok(actual.some(o => o.eventId === 'dakini-tsok' && o.date === '2026-02-11'));
  assert.ok(!actual.some(o => o.eventId === 'dakini-tsok' && o.date === '2026-02-12'));
  assert.ok(actual.some(o => o.eventId === 'guru-tsok' && o.date === '2027-04-16'));
  const leap = actual.find(o => o.eventId === 'guru-tsok' && o.date === '2027-04-16');
  assert.equal(leap.uid, 'guru-tsok-2027-闰二-1');
});

test('future windows extend fixed rules without predicting ceremonies, seasons, or astronomical events', () => {
  const actual = events('2027-05-07', '2028-10-20');
  assert.ok(actual.some(o => o.eventId === 'guru-tsok'));
  assert.ok(actual.some(o => o.eventId === 'jigme-lingpa'));
  assert.ok(actual.every(o => data.catalog.events.find(e => e.id === o.eventId).rule));
  assert.ok(actual.every(o => o.origin === 'rule'));
  const publishedOnly = new Set(data.catalog.events.filter(e => !e.rule).map(e => e.id));
  assert.ok(!actual.some(o => publishedOnly.has(o.eventId)));
  for (const event of data.catalog.events.filter(e => /法会|日食|月食|日环食|日全食|月全食|月偏食|春分|夏至|秋分|冬至/.test(e.title))) {
    assert.equal(event.rule, undefined, event.title);
  }
});

test('annual observances do not repeat in a leap month', () => {
  const catalog = {events: [{id: 'fixture', title: '测试纪念日', sourceLabel: '测试纪念日',
    rule: {kind: 'tibetan-annual', month: 2, day: 10, missing: 'previous', repeated: 'first', leapMonth: 'exclude'}}]};
  const actual = events('2027-03-01', '2027-05-06', {catalog});
  assert.equal(actual.length, 1);
  assert.equal(getTibetanDate(actual[0].date).monthLeap, false);
});

test('single-day queries preserve missing-day placement at the range boundary', () => {
  const whole = events('2026-06-01', '2026-08-01', rulesOnly).filter(o => o.date === '2026-07-09');
  assert.deepEqual(events('2026-07-09', '2026-07-09', rulesOnly), whole);
  assert.deepEqual(events('2026-07-10', '2026-07-10', rulesOnly).filter(o => o.eventId === 'dakini-tsok'), []);
});

test('stable lunar and published IDs survive corrected dates and original-title changes', () => {
  const original = data.published.records.find(o => o.eventId === 'guru-tsok' && o.date === '2026-10-21');
  const changed = structuredClone(data);
  Object.assign(changed.published.records.find(o => o.uid === original.uid),
    {date: '2026-10-22', tibetan: '九月十一', title: '莲师荟供日（校订）'});
  const actual = events('2026-10-20', '2026-10-23', changed).filter(o => o.eventId === 'guru-tsok');
  assert.equal(actual.length, 1);
  assert.equal(actual[0].uid, original.uid);
  assert.equal(actual[0].date, '2026-10-22');
  assert.equal(actual[0].title, '莲师荟供日（校订）');
  // A source correction outside the requested window must suppress the old
  // algorithmic date as well, even when the source coverage isn't supplied.
  const withoutCoverage = {catalog: data.catalog, published: {records: changed.published.records}};
  assert.ok(!events('2026-10-21', '2026-10-21', withoutCoverage).some(o => o.uid === original.uid));
  const eclipse = data.published.records.find(o => o.eventId === 'total-solar-eclipse');
  assert.match(eclipse.recordId, /^fohui-\d{5}$/);
  assert.equal(eclipse.uid, 'total-solar-eclipse-' + eclipse.recordId);
});

test('date validation rejects rollover, unsupported dates, and reversed windows', () => {
  for (const date of ['2026-02-30', '2026-2-01', 'not-a-date', '1951-01-07', '2051-02-12']) {
    assert.throws(() => getTibetanDate(date), RangeError, date);
  }
  assert.equal(getTibetanDate(ENGINE.supported.start).display, '十二月初一');
  assert.ok(getTibetanDate(ENGINE.supported.end).day);
  assert.throws(() => events('2026-10-22', '2026-10-21'), RangeError);
  assert.throws(() => events('2026-01-01', '2026-01-02', {catalog: data.catalog,
    published: {records: [data.published.records[0], data.published.records[0]]}}), /标识重复/);
});

test('the same civil dates and generated observances are identical in Shanghai, Vancouver, and UTC', () => {
  const code = "import {getTibetanDate,generateOccurrences} from './static/calendar-reminders/engine.mjs';" +
    "const dates=['2026-02-18','2026-11-01','2027-03-14','2027-04-16'];" +
    "const catalog={events:[{id:'tsok',title:'莲师荟供日',sourceLabel:'莲师荟供日',rule:{kind:'tibetan-monthly',day:10,missing:'previous',repeated:'first',leapMonth:'include'}}]};" +
    "console.log(JSON.stringify({dates:dates.map(getTibetanDate),events:generateOccurrences({catalog},{start:'2026-10-01',end:'2027-05-01'})}));";
  const outputs = ['Asia/Shanghai', 'America/Vancouver', 'UTC'].map(TZ =>
    execFileSync(process.execPath, ['--input-type=module', '-e', code], {encoding: 'utf8', env: {...process.env, TZ}}));
  assert.equal(outputs[0], outputs[1]);
  assert.equal(outputs[1], outputs[2]);
});
