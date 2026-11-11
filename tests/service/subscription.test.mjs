import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, realpathSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname, basename} from 'node:path';
import ICAL from 'ical.js';
import {SQLiteD1} from '../../service/calendar/sqlite-d1.mjs';
import {createCalendarService, digest, clientFamily} from '../../service/calendar/service.mjs';
import {validateSettings, exportICS, selectOccurrences, defaults, addDays, rangeEnd, resolveAlarmInstants} from '../../static/calendar-reminders/core.mjs';
import {dailyDateOccurrences} from '../../static/calendar-reminders/engine.mjs';

const ORIGIN = 'https://www.example.org';
const BASE = 'https://calendar.example.org';
const date = '2027-03-20';
const makeSettings = (mode = 'remind', time = '08:00') => ({
  version: 2, zone: 'Asia/Shanghai',
  events: {test: {mode, reminders: [{daysBefore: 0, time}]}}
});
const newCreationKey = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
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
  let dataReads = 0;
  const service = createCalendarService({
    getData: () => { dataReads++; return data; }, getRelease: () => release, validateSettings,
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
    get dataReads() { return dataReads; },
    get db() { return DB; },
    tick(milliseconds) { current = new Date(current.getTime() + milliseconds); },
    setTime(instant) { current = new Date(instant); },
    reopen() { DB.close(); DB = new SQLiteD1(dbPath); env.DB = DB; }
  };
}

test('daily layer v2 input is opt-in and rejects non-boolean API values before persistence', async t => {
  const f = fixture(t);
  const created = await f.create(makeSettings('off'));
  assert.equal(created.settings.includeDailyDates, false);
  assert.equal(f.entries(await (await f.fetch(created.feedUrl)).text()).length, 0);
  for (const includeDailyDates of [null, 'true', 'false', 0, 1, [], {}]) {
    const settings = {...makeSettings('off'), includeDailyDates};
    assert.equal((await f.api('/api/subscriptions', 'POST', {settings})).status, 400);
    assert.equal((await f.api(`/api/subscriptions/${created.id}`, 'PATCH',
      {settings, revision: 1}, created.manageToken)).status, 400);
  }
  const record = await f.db.prepare('SELECT * FROM subscriptions').first();
  assert.equal(record.revision, 1);
  assert.equal(JSON.parse(record.settings_json).includeDailyDates, false);
  assert.equal((await f.db.prepare('SELECT count(*) AS total FROM subscriptions').first()).total, 1);
});

