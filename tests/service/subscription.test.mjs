import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, realpathSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname, basename} from 'node:path';
import ICAL from 'ical.js';
import {SQLiteD1} from '../../service/calendar/sqlite-d1.mjs';
import {createCalendarService, digest} from '../../service/calendar/service.mjs';
import {validateSettings, exportICS, selectOccurrences, defaults, addDays, rangeEnd, resolveAlarmInstants} from '../../static/calendar-reminders/core.mjs';

const ORIGIN = 'https://www.example.org';
const BASE = 'https://calendar.example.org';
const date = '2027-03-20';
const makeSettings = (mode = 'remind', time = '08:00') => ({
  version: 2, zone: 'Asia/Shanghai',
  events: {test: {mode, reminders: [{daysBefore: 0, time}]}}
});
function fixture(t, alarmResolver = resolveAlarmInstants) {
  const temporaryRoot = realpathSync(tmpdir());
  const directory = mkdtempSync(join(temporaryRoot, 'huideng-calendar-sqlite-'));
  const dbPath = join(directory, 'calendar.sqlite');
  let DB = new SQLiteD1(dbPath), current = new Date('2026-10-20T02:00:00Z');
  const data = {
    updatedOn: '2026-10-20', catalog: {events: [{id: 'test', title: '莲师荟供日'}]},
    occurrences: [{id: 'test', eventId: 'test', uid: 'test-2027-month-1', date,
      title: '莲师荟供日', tibetan: '二月初十', source: 'https://www.fohuifayu.com/index.php/calendar'}]
  };
  const release = {version: 'test-commit', dataVersion: '', rendererVersion: 'snapshot-v1', environment: 'acceptance'};
  const calls = {selection: 0, export: 0};
  const service = createCalendarService({
    getData: () => data, getRelease: () => release, validateSettings,
    exportICS: (...args) => { calls.export++; return exportICS(...args); },
    resolveAlarmInstants: alarmResolver, now: () => current,
    // The service's publication state is tested independently of the date engine.
    // Real validation, ICS serializer, D1-shaped SQL, and SQLite are used here.
    selectOccurrences: (calendar, settings, {start, end}) => {
      calls.selection++;
      return calendar.occurrences
        .filter(event => event.date >= start && event.date <= end && settings.events[event.id]?.mode !== 'off')
        .map(event => ({...event, preference: settings.events[event.id]}));
    }
  });
  const env = {DB, PUBLIC_BASE_URL: BASE, ALLOWED_ORIGINS: ORIGIN, RATE_LIMIT_SALT: 'test-only-secret'};
  t.after(() => {
    DB.close();
    assert.equal(dirname(realpathSync(directory)), temporaryRoot);
    assert.ok(basename(directory).startsWith('huideng-calendar-sqlite-'));
    rmSync(directory, {recursive: true, force: true});
  });
  const fetch = (path, options = {}) => service.fetch(new Request(
    path.startsWith('https:') ? path : `${BASE}${path}`, options), env);
  const api = (path, method, body, manageToken, extraHeaders = {}) => fetch(path, {
    method, headers: {Origin: ORIGIN, 'Content-Type': 'application/json',
      ...(manageToken ? {Authorization: `Bearer ${manageToken}`} : {}), ...extraHeaders},
    ...(body !== undefined ? {body: JSON.stringify(body)} : {})
  });
  const create = async settings => {
    const response = await api('/api/subscriptions', 'POST', {settings: settings || makeSettings()});
    assert.equal(response.status, 201, await response.clone().text());
    return response.json();
  };
  const entries = text => new ICAL.Component(ICAL.parse(text)).getAllSubcomponents('vevent');
  return {
    data, release, calls, env, fetch, api, create, entries, service,
    get db() { return DB; },
    tick(milliseconds) { current = new Date(current.getTime() + milliseconds); },
    setTime(instant) { current = new Date(instant); },
    reopen() { DB.close(); DB = new SQLiteD1(dbPath); env.DB = DB; }
  };
}

