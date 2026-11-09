// Local CPU profile of feed regeneration (not Cloudflare CPU). Usage:
//   node --cpu-prof --cpu-prof-dir=<dir> tools/calendar/profile-feed.mjs [cold|daily|renderer]
import fs from 'node:fs/promises';
import {SQLiteD1} from '../../service/calendar/sqlite-d1.mjs';
import {createCalendarService} from '../../service/calendar/service.mjs';
import {defaults, validateSettings, selectOccurrences, exportICS} from '../../static/calendar-reminders/core.mjs';
import {applyPreset} from '../../static/calendar-reminders/presets.mjs';

const mode = process.argv[2] || 'daily';
const data = JSON.parse(await fs.readFile('static/calendar-reminders/calendar-data.json', 'utf8'));
const origin = 'https://local-measurement.example';
let clock = Date.parse('2026-11-02T04:00:00Z');
const release = {version: 'p', dataVersion: 'd', rendererVersion: 'r0', environment: 'local'};
const env = {DB: new SQLiteD1(':memory:'), PUBLIC_BASE_URL: origin, ALLOWED_ORIGINS: origin, RATE_LIMIT_SALT: 'x'};
const service = createCalendarService({getData: () => data, validateSettings, selectOccurrences, exportICS, now: () => new Date(clock), release: () => release, getRelease: () => release});
let settings = applyPreset(defaults(data.catalog, 'Asia/Shanghai'), data.catalog, 'practice');
for (const value of Object.values(settings.events)) if (value.mode !== 'off') { value.mode = 'remind'; value.reminders = [{daysBefore: 0, time: '08:00'}, {daysBefore: 1, time: '20:00'}]; }
settings.includeDailyDates = true;
const created = await (await service.fetch(new Request(`${origin}/api/subscriptions`, {method: 'POST', headers: {Origin: origin, 'Content-Type': 'application/json'}, body: JSON.stringify({settings})}), env)).json();
const read = async () => { const r = await service.fetch(new Request(created.feedUrl), env); await r.text(); return r.status; };
await read();
const times = [];
for (let i = 0; i < 20; i++) {
  if (mode === 'daily') clock += 86400000;          // next day: window slides, most entries unchanged
  if (mode === 'renderer') release.rendererVersion = 'r' + (i + 1); // snapshot invalidated, nothing changed
  if (mode === 'cold') { env.DB.database.exec('DELETE FROM calendar_entries; DELETE FROM feed_snapshots;'); }
  const t = performance.now(); await read(); times.push(performance.now() - t);
}
times.sort((a, b) => a - b);
console.log(JSON.stringify({mode, medianMs: +times[10].toFixed(1), p90Ms: +times[18].toFixed(1)}));