test('daily dates are live: enable, disable, re-enable and stop keep URL and UID, never touch the ledger, and only raise versions', async t => {
  const f = fixture(t), created = await f.create();
  const initial = f.entries(await (await f.fetch(created.feedUrl)).text());
  assert.equal(initial.length, 1);
  const festivalUid = initial[0].getFirstPropertyValue('uid');
  let revision = 1;
  const change = async includeDailyDates => {
    f.tick(1000);
    const response = await f.api(`/api/subscriptions/${created.id}`, 'PATCH',
      {settings: {...makeSettings(), includeDailyDates}, revision}, created.manageToken);
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal(saved.feedUrl, created.feedUrl);
    assert.equal(saved.revision, ++revision);
    assert.equal((await f.db.prepare('SELECT count(*) AS total FROM feed_snapshots').first()).total, 0);
    return f.fetch(created.feedUrl);
  };
  const first = await change(true), firstText = await first.text(), enabled = f.entries(firstText);
  const daily = enabled.filter(event => event.getFirstPropertyValue('uid').startsWith('daily-date-'));
  const firstDay = addDays('2026-10-20', -90), finalDay = rangeEnd('2026-10-20', 24);
  assert.equal(daily.length, (Date.parse(finalDay) - Date.parse(firstDay)) / 86400000 + 1);
  assert.equal(enabled.length, daily.length + 1);
  assert.equal(new Set(enabled.map(event => event.getFirstPropertyValue('uid'))).size, enabled.length);
  for (const event of daily) {
    const civil = event.getFirstPropertyValue('dtstart');
    assert.equal(civil.isDate, true);
    assert.equal(event.getFirstPropertyValue('uid'), `daily-date-${civil.toString()}@calendar.huidengvan.org`);
    assert.ok(event.getFirstPropertyValue('sequence') >= 1000, 'live daily versions start above every ledger version');
    assert.equal(event.getAllSubcomponents('valarm').length, 0);
    assert.doesNotMatch(event.getFirstPropertyValue('description'), /佛慧法语|fohuifayu/);
  }
  const trackedUid = 'daily-date-2026-10-20@calendar.huidengvan.org';
  const repeated = enabled.find(event => event.getFirstPropertyValue('uid') === trackedUid);
  assert.match(repeated.getFirstPropertyValue('summary'), /重日2/);
  assert.equal(enabled.find(event => event.getFirstPropertyValue('uid') === festivalUid).getFirstPropertyValue('sequence'), 0);
  const dailyRows = async () => (await f.db.prepare(`SELECT count(*) AS total FROM calendar_entries WHERE uid LIKE 'daily-date-%'`).first()).total;
  assert.equal(await dailyRows(), 0, 'daily dates are not stored per subscriber');
  const firstSequence = repeated.getFirstPropertyValue('sequence');
  const snapshotCalls = {...f.calls};
  const renderVersion = (await f.db.prepare('SELECT render_version FROM subscriptions').first()).render_version;
  assert.equal((await f.fetch(created.feedUrl, {headers: {'If-None-Match': first.headers.get('ETag')}})).status, 304);
  assert.deepEqual(f.calls, snapshotCalls);
  assert.equal((await f.db.prepare('SELECT render_version FROM subscriptions').first()).render_version, renderVersion);

  const removed = await change(false), removedEvents = f.entries(await removed.text());
  assert.notEqual(removed.headers.get('ETag'), first.headers.get('ETag'));
  // Turning daily dates off leaves them out of the feed entirely (11-10 device test).
  assert.equal(removedEvents.filter(event => event.getFirstPropertyValue('uid').startsWith('daily-date-')).length, 0);
  assert.equal(removedEvents.length, 1);
  assert.equal(removedEvents.find(event => event.getFirstPropertyValue('uid') === festivalUid).getFirstPropertyValue('sequence'), 0);
  const restored = f.entries(await (await change(true)).text());
  for (const event of restored.filter(event => event.getFirstPropertyValue('uid').startsWith('daily-date-'))) {
    assert.equal(event.getFirstPropertyValue('status'), 'CONFIRMED');
    assert.ok(event.getFirstPropertyValue('sequence') > firstSequence);
    assert.equal(event.getAllSubcomponents('valarm').length, 0);
  }
  assert.equal(await dailyRows(), 0);
  f.tick(1000);
  assert.equal((await f.api(`/api/subscriptions/${created.id}`, 'DELETE', undefined, created.manageToken)).status, 200);
  const stoppedText = await (await f.fetch(created.feedUrl)).text(), stopped = f.entries(stoppedText);
  assert.doesNotMatch(stoppedText, /BEGIN:VALARM/);
  assert.equal(stopped.length, 0, 'a stopped subscription lists nothing; calendar apps drop what the feed no longer lists');
  assert.equal((await f.db.prepare('SELECT count(*) AS count FROM calendar_entries WHERE cancelled_at IS NOT NULL').first()).count, 1,
    'the ledger keeps the cancelled festival so a return continues its SEQUENCE');
  assert.equal((await f.db.prepare('SELECT settings_json FROM subscriptions').first()).settings_json, '{}');
});

test('legacy PATCH omission preserves current daily choice while explicit false removes it', async t => {
  const f = fixture(t), created = await f.create({...makeSettings('off'), includeDailyDates: true});
  await f.fetch(created.feedUrl);
  const path = `/api/subscriptions/${created.id}`;
  const same = await f.api(path, 'PATCH', {settings: makeSettings('off'), revision: 1}, created.manageToken);
  assert.equal(same.status, 200);
  const sameValue = await same.json();
  assert.equal(sameValue.revision, 1);
  assert.equal(sameValue.settings.includeDailyDates, true);
  const edited = await f.api(path, 'PATCH', {settings: makeSettings('display'), revision: 1}, created.manageToken);
  const updated = await edited.json();
  assert.equal(updated.revision, 2);
  assert.equal(updated.settings.includeDailyDates, true);
  assert.equal(updated.feedUrl, created.feedUrl);
  const feed = f.entries(await (await f.fetch(created.feedUrl)).text());
  assert.ok(feed.some(event => event.getFirstPropertyValue('uid').startsWith('daily-date-')));
  assert.ok(feed.every(event => event.getAllSubcomponents('valarm').length === 0));
  const explicit = await f.api(path, 'PATCH',
    {settings: {...makeSettings('display'), includeDailyDates: false}, revision: 2}, created.manageToken);
  assert.equal((await explicit.json()).settings.includeDailyDates, false);
  const omitted = await f.api(path, 'PATCH', {settings: makeSettings('display'), revision: 3}, created.manageToken);
  const last = await omitted.json();
  assert.equal(last.settings.includeDailyDates, false);
  assert.equal(last.revision, 3);
});

