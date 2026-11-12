// Compare saved 佛慧法语 month pages with the confirmed data; optionally merge.
// Usage:
//   node tools/calendar/fohui-diff.mjs <folder> --retrieved-on YYYY-MM-DD            # report only
//   node tools/calendar/fohui-diff.mjs <folder> --retrieved-on YYYY-MM-DD --apply    # merge + record changes
//   add --accept-removals only after confirming on 佛慧法语 that an occurrence was withdrawn.
// Offline fallback for saved pages (fohui-YYYY-M.html). The separately authorized
// scheduled collector is fohui-maintain.mjs; this command itself never fetches.
import fs from 'node:fs';
import path from 'node:path';
import {parseMonthPage, assertCompleteMonth, monthFile, diffSource, mergeSource} from './fohui-source.mjs';
import {factsDigest} from './fohui-maintenance-core.mjs';

const args = process.argv.slice(2);
const folder = path.resolve(args.find(a => !a.startsWith('--') && !/^\d{4}-\d{2}-\d{2}$/.test(a)) || '');
const flag = name => args.includes(name);
const retrievedOn = args[args.indexOf('--retrieved-on') + 1];
if (!fs.existsSync(folder) || !/^\d{4}-\d{2}-\d{2}$/.test(retrievedOn || '')) throw new Error('用法：fohui-diff.mjs <网页文件夹> --retrieved-on YYYY-MM-DD [--apply] [--accept-removals]');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const existing = read('data/calendar/fohui-dates.json'), catalog = read('data/calendar/catalog.json');
const ledger = read('data/calendar/published-record-ids.json');
const incoming = [], snapshots = [];
const files = fs.readdirSync(folder).map(name => ({name, ym: monthFile(name)})).filter(file => file.ym)
  .sort((a, b) => a.ym[0] - b.ym[0] || a.ym[1] - b.ym[1]);
for (const [index, {name, ym}] of files.entries()) {
  const {days, snapshot} = parseMonthPage(fs.readFileSync(path.join(folder, name), 'utf8'), ...ym);
  assertCompleteMonth(days, ...ym, {allowTrailing: index === files.length - 1});
  incoming.push(...days); snapshots.push(snapshot);
}
incoming.sort((a, b) => a.date.localeCompare(b.date));
if (!incoming.length) throw new Error('文件夹中没有 fohui-YYYY-M.html 月份页面。');
const changes = diffSource({existing, incoming, catalog, ledger});
const report = {retrievedOn, months: snapshots.map(s => s.url), range: [incoming[0].date, incoming.at(-1).date], changes};
console.log(JSON.stringify(report, null, 2));
if (!flag('--apply')) process.exit(changes.some(c => c.blocking) ? 2 : 0);
const merged = mergeSource({existing, incoming, snapshots, ledger, changes, retrievedOn, acceptRemovals: flag('--accept-removals')});
if (factsDigest(merged.source.days) === factsDigest(existing.days)) {
  console.error('原历事实没有变化，未改写资料日期、记录或发布版本。');
  process.exit(0);
}
fs.writeFileSync('data/calendar/fohui-dates.json', JSON.stringify(merged.source, null, 2) + '\n');
fs.writeFileSync('data/calendar/published-record-ids.json', JSON.stringify(merged.ledger, null, 2) + '\n');
const logFile = 'data/calendar/fohui-changes.json';
const log = fs.existsSync(logFile) ? read(logFile) : {schemaVersion: 1, note: '佛慧法语原历变更记录。名称与安排以佛慧法语为准；此文件只记录，不覆盖来源。', entries: []};
for (const change of changes) log.entries.push({recordedFrom: retrievedOn, ...change});
fs.writeFileSync(logFile, JSON.stringify(log, null, 2) + '\n');
console.error(`已合并 ${incoming.length} 天、记录 ${changes.length} 项变更。请运行 npm run check:calendar 生成资料并核对。`);