test('real SQLite persists a subscription; read and management credentials are separate', async t => {
  const f = fixture(t), created = await f.create();
  assert.match(created.manageToken, /^[\w-]{43}$/);
  const feedToken = new URL(created.feedUrl).pathname.split('/').at(-1).replace('.ics', '');
  assert.notEqual(feedToken, created.manageToken);
  const row = await f.db.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(created.id).first();
  assert.equal(row.manage_token_hash, await digest(created.manageToken));
  assert.equal(JSON.stringify(row).includes(created.manageToken), false);
  f.reopen();
  const response = await f.api(`/api/subscriptions/${created.id}`, 'GET', undefined, created.manageToken);
  assert.equal(response.status, 200);
  const restored = await response.json();
  assert.equal(restored.feedUrl, created.feedUrl);
  assert.equal(restored.revision, 1);
  assert.equal(Object.hasOwn(restored, 'manageToken'), false);
  assert.equal((await f.api(`/api/subscriptions/${created.id}`, 'GET', undefined, feedToken)).status, 401);
  assert.equal((await f.fetch(`/api/subscriptions/${created.id}`)).status, 401);
});

test('creation and edits reject invalid data and unconfigured, absent, or null browser origins', async t => {
  const f = fixture(t);
  for (const bad of [
    {...makeSettings(), version: 1},
    {...makeSettings(), zone: 'Not/A_Zone'},
    {...makeSettings(), events: {unknown: makeSettings().events.test}},
    {...makeSettings(), events: {test: {mode: 'remind', reminders: [{daysBefore: 3, time: '09:00'}]}}}
  ]) {
    assert.equal((await f.api('/api/subscriptions', 'POST', {settings: bad})).status, 400);
  }
  for (const origin of ['null', 'https://evil.example', '']) {
    const response = await f.api('/api/subscriptions', 'POST', {settings: makeSettings()}, undefined, {Origin: origin});
    assert.equal(response.status, 403);
    assert.equal(response.headers.has('Access-Control-Allow-Origin'), false);
  }
  const preflight = await f.fetch('/api/subscriptions', {method: 'OPTIONS', headers: {Origin: ORIGIN}});
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(preflight.headers.has('Access-Control-Allow-Credentials'), false);
  f.env.ALLOWED_ORIGINS = '';
  assert.equal((await f.api('/api/subscriptions', 'POST', {settings: makeSettings()})).status, 403);
  f.env.PUBLIC_BASE_URL = '';
  assert.equal((await f.fetch('/calendar/invalid.ics')).status, 503);
});

test('feeds retain stable publication timestamps and honor conditional and HEAD requests', async t => {
  const f = fixture(t), created = await f.create();
  const first = await f.fetch(created.feedUrl), content = await first.text();
  assert.equal(first.status, 200);
  const [event] = f.entries(content);
  assert.equal(event.getFirstPropertyValue('dtstart').isDate, true);
  assert.equal(event.getFirstPropertyValue('dtstart').toString(), date);
  assert.equal(event.getFirstPropertyValue('sequence'), 0);
  assert.equal(event.getAllSubcomponents('valarm').length, 1);
  assert.equal(event.getFirstSubcomponent('valarm').getFirstPropertyValue('trigger').toString(), '2027-03-20T00:00:00Z');
  assert.equal(content.includes(created.manageToken), false);
  assert.equal(content.includes(new URL(created.feedUrl).pathname), false);
  f.tick(300000);
  const second = await f.fetch(created.feedUrl);
  assert.equal(await second.text(), content);
  assert.equal(second.headers.get('ETag'), first.headers.get('ETag'));
  const unchanged = await f.fetch(created.feedUrl, {headers: {'If-None-Match': first.headers.get('ETag')}});
  assert.equal(unchanged.status, 304);
  assert.equal(await unchanged.text(), '');
  const head = await f.fetch(created.feedUrl, {method: 'HEAD'});
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('Content-Type'), 'text/calendar; charset=utf-8');
  assert.equal(await head.text(), '');
});

test('editing preserves the feed and UID, increments publication sequence, and detects stale revisions', async t => {
  const f = fixture(t), created = await f.create();
  const initial = f.entries(await (await f.fetch(created.feedUrl)).text())[0];
  f.tick(60000);
  const changed = await f.api(`/api/subscriptions/${created.id}`, 'PATCH',
    {settings: makeSettings('remind', '09:30'), revision: 1}, created.manageToken);
  assert.equal(changed.status, 200);
  const updated = await changed.json();
  assert.equal(updated.feedUrl, created.feedUrl);
  assert.equal(updated.revision, 2);
  const [event] = f.entries(await (await f.fetch(created.feedUrl)).text());
  assert.equal(event.getFirstPropertyValue('uid'), initial.getFirstPropertyValue('uid'));
  assert.equal(event.getFirstPropertyValue('sequence'), 1);
  assert.notEqual(event.getFirstPropertyValue('dtstamp').toString(), initial.getFirstPropertyValue('dtstamp').toString());
  assert.equal(event.getFirstSubcomponent('valarm').getFirstPropertyValue('trigger').toString(), '2027-03-20T01:30:00Z');
  const stale = await f.api(`/api/subscriptions/${created.id}`, 'PATCH',
    {settings: makeSettings('off'), revision: 1}, created.manageToken);
  assert.equal(stale.status, 409);
  const same = await f.api(`/api/subscriptions/${created.id}`, 'PATCH',
    {settings: updated.settings, revision: 2}, created.manageToken);
  assert.equal((await same.json()).revision, 2);
});