test('timezone edits leave overlapping daily dates and titles unchanged, never lower versions and never introduce alarms', async t => {
  const f = fixture(t), settings = {...makeSettings('off'), includeDailyDates: true};
  const created = await f.create(settings);
  const first = f.entries(await (await f.fetch(created.feedUrl)).text());
  const byUid = new Map(first.map(event => [event.getFirstPropertyValue('uid'), event]));
  f.tick(1000);
  const response = await f.api(`/api/subscriptions/${created.id}`, 'PATCH',
    {settings: {...settings, zone: 'America/Vancouver'}, revision: 1}, created.manageToken);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).feedUrl, created.feedUrl);
  const body = await (await f.fetch(created.feedUrl)).text();
  assert.doesNotMatch(body, /BEGIN:VALARM/);
  const changed = f.entries(body).filter(event => event.getFirstPropertyValue('status') === 'CONFIRMED');
  let overlaps = 0;
  for (const event of changed) {
    const previous = byUid.get(event.getFirstPropertyValue('uid'));
    if (!previous) continue;
    overlaps++;
    for (const field of ['summary', 'description'])
      assert.equal(String(event.getFirstPropertyValue(field)), String(previous.getFirstPropertyValue(field)), field);
    // A settings save may raise a live daily version; it must never lower it.
    assert.ok(event.getFirstPropertyValue('sequence') >= previous.getFirstPropertyValue('sequence'));
    assert.equal(event.getFirstPropertyValue('dtstart').toString(), previous.getFirstPropertyValue('dtstart').toString());
  }
  assert.ok(overlaps > 800);
});

test('persisted pre-extension v2 settings need no migration and omitted PATCH preserves the new server choice', async t => {
  const f = fixture(t), created = await f.create(makeSettings('display'));
  // Model an actual pre-extension row, not just a legacy request sent to the new validator.
  await f.db.prepare("UPDATE subscriptions SET settings_json = json_remove(settings_json, '$.includeDailyDates') WHERE id = ?")
    .bind(created.id).run();
  const original = await f.db.prepare('SELECT settings_json FROM subscriptions').first();
  assert.equal(Object.hasOwn(JSON.parse(original.settings_json), 'includeDailyDates'), false);
  const oldFeed = f.entries(await (await f.fetch(created.feedUrl)).text());
  assert.equal(oldFeed.length, 1);
  assert.ok(!oldFeed[0].getFirstPropertyValue('uid').startsWith('daily-date-'));
  const path = `/api/subscriptions/${created.id}`;
  const legacy = await f.api(path, 'PATCH', {settings: makeSettings('remind', '09:00'), revision: 1}, created.manageToken);
  assert.equal(legacy.status, 200);
  const saved = await legacy.json();
  assert.equal(saved.settings.includeDailyDates, false);
  assert.equal(saved.feedUrl, created.feedUrl);
  const enabled = await f.api(path, 'PATCH', {settings: {...saved.settings, includeDailyDates: true}, revision: saved.revision}, created.manageToken);
  const changed = await enabled.json();
  assert.equal(changed.settings.includeDailyDates, true);
  const omitted = await f.api(path, 'PATCH', {settings: makeSettings('display'), revision: changed.revision}, created.manageToken);
  assert.equal(omitted.status, 200);
  assert.equal((await omitted.json()).settings.includeDailyDates, true);
  assert.ok(f.entries(await (await f.fetch(created.feedUrl)).text()).some(event => event.getFirstPropertyValue('uid').startsWith('daily-date-')));
});

test('daily rows stored before 11-10 are removed once and live versions stay above them', async t => {
  const f = fixture(t), created = await f.create({...makeSettings('off'), includeDailyDates: true});
  await f.fetch(created.feedUrl);
  // Model a subscriber from before the change: daily dates in the ledger with versions up to 7.
  const sample = 'daily-date-2026-10-20';
  await f.db.prepare(`INSERT INTO calendar_entries (subscription_id, uid, content_hash, event_json, sequence, created_at, modified_at, cancelled_at)
    VALUES (?, ?, 'h', '{}', 7, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', NULL),
           (?, 'daily-date-2026-10-21', 'h', '{}', 3, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', '2026-10-02T00:00:00.000Z')`)
    .bind(created.id, sample, created.id).run();
  await f.db.prepare('DELETE FROM feed_snapshots').run();
  f.tick(1000);
  const events = f.entries(await (await f.fetch(created.feedUrl)).text());
  const legacy = events.find(event => event.getFirstPropertyValue('uid') === `${sample}@calendar.huidengvan.org`);
  assert.equal(legacy.getFirstPropertyValue('status'), 'CONFIRMED');
  assert.ok(legacy.getFirstPropertyValue('sequence') > 7);
  assert.equal(events.filter(event => event.getFirstPropertyValue('uid') === legacy.getFirstPropertyValue('uid')).length, 1, 'no duplicate after the move');
  assert.equal((await f.db.prepare(`SELECT count(*) AS total FROM calendar_entries WHERE uid LIKE 'daily-date-%'`).first()).total, 0);
});

