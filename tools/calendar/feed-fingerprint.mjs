// Byte-level fingerprint of generated feeds and ledgers, to prove a
// performance change leaves every published byte unchanged.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {SQLiteD1} from '../../service/calendar/sqlite-d1.mjs';
import {createCalendarService} from '../../service/calendar/service.mjs';
import {defaults, validateSettings, selectOccurrences, exportICS} from '../../static/calendar-reminders/core.mjs';
import {applyPreset} from '../../static/calendar-reminders/presets.mjs';
const data = JSON.parse(await fs.readFile('static/calendar-reminders/calendar-data.json', 'utf8'));
const origin = 'https://local-measurement.example', out = {};
for (const zone of ['Asia/Shanghai', 'America/Los_Angeles', 'Australia/Lord_Howe', 'Asia/Kathmandu']) for (const marks of ['none', 'symbols']) {
  let clock = Date.parse('2026-11-02T04:00:00Z');
  const release = {version: 'p', dataVersion: 'd', rendererVersion: 'r', environment: 'local'};
  const env = {DB: new SQLiteD1(':memory:'), PUBLIC_BASE_URL: origin, ALLOWED_ORIGINS: origin, RATE_LIMIT_SALT: 'x'};
  const service = createCalendarService({getData: () => data, validateSettings, selectOccurrences, exportICS, now: () => new Date(clock), getRelease: () => release});
  let settings = applyPreset(defaults(data.catalog, zone), data.catalog, 'practice');
  for (const value of Object.values(settings.events)) if (value.mode !== 'off') { value.mode = 'remind'; value.reminders = [{daysBefore: 0, time: '02:30'}, {daysBefore: 1, time: '20:00'}]; }
  settings.includeDailyDates = true; if (marks === 'symbols') settings.titleMarks = 'symbols';
  const created = await (await service.fetch(new Request(`${origin}/api/subscriptions`, {method: 'POST', headers: {Origin: origin, 'Content-Type': 'application/json'}, body: JSON.stringify({settings})}), env)).json();
  const h = createHash('sha256');
  for (let day = 0; day < 4; day++) {
    const r = await service.fetch(new Request(created.feedUrl), env); h.update(await r.text());
    clock += 86400000 * 37;
  }
  for (const row of env.DB.database.prepare('SELECT uid, content_hash, event_json, sequence FROM calendar_entries ORDER BY uid').all()) h.update(JSON.stringify(row));
  out[`${zone}|${marks}`] = h.digest('hex').slice(0, 16);
}
console.log(JSON.stringify(out));