test('a timezone-rule change republishes exact UTC alarms with stable UID and a new sequence and ETag', async t => {
  let shift = 0;
  const f = fixture(t, (event, zone) => resolveAlarmInstants(event, zone)
    .map(value => new Date(Date.parse(value) + shift).toISOString()));
  const settings = makeSettings();
  settings.events.test.reminders.push({daysBefore: 1, time: '20:00'});
  const created = await f.create(settings);
  const first = await f.fetch(created.feedUrl), [initial] = f.entries(await first.text());
  f.tick(60000); shift = 3600000;
  // Deployment metadata invalidates snapshots when the runtime/date rules change.
  f.release.rendererVersion = 'snapshot-v2';
  const changed = await f.fetch(created.feedUrl, {headers: {'If-None-Match': first.headers.get('ETag')}});
  assert.equal(changed.status, 200);
  const [event] = f.entries(await changed.text());
  assert.equal(event.getFirstPropertyValue('uid'), initial.getFirstPropertyValue('uid'));
  assert.equal(event.getFirstPropertyValue('dtstart').toString(), date);
  assert.equal(event.getFirstPropertyValue('sequence'), 1);
  assert.notEqual(changed.headers.get('ETag'), first.headers.get('ETag'));
  assert.notEqual(changed.headers.get('Last-Modified'), first.headers.get('Last-Modified'));
  assert.notEqual(event.getFirstPropertyValue('dtstamp').toString(), initial.getFirstPropertyValue('dtstamp').toString());
  assert.deepEqual(event.getAllSubcomponents('valarm').map(alarm => alarm.getFirstPropertyValue('trigger').toString()),
    ['2027-03-20T01:00:00Z', '2027-03-19T13:00:00Z']);
  const stored = await f.db.prepare('SELECT * FROM calendar_entries').first();
  assert.deepEqual(JSON.parse(stored.event_json).alarmInstants,
    ['2027-03-20T01:00:00.000Z', '2027-03-19T13:00:00.000Z']);
  f.tick(60000);
  assert.equal((await f.fetch(created.feedUrl, {headers: {'If-None-Match': changed.headers.get('ETag')}})).status, 304);
  assert.equal((await f.db.prepare('SELECT sequence FROM calendar_entries').first()).sequence, 1);
  assert.equal((await f.db.prepare('SELECT revision FROM subscriptions').first()).revision, 1);
});

test('legacy entries gain alarm instants once and subsequent unchanged refreshes are stable', async t => {
  const f = fixture(t), created = await f.create();
  await f.fetch(created.feedUrl);
  const row = await f.db.prepare('SELECT * FROM calendar_entries').first();
  const legacy = JSON.parse(row.event_json); delete legacy.alarmInstants;
  const content = JSON.stringify(legacy);
  await f.db.prepare('UPDATE calendar_entries SET event_json = ?, content_hash = ?')
    .bind(content, await digest(content)).run();
  // A pre-snapshot database has publication entries but no cached representation.
  await f.db.prepare('DELETE FROM feed_snapshots').run();
  f.tick(60000);
  const response = await f.fetch(created.feedUrl), [event] = f.entries(await response.text());
  assert.equal(event.getFirstPropertyValue('sequence'), 1);
  assert.equal(event.getFirstSubcomponent('valarm').getFirstPropertyValue('trigger').toString(), '2027-03-20T00:00:00Z');
  f.tick(60000);
  assert.equal((await f.fetch(created.feedUrl, {headers: {'If-None-Match': response.headers.get('ETag')}})).status, 304);
});