test('a daily date label correction retains the civil UID and publishes a higher sequence and fresh ETag', async t => {
  const f = fixture(t);
  // The injected selector simulates a future PRO correction on one real date.
  // The production selector generates this same event shape from the shared helper.
  f.data.occurrences = [{...dailyDateOccurrences(date, date)[0], id: 'test', eventId: 'test'}];
  const created = await f.create(makeSettings('display'));
  const first = await f.fetch(created.feedUrl), before = f.entries(await first.text())[0];
  f.tick(1000);
  // A real correction arrives as a new data import, which advances updatedOn.
  f.data.updatedOn = '2026-10-21';
  Object.assign(f.data.occurrences[0], {title: '藏历二月十一（历法校订）', tibetan: '二月十一',
    description: '藏历日期校订。日期换算：藏历 PRO。'});
  const updated = await f.fetch(created.feedUrl), after = f.entries(await updated.text())[0];
  assert.equal(before.getFirstPropertyValue('uid'), `daily-date-${date}@calendar.huidengvan.org`);
  assert.equal(after.getFirstPropertyValue('uid'), before.getFirstPropertyValue('uid'));
  assert.equal(after.getFirstPropertyValue('dtstart').toString(), date);
  assert.ok(after.getFirstPropertyValue('sequence') > before.getFirstPropertyValue('sequence'));
  assert.match(after.getFirstPropertyValue('summary'), /校订/);
  assert.match(after.getFirstPropertyValue('description'), /日期校订/);
  assert.notEqual(after.getFirstPropertyValue('last-modified').toString(), before.getFirstPropertyValue('last-modified').toString());
  assert.notEqual(updated.headers.get('ETag'), first.headers.get('ETag'));
  assert.equal(after.getAllSubcomponents('valarm').length, 0);
  assert.doesNotMatch(after.getFirstPropertyValue('description'), /佛慧法语/);
});

test('production HTTP reads redirect to the configured HTTPS host without touching data or D1', async t => {
  const f = fixture(t);
  f.env.DB = new Proxy({}, {get() { assert.fail('HTTP transport handling must not access D1'); }});
  for (const method of ['GET', 'HEAD']) {
    for (const path of ['/healthz?test=1', '//untrusted.example/calendar/example.ics?check=1']) {
      const response = await f.service.fetch(new Request(`http://incoming.example${path}`, {method}), f.env);
      assert.equal(response.status, 308);
      const target = new URL(response.headers.get('Location'));
      assert.equal(target.origin, BASE);
      assert.equal(target.pathname + target.search, path);
      assert.equal(response.headers.get('Strict-Transport-Security'), null);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.equal(await response.text(), '');
    }
  }
  assert.equal(f.dataReads, 0);
});

test('HTTP writes fail before reading credentials, request bodies or D1; the local exception stays on loopback', async t => {
  const f = fixture(t);
  f.env.DB = new Proxy({}, {get() { assert.fail('HTTP writes must not access D1'); }});
  f.env.ALLOW_LOCAL_DEV = 'true';
  for (const method of ['POST', 'PATCH', 'DELETE', 'OPTIONS']) {
    const request = new Request('http://incoming.example/api/subscriptions', {
      method, headers: {Origin: ORIGIN, 'Content-Type': 'application/json'}, body: '{invalid'
    });
    const response = await f.service.fetch(request, f.env);
    assert.equal(response.status, 426);
    assert.equal(request.bodyUsed, false);
    assert.match((await response.json()).error, /HTTPS/);
  }
  assert.equal(f.dataReads, 0);
});

test('HTTPS applies HSTS to health, errors, API, calendar, HEAD and 304 while preserving CORS', async t => {
  const f = fixture(t), created = await f.create();
  const feed = await f.fetch(created.feedUrl);
  const responses = [feed, await f.fetch('/healthz'), await f.fetch('/missing'),
    await f.fetch('/api/subscriptions', {method: 'POST'}),
    await f.api(`/api/subscriptions/${created.id}`, 'GET', undefined, created.manageToken),
    await f.fetch(created.feedUrl, {method: 'HEAD'}),
    await f.fetch(created.feedUrl, {headers: {'If-None-Match': feed.headers.get('ETag')}})];
  for (const response of responses) assert.equal(response.headers.get('Strict-Transport-Security'), 'max-age=31536000');
  assert.equal(responses.at(-1).status, 304);
  assert.equal(responses[4].headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(responses[4].headers.get('Vary'), 'Origin');
  f.env.PUBLIC_BASE_URL = 'bad configuration';
  const broken = await f.fetch('/healthz');
  assert.equal(broken.status, 503);
  assert.equal(broken.headers.get('Strict-Transport-Security'), 'max-age=31536000');
});

test('explicit loopback HTTP development still creates and reads subscriptions without HSTS', async t => {
  const f = fixture(t), local = 'http://127.0.0.1:8787';
  Object.assign(f.env, {ALLOW_LOCAL_DEV: 'true', PUBLIC_BASE_URL: local, ALLOWED_ORIGINS: local});
  const request = new Request(`${local}/api/subscriptions`, {method: 'POST',
    headers: {Origin: local, 'Content-Type': 'application/json'}, body: JSON.stringify({settings: makeSettings()})});
  const response = await f.service.fetch(request, f.env);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('Strict-Transport-Security'), null);
  const created = await response.json();
  assert.equal(new URL(created.feedUrl).origin, local);
  assert.equal((await f.service.fetch(new Request(created.feedUrl), f.env)).status, 200);
});

