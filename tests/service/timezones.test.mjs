import test from 'node:test';
import assert from 'node:assert/strict';
import {SQLiteD1} from '../../service/calendar/sqlite-d1.mjs';
import {createCalendarService} from '../../service/calendar/service.mjs';
import {validateSettings, exportICS, addDays, rangeEnd} from '../../static/calendar-reminders/core.mjs';

test('anonymous subscription accepts global aliases, retains preferences and keeps feed URL on timezone edit', async t => {
  const DB = new SQLiteD1(':memory:');
  t.after(() => DB.close());
  const catalog = {events: [{id: 'test', title: '莲师荟供日'}]};
  const service = createCalendarService({getData: () => ({catalog}), validateSettings, exportICS,
    selectOccurrences: () => [], now: () => new Date('2026-10-22T00:00:00Z')});
  const env = {DB, PUBLIC_BASE_URL: 'https://calendar.example.org', ALLOWED_ORIGINS: 'https://www.example.org', RATE_LIMIT_SALT: 'test-timezones'};
  const request = (path, method, body, token) => service.fetch(new Request('https://calendar.example.org' + path, {
    method, headers: {Origin: env.ALLOWED_ORIGINS, 'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})},
    ...(body ? {body: JSON.stringify(body)} : {})
  }), env);
  const events = {test: {mode: 'remind', reminders: [{daysBefore: 1, time: '20:00'}, {daysBefore: 0, time: '08:00'}]}};
  const response = await request('/api/subscriptions', 'POST', {settings: {version: 2, zone: 'Asia/Katmandu', events}});
  assert.equal(response.status, 201, await response.clone().text());
  const created = await response.json();
  assert.equal(created.settings.zone, 'Asia/Kathmandu');
  const update = await request(`/api/subscriptions/${created.id}`, 'PATCH', {
    revision: created.revision, settings: {...created.settings, zone: 'Australia/Eucla'}
  }, created.manageToken);
  assert.equal(update.status, 200, await update.clone().text());
  const changed = await update.json();
  assert.equal(changed.feedUrl, created.feedUrl);
  assert.equal(changed.settings.zone, 'Australia/Eucla');
  assert.deepEqual(changed.settings.events, events);
});

test('service rolling window uses corrected Vancouver civil date at a stale-runtime midnight boundary', async t => {
  const DB = new SQLiteD1(':memory:');
  t.after(() => DB.close());
  const observed = [];
  const service = createCalendarService({getData: () => ({catalog: {events: []}}), validateSettings, exportICS,
    selectOccurrences: (_, __, range) => { observed.push(range); return []; },
    now: () => new Date('2026-11-22T07:30:00Z')});
  const env = {DB, PUBLIC_BASE_URL: 'https://calendar.example.org', ALLOWED_ORIGINS: 'https://www.example.org', RATE_LIMIT_SALT: 'test-date'};
  const response = await service.fetch(new Request('https://calendar.example.org/api/subscriptions', {
    method: 'POST', headers: {Origin: env.ALLOWED_ORIGINS, 'Content-Type': 'application/json'},
    body: JSON.stringify({settings: {version: 2, zone: 'America/Vancouver', events: {}}})
  }), env);
  assert.equal(response.status, 201, await response.clone().text());
  assert.ok(observed.length > 0);
  for (const range of observed) assert.deepEqual(range, {start: addDays('2026-11-22', -90), end: rangeEnd('2026-11-22', 24)});
});