test('display entries stay alarm-free and ignore timezone-rule changes', async t => {
  let shift = 0;
  const f = fixture(t, (event, zone) => resolveAlarmInstants(event, zone)
    .map(value => new Date(Date.parse(value) + shift).toISOString()));
  const created = await f.create(makeSettings('display'));
  const first = await f.fetch(created.feedUrl), [event] = f.entries(await first.text());
  assert.equal(event.getAllSubcomponents('valarm').length, 0);
  assert.deepEqual(JSON.parse((await f.db.prepare('SELECT event_json FROM calendar_entries').first()).event_json).alarmInstants, []);
  shift = 3600000; f.tick(60000); f.release.rendererVersion = 'snapshot-v2';
  assert.equal((await f.fetch(created.feedUrl, {headers: {'If-None-Match': first.headers.get('ETag')}})).status, 304);
});

test('date corrections use the same UID and deselection creates alarm-free cancellation tombstones', async t => {
  const f = fixture(t), created = await f.create();
  const initial = f.entries(await (await f.fetch(created.feedUrl)).text())[0];
  f.data.occurrences[0].date = '2027-03-21'; f.tick(60000);
  const [corrected] = f.entries(await (await f.fetch(created.feedUrl)).text());
  assert.equal(corrected.getFirstPropertyValue('uid'), initial.getFirstPropertyValue('uid'));
  assert.equal(corrected.getFirstPropertyValue('sequence'), 1);
  assert.equal(corrected.getFirstPropertyValue('dtstart').toString(), '2027-03-21');
  await f.api(`/api/subscriptions/${created.id}`, 'PATCH',
    {settings: makeSettings('off'), revision: 1}, created.manageToken);
  const [cancelled] = f.entries(await (await f.fetch(created.feedUrl)).text());
  assert.equal(cancelled.getFirstPropertyValue('status'), 'CANCELLED');
  assert.equal(cancelled.getFirstPropertyValue('sequence'), 2);
  assert.equal(cancelled.getAllSubcomponents('valarm').length, 0);
  f.tick(91 * 86400000);
  await f.service.scheduled(null, f.env);
  assert.equal(f.entries(await (await f.fetch(created.feedUrl)).text()).length, 0);
  const retired = await f.db.prepare('SELECT * FROM calendar_entries').first();
  assert.equal(retired.event_json, '{}');
  await f.api(`/api/subscriptions/${created.id}`, 'PATCH',
    {settings: makeSettings(), revision: 2}, created.manageToken);
  const [restored] = f.entries(await (await f.fetch(created.feedUrl)).text());
  assert.equal(restored.getFirstPropertyValue('uid'), initial.getFirstPropertyValue('uid'));
  assert.equal(restored.getFirstPropertyValue('sequence'), 3);
});

test('source removals cancel events and an advancing rolling window publishes new dates automatically', async t => {
  const f = fixture(t), created = await f.create();
  await f.fetch(created.feedUrl);
  f.data.occurrences.length = 0;
  const [cancelled] = f.entries(await (await f.fetch(created.feedUrl)).text());
  assert.equal(cancelled.getFirstPropertyValue('status'), 'CANCELLED');
  f.data.occurrences.push({id: 'test', eventId: 'test', uid: 'test-2028-month-1', date: '2028-10-25',
    title: '莲师荟供日', tibetan: '九月初十', source: 'https://www.fohuifayu.com/index.php/calendar'});
  assert.equal(f.entries(await (await f.fetch(created.feedUrl)).text()).length, 1);
  f.tick(10 * 86400000);
  const all = f.entries(await (await f.fetch(created.feedUrl)).text());
  assert.equal(all.length, 2);
  assert.equal(all.filter(event => event.getFirstPropertyValue('status') === 'CONFIRMED').length, 1);
});

test('disable erases preferences, cancels published events, and purges event content after retention', async t => {
  const f = fixture(t), created = await f.create();
  await f.fetch(created.feedUrl);
  const removed = await f.api(`/api/subscriptions/${created.id}`, 'DELETE', undefined, created.manageToken);
  assert.equal(removed.status, 200);
  const stored = await f.db.prepare('SELECT * FROM subscriptions').first();
  assert.equal(stored.settings_json, '{}');
  const [cancelled] = f.entries(await (await f.fetch(created.feedUrl)).text());
  assert.equal(cancelled.getFirstPropertyValue('status'), 'CANCELLED');
  assert.equal(cancelled.getAllSubcomponents('valarm').length, 0);
  assert.equal((await f.api(`/api/subscriptions/${created.id}`, 'PATCH',
    {settings: makeSettings(), revision: 2}, created.manageToken)).status, 410);
  f.tick(91 * 86400000);
  await f.service.scheduled(null, f.env);
  assert.equal((await f.db.prepare('SELECT count(*) AS count FROM calendar_entries').first()).count, 0);
  assert.equal(f.entries(await (await f.fetch(created.feedUrl)).text()).length, 0);
});