test('creation and edits validate alarms without discarded ICS; unchanged settings do not regenerate dates', async t => {
  let invalid = false, resolutions = 0;
  const f = fixture(t, (event, zone) => {
    resolutions++;
    if (invalid) throw new Error('提醒时间无法转换。');
    return resolveAlarmInstants(event, zone);
  });
  const created = await f.create();
  assert.equal(resolutions, 1);
  assert.equal(f.calls.export, 0);
  const before = {...f.calls};
  const same = await f.api(`/api/subscriptions/${created.id}`, 'PATCH',
    {settings: makeSettings(), revision: 1}, created.manageToken);
  assert.equal(same.status, 200);
  assert.equal((await same.json()).revision, 1);
  assert.deepEqual(f.calls, before);
  assert.equal(resolutions, 1);
  invalid = true;
  assert.equal((await f.api('/api/subscriptions', 'POST', {settings: makeSettings()})).status, 400);
  assert.equal((await f.api(`/api/subscriptions/${created.id}`, 'PATCH',
    {settings: makeSettings('remind', '09:00'), revision: 1}, created.manageToken)).status, 400);
  assert.equal((await f.db.prepare('SELECT count(*) AS total FROM subscriptions').first()).total, 1);
  assert.equal((await f.db.prepare('SELECT revision FROM subscriptions').first()).revision, 1);
});

test('validation without ICS still rejects invalid dates and duplicate or absent publication identifiers', async t => {
  const f = fixture(t), original = {...f.data.occurrences[0]};
  for (const occurrences of [
    [original, {...original}],
    [{...original, uid: ''}],
    [{...original, date: '2027-03-invalid'}]
  ]) {
    f.data.occurrences = occurrences;
    const response = await f.api('/api/subscriptions', 'POST', {settings: makeSettings('display')});
    assert.equal(response.status, 400);
    assert.equal((await f.db.prepare('SELECT count(*) AS total FROM subscriptions').first()).total, 0);
  }
});

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

test('a committed creation with a lost response recovers its capability and current revision without another write', async t => {
  const f=fixture(t), key=newCreationKey(), original=makeSettings();
  const headers={'Idempotency-Key':key,'CF-Connecting-IP':'192.0.2.1'};
  const first=await f.api('/api/subscriptions','POST',{settings:original},undefined,headers);
  assert.equal(first.status,201);
  // Deliberately discard the HTTP response body and reopen the persisted DB.
  const before=await f.db.prepare('SELECT * FROM subscriptions').first();
  assert.equal(JSON.stringify(before).includes(key),false);
  f.reopen();
  const retry=await f.api('/api/subscriptions','POST',{settings:original},undefined,headers);
  assert.equal(retry.status,200);
  const recovered=await retry.json();
  assert.equal(recovered.id,before.id);
  assert.equal(await digest(recovered.manageToken),before.manage_token_hash);
  assert.equal(recovered.feedUrl,`${BASE}/calendar/${before.feed_token}.ics`);
  assert.equal(JSON.stringify(before).includes(recovered.manageToken),false);
  assert.equal((await f.db.prepare('SELECT count(*) AS total FROM subscriptions').first()).total,1);
  assert.equal((await f.db.prepare('SELECT count FROM creation_limits').first()).count,1);
  const edited=makeSettings('display');
  assert.equal((await f.api(`/api/subscriptions/${recovered.id}`,'PATCH',{settings:edited,revision:1},recovered.manageToken)).status,200);
  const replay=await f.api('/api/subscriptions','POST',{settings:original},undefined,headers);
  assert.equal(replay.status,200);
  const current=await replay.json();
  assert.equal(current.id,recovered.id);assert.equal(current.manageToken,recovered.manageToken);
  assert.equal(current.feedUrl,recovered.feedUrl);assert.equal(current.revision,2);
  assert.deepEqual(current.settings,{...edited,includeDailyDates:false});
  // Recovery does not revalidate retired content or rebuild the whole calendar.
  f.data.catalog.events=[];
  const exports=f.calls.export;
  assert.equal((await f.api('/api/subscriptions','POST',{settings:original},undefined,headers)).status,200);
  assert.equal(f.calls.export,exports);
});

test('concurrent same-key creations have one winner and consume one creation allowance', async t => {
  const f=fixture(t), headers={'Idempotency-Key':newCreationKey(),'CF-Connecting-IP':'192.0.2.2'};
  const responses=await Promise.all(Array.from({length:5},()=>f.api('/api/subscriptions','POST',{settings:makeSettings()},undefined,headers)));
  assert.equal(responses.filter(response=>response.status===201).length,1);
  assert.equal(responses.filter(response=>response.status===200).length,4);
  const bodies=await Promise.all(responses.map(response=>response.json()));
  for(const body of bodies) {
    assert.equal(body.id,bodies[0].id);assert.equal(body.feedUrl,bodies[0].feedUrl);
    assert.equal(body.manageToken,bodies[0].manageToken);assert.equal(body.revision,1);
  }
  assert.equal((await f.db.prepare('SELECT count(*) AS total FROM subscriptions').first()).total,1);
  assert.equal((await f.db.prepare('SELECT count FROM creation_limits').first()).count,1);
});

