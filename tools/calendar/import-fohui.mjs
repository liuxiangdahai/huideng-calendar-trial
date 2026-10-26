// Import date facts from downloaded public month pages; never execute source HTML.
// Usage: node tools/calendar/import-fohui.mjs ../research --retrieved-on 2026-10-20
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const folder = path.resolve(process.argv[2] || '../research');
const dateIndex = process.argv.indexOf('--retrieved-on');
const retrievedOn = dateIndex >= 0 ? process.argv[dateIndex + 1] : '';
if (!/^\d{4}-\d{2}-\d{2}$/.test(retrievedOn)) throw new Error('Provide --retrieved-on YYYY-MM-DD for source provenance.');
const decode = value => value.replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
const text = value => decode(value).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim();
const days = [], snapshots = [];
for (const name of fs.readdirSync(folder).sort()) {
  const match = name.match(/^fohui-(\d{4})-(\d{1,2})\.html$/);
  if (!match) continue;
  const [year, month] = match.slice(1).map(Number);
  const html = fs.readFileSync(path.join(folder, name), 'utf8');
  const url = `https://www.fohuifayu.com/index.php/calendar/monthcalendar/${year}/${month}/-`;
  let count = 0;
  for (const cell of html.matchAll(/<td\b[^>]*class="cal_dayshasevents\b[^"]*"[^>]*>([\s\S]*?)<\/td>/g)) {
    const dayMatch = cell[1].match(/class="cal_daylink">\s*(\d+)/);
    const info = cell[1].match(/class="eventfull[^"]*"[^>]*title="([^"]*)"[^>]*data-content="([^"]*)"/);
    if (!dayMatch || !info) throw new Error(`Unrecognized date markup: ${name}`);
    const date = `${year}-${String(month).padStart(2, '0')}-${dayMatch[1].padStart(2, '0')}`;
    const tibetan = text(info[1]).replace(/^藏历[：:]\s*/, '');
    const labels = text(info[2]).split(/\n/).map(s => s.trim()).filter(Boolean);
    if (!tibetan.includes('月')) throw new Error(`Missing Tibetan date: ${date}`);
    days.push({date, tibetan, labels, source: url});
    count++;
  }
  if (count) snapshots.push({url, sha256: crypto.createHash('sha256').update(html).digest('hex'), days: count});
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