test('concurrent feed refreshes do not duplicate UIDs or reset sequences', async t => {
  const f = fixture(t), created = await f.create();
  const first = await Promise.all([f.fetch(created.feedUrl), f.fetch(created.feedUrl)]);
  assert.deepEqual(await first[0].text(), await first[1].text());
  assert.equal((await f.db.prepare('SELECT count(*) AS count FROM calendar_entries').first()).count, 1);
  f.data.occurrences[0].date = '2027-03-21';
  const second = await Promise.all([f.fetch(created.feedUrl), f.fetch(created.feedUrl)]);
  for (const response of second) assert.equal(f.entries(await response.text())[0].getFirstPropertyValue('sequence'), 1);
});

test('creation limits use digest buckets and oversized JSON is rejected before persistence', async t => {
  const f = fixture(t);
  for (let i = 0; i < 21; i++) {
    const response = await f.api('/api/subscriptions', 'POST', {settings: makeSettings()}, undefined,
      {'CF-Connecting-IP': '203.0.113.123'});
    assert.equal(response.status, i < 20 ? 201 : 429);
  }
  const bucket = await f.db.prepare('SELECT * FROM creation_limits').first();
  assert.match(bucket.bucket, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(bucket).includes('203.0.113.123'), false);
  const huge = await f.api('/api/subscriptions', 'POST', {settings: makeSettings(), extra: 'a'.repeat(70000)});
  assert.equal(huge.status, 413);
  assert.equal((await f.db.prepare('SELECT count(*) AS count FROM subscriptions').first()).count, 20);
});

test('SQLite batch transaction rolls back all statements when any statement fails', async t => {
  const f = fixture(t), created = await f.create();
  await assert.rejects(f.db.batch([
    f.db.prepare('UPDATE subscriptions SET revision = 99 WHERE id = ?').bind(created.id),
    f.db.prepare('INSERT INTO missing_table(value) VALUES (?)').bind('invalid')
  ]));
  assert.equal((await f.db.prepare('SELECT revision FROM subscriptions WHERE id = ?').bind(created.id).first()).revision, 1);
});

test('real PRO engine, published catalog, serializer, and SQLite use the service clock for the rolling window', async t => {
  const f = fixture(t);
  const data = JSON.parse(readFileSync(new URL('../../static/calendar-reminders/calendar-data.json', import.meta.url), 'utf8'));
  let current = new Date('2030-06-01T04:00:00Z');
  const settings = defaults(data.catalog, 'Asia/Shanghai');
  settings.events['guru-tsok'].mode = 'remind';
  const service = createCalendarService({
    getData: () => data, validateSettings, selectOccurrences, exportICS, now: () => current
  });
  const createdResponse = await service.fetch(new Request(`${BASE}/api/subscriptions`, {
    method: 'POST', headers: {Origin: ORIGIN, 'Content-Type': 'application/json'},
    body: JSON.stringify({settings})
  }), f.env);
  assert.equal(createdResponse.status, 201, await createdResponse.clone().text());
  const created = await createdResponse.json();
  for (const today of ['2030-06-01', '2031-06-01']) {
    current = new Date(`${today}T04:00:00Z`);
    const response = await service.fetch(new Request(created.feedUrl), f.env);
    assert.equal(response.status, 200, await response.clone().text());
    const actual = f.entries(await response.text()).filter(event => event.getFirstPropertyValue('status') === 'CONFIRMED');
    const expected = selectOccurrences(data, settings, {start: addDays(today, -90), end: rangeEnd(today, 24)});
    assert.ok(actual.length > 20);
    assert.deepEqual(actual.map(event => event.getFirstPropertyValue('uid')).sort(),
      expected.map(event => `${event.uid}@calendar.huidengvan.org`).sort());
    assert.ok(actual.some(event => event.getFirstPropertyValue('dtstart').toString() > data.coverage.end));
  }
});