test('same-key requests with different bodies are rejected, including racing first requests', async t => {
  const f=fixture(t), headers={'Idempotency-Key':newCreationKey(),'CF-Connecting-IP':'192.0.2.3'};
  const responses=await Promise.all(['08:00','09:00'].map(time=>f.api('/api/subscriptions','POST',{settings:makeSettings('remind',time)},undefined,headers)));
  assert.deepEqual(responses.map(response=>response.status).sort(),[201,409]);
  assert.equal((await responses.find(response=>response.status===409).json()).code,'creation_body_mismatch');
  assert.equal((await f.db.prepare('SELECT count(*) AS total FROM subscriptions').first()).total,1);
  assert.equal((await f.db.prepare('SELECT count FROM creation_limits').first()).count,1);
});

test('disabled, expired and salt-rotated creation attempts fail explicitly and never create or revive subscriptions', async t => {
  const f=fixture(t), create=async()=>{
    const headers={'Idempotency-Key':newCreationKey()};
    const response=await f.api('/api/subscriptions','POST',{settings:makeSettings()},undefined,headers);
    assert.equal(response.status,201);return {headers,body:await response.json()};
  };
  const stopped=await create();
  await f.api(`/api/subscriptions/${stopped.body.id}`,'DELETE',undefined,stopped.body.manageToken);
  const disabled=await f.api('/api/subscriptions','POST',{settings:makeSettings()},undefined,stopped.headers);
  assert.equal(disabled.status,410);assert.equal((await disabled.json()).code,'creation_disabled');
  const expiring=await create();
  f.tick(7*86400000-1);
  assert.equal((await f.api('/api/subscriptions','POST',{settings:makeSettings()},undefined,expiring.headers)).status,200);
  f.tick(1);
  const expired=await f.api('/api/subscriptions','POST',{settings:makeSettings()},undefined,expiring.headers);
  assert.equal(expired.status,410);assert.equal((await expired.json()).code,'creation_expired');
  const rotated=await create();f.env.RATE_LIMIT_SALT='another-test-only-secret';
  const changed=await f.api('/api/subscriptions','POST',{settings:makeSettings()},undefined,rotated.headers);
  assert.equal(changed.status,410);assert.equal((await changed.json()).code,'creation_unrecoverable');
  assert.equal((await f.db.prepare('SELECT count(*) AS total FROM subscriptions').first()).total,3);
  const row=await f.db.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(stopped.body.id).first();
  assert.equal(row.disabled,1);assert.equal(row.settings_json,'{}');assert.equal(row.revision,2);
});

test('idempotency validates keys, keeps legacy creation working and permits replay after the create limit', async t => {
  const f=fixture(t), headers={'CF-Connecting-IP':'192.0.2.4'};
  for(const key of ['', 'x'.repeat(42), 'A'.repeat(42)+'B', 'A'.repeat(44)]) {
    const bad=await f.api('/api/subscriptions','POST',{settings:makeSettings()},undefined,{...headers,'Idempotency-Key':key});
    assert.equal(bad.status,400);assert.equal((await bad.json()).code,'creation_key_invalid');
  }
  assert.equal((await f.db.prepare('SELECT count(*) AS total FROM creation_limits').first()).total,0);
  const key=newCreationKey();
  const first=await f.api('/api/subscriptions','POST',{settings:makeSettings()},undefined,{...headers,'Idempotency-Key':key});
  assert.equal(first.status,201);
  const original=await first.json();
  for(let index=0;index<19;index++) assert.equal((await f.api('/api/subscriptions','POST',{settings:makeSettings()},undefined,headers)).status,201);
  assert.equal((await f.api('/api/subscriptions','POST',{settings:makeSettings()},undefined,headers)).status,429);
  const replay=await f.api('/api/subscriptions','POST',{settings:makeSettings()},undefined,{...headers,'Idempotency-Key':key});
  assert.equal(replay.status,200);assert.equal((await replay.json()).id,original.id);
  assert.equal((await f.db.prepare('SELECT count FROM creation_limits').first()).count,20);
  assert.equal((await f.db.prepare('SELECT count(*) AS total FROM subscriptions WHERE creation_key_hash IS NULL').first()).total,19);
  const cors=await f.fetch('/api/subscriptions',{method:'OPTIONS',headers:{Origin:ORIGIN,'Access-Control-Request-Headers':'idempotency-key,content-type'}});
  assert.equal(cors.status,204);assert.match(cors.headers.get('Access-Control-Allow-Headers'),/Idempotency-Key/);
});

