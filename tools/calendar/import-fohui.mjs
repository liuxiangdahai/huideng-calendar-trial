// Initial full import from downloaded public month pages; never execute source HTML.
// For later updates use fohui-diff.mjs, which records changes and keeps record IDs.
// Usage: node tools/calendar/import-fohui.mjs ../research --retrieved-on 2026-10-20
import fs from 'node:fs';
import path from 'node:path';
import {parseMonthPage, monthFile} from './fohui-source.mjs';

const folder = path.resolve(process.argv[2] || '../research');
const dateIndex = process.argv.indexOf('--retrieved-on');
const retrievedOn = dateIndex >= 0 ? process.argv[dateIndex + 1] : '';
if (!/^\d{4}-\d{2}-\d{2}$/.test(retrievedOn)) throw new Error('Provide --retrieved-on YYYY-MM-DD for source provenance.');
const days = [], snapshots = [];
for (const name of fs.readdirSync(folder).sort()) {
  const ym = monthFile(name);
  if (!ym) continue;
  const parsed = parseMonthPage(fs.readFileSync(path.join(folder, name), 'utf8'), ...ym);
  days.push(...parsed.days);
  if (parsed.days.length) snapshots.push(parsed.snapshot);
}
days.sort((a, b) => a.date.localeCompare(b.date));
if (days.length < 365 || new Set(days.map(d => d.date)).size !== days.length) {
  throw new Error('Source range too short or duplicate Gregorian dates');
}
for (let i = 1; i < days.length; i++) {
  if (Date.parse(days[i].date) - Date.parse(days[i - 1].date) !== 86400000) {
    throw new Error(`Source gap after ${days[i - 1].date}; fetch the missing month before building.`);
  }
}
const output = {schemaVersion: 1, sourceName: '佛慧法语藏历', retrievedOn,
  start: days[0].date, end: days.at(-1).date, snapshots, days};
fs.mkdirSync('data/calendar', {recursive: true});
fs.writeFileSync('data/calendar/fohui-dates.json', JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({days: days.length, start: output.start, end: output.end,
  labels: [...new Set(days.flatMap(d => d.labels))]}, null, 2));