test('a rolling Los Angeles subscription survives a newly included autumn DST overlap with one early alarm', async t => {
  const f = fixture(t);
  const data = JSON.parse(readFileSync(new URL('../../static/calendar-reminders/calendar-data.json', import.meta.url), 'utf8'));
  let current = new Date('2026-10-21T12:00:00Z');
  const settings = {version: 2, zone: 'America/Los_Angeles', events: {
    avalokiteshvara: {mode: 'remind', reminders: [{daysBefore: 0, time: '01:30'}]}
  }};
  const service = createCalendarService({
    getData: () => data, validateSettings, selectOccurrences, exportICS, now: () => current
  });
  const createdResponse = await service.fetch(new Request(`${BASE}/api/subscriptions`, {
    method: 'POST', headers: {Origin: ORIGIN, 'Content-Type': 'application/json'},
    body: JSON.stringify({settings})
  }), f.env);
  assert.equal(createdResponse.status, 201, await createdResponse.clone().text());
  const created = await createdResponse.json();
  const initial = await service.fetch(new Request(created.feedUrl), f.env);
  assert.equal(initial.status, 200);
  assert.equal(f.entries(await initial.text()).some(event =>
    event.getFirstPropertyValue('dtstart').toString() === '2028-11-05'), false);
  current = new Date('2026-11-07T12:00:00Z');
  const advanced = await service.fetch(new Request(created.feedUrl), f.env);
  assert.equal(advanced.status, 200, await advanced.clone().text());
  const overlaps = f.entries(await advanced.text()).filter(event =>
    event.getFirstPropertyValue('dtstart').toString() === '2028-11-05');
  assert.equal(overlaps.length, 1);
  assert.equal(overlaps[0].getFirstPropertyValue('summary'), '观音菩萨加持日');
  const alarms = overlaps[0].getAllSubcomponents('valarm');
  assert.equal(alarms.length, 1);
  assert.equal(alarms[0].getFirstPropertyValue('trigger').toString(), '2028-11-05T08:30:00Z');
});

test('persisted snapshot GET, HEAD and 304 hits do not generate events, read the ledger or write D1', async t => {
  const f = fixture(t), created = await f.create();
  const first = await f.fetch(created.feedUrl), body = await first.text();
  f.reopen(); // A new process also benefits; this is not an isolate memory cache.
  const expectedCalls = {...f.calls};
  const originalPrepare = f.db.prepare.bind(f.db);
  f.db.prepare = sql => {
    assert.match(sql, /^SELECT /, 'cache hits must not issue mutation statements');
    assert.doesNotMatch(sql, /calendar_entries/, 'cache hits must not load publication entries');
    return originalPrepare(sql);
  };
  f.db.batch = () => { assert.fail('cache hits must not start a write transaction'); };
  for (const options of [{}, {method: 'HEAD'}, {headers: {'If-None-Match': first.headers.get('ETag')}}]) {
    const response = await f.fetch(created.feedUrl, options);
    assert.equal(response.status, options.headers ? 304 : 200);
    assert.equal(response.headers.get('ETag'), first.headers.get('ETag'));
    assert.equal(await response.text(), options.method || options.headers ? '' : body);
  }
  assert.deepEqual(f.calls, expectedCalls);
  assert.equal((await f.db.prepare('SELECT render_version FROM subscriptions').first()).render_version, 1);
});

test('snapshots expire exactly at one hour without changing stable event versions or ETags', async t => {
  const f = fixture(t), created = await f.create();
  const first = await f.fetch(created.feedUrl), before = {...f.calls};
  f.tick(3599999);
  assert.equal((await f.fetch(created.feedUrl)).status, 200);
  assert.deepEqual(f.calls, before);
  f.tick(1);
  const expired = await f.fetch(created.feedUrl, {headers: {'If-None-Match': first.headers.get('ETag')}});
  assert.equal(expired.status, 304);
  assert.equal(f.calls.selection, before.selection + 1);
  assert.equal(f.calls.export, before.export + 1);
  assert.equal((await f.db.prepare('SELECT sequence FROM calendar_entries').first()).sequence, 0);
  assert.equal((await f.db.prepare('SELECT render_version FROM subscriptions').first()).render_version, 2);
});