test('idempotent creation does not disguise a database failure as a valid replay', async t => {
  const f=fixture(t), headers={'Idempotency-Key':newCreationKey()};
  f.db.batch=async()=>{throw new Error('synthetic storage failure');};
  const response=await f.api('/api/subscriptions','POST',{settings:makeSettings()},undefined,headers);
  assert.equal(response.status,503);
  assert.equal((await f.db.prepare('SELECT count(*) AS total FROM subscriptions').first()).total,0);
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
  // All-day alarms are relative to the civil day (08:00 = 480 minutes after midnight).
  assert.equal(event.getFirstSubcomponent('valarm').getFirstPropertyValue('trigger').toSeconds(), 8 * 3600);
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
  assert.equal(event.getFirstSubcomponent('valarm').getFirstPropertyValue('trigger').toSeconds(), 9.5 * 3600);
  const stale = await f.api(`/api/subscriptions/${created.id}`, 'PATCH',
    {settings: makeSettings('off'), revision: 1}, created.manageToken);
  assert.equal(stale.status, 409);
  const same = await f.api(`/api/subscriptions/${created.id}`, 'PATCH',
    {settings: updated.settings, revision: 2}, created.manageToken);
  assert.equal((await same.json()).revision, 2);
});

test('a timezone-rule change republishes the ledger with stable UID, a new sequence and ETag; triggers stay civil', async t => {
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
  assert.deepEqual(event.getAllSubcomponents('valarm').map(alarm => alarm.getFirstPropertyValue('trigger').toSeconds()),
    [8 * 3600, -4 * 3600]);
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
  assert.equal(event.getFirstSubcomponent('valarm').getFirstPropertyValue('trigger').toSeconds(), 8 * 3600);
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

test('date corrections use the same UID; deselection drops the event from the feed and keeps a ledger tombstone', async t => {
  const f = fixture(t), created = await f.create();
  const initial = f.entries(await (await f.fetch(created.feedUrl)).text())[0];
  f.data.occurrences[0].date = '2027-03-21'; f.tick(60000);
  const [corrected] = f.entries(await (await f.fetch(created.feedUrl)).text());
  assert.equal(corrected.getFirstPropertyValue('uid'), initial.getFirstPropertyValue('uid'));
  assert.equal(corrected.getFirstPropertyValue('sequence'), 1);
  assert.equal(corrected.getFirstPropertyValue('dtstart').toString(), '2027-03-21');
  await f.api(`/api/subscriptions/${created.id}`, 'PATCH',
    {settings: makeSettings('off'), revision: 1}, created.manageToken);
  assert.equal(f.entries(await (await f.fetch(created.feedUrl)).text()).length, 0, 'a deselected day leaves the feed');
  const tombstone = await f.db.prepare('SELECT * FROM calendar_entries').first();
  assert.ok(tombstone.cancelled_at);
  assert.equal(tombstone.sequence, 2);
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

test('source removals drop events from the feed and an advancing rolling window publishes new dates automatically', async t => {
  const f = fixture(t), created = await f.create();
  await f.fetch(created.feedUrl);
  f.data.occurrences.length = 0;
  assert.equal(f.entries(await (await f.fetch(created.feedUrl)).text()).length, 0);
  f.data.occurrences.push({id: 'test', eventId: 'test', uid: 'test-2028-month-1', date: '2028-10-25',
    title: '莲师荟供日', tibetan: '九月初十', source: 'https://www.fohuifayu.com/index.php/calendar'});
  assert.equal(f.entries(await (await f.fetch(created.feedUrl)).text()).length, 0, 'not yet inside the rolling window');
  f.tick(10 * 86400000);
  const all = f.entries(await (await f.fetch(created.feedUrl)).text());
  assert.equal(all.length, 1);
  assert.equal(all.filter(event => event.getFirstPropertyValue('status') === 'CONFIRMED').length, 1);
});

test('disable erases preferences, empties the feed, and purges event content after retention', async t => {
  const f = fixture(t), created = await f.create();
  await f.fetch(created.feedUrl);
  const removed = await f.api(`/api/subscriptions/${created.id}`, 'DELETE', undefined, created.manageToken);
  assert.equal(removed.status, 200);
  const stored = await f.db.prepare('SELECT * FROM subscriptions').first();
  assert.equal(stored.settings_json, '{}');
  const stoppedText = await (await f.fetch(created.feedUrl)).text();
  assert.equal(f.entries(stoppedText).length, 0);
  assert.doesNotMatch(stoppedText, /BEGIN:VALARM/);
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
  // The phone resolves 01:30 on the overlap day itself; the feed carries one civil offset.
  assert.equal(alarms[0].getFirstPropertyValue('trigger').toSeconds(), 90 * 60);
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

test('a deployed snapshot digest avoids full calendar data loading on GET, HEAD, 304 and health', async t => {
  const f = fixture(t);
  f.release.dataVersion = 'audited-build-data-digest';
  const created = await f.create(), first = await f.fetch(created.feedUrl);
  const reads = f.dataReads, calls = {...f.calls};
  for (const options of [{}, {method: 'HEAD'}, {headers: {'If-None-Match': first.headers.get('ETag')}}]) {
    assert.ok([200, 304].includes((await f.fetch(created.feedUrl, options)).status));
  }
  assert.equal((await f.fetch('/healthz')).status, 200);
  assert.equal(f.dataReads, reads);
  assert.deepEqual(f.calls, calls);
  f.release.dataVersion = 'updated-build-data-digest';
  assert.equal((await f.fetch(created.feedUrl)).status, 200);
  assert.equal(f.dataReads, reads + 1);
  assert.equal(f.calls.export, calls.export + 1);
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
  const stopped = await f.fetch(created.feedUrl);
  const text = await stopped.text();
  assert.doesNotMatch(text, /BEGIN:VALARM/);
  assert.doesNotMatch(text, /BEGIN:VEVENT/);
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
  assert.doesNotMatch(text, /BEGIN:VEVENT/);
  assert.doesNotMatch(text, /BEGIN:VALARM/);
  const row = await f.db.prepare('SELECT * FROM calendar_entries').first();
  assert.ok(row.cancelled_at, 'the cancellation is kept in the ledger');
  assert.equal(row.sequence, 1);
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

test('an older database gains creation idempotency without changing credentials, revisions or published entries', async t => {
  const f=fixture(t), created=await f.create();await f.fetch(created.feedUrl);
  const before=await f.db.prepare('SELECT * FROM calendar_entries').first();
  const subscription=await f.db.prepare('SELECT * FROM subscriptions').first();
  await f.db.exec('DROP INDEX subscriptions_creation_key; ALTER TABLE subscriptions DROP COLUMN creation_key_hash; ALTER TABLE subscriptions DROP COLUMN creation_body_hash;');
  assert.equal((await f.fetch('/healthz')).status,503);
  f.reopen();
  assert.equal((await f.fetch('/healthz')).status,200);
  assert.deepEqual(await f.db.prepare('SELECT * FROM subscriptions').first(),subscription);
  assert.deepEqual(await f.db.prepare('SELECT * FROM calendar_entries').first(),before);
  assert.equal((await f.api(`/api/subscriptions/${created.id}`,'GET',undefined,created.manageToken)).status,200);
  await f.db.exec('DROP INDEX subscriptions_creation_key');
  assert.equal((await f.fetch('/healthz')).status,503);
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

test('feed fetches are recorded per calendar app at most once an hour, never blocking the feed', async t => {
  const f = fixture(t), created = await f.create();
  const google = 'Google-Calendar-Importer', iphone = 'iOS/18.1 (22B83) dataaccessd/1.0';
  const rows = async () => (await f.db.prepare('SELECT client, user_agent, first_seen_at, last_seen_at FROM feed_fetches ORDER BY client').all()).results;
  assert.equal((await f.fetch(created.feedUrl, {headers: {'User-Agent': google}})).status, 200);
  assert.equal((await f.fetch(created.feedUrl, {headers: {'User-Agent': iphone}})).status, 200);
  let seen = await rows();
  assert.deepEqual(seen.map(row => row.client), ['apple', 'google']);
  const first = seen.find(row => row.client === 'google').last_seen_at;
  f.tick(20 * 60000);
  await f.fetch(created.feedUrl, {headers: {'User-Agent': google}});
  assert.equal((await rows()).find(row => row.client === 'google').last_seen_at, first, 'within the hour: no write');
  f.tick(61 * 60000);
  await f.fetch(created.feedUrl, {headers: {'User-Agent': google}});
  seen = await rows();
  assert.notEqual(seen.find(row => row.client === 'google').last_seen_at, first);
  assert.equal(seen.find(row => row.client === 'google').first_seen_at, first);
  // A broken log never breaks the feed.
  await f.db.prepare('DROP TABLE feed_fetches').run();
  assert.equal((await f.fetch(created.feedUrl, {headers: {'User-Agent': google}})).status, 200);
});

test('calendar apps are told apart by User-Agent', () => {
  assert.equal(clientFamily('Google-Calendar-Importer'), 'google');
  assert.equal(clientFamily('iOS/18.1 (22B83) dataaccessd/1.0'), 'apple');
  assert.equal(clientFamily('macOS/15.1 (24B83) CalendarAgent/1000'), 'apple');
  assert.equal(clientFamily('Mozilla/5.0 (Linux; Android 14; 23078RKD5C Build/UKQ1) MIUI/V816'), 'xiaomi');
  assert.equal(clientFamily('Microsoft Office/16.0 (Windows NT 10.0; Microsoft Outlook 16.0)'), 'outlook');
  assert.equal(clientFamily('okhttp/4.12.0'), 'android');
  assert.equal(clientFamily(''), 'other');
});