test('snapshot rolling-day invalidation uses the reminder zone, including Vancouver daylight time', async t => {
  const f = fixture(t);
  for (const [zone, midnight] of [['Asia/Shanghai', '2026-10-20T16:00:00Z'], ['America/Vancouver', '2026-10-21T07:00:00Z']]) {
    f.setTime(new Date(Date.parse(midnight) - 60000));
    const created = await f.create({...makeSettings(), zone});
    await f.fetch(created.feedUrl);
    const before = {...f.calls};
    const old = await f.db.prepare('SELECT local_day FROM feed_snapshots WHERE subscription_id = ?').bind(created.id).first();
    f.tick(120000);
    assert.equal((await f.fetch(created.feedUrl)).status, 200);
    const fresh = await f.db.prepare('SELECT local_day FROM feed_snapshots WHERE subscription_id = ?').bind(created.id).first();
    assert.equal(old.local_day, '2026-10-20');
    assert.equal(fresh.local_day, '2026-10-21');
    assert.equal(f.calls.selection, before.selection + 1);
  }
});

test('release data and renderer versions independently invalidate snapshots without changing settings revision', async t => {
  const f = fixture(t), created = await f.create();
  f.release.dataVersion = 'published-data-a';
  await f.fetch(created.feedUrl);
  const before = {...f.calls};
  f.release.dataVersion = 'published-data-b';
  await f.fetch(created.feedUrl);
  f.release.rendererVersion = 'renderer-b';
  await f.fetch(created.feedUrl);
  assert.equal(f.calls.selection, before.selection + 2);
  const row = await f.db.prepare('SELECT * FROM feed_snapshots').first();
  assert.equal(row.data_version, 'published-data-b');
  assert.equal(row.renderer_version, 'renderer-b');
  assert.equal(row.settings_revision, 1);
  assert.equal((await f.db.prepare('SELECT revision FROM subscriptions').first()).revision, 1);
});

test('editing and disabling atomically remove cached private settings before the next fetch', async t => {
  const f = fixture(t), created = await f.create();
  await f.fetch(created.feedUrl);
  assert.equal((await f.api(`/api/subscriptions/${created.id}`, 'PATCH',
    {settings: makeSettings('display'), revision: 1}, created.manageToken)).status, 200);
  assert.equal((await f.db.prepare('SELECT count(*) AS count FROM feed_snapshots').first()).count, 0);
  await f.fetch(created.feedUrl);
  assert.equal((await f.db.prepare('SELECT settings_revision FROM feed_snapshots').first()).settings_revision, 2);
  assert.equal((await f.api(`/api/subscriptions/${created.id}`, 'DELETE', undefined, created.manageToken)).status, 200);
  assert.equal((await f.db.prepare('SELECT count(*) AS count FROM feed_snapshots').first()).count, 0);
  const cancelled = await f.fetch(created.feedUrl);
  const text = await cancelled.text();
  assert.doesNotMatch(text, /BEGIN:VALARM/);
  assert.match(text, /STATUS:CANCELLED/);
  assert.equal((await f.db.prepare('SELECT settings_revision FROM feed_snapshots').first()).settings_revision, 3);
});

test('five concurrent cold and expired fetches reuse the winning snapshot without sequence or render-version inflation', async t => {
  const f = fixture(t), created = await f.create();
  for (const expectedVersion of [1, 2]) {
    const responses = await Promise.all(Array.from({length: 5}, () => f.fetch(created.feedUrl)));
    assert.ok(responses.every(response => response.status === 200));
    const bodies = await Promise.all(responses.map(response => response.text()));
    assert.equal(new Set(bodies).size, 1);
    assert.equal((await f.db.prepare('SELECT render_version FROM subscriptions').first()).render_version, expectedVersion);
    assert.equal((await f.db.prepare('SELECT sequence FROM calendar_entries').first()).sequence, 0);
    assert.equal((await f.db.prepare('SELECT count(*) AS count FROM feed_snapshots').first()).count, 1);
    f.tick(3600000);
  }
});

test('a settings edit racing a cold snapshot cannot publish the old preference', async t => {
  const f = fixture(t), created = await f.create();
  const batch = f.db.batch.bind(f.db);
  let interrupted = false;
  f.db.batch = async statements => {
    if (!interrupted && statements.at(-1).sql.includes('render_version = render_version + 1')) {
      interrupted = true;
      const response = await f.api(`/api/subscriptions/${created.id}`, 'PATCH',
        {settings: makeSettings('display'), revision: 1}, created.manageToken);
      assert.equal(response.status, 200);
    }
    return batch(statements);
  };
  const response = await f.fetch(created.feedUrl);
  assert.equal(response.status, 200);
  assert.equal(interrupted, true);
  assert.doesNotMatch(await response.text(), /BEGIN:VALARM/);
  const snapshot = await f.db.prepare('SELECT * FROM feed_snapshots').first();
  assert.equal(snapshot.settings_revision, 2);
  assert.doesNotMatch(snapshot.ics, /BEGIN:VALARM/);
  assert.equal((await f.db.prepare('SELECT render_version FROM subscriptions').first()).render_version, 1);
});

test('disable racing a refresh cannot resurrect cached reminders or overwrite cancellations', async t => {
  const f = fixture(t), created = await f.create();
  await f.fetch(created.feedUrl);
  f.data.occurrences[0].date = '2027-03-21';
  const batch = f.db.batch.bind(f.db);
  let interrupted = false;
  f.db.batch = async statements => {
    if (!interrupted && statements.at(-1).sql.includes('render_version = render_version + 1')) {
      interrupted = true;
      assert.equal((await f.api(`/api/subscriptions/${created.id}`, 'DELETE', undefined, created.manageToken)).status, 200);
    }
    return batch(statements);
  };
  const response = await f.fetch(created.feedUrl), text = await response.text();
  assert.equal(response.status, 200);
  assert.match(text, /STATUS:CANCELLED/);
  assert.doesNotMatch(text, /BEGIN:VALARM/);
  assert.equal(f.entries(text)[0].getFirstPropertyValue('sequence'), 1);
  assert.equal((await f.db.prepare('SELECT settings_revision FROM feed_snapshots').first()).settings_revision, 2);
});

test('an older database gains the additive snapshot table without changing subscriptions or publication history', async t => {
  const f = fixture(t), created = await f.create();
  await f.fetch(created.feedUrl);
  const before = await f.db.prepare('SELECT * FROM calendar_entries').first();
  await f.db.exec('DROP TABLE feed_snapshots');
  f.reopen();
  assert.deepEqual(await f.db.prepare('SELECT * FROM calendar_entries').first(), before);
  assert.equal((await f.db.prepare('SELECT count(*) AS count FROM feed_snapshots').first()).count, 0);
  assert.equal((await f.fetch(created.feedUrl)).status, 200);
  assert.equal((await f.db.prepare('SELECT sequence FROM calendar_entries').first()).sequence, before.sequence);
});

test('scheduled cleanup expires snapshots while retaining current snapshots and stable publication history', async t => {
  const f = fixture(t), first = await f.create();
  await f.fetch(first.feedUrl);
  f.tick(1800000);
  const second = await f.create();
  await f.fetch(second.feedUrl);
  f.tick(1800000);
  await f.service.scheduled(null, f.env);
  const snapshots = (await f.db.prepare('SELECT subscription_id FROM feed_snapshots').all()).results;
  assert.deepEqual(snapshots, [{subscription_id: second.id}]);
  assert.equal((await f.db.prepare('SELECT count(*) AS count FROM calendar_entries').first()).count, 2);
});

test('health is read-only, validates configuration and migrations, and exposes only release metadata', async t => {
  const f = fixture(t), created = await f.create();
  f.release.dataVersion = 'published-data-hash';
  const prepare = f.db.prepare.bind(f.db);
  f.db.prepare = sql => { assert.match(sql, /^SELECT /); return prepare(sql); };
  f.db.batch = () => { assert.fail('health must never write'); };
  const expected = {status: 'ok', version: 'test-commit', dataVersion: 'published-data-hash', environment: 'acceptance'};
  const ok = await f.fetch('/healthz');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await ok.json(), expected);
  const head = await f.fetch('/healthz', {method: 'HEAD'});
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  for (const [key, invalid] of [['PUBLIC_BASE_URL', 'http://insecure.example'], ['ALLOWED_ORIGINS', ''], ['RATE_LIMIT_SALT', ''], ['DB', null]]) {
    const original = f.env[key]; f.env[key] = invalid;
    const unavailable = await f.fetch('/healthz');
    assert.equal(unavailable.status, 503, key);
    assert.deepEqual(await unavailable.json(), {...expected, status: 'unavailable'});
    f.env[key] = original;
  }
  f.db.prepare = () => { throw new Error(`sensitive diagnostics: ${created.manageToken} ${created.feedUrl}`); };
  const failure = await f.fetch('/healthz');
  assert.equal(failure.status, 503);
  assert.deepEqual(await failure.json(), {...expected, status: 'unavailable'});
  f.db.prepare = prepare;
  await f.db.exec('DROP TABLE feed_snapshots');
  assert.equal((await f.fetch('/healthz')).status, 503);
});
